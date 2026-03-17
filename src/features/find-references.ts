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
  context.subscriptions.push(
    vscode.commands.registerCommand('elmLand.removeDeclaration', async (
      docUri: vscode.Uri,
      declRange: vscode.Range,
      projectFolder: string,
      mentions: ElmFindUsage[]
    ) => {
      const wsEdit = new vscode.WorkspaceEdit()
      const cancelSource = new vscode.CancellationTokenSource()

      // Delete the declaration lines
      wsEdit.delete(docUri, new vscode.Range(
        new vscode.Position(declRange.start.line, 0),
        new vscode.Position(declRange.end.line + 1, 0)
      ))

      // Group mentions by file and remove each from its exposing list
      const fileToMentions = new Map<string, ElmFindUsage[]>()
      for (const mention of mentions) {
        const absPath = path.resolve(projectFolder, mention.file)
        const existing = fileToMentions.get(absPath) ?? []
        existing.push(mention)
        fileToMentions.set(absPath, existing)
      }

      for (const [absPath, fileMentions] of fileToMentions) {
        const fileUri = vscode.Uri.file(absPath)
        const doc = await vscode.workspace.openTextDocument(fileUri)
        const ast = await ElmToAst.run(doc.getText(), cancelSource.token)
        if (!ast) continue

        for (const mention of fileMentions) {
          removeFromAnyExposingList(wsEdit, fileUri, doc, ast, mention.region)
        }
      }

      cancelSource.dispose()
      await vscode.workspace.applyEdit(wsEdit)
    })
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
      const isUnusedDeclarationsEnabled: boolean = vscode.workspace.getConfiguration('elmLand').feature.unusedDeclarations
      const mentions = (definitions ?? []).flatMap(d => d.usages).filter(u => u.tag === 'mention')
      if (count === 0 && isUnusedDeclarationsEnabled && name !== 'main') {
        lens.command = {
          title: 'Remove unused code',
          command: 'elmLand.removeDeclaration',
          arguments: [docUri, lens.range, projectFolder, mentions]
        }
      } else {
        lens.command = {
          title: `${count} reference${count === 1 ? '' : 's'}`,
          command: 'editor.action.showReferences',
          arguments: [docUri, lens.range.start, locations]
        }
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

// Scan all exposing lists in a file's AST and remove the item matching the mention's region.
// Uses adjacent item ranges to include the surrounding comma and whitespace cleanly.
const removeFromAnyExposingList = (
  wsEdit: vscode.WorkspaceEdit,
  uri: vscode.Uri,
  doc: vscode.TextDocument,
  ast: ElmSyntax.Ast,
  mentionRegion: ElmFindRegion
): void => {
  const moduleData = ElmSyntax.toModuleData(ast)
  if (moduleData.exposingList.value.type === 'explicit') {
    if (removeFromExposingItems(wsEdit, uri, doc, moduleData.exposingList.value.explicit, mentionRegion, false)) return
  }
  for (const import_ of ast.imports) {
    if (!import_.value.exposingList) continue
    if (import_.value.exposingList.value.type !== 'explicit') continue
    if (removeFromExposingItems(wsEdit, uri, doc, import_.value.exposingList.value.explicit, mentionRegion, true)) return
  }
}

// Try to remove an item from an explicit exposing list by matching the mention's start position.
// Returns true if the item was found and an edit was added.
const removeFromExposingItems = (
  wsEdit: vscode.WorkspaceEdit,
  uri: vscode.Uri,
  doc: vscode.TextDocument,
  items: ElmSyntax.Node<ElmSyntax.TopLevelExpose>[],
  mentionRegion: ElmFindRegion,
  isImport: boolean
): boolean => {
  const index = items.findIndex(item =>
    item.range[0] === mentionRegion.start.line &&
    item.range[1] === mentionRegion.start.column
  )
  if (index === -1) return false

  if (items.length === 1) {
    if (isImport) {
      // Remove the whole " exposing (name)" from the import line
      const lineNum = items[0]!.range[0] - 1
      const lineText = doc.lineAt(lineNum).text
      const newText = lineText.replace(/\s+exposing\s*\([^)]*\)/, '')
      if (newText !== lineText) {
        wsEdit.replace(uri, doc.lineAt(lineNum).range, newText)
      }
    }
    // For the module's own exposing list with a single item, skip — the compiler
    // will report the dangling expose and the user can decide what to do.
    return true
  }

  const item = items[index]!
  let deleteRange: vscode.Range
  if (index < items.length - 1) {
    // Not last: delete from this item's start to next item's start (includes trailing ", ")
    deleteRange = new vscode.Range(
      sharedLogic.fromElmRange(item.range).start,
      sharedLogic.fromElmRange(items[index + 1]!.range).start
    )
  } else {
    // Last of multiple: delete from prev item's end to this item's end (includes leading ", ")
    deleteRange = new vscode.Range(
      sharedLogic.fromElmRange(items[index - 1]!.range).end,
      sharedLogic.fromElmRange(item.range).end
    )
  }
  wsEdit.delete(uri, deleteRange)
  return true
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
