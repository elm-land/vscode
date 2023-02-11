import * as path from 'path'
import * as vscode from 'vscode'
import { Dependency, ElmJsonFile } from './elm-json-file'
import sharedLogic from './logic'

export type GlobalState = {
  elmJsonFiles: ElmJsonFile[]
  jumpToDocDetails: JumpToDocDetails[] | undefined
}

export type JumpToDocDetails = {
  range: vscode.Range
  docsJsonFsPath: string
  moduleName: string
  typeOrValueName: string | undefined
}

// Initially run auto-detect, and listen for changes
export const initialize = async ({ globalState, context }: {
  globalState: GlobalState, context: vscode.ExtensionContext
}): Promise<void> => {
  await run(globalState)

  // If user changes the current folder, look for the "elm.json" file again
  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(async () => await run(globalState))
  )
}

// Rescan the file system for `elm.json` files
export const run = async (globalState: GlobalState) => {
  let config = vscode.workspace.getConfiguration('elmLand')

  let settings: Settings = {
    entrypointFilepaths: config.get('entrypointFilepaths') || []
  }

  let elmJsonFileUris = await vscode.workspace.findFiles('**/elm.json', '**/node_modules/**', 10)
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
            // TODO: Make sure that docs are installed before running this step
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
    } catch (reason) {
      console.error(`Failed to parse elm.json`, { uri: uri.fsPath, contents: fileContents, reason })
    }
  })