const path = require('path')
const vscode = require('vscode')

module.exports = async (globalState) => {
  let config = vscode.workspace.getConfiguration('elmLand')

  let settings = {
    entrypointFilepaths: config.get('entrypointFilepaths') || ['src/Main.elm']
  }

  let elmJsonFileUris = await vscode.workspace.findFiles('**/*/elm.json')

  globalState.elmJsonFiles = await Promise.all(elmJsonFileUris.map(async uri => {
    let projectFolder = uri.fsPath.split('elm.json')[0]
    let toAbsolutePath = (relativePath) => path.join(projectFolder, relativePath)
    // Reading JSON file contents
    let buffer = await vscode.workspace.fs.readFile(uri)
    let fileContents = Buffer.from(buffer).toString('utf8')
    let elmJson = JSON.parse(fileContents)

    let entrypoints = settings.entrypointFilepaths.map(toAbsolutePath)

    return {
      uri,
      projectFolder,
      entrypoints,
      sourceDirectories: elmJson['source-directories'].map(toAbsolutePath),
      dependencies: elmJson['dependencies']['direct']
    }
  }))
}