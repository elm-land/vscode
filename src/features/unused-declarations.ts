import * as child_process from 'child_process'
import * as vscode from 'vscode'
import sharedLogic, { Feature } from './shared/logic'
import * as ElmToAst from './shared/elm-to-ast'
import * as ElmSyntax from './shared/elm-to-ast/elm-syntax'
import { GlobalState } from './shared/autodetect-elm-json'

const diagnostics = vscode.languages.createDiagnosticCollection('elmLandUnusedDeclarations')

// Track in-flight cancellation tokens per document URI to cancel stale checks
const cancellationSources = new Map<string, vscode.CancellationTokenSource>()

export const feature: Feature = ({ globalState, context }) => {
  context.subscriptions.push(diagnostics)

  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(document => run(globalState, document))
  )
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument(document => run(globalState, document))
  )
  context.subscriptions.push(
    vscode.workspace.onDidCloseTextDocument(document => {
      diagnostics.delete(document.uri)
      const source = cancellationSources.get(document.uri.toString())
      if (source) {
        source.cancel()
        cancellationSources.delete(document.uri.toString())
      }
    })
  )
}

const run = async (globalState: GlobalState, document: vscode.TextDocument) => {
  const isEnabled: boolean = vscode.workspace.getConfiguration('elmLand').feature.unusedDeclarations
  if (!isEnabled) {
    diagnostics.clear()
    return
  }

  if (!document.uri.fsPath.endsWith('.elm')) return

  const elmJsonFile = sharedLogic.findElmJsonFor(globalState, document.uri)
  if (!elmJsonFile) return

  // Cancel any in-flight check for this document
  const uriKey = document.uri.toString()
  const existing = cancellationSources.get(uriKey)
  if (existing) existing.cancel()
  const tokenSource = new vscode.CancellationTokenSource()
  cancellationSources.set(uriKey, tokenSource)
  const token = tokenSource.token

  const ast = await ElmToAst.run(document.getText(), token)
  if (!ast || token.isCancellationRequested) return

  const moduleName = ElmSyntax.toModuleData(ast).moduleName.value.join('.')
  const elmFindBinary: string = vscode.workspace.getConfiguration('elmLand').elmFindFilepath || 'elm-find'
  const projectFolder = elmJsonFile.projectFolder

  // Run elm-find for all declarations in parallel
  const checks = ast.declarations.map(async declaration => {
    const name = ElmSyntax.toDeclarationName(declaration)
    if (!name) return null

    // Skip ports (invoked from JavaScript) and main (program entry point)
    if (declaration.value.type === 'port') return null
    if (name === 'main') return null

    const kind = getKindForDeclaration(declaration)
    if (!kind) return null

    const definitions = await runElmFind({ binary: elmFindBinary, name, kind, moduleName, projectFolder, token })
    if (!definitions || token.isCancellationRequested) return null

    const usageCount = definitions.flatMap(d => d.usages).filter(u => u.tag !== 'mention').length
    if (usageCount === 0) {
      const range = getNameRange(declaration)
      return new vscode.Diagnostic(range, `\`${name}\` is unused`, vscode.DiagnosticSeverity.Warning)
    }
    return null
  })

  const results = await Promise.all(checks)
  if (token.isCancellationRequested) return

  diagnostics.set(document.uri, results.filter((d): d is vscode.Diagnostic => d !== null))
  cancellationSources.delete(uriKey)
}

const getKindForDeclaration = (declaration: ElmSyntax.Node<ElmSyntax.Declaration>): ElmFindKind | undefined => {
  switch (declaration.value.type) {
    case 'function': return 'value'
    case 'typeAlias': return 'type'
    case 'typedecl': return 'type'
    default: return undefined
  }
}

// Get the range of just the name portion of a declaration for precise diagnostic highlighting
const getNameRange = (declaration: ElmSyntax.Node<ElmSyntax.Declaration>): vscode.Range => {
  switch (declaration.value.type) {
    case 'function':
      return sharedLogic.fromElmRange(declaration.value.function.declaration.value.name.range)
    case 'typeAlias':
      return sharedLogic.fromElmRange(declaration.value.typeAlias.name.range)
    case 'typedecl':
      return sharedLogic.fromElmRange(declaration.value.typedecl.name.range)
    default:
      return sharedLogic.fromElmRange(declaration.range)
  }
}

type ElmFindKind = 'value' | 'type' | 'ctor'

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
