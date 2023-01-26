import * as path from "path"
import * as vscode from "vscode"
import autodetectElmJson, { GlobalState, JumpToDocDetails } from "./features/autodetect-elm-json"
import elmFormatOnSave from "./features/elm-format-on-save"
import errorHighlighting from "./features/error-highlighting"
import findUsages from "./features/find-usages"
import inlineAutocomplete from "./features/inline-autocomplete"
import jumpToDefinition from "./features/jump-to-definition"
import offlinePackageDocs from "./features/offline-package-docs"

const pluginId = `elmLand`
let diagnostics = vscode.languages.createDiagnosticCollection(pluginId)

export async function activate(context: vscode.ExtensionContext) {
  console.info("ACTIVATE")

  // Global context available to functions below
  let globalState: GlobalState = { elmJsonFiles: [], jumpToDocDetails: undefined }
  context.subscriptions.push({
    dispose: () => { globalState = undefined as any }
  })

  // Attempt to find an elm.json file at the project root
  await autodetectElmJson(globalState)

  // If user changes the current folder, look for the "elm.json" file again
  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(async () => await autodetectElmJson(globalState))
  )

  // Run `elm-format` when any Elm file is saved
  context.subscriptions.push(
    vscode.languages.registerDocumentFormattingEditProvider('elm', elmFormatOnSave)
  )

  // Provide inline autocomplete suggestions
  // context.subscriptions.push(
  //   vscode.languages.registerInlineCompletionItemProvider('elm', inlineAutocomplete(globalState))
  // )


  // Provide jump-to-definition behavior
  const jumpToDefinitionProvider = jumpToDefinition(globalState)
  context.subscriptions.push(
    vscode.languages.registerDefinitionProvider('elm', jumpToDefinitionProvider)
  )

  // Provide "Find references" for all types and functions
  context.subscriptions.push(
    vscode.languages.registerReferenceProvider('elm', findUsages(globalState))
  )

  // Show inline compiler errors anytime an Elm file is saved or opened
  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(document => errorHighlighting(globalState, diagnostics, document, 'open'))
  )
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument(document => errorHighlighting(globalState, diagnostics, document, 'save'))
  )
  context.subscriptions.push(diagnostics)

  // Reload and show errors anytime an "elm.json" file is saved or opened
  const recompileElmJson = async (document: vscode.TextDocument) => {
    if (document.uri.fsPath.endsWith('elm.json')) {
      await autodetectElmJson(globalState)
      await errorHighlighting(globalState, diagnostics, document, 'open')
    }
  }
  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(recompileElmJson)
  )
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument(recompileElmJson)
  )

  // Offline friendly package docs
  offlinePackageDocs.enable({ globalState, context })
}

export function deactivate() {
  console.info('DEACTIVATE')
}
