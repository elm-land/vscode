const vscode = require('vscode')
const autodetectElmJson = require('./features/autodetect-elm-json')
const elmFormatOnSave = require('./features/elm-format-on-save')
const errorHighlighting = require('./features/error-highlighting')
const inlineAutocomplete = require('./features/inline-autocomplete')

let diagnostics = vscode.languages.createDiagnosticCollection('elmLand')

async function activate(context) {
  console.log("ACTIVATE")

  let globalState = { elmJsonFiles: [] }

  // Attempt to find an elm.json file at the project root
  await autodetectElmJson(globalState)
  vscode.workspace.onDidChangeWorkspaceFolders(async () => await autodetectElmJson(globalState))

  // Run `elm-format` when a file is saved
  vscode.languages.registerDocumentFormattingEditProvider('elm', elmFormatOnSave)

  // Provide inline autocomplete suggestions
  vscode.languages.registerInlineCompletionItemProvider('elm', inlineAutocomplete(globalState))

  // Show inline compiler errors anytime a file is saved or opened
  vscode.workspace.onDidOpenTextDocument(document => errorHighlighting(globalState, diagnostics, document, 'open'))
  vscode.workspace.onDidSaveTextDocument(document => errorHighlighting(globalState, diagnostics, document, 'save'))
  // vscode.workspace.onDidChangeTextDocument(({ document }) => errorHighlighting(globalState, diagnostics, document, 'edit'))
  context.subscriptions.push(diagnostics)
}

function onChange() {

}

function deactivate() {
  console.log('DEACTIVATE')
}



module.exports = {
  activate,
  deactivate
}