import * as child_process from 'child_process'
import * as path from 'path'
import * as vscode from 'vscode'
import sharedLogic, { Feature } from './shared/logic'
import * as ElmToAst from './shared/elm-to-ast'
import * as ElmSyntax from './shared/elm-to-ast/elm-syntax'
import { GlobalState } from './shared/autodetect-elm-json'

export const feature: Feature = ({ globalState, context }) => {
  context.subscriptions.push(
    vscode.languages.registerReferenceProvider('elm', provider(globalState))
  )
  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider('elm', codeLensProvider(globalState))
  )
}

const provider = (globalState: GlobalState) => {
  return {
    async provideReferences(
      doc: vscode.TextDocument,
      position: vscode.Position,
      context: vscode.ReferenceContext,
      token: vscode.CancellationToken
    ): Promise<vscode.Location[] | undefined> {
      // Allow user to disable this feature
      const isEnabled: boolean = vscode.workspace.getConfiguration('elmLand').feature.findReferences
      if (!isEnabled) return

      const start = Date.now()

      const elmJsonFile = sharedLogic.findElmJsonFor(globalState, doc.uri)
      if (!elmJsonFile) return

      // Get the word at the cursor position
      const wordRange = doc.getWordRangeAtPosition(position, /[a-zA-Z0-9_]+/)
      if (!wordRange) return
      const word = doc.getText(wordRange)
      if (!word) return

      // Get the module name from the current file's AST
      const ast = await ElmToAst.run(doc.getText(), token)
      if (!ast) return

      const moduleData = ElmSyntax.toModuleData(ast)
      const moduleName = moduleData.moduleName.value.join('.')

      // Read the configured binary path
      const elmFindBinary: string = vscode.workspace.getConfiguration('elmLand').elmFindFilepath || 'elm-find'
      const projectFolder = elmJsonFile.projectFolder

      const kind = getKindAtPosition(ast, position)

      const definitions = await runElmFind({
        binary: elmFindBinary,
        name: word,
        kind,
        moduleName,
        projectFolder,
        token
      })

      if (!definitions) return

      const locations: vscode.Location[] = []

      for (const definition of definitions) {
        // Optionally include the declaration itself
        if (context.includeDeclaration) {
          const defUri = vscode.Uri.file(path.resolve(projectFolder, definition.file))
          locations.push(new vscode.Location(defUri, fromElmFindRegion(definition.region)))
        }

        // Include all usages (exclude mentions — type annotations and exposing clauses)
        for (const usage of definition.usages) {
          if (usage.tag === 'mention') continue
          const usageUri = vscode.Uri.file(path.resolve(projectFolder, usage.file))
          locations.push(new vscode.Location(usageUri, fromElmFindRegion(usage.region)))
        }
      }

      console.info('provideReferences', `${Date.now() - start}ms`)
      return locations
    }
  }
}

type ElmFindRegion = {
  start: { line: number; column: number }
  end: { line: number; column: number }
}

type ElmFindUsage = {
  file: string
  module: string
  region: ElmFindRegion
  tag: 'usage' | 'mention'
}

type ElmFindKind = 'value' | 'type' | 'ctor'

type ElmFindDefinition = {
  name: string
  kind: ElmFindKind
  file: string
  module: string
  region: ElmFindRegion
  usages: ElmFindUsage[]
}

type ElmCodeLens = vscode.CodeLens & {
  data: { name: string; kind: ElmFindKind | undefined; moduleName: string; projectFolder: string; docUri: vscode.Uri }
}

const codeLensProvider = (globalState: GlobalState) => {
  return {
    async provideCodeLenses(
      doc: vscode.TextDocument,
      token: vscode.CancellationToken
    ): Promise<vscode.CodeLens[]> {
      const isEnabled: boolean = vscode.workspace.getConfiguration('elmLand').feature.referencesCodeLens
      if (!isEnabled) return []

      const elmJsonFile = sharedLogic.findElmJsonFor(globalState, doc.uri)
      if (!elmJsonFile) return []

      const ast = await ElmToAst.run(doc.getText(), token)
      if (!ast) return []

      const moduleName = ElmSyntax.toModuleData(ast).moduleName.value.join('.')
      const lenses: ElmCodeLens[] = []

      for (const declaration of ast.declarations) {
        const name = ElmSyntax.toDeclarationName(declaration)
        if (!name) continue

        const kind = getKindForDeclaration(declaration)
        const range = sharedLogic.fromElmRange(declaration.range)
        const lens = new vscode.CodeLens(range) as ElmCodeLens
        lens.data = { name, kind, moduleName, projectFolder: elmJsonFile.projectFolder, docUri: doc.uri }
        lenses.push(lens)
      }

      return lenses
    },

    async resolveCodeLens(
      codeLens: vscode.CodeLens,
      token: vscode.CancellationToken
    ): Promise<vscode.CodeLens> {
      const lens = codeLens as ElmCodeLens
      const { name, kind, moduleName, projectFolder, docUri } = lens.data

      const elmFindBinary: string = vscode.workspace.getConfiguration('elmLand').elmFindFilepath || 'elm-find'
      const definitions = await runElmFind({ binary: elmFindBinary, name, kind, moduleName, projectFolder, token })

      const locations: vscode.Location[] = []
      for (const definition of definitions ?? []) {
        for (const usage of definition.usages) {
          if (usage.tag === 'mention') continue
          const usageUri = vscode.Uri.file(path.resolve(projectFolder, usage.file))
          locations.push(new vscode.Location(usageUri, fromElmFindRegion(usage.region)))
        }
      }

      const count = locations.length
      lens.command = {
        title: `${count} reference${count === 1 ? '' : 's'}`,
        command: 'editor.action.showReferences',
        arguments: [docUri, lens.range.start, locations]
      }

      return lens
    }
  }
}

// Determine the elm-find kind for a symbol at a given cursor position by inspecting declarations.
// Returns undefined when the cursor is at a usage site rather than a definition.
const getKindAtPosition = (ast: ElmSyntax.Ast, position: vscode.Position): ElmFindKind | undefined => {
  const inRange = (range: ElmSyntax.Range) => sharedLogic.fromElmRange(range).contains(position)

  for (const decl of ast.declarations) {
    switch (decl.value.type) {
      case 'function':
        if (inRange(decl.value.function.declaration.value.name.range)) return 'value'
        break
      case 'typeAlias':
        if (inRange(decl.value.typeAlias.name.range)) return 'type'
        break
      case 'typedecl':
        if (inRange(decl.value.typedecl.name.range)) return 'type'
        for (const ctor of decl.value.typedecl.constructors) {
          if (inRange(ctor.value.name.range)) return 'ctor'
        }
        break
    }
  }
  return undefined
}

// Determine the elm-find kind for a top-level declaration (used by CodeLens).
const getKindForDeclaration = (declaration: ElmSyntax.Node<ElmSyntax.Declaration>): ElmFindKind | undefined => {
  switch (declaration.value.type) {
    case 'function': return 'value'
    case 'typeAlias': return 'type'
    case 'typedecl': return 'type'
    case 'port': return 'value'
    default: return undefined
  }
}

// Convert 1-based elm-find positions to 0-based VS Code positions
const fromElmFindRegion = (region: ElmFindRegion): vscode.Range =>
  new vscode.Range(
    region.start.line - 1,
    region.start.column - 1,
    region.end.line - 1,
    region.end.column - 1
  )

type RunElmFindInput = {
  binary: string
  name: string
  kind: ElmFindKind | undefined
  moduleName: string
  projectFolder: string
  token: vscode.CancellationToken
}

const runElmFind = (input: RunElmFindInput): Promise<ElmFindDefinition[] | undefined> => {
  return new Promise((resolve) => {
    const { binary, name, kind, moduleName, projectFolder, token } = input

    const args = [name, '--module', moduleName, '--project', projectFolder]
    if (kind) args.push('--kind', kind)
    const child = child_process.spawn(binary, args, { env: sharedLogic.npxEnv() })

    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (data: Buffer) => { stdout += data.toString() })
    child.stderr.on('data', (data: Buffer) => { stderr += data.toString() })

    child.on('error', (err: Error & { code?: string }) => {
      if (err.code !== 'ENOENT') {
        console.error('elm-find error:', err.message)
      }
      resolve(undefined)
    })

    child.on('close', (code: number) => {
      if (code !== 0) {
        resolve(undefined)
        return
      }
      try {
        const definitions: ElmFindDefinition[] = JSON.parse(stdout)
        resolve(definitions)
      } catch (_) {
        resolve(undefined)
      }
    })

    token.onCancellationRequested(() => {
      child.kill()
      resolve(undefined)
    })
  })
}
