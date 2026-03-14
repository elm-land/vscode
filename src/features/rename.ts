import * as child_process from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import * as vscode from 'vscode'
import sharedLogic, { Feature } from './shared/logic'
import * as ElmToAst from './shared/elm-to-ast'
import * as ElmSyntax from './shared/elm-to-ast/elm-syntax'
import { GlobalState } from './shared/autodetect-elm-json'

// Files above this threshold switch to incremental mode (direct disk writes, no undo).
// Relies on git for recovery rather than Cmd+Z.
const LARGE_RENAME_FILE_THRESHOLD = 20

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

      const oldName = word

      const fileEdits = new Map<string, { uri: vscode.Uri; replacements: Replacement[] }>()

      const getOrAdd = (uri: vscode.Uri) => {
        if (!fileEdits.has(uri.fsPath)) {
          fileEdits.set(uri.fsPath, { uri, replacements: [] })
        }
        return fileEdits.get(uri.fsPath)!
      }

      // Collect unique definition files that need doc-comment scanning
      const docFiles = new Map<string, vscode.Uri>()
      for (const definition of definitions) {
        const defUri = vscode.Uri.file(path.resolve(projectFolder, definition.file))
        docFiles.set(defUri.fsPath, defUri)
      }

      // Parse all definition files in parallel for @docs edits
      await Promise.all([...docFiles.values()].map(async (defUri) => {
        const rawDefContent = defUri.fsPath === doc.uri.fsPath
          ? doc.getText()
          : readFileSafe(defUri.fsPath)
        if (rawDefContent === undefined) return
        const defAst = await ElmToAst.run(rawDefContent, token)
        if (!defAst) return
        // Collect @docs edits into a temporary WorkspaceEdit so we can forward them
        const tmp = new vscode.WorkspaceEdit()
        if (kind !== 'ctor') {
          addDocCommentEdits(tmp, defUri, defAst, oldName, newName)
        }
        for (const [, entries] of tmp.entries()) {
          for (const entry of entries) {
            if (entry instanceof vscode.TextEdit) {
              getOrAdd(defUri).replacements.push({ range: entry.range, newText: entry.newText })
            }
          }
        }
      }))

      for (const definition of definitions) {
        const defUri = vscode.Uri.file(path.resolve(projectFolder, definition.file))
        getOrAdd(defUri).replacements.push({ range: rangeFromRegion(definition.region), newText: newName })

        for (const usage of definition.usages) {
          const usageUri = vscode.Uri.file(path.resolve(projectFolder, usage.file))
          getOrAdd(usageUri).replacements.push({ range: nameRangeFromRegion(usage.region, oldName), newText: newName })
        }
      }

      const files = [...fileEdits.values()]

      if (files.length <= LARGE_RENAME_FILE_THRESHOLD) {
        const edit = new vscode.WorkspaceEdit()
        for (const { uri, replacements } of files) {
          for (const { range, newText } of replacements) {
            edit.replace(uri, range, newText)
          }
        }
        console.info('provideRenameEdits', `${Date.now() - start}ms`)
        return edit
      }

      // Large rename — prompt before proceeding without undo support
      const answer = await vscode.window.showWarningMessage(
        `This rename touches ${files.length} files and cannot be undone. Make sure your git working tree is clean before continuing.`,
        { modal: true },
        'Rename anyway'
      )
      if (answer !== 'Rename anyway') return

      const openDocs = new Map(vscode.workspace.textDocuments.map(d => [d.uri.fsPath, d]))

      const edit = new vscode.WorkspaceEdit()
      const diskWrites: { uri: vscode.Uri; replacements: Replacement[] }[] = []

      for (const { uri, replacements } of files) {
        if (openDocs.has(uri.fsPath)) {
          for (const { range, newText } of replacements) {
            edit.replace(uri, range, newText)
          }
        } else {
          diskWrites.push({ uri, replacements })
        }
      }

      await vscode.workspace.applyEdit(edit, { isRefactoring: true })

      await vscode.window.withProgress(
        { 
          location: vscode.ProgressLocation.Notification,
          title: `Renaming '${oldName}' to '${newName}'`,
          cancellable: true
        },
        async (progress, cancelToken) => {
          for (let i = 0; i < diskWrites.length; i++) {
            if (cancelToken.isCancellationRequested) break
            progress.report({ message: `${i + 1} / ${diskWrites.length} files`, increment: 100 / diskWrites.length })
            const { uri, replacements } = diskWrites[i]!
            await applyReplacementsToDisk(uri, replacements)
          }
        }
      )

      console.info('provideRenameEdits', `${Date.now() - start}ms`)
      return new vscode.WorkspaceEdit()
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

type Replacement = { range: vscode.Range; newText: string }

const applyReplacementsToDisk = async (uri: vscode.Uri, replacements: Replacement[]) => {
  let content: string
  try {
    const bytes = await vscode.workspace.fs.readFile(uri)
    content = new TextDecoder().decode(bytes)
  } catch (_) {
    return
  }

  const lines = content.split('\n')

  // Apply in reverse order so earlier positions aren't shifted by later edits
  const sorted = [...replacements].sort((a, b) =>
    b.range.start.line !== a.range.start.line
      ? b.range.start.line - a.range.start.line
      : b.range.start.character - a.range.start.character
  )

  for (const { range, newText } of sorted) {
    const line = lines[range.start.line]
    if (line === undefined) continue
    lines[range.start.line] = line.slice(0, range.start.character) + newText + line.slice(range.end.character)
  }

  try {
    await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(lines.join('\n')))
  } catch (_) {}
}

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

type RunElmFindInput = {
  binary: string
  name: string
  kind: ElmFindKind | undefined
  moduleName: string
  projectFolder: string
  token: vscode.CancellationToken
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
