const vscode = require('vscode')

const elmFormatOnSave = require('./features/elm-format-on-save')
const inlineAutocomplete = require('./features/inline-autocomplete')

function activate(context) {
  console.log("ACTIVATE")

  // Attempt to find an elm.json file at the project root
  let currentFolders = vscode.workspace.workspaceFolders.map(folder => folder.uri)
  let config = vscode.workspace.getConfiguration('elmLand')
  let settings = {
    elmJsonLocation: config.elmJsonLocation || 'elm.json',
    mainModuleLocation: config.mainModuleLocation || 'src/Main.elm',
  }

  console.log({ context })

  // Run `elm-format` when a file is saved
  vscode.languages.registerDocumentFormattingEditProvider('elm', elmFormatOnSave)

  // Provide inline autocomplete suggestions
  vscode.languages.registerInlineCompletionItemProvider('elm', inlineAutocomplete)
}

function deactivate() {
  console.log('DEACTIVATE')
}



module.exports = {
  activate,
  deactivate
}