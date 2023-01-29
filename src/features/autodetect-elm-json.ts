import * as path from 'path'
import * as vscode from 'vscode'
import sharedLogic from './_shared-logic'

export type GlobalState = {
  elmJsonFiles: ElmJsonFile[]
  jumpToDocDetails: JumpToDocDetails | undefined
}

export type JumpToDocDetails = {
  range: vscode.Range
  docsJsonFsPath: string
  moduleName: string
  typeOrValueName: string | undefined
}

export type ElmJsonFile = {
  uri: vscode.Uri
  rawFileContents: string
  projectFolder: string
  entrypoints: string[]
  sourceDirectories: string[],
  dependencies: Dependency[]
}

export default async (globalState: GlobalState) => {
  let config = vscode.workspace.getConfiguration('elmLand')

  let settings: Settings = {
    entrypointFilepaths: config.get('entrypointFilepaths') || []
  }

  let elmJsonFileUris = await vscode.workspace.findFiles('elm.json')
  let possibleElmJsonFiles = await Promise.all(toElmJsonFiles({ elmJsonFileUris, settings }))
  globalState.elmJsonFiles = possibleElmJsonFiles.filter(sharedLogic.isDefined)
}

type Input = {
  settings: Settings,
  elmJsonFileUris: vscode.Uri[]
}

type Settings = {
  entrypointFilepaths: string[]
}

type Dependency = {
  packageUserAndName: string
  packageVersion: string
  fsPath: string
  docs: ModuleDoc[]
}

type ModuleDoc = {
  name: string
  comment: string,
  unions: Union[]
  aliases: Alias[]
  values: Value[]
  binops: BinOp[]
}

type Union = {
  name: string
  comment: string
  args: string[]
  cases: [string, string[]][]
}

type Alias = {
  name: string
  comment: string
  args: string[]
  type: string
}

type Value = {
  name: string
  comment: string
  type: string
}

type BinOp = unknown

const isObject = (x: unknown): x is { [key: string]: unknown } =>
  (!!x && typeof x === 'object')

const hasStringKeys = (x: { [key: string]: unknown }): x is { [key: string]: string } =>
  Object.values(x).every(value => typeof value === 'string')

const isStringArray = (x: unknown): x is string[] =>
  !!x && x instanceof Array && x.every(isString)

const isString = (x: unknown): x is string =>
  typeof x === 'string'

type RawElmJson = {
  'elm-version': string,
  'source-directories': string[],
  'dependencies': {
    'direct': Record<string, string>
  },
}

const parseElmJson = (rawElmJsonString: string): RawElmJson | undefined => {
  try {
    let json: unknown = JSON.parse(rawElmJsonString)

    if (
      isObject(json) &&
      isString(json['elm-version']) &&
      isObject(json.dependencies) &&
      isObject(json.dependencies.direct) &&
      hasStringKeys(json.dependencies.direct) &&
      isStringArray(json["source-directories"])
    ) {
      return {
        'elm-version': json['elm-version'],
        "source-directories": json['source-directories'],
        dependencies: {
          direct: json.dependencies.direct
        }
      }
    }
  } catch (_) {
    return undefined
  }
}

const toElmJsonFiles = ({ settings, elmJsonFileUris }: Input): Promise<ElmJsonFile | undefined>[] =>
  elmJsonFileUris.map(async uri => {
    let projectFolder = uri.fsPath.split('elm.json')[0] as string

    let toAbsolutePath = (relativePath: string) =>
      path.join(projectFolder, relativePath)

    // Reading JSON file contents
    let buffer = await vscode.workspace.fs.readFile(uri)
    let fileContents = Buffer.from(buffer).toString('utf8')
    try {
      let elmJson: RawElmJson | undefined = parseElmJson(fileContents)

      if (elmJson) {

        let version = elmJson['elm-version']
        let entrypoints = settings.entrypointFilepaths.map(toAbsolutePath)
        let ELM_HOME: string | undefined =
          (process.env.ELM_HOME) ? process.env.ELM_HOME
            : (process.env.HOME) ? path.join(process.env.HOME, '.elm')
              : undefined

        let dependencies: Dependency[] = []

        if (ELM_HOME) {
          let elmHome: string = ELM_HOME

          let toDocsFilepath = (packageUserAndName: string, packageVersion: string) =>
            path.join(elmHome, version, 'packages', ...packageUserAndName.split('/'), packageVersion, 'docs.json')

          let toDocsJson = async (packageUserAndName: string, packageVersion: string) => {
            let fsPath = toDocsFilepath(packageUserAndName, packageVersion)
            let buffer = await vscode.workspace.fs.readFile(vscode.Uri.file(fsPath))
            let contents = Buffer.from(buffer).toString('utf8')
            let json = JSON.parse(contents)
            return { fsPath, docs: json }
          }

          dependencies =
            await Promise.all(
              Object.entries(elmJson['dependencies']['direct'])
                .map(async ([packageUserAndName, packageVersion]) => {
                  let { fsPath, docs } = await toDocsJson(packageUserAndName, packageVersion)
                  return {
                    packageUserAndName,
                    packageVersion,
                    fsPath,
                    docs
                  }
                })
            )
        }

        let elmJsonFile: ElmJsonFile = {
          uri,
          rawFileContents: fileContents,
          projectFolder,
          entrypoints,
          sourceDirectories: elmJson['source-directories'].map(toAbsolutePath),
          dependencies
        }
        return elmJsonFile
      }
    } catch (_) {
      console.error(`Failed to parse elm.json`, fileContents)
    }
  })