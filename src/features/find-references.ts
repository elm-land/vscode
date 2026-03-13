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

      const definitions = await runElmFind({
        binary: elmFindBinary,
        name: word,
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

        // Include all usages
        for (const usage of definition.usages) {
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
}

type ElmFindDefinition = {
  name: string
  file: string
  module: string
  region: ElmFindRegion
  usages: ElmFindUsage[]
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
