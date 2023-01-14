const vscode = require('vscode')

let findElmJsonFor = (globalState, uri) => {
  let filepath = uri.fsPath

  for (let elmJsonFile of globalState.elmJsonFiles) {
    for (let sourceDirectory of elmJsonFile.sourceDirectories) {
      if (filepath.startsWith(sourceDirectory)) {
        return elmJsonFile
      }
    }
  }
}

const getMappingOfPackageNamesToUris = (elmJsonFile) => {
  let packages = {}
  const dependencies = elmJsonFile.dependencies
  for (let dep of dependencies) {
    for (let doc of dep.docs) {
      packages[doc.name] = vscode.Uri.parse(`https://package.elm-lang.org/packages/${dep.packageUserAndName}/${dep.packageVersion}/${doc.name.split('.').join('-')}`)
    }
  }
  return packages
}

module.exports = {
  findElmJsonFor,
  getMappingOfPackageNamesToUris
}