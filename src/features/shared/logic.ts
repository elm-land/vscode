import * as vscode from 'vscode'
import * as AutodetectElmJson from '../autodetect-elm-json'
import { ElmJsonFile } from './elm-json-file'

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

const getMappingOfPackageNameToDocJsonFilepath = (elmJsonFile: ElmJsonFile) => {
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

const doesModuleExposesValue = (elmJsonFile: ElmJsonFile, moduleName: string, typeOrValueName: string) => {
  for (let dependency of elmJsonFile.dependencies) {
    for (let moduleDoc of dependency.docs) {
      if (moduleDoc.name === moduleName) {
        return [
          ...moduleDoc.aliases.map(x => x.name),
          ...moduleDoc.unions.map(x => x.name),
          ...moduleDoc.values.map(x => x.name),
        ].some(name => name === typeOrValueName)
      }
    }
  }
  return false
}


const keepFilesThatExist = async (fsPath: string[]): Promise<string[]> => {
  let files = await Promise.all(fsPath.map(verifyFileExists))
  return files.filter(isDefined)
}

const verifyFileExists = async (fsPath: string): Promise<string | undefined> => {
  try {
    let stats = await vscode.workspace.fs.stat(vscode.Uri.file(fsPath))
    if (stats.size > 0) {
      return fsPath
    } else {
      return undefined
    }
  } catch (_) {
    return undefined
  }
}

export default {
  pluginId: 'elmLand',
  findElmJsonFor,
  fromElmRange,
  getMappingOfPackageNameToDocJsonFilepath,
  findFirstOccurenceOfWordInFile,
  isDefined,
  doesModuleExposesValue,
  keepFilesThatExist
}
