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

const getMappingOfPackageNameToDocJsonFilepath = (elmJsonFile) => {
  let packages = {}
  const dependencies = elmJsonFile.dependencies
  for (let dep of dependencies) {
    for (let doc of dep.docs) {
      packages[doc.name] = dep.fsPath
    }
  }
  return packages
}

module.exports = {
  findElmJsonFor,
  getMappingOfPackageNameToDocJsonFilepath
}