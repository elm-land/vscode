import * as vscode from 'vscode'
import * as child_process from 'child_process'
import sharedLogic, { Feature } from './shared/logic'
import { diagnostics as elmDiagnostics } from './error-highlighting'

const HANDLED_TITLES = ['UNKNOWN VARIABLE', 'UNKNOWN TYPE', 'NAMING ERROR']

export const feature: Feature = ({ globalState, context }) => {
  // Provide the quick-fix action instantly — no background work needed.
  // The action carries a command that runs elm-find lazily when triggered.
  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider(
      { scheme: 'file', language: 'elm' },
      {
        provideCodeActions(document, _range, context) {
          const isEnabled: boolean = vscode.workspace.getConfiguration('elmLand').feature.suggestedImports
          if (!isEnabled) return []

          const elmJsonFile = sharedLogic.findElmJsonFor(globalState, document.uri)
          if (!elmJsonFile) return []

          const actions: vscode.CodeAction[] = []

          for (const diagnostic of context.diagnostics) {
            if (diagnostic.severity !== vscode.DiagnosticSeverity.Error) continue
            if (!HANDLED_TITLES.some(t => diagnostic.message.startsWith(t))) continue

            const regionText = document.getText(diagnostic.range)
            const parsed = parseRegionText(regionText)
            if (!parsed) continue

            const action = new vscode.CodeAction(
              `Import from module...`,
              vscode.CodeActionKind.QuickFix
            )
            action.diagnostics = [diagnostic]
            action.command = {
              command: 'elmLand.suggestImport',
              title: `Import from module...`,
              arguments: [document.uri.toString(), parsed.lookupName, parsed.qualifier, elmJsonFile.projectFolder]
            }
            actions.push(action)
          }

          return actions
        }
      },
      { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] }
    )
  )

  // The command runs elm-find on demand and shows results in a QuickPick.
  context.subscriptions.push(
    vscode.commands.registerCommand('elmLand.suggestImport', async (
      uriString: string,
      lookupName: string,
      qualifier: string | undefined,
      projectFolder: string
    ) => {
      const uri = vscode.Uri.parse(uriString)
      const document = await vscode.workspace.openTextDocument(uri)
      const elmFindBinary: string = vscode.workspace.getConfiguration('elmLand').elmFindFilepath || 'elm-find'

      const allModules = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: `Finding modules for "${lookupName}"...`, cancellable: false },
        () => runElmFindForImports({ binary: elmFindBinary, name: lookupName, projectFolder })
      )

      if (allModules.length === 0) {
        vscode.window.showInformationMessage(`No modules found exposing "${lookupName}"`)
        return
      }

      const modules = qualifier
        ? pickModulesForQualifier(allModules, qualifier)
        : allModules

      const items = modules
        .filter(m => !isAlreadyImported(document, buildImportLine(m, qualifier)))
        .map(moduleName => ({ label: buildImportLine(moduleName, qualifier).trimEnd(), moduleName }))

      if (items.length === 0) {
        vscode.window.showInformationMessage(`"${lookupName}" is already imported`)
        return
      }

      const selected = items.length === 1
        ? items[0]
        : await vscode.window.showQuickPick(items, {
            placeHolder: `Choose a module to import for "${lookupName}"`
          })
      if (!selected) return

      const edit = new vscode.WorkspaceEdit()
      edit.insert(
        uri,
        new vscode.Position(findImportInsertionLine(document), 0),
        buildImportLine(selected.moduleName, qualifier)
      )
      await vscode.workspace.applyEdit(edit)
      elmDiagnostics.delete(uri)
    })
  )
}


// ─── Name parsing ─────────────────────────────────────────────────────────────

const parseRegionText = (text: string): { lookupName: string, qualifier?: string } | undefined => {
  if (/^[a-zA-Z][a-zA-Z0-9_]*$/.test(text)) {
    return { lookupName: text }
  }
  const qualifiedMatch = text.match(/^([A-Z][a-zA-Z0-9_]*)\.([a-zA-Z][a-zA-Z0-9_]*)$/)
  if (qualifiedMatch && qualifiedMatch[1] !== undefined && qualifiedMatch[2] !== undefined) {
    return { lookupName: qualifiedMatch[2], qualifier: qualifiedMatch[1] }
  }
  return undefined
}

const pickModulesForQualifier = (modules: string[], qualifier: string): string[] => {
  const exactMatches = modules.filter(m => m.split('.').at(-1) === qualifier)
  return exactMatches.length > 0 ? exactMatches : modules
}


// ─── Import line construction ─────────────────────────────────────────────────

const buildImportLine = (moduleName: string, qualifier: string | undefined): string => {
  if (!qualifier) return `import ${moduleName} exposing (..)\n`
  if (moduleName === qualifier) return `import ${moduleName}\n`
  return `import ${moduleName} as ${qualifier}\n`
}

const isAlreadyImported = (document: vscode.TextDocument, importLine: string): boolean => {
  const trimmed = importLine.trimEnd()
  for (let i = 0; i < document.lineCount; i++) {
    if (document.lineAt(i).text === trimmed) return true
  }
  return false
}

const findImportInsertionLine = (document: vscode.TextDocument): number => {
  let lastImportLine = -1
  for (let i = 0; i < document.lineCount; i++) {
    if (document.lineAt(i).text.startsWith('import ')) {
      lastImportLine = i
    }
  }
  if (lastImportLine >= 0) return lastImportLine + 1

  for (let i = 0; i < document.lineCount; i++) {
    const text = document.lineAt(i).text
    if (text.startsWith('module ') || text.startsWith('port module ') || text.startsWith('effect module ')) {
      return i + 1
    }
  }

  return 0
}


// ─── elm-find ─────────────────────────────────────────────────────────────────

const runElmFindForImports = (input: {
  binary: string
  name: string
  projectFolder: string
}): Promise<string[]> => {
  return new Promise((resolve) => {
    const { binary, name, projectFolder } = input
    const args = [name, '--definitions', '--exposed', '--project', projectFolder]
    const child = child_process.spawn(binary, args, { env: sharedLogic.npxEnv() })

    child.on('error', () => resolve([]))

    const stdoutBuffers: Buffer[] = []
    child.stdout.on('data', (chunk: Buffer) => stdoutBuffers.push(chunk))
    child.on('exit', () => {
      try {
        const defs: ElmFindDefinition[] = JSON.parse(Buffer.concat(stdoutBuffers as Uint8Array[]).toString('utf-8'))
        const seen = new Set<string>()
        const modules: string[] = []
        for (const def of [...defs].sort((a, b) => (b.isLocal ? 1 : 0) - (a.isLocal ? 1 : 0))) {
          if (!seen.has(def.module)) {
            seen.add(def.module)
            modules.push(def.module)
          }
        }
        resolve(modules)
      } catch {
        resolve([])
      }
    })
  })
}


// ─── Types ────────────────────────────────────────────────────────────────────

type ElmFindDefinition = {
  isLocal: boolean
  module: string
  [key: string]: unknown
}
