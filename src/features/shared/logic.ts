import * as vscode from 'vscode'
import * as AutodetectElmJson from '../autodetect-elm-json'

export type Feature =
  (args: {
    globalState: AutodetectElmJson.GlobalState,
    context: vscode.ExtensionContext
  }) => void

let findElmJsonFor = (globalState: AutodetectElmJson.GlobalState, uri: vscode.Uri) => {
  let filepath = uri.fsPath

  for (let elmJsonFile of globalState.elmJsonFiles) {
    for (let sourceDirectory of elmJsonFile.sourceDirectories) {
      if (elmJsonFile.uri.fsPath === filepath) {
        return elmJsonFile
      }
      if (filepath.startsWith(sourceDirectory)) {
        return elmJsonFile
      }
    }
  }
}

const getMappingOfPackageNameToDocJsonFilepath = (elmJsonFile: AutodetectElmJson.ElmJsonFile) => {
  let packages: { [key: string]: string } = {}
  const dependencies = elmJsonFile.dependencies
  for (let dep of dependencies) {
    for (let doc of dep.docs) {
      packages[doc.name] = dep.fsPath
    }
  }
  return packages
}

const findFirstOccurenceOfWordInFile = (word: string, rawJsonString: string): [number, number, number, number] | undefined => {
  if (word && rawJsonString) {
    const regex = new RegExp(word, 'm')
    const match = rawJsonString.match(regex)
    if (match) {
      // line number starts from 1
      const lineNumber = rawJsonString.substring(0, match.index).split('\n').length
      // column number starts from 1
      const columnNumber = match.index || 0 - rawJsonString.lastIndexOf('\n', match.index)
      return [lineNumber, columnNumber, lineNumber, columnNumber + word.length]
    } else {
      return undefined
    }
  }
}


// VS code has zero-based ranges and positions, so we need to decrement all values
// returned from ElmToAst so they work with the code editor
const fromElmRange = (array: [number, number, number, number]): vscode.Range =>
  new vscode.Range(array[0] - 1, array[1] - 1, array[2] - 1, array[3] - 1)



const isDefined = <T>(input: T | undefined): input is T =>
  input !== undefined

export default {
  pluginId: 'elmLand',
  findElmJsonFor,
  fromElmRange,
  getMappingOfPackageNameToDocJsonFilepath,
  findFirstOccurenceOfWordInFile,
  isDefined
}