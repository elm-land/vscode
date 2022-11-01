const path = require('path')
const vscode = require('vscode')

module.exports = async (globalState) => {
  let config = vscode.workspace.getConfiguration('elmLand')

  let settings = {
    entrypointFilepaths: config.get('entrypointFilepaths')
  }

  let elmJsonFileUris = await vscode.workspace.findFiles('elm.json')

  globalState.elmJsonFiles = await Promise.all(elmJsonFileUris.map(async uri => {
    let projectFolder = uri.fsPath.split('elm.json')[0]
    let toAbsolutePath = (relativePath) => path.join(projectFolder, relativePath)
    // Reading JSON file contents
    let buffer = await vscode.workspace.fs.readFile(uri)
    let fileContents = Buffer.from(buffer).toString('utf8')
    let elmJson = JSON.parse(fileContents)

    let version = elmJson['elm-version']
    let entrypoints = settings.entrypointFilepaths.map(toAbsolutePath)
    let ELM_HOME =
      (process.env.ELM_HOME) ? process.env.ELM_HOME
        : (process.env.HOME) ? path.join(process.env.HOME, '.elm')
          : undefined


    let dependencies = []
    if (ELM_HOME) {
      let toDocsFilepath = (packageUserAndName, packageVersion) =>
        path.join(ELM_HOME, version, 'packages', ...packageUserAndName.split('/'), packageVersion, 'docs.json')

      let toDocsJson = async (packageUserAndName, packageVersion) => {
        let fsPath = toDocsFilepath(packageUserAndName, packageVersion)
        let buffer = await vscode.workspace.fs.readFile(vscode.Uri.file(fsPath))
        let contents = Buffer.from(buffer).toString('utf8')
        let json = JSON.parse(contents)
        return json
      }

      dependencies =
        await Promise.all(
          Object.entries(elmJson['dependencies']['direct'])
            .map(async ([packageUserAndName, packageVersion]) => {
              let docs = await toDocsJson(packageUserAndName, packageVersion)
              return {
                packageUserAndName,
                packageVersion,
                docs
              }
            })
        )
    }

    let elmJsonFile = {
      uri,
      projectFolder,
      entrypoints,
      sourceDirectories: elmJson['source-directories'].map(toAbsolutePath),
      dependencies
    }
    return elmJsonFile
  }))
}