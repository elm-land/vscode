import * as child_process from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import * as vscode from 'vscode'
import sharedLogic, { Feature } from './shared/logic'
import * as ElmToAst from './shared/elm-to-ast'
import * as ElmSyntax from './shared/elm-to-ast/elm-syntax'
import { GlobalState } from './shared/autodetect-elm-json'

export const feature: Feature = ({ globalState, context }) => {
  context.subscriptions.push(
    vscode.languages.registerRenameProvider('elm', provider(globalState))
  )
}

const provider = (globalState: GlobalState) => {
  return {
    async prepareRename(
      doc: vscode.TextDocument,
      position: vscode.Position,
      token: vscode.CancellationToken
    ): Promise<{ range: vscode.Range; placeholder: string } | undefined> {
      const isEnabled: boolean = vscode.workspace.getConfiguration('elmLand').feature.rename
      if (!isEnabled) return

      const wordRange = doc.getWordRangeAtPosition(position, /[a-zA-Z0-9_]+/)
      if (!wordRange) return
      const word = doc.getText(wordRange)
      if (!word) return

      return { range: wordRange, placeholder: word }
    },

    async provideRenameEdits(
      doc: vscode.TextDocument,
      position: vscode.Position,
      newName: string,
      token: vscode.CancellationToken
    ): Promise<vscode.WorkspaceEdit | undefined> {
      const isEnabled: boolean = vscode.workspace.getConfiguration('elmLand').feature.rename
      if (!isEnabled) return

      const start = Date.now()

      const elmJsonFile = sharedLogic.findElmJsonFor(globalState, doc.uri)
      if (!elmJsonFile) return

      const wordRange = doc.getWordRangeAtPosition(position, /[a-zA-Z0-9_]+/)
      if (!wordRange) return
      const word = doc.getText(wordRange)
      if (!word) return

      const ast = await ElmToAst.run(doc.getText(), token)
      if (!ast) return

      const moduleData = ElmSyntax.toModuleData(ast)
      const moduleName = moduleData.moduleName.value.join('.')

      const elmFindBinary: string = vscode.workspace.getConfiguration('elmLand').elmFindFilepath || 'elm-find'
      const projectFolder = elmJsonFile.projectFolder

      const definitions = await runElmFind({
        binary: elmFindBinary,
        name: word,
        moduleName,
        projectFolder,
        token
      })

      if (!definitions) return

      const edit = new vscode.WorkspaceEdit()

      for (const definition of definitions) {
        const defUri = vscode.Uri.file(path.resolve(projectFolder, definition.file))
        const oldName = word

        // Rename the definition itself (region is always unqualified at definition site)
        edit.replace(defUri, rangeFromRegion(definition.region), newName)

        // Rename in the exposing list and @docs of the definition file
        const rawDefContent = defUri.fsPath === doc.uri.fsPath
          ? doc.getText()
          : readFileSafe(defUri.fsPath)

        if (rawDefContent !== undefined) {
          const defAst = await ElmToAst.run(rawDefContent, token)
          if (defAst) {
            addTypeSignatureNameEdits(edit, defUri, defAst, oldName, newName)
            addExposingListEdits(edit, defUri, defAst, oldName, newName)
            addDocCommentEdits(edit, defUri, defAst, oldName, newName)
          }
        }

        // Rename all usages — use end-anchored range to handle qualified references
        for (const usage of definition.usages) {
          const usageUri = vscode.Uri.file(path.resolve(projectFolder, usage.file))
          edit.replace(usageUri, nameRangeFromRegion(usage.region, oldName), newName)
        }
      }

      console.info('provideRenameEdits', `${Date.now() - start}ms`)
      return edit
    }
  }
}

const rangeFromRegion = (region: ElmFindRegion): vscode.Range =>
  new vscode.Range(
    region.start.line - 1,
    region.start.column - 1,
    region.end.line - 1,
    region.end.column - 1,
  )

// Extract just the identifier at the end of a region.
// elm-find returns regions that may cover a qualified name like `Module.Nested.foo`,
// but the identifier we rename is always at the end. By anchoring to region.end
// and subtracting name.length we get exactly the identifier — whether qualified or not.
const nameRangeFromRegion = (region: ElmFindRegion, name: string): vscode.Range =>
  new vscode.Range(
    region.start.line - 1,
    region.end.column - 1 - name.length,
    region.end.line - 1,
    region.end.column - 1,
  )

// Rename the function name in its type signature line, e.g. the `create` in
// `create : Config -> Model`. elm-find reports the declaration name but not the
// signature name, so we fill the gap from the AST.
const addTypeSignatureNameEdits = (
  edit: vscode.WorkspaceEdit,
  uri: vscode.Uri,
  ast: ElmSyntax.Ast,
  name: string,
  newName: string
) => {
  for (const declaration of ast.declarations) {
    if (declaration.value.type !== 'function') continue
    const func = declaration.value.function
    if (func.declaration.value.name.value !== name) continue
    if (!func.signature) continue
    edit.replace(uri, sharedLogic.fromElmRange(func.signature.value.name.range), newName)
  }
}

// If the symbol appears in an explicit `exposing (...)` list, rename it there too.
const addExposingListEdits = (
  edit: vscode.WorkspaceEdit,
  uri: vscode.Uri,
  ast: ElmSyntax.Ast,
  name: string,
  newName: string
) => {
  const exposingList = ElmSyntax.toModuleData(ast).exposingList
  if (exposingList.value.type !== 'explicit') return

  for (const exposeNode of exposingList.value.explicit) {
    const exposeName = ElmSyntax.toTopLevelExposeName(exposeNode.value)
    if (exposeName !== name) continue

    // The expose node range starts at the identifier. For `TypeName(..)` the range
    // covers the whole thing, so we use start + name.length to target just the name.
    const startLine = exposeNode.range[0] - 1
    const startCol = exposeNode.range[1] - 1
    edit.replace(uri, new vscode.Range(startLine, startCol, startLine, startCol + name.length), newName)
  }
}

// Rename occurrences of `name` on `@docs` lines inside any doc comment.
const addDocCommentEdits = (
  edit: vscode.WorkspaceEdit,
  uri: vscode.Uri,
  ast: ElmSyntax.Ast,
  name: string,
  newName: string
) => {
  const wordBoundary = new RegExp(`(?<![a-zA-Z0-9_])${escapeRegex(name)}(?![a-zA-Z0-9_])`, 'g')

  for (const comment of ast.comments) {
    if (!comment.value.includes('@docs')) continue

    const commentStartLine = comment.range[0] - 1  // 0-based
    const commentStartCol = comment.range[1] - 1   // 0-based
    const lines = comment.value.split('\n')

    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
      const line = lines[lineIdx] ?? ''
      if (!line.includes('@docs')) continue

      wordBoundary.lastIndex = 0
      let match: RegExpExecArray | null
      while ((match = wordBoundary.exec(line ?? '')) !== null) {
        const absLine = commentStartLine + lineIdx
        // On the first line of the comment the text begins at commentStartCol;
        // subsequent lines always start at column 0.
        const absCol = lineIdx === 0
          ? commentStartCol + match.index
          : match.index
        edit.replace(uri, new vscode.Range(absLine, absCol, absLine, absCol + name.length), newName)
      }
    }
  }
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const readFileSafe = (fsPath: string): string | undefined => {
  try {
    return fs.readFileSync(fsPath, 'utf8')
  } catch (_) {
    return undefined
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
}

type ElmFindDefinition = {
  name: string
  file: string
  module: string
  region: ElmFindRegion
  usages: ElmFindUsage[]
}

type RunElmFindInput = {
  binary: string
  name: string
  moduleName: string
  projectFolder: string
  token: vscode.CancellationToken
}

const runElmFind = (input: RunElmFindInput): Promise<ElmFindDefinition[] | undefined> => {
  return new Promise((resolve) => {
    const { binary, name, moduleName, projectFolder, token } = input

    const args = [name, '--module', moduleName, '--project', projectFolder]
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
