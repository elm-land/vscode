import * as vscode from 'vscode'

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
  docs: ModuleDoc[]
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