import * as path from 'path'
import * as vscode from 'vscode'
import * as AutodetectElmJson from './autodetect-elm-json'
import { ElmJsonFile, getDocumentationForElmPackage } from './elm-json-file'

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

const getMappingOfModuleNameToDocJsonFilepath = async (globalState: AutodetectElmJson.GlobalState, elmJsonFile: ElmJsonFile): Promise<Map<string, string>> => {
  const packages = new Map<string, string>()
  const dependencies = elmJsonFile.dependencies
  for (const dep of dependencies) {
    const docs = await getDocumentationForElmPackage(globalState, dep.fsPath)
    for (const doc of docs) {
      packages.set(doc.name, dep.fsPath)
    }
  }

  return packages
}

const findFirstOccurrenceOfWordInFile = (word: string, rawJsonString: string): [number, number, number, number] | undefined => {
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

const doesModuleExposesValue = async (globalState: AutodetectElmJson.GlobalState, elmJsonFile: ElmJsonFile, moduleName: string, typeOrValueName: string): Promise<string | undefined> => {
  for (let dependency of elmJsonFile.dependencies) {
    let docs = await getDocumentationForElmPackage(globalState, dependency.fsPath)
    for (let moduleDoc of docs) {
      if (moduleDoc.name === moduleName) {
        let match = [
          ...moduleDoc.aliases.map(x => ({ typeOrValueName: x.name, items: [x.name] })),
          ...moduleDoc.unions.map(x => ({ typeOrValueName: x.name, items: [x.name, ...x.cases.map(([caseName]) => caseName)] })),
          ...moduleDoc.values.map(x => ({ typeOrValueName: x.name, items: [x.name] })),
        ].find(obj => obj.items.includes(typeOrValueName))
        if (match) {
          return match.typeOrValueName
        }
      }
    }
  }
  return undefined
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

// Some people install elm and elm-format locally instead of globally, using
// npm or the elm-tooling CLI. To run locally installed tools, they use `npx`.
//
// `npx` adds all potential `node_modules/.bin` up the current directory to the
// beginning of PATH, for example:
//
//     ❯ npx node -p 'process.env.PATH.split(path.delimiter)'
//     [
//       '/Users/you/stuff/node_modules/.bin',
//       '/Users/you/node_modules/.bin',
//       '/Users/node_modules/.bin',
//       '/node_modules/.bin',
//       '/usr/bin',
//       'etc'
//     ]
//
// This function also does that, so that local installations just work.
function npxEnv() {
  return {
    ...process.env,
    PATH: [
      ...(vscode.workspace.workspaceFolders ?? [])
        .flatMap(folder =>
          folder.uri.fsPath.split(path.sep)
            .map((_, index, parts) =>
              [...parts.slice(0, index + 1), 'node_modules', '.bin'].join(path.sep)
            )
            .reverse()
        ),
      process.env.PATH
    ].join(path.delimiter)
  }
}

export default {
  pluginId: 'elmLand',
  findElmJsonFor,
  fromElmRange,
  getMappingOfModuleNameToDocJsonFilepath,
  findFirstOccurenceOfWordInFile: findFirstOccurrenceOfWordInFile,
  isDefined,
  doesModuleExposesValue,
  keepFilesThatExist,
  npxEnv
}
