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

const findFirstOccurenceOfWordInFile = (word, rawJsonString) => {
  if (word, rawJsonString) {
    const regex = new RegExp(word, 'm')
    const match = rawJsonString.match(regex)
    if (match) {
      // line number starts from 1
      const lineNumber = rawJsonString.substring(0, match.index).split('\n').length
      // column number starts from 1
      const columnNumber = match.index - rawJsonString.lastIndexOf('\n', match.index)
      return [lineNumber, columnNumber, lineNumber, columnNumber + word.length]
    } else {
      return undefined
    }
  }
}


// VS code has zero-based ranges and positions, so we need to decrement all values
// returned from ElmToAst so they work with the code editor
const fromElmRange = (array) =>
  new vscode.Range(...array.map(x => x - 1))

module.exports = {
  findElmJsonFor,
  fromElmRange,
  getMappingOfPackageNameToDocJsonFilepath,
  findFirstOccurenceOfWordInFile
}