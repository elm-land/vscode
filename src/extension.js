const vscode = require('vscode')
const autodetectElmJson = require('./features/autodetect-elm-json')

const elmFormatOnSave = require('./features/elm-format-on-save')
const errorHighlighting = require('./features/error-highlighting')
const inlineAutocomplete = require('./features/inline-autocomplete')

let diagnostics = vscode.languages.createDiagnosticCollection('elm')

async function activate(context) {
  console.log("ACTIVATE")

  let globalState = { elmJsonFiles: [] }

  // Attempt to find an elm.json file at the project root
  await autodetectElmJson(globalState)

  // Run `elm-format` when a file is saved
  vscode.languages.registerDocumentFormattingEditProvider('elm', elmFormatOnSave)

  // Provide inline autocomplete suggestions
  vscode.languages.registerInlineCompletionItemProvider('elm', inlineAutocomplete)

  // Show inline compiler errors anytime a file is saved or opened
  vscode.workspace.onDidOpenTextDocument(errorHighlighting(globalState, diagnostics))
  vscode.workspace.onDidSaveTextDocument(errorHighlighting(globalState, diagnostics))
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