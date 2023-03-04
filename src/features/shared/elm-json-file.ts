import * as vscode from 'vscode'
import { GlobalState } from './autodetect-elm-json'

export type ElmJsonFile = {
  uri: vscode.Uri
  rawFileContents: string
  projectFolder: string
  entrypoints: string[]
  sourceDirectories: string[],
  dependencies: Dependency[]
}

export type Dependency = {
  packageUserAndName: string
  packageVersion: string
  fsPath: string
}

export type ModuleDoc = {
  name: string
  comment: string,
  unions: Union[]
  aliases: Alias[]
  values: Value[]
  binops: BinOp[]
}

export type Union = {
  name: string
  comment: string
  args: string[]
  cases: [string, string[]][]
}

export type Alias = {
  name: string
  comment: string
  args: string[]
  type: string
}

export type Value = {
  name: string
  comment: string
  type: string
}

export type BinOp = {
  name: string
  comment: string
  type: string
}


export const getDocumentationForElmPackage = async (globalState: GlobalState, fsPath: string): Promise<ModuleDoc[]> => {
  let cachedDocsForThisFsPath = globalState.cachedDocs[fsPath]

  if (cachedDocsForThisFsPath) {
    return cachedDocsForThisFsPath
  } else {
    try {
      let buffer = await vscode.workspace.fs.readFile(vscode.Uri.file(fsPath))
      let contents = Buffer.from(buffer).toString('utf8')
      let json = JSON.parse(contents)
      globalState.cachedDocs[fsPath] = json
      return json
    } catch (_) {
      return []
    }
  }
}