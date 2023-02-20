import { exec } from "node:child_process"
import * as vscode from "vscode"
import { elmFind, Output, QualifiedItem } from "../elm-find"

export type Input = {
  folders: string[]
  moduleName: string
  typeOrValueName: string
}

export type FindElmFilesOutput = {
  matches: vscode.Location[]
  fsPathsToScan: string[]
}

export const findElmFiles = async ({
  folders,
  moduleName,
  typeOrValueName,
}: Input): Promise<FindElmFilesOutput> => {
  const isWindows = process.platform === "win32"

  if (isWindows) {
    // 🐢 Slower version ( needs an "elmFind" implementation for findstr, cat, etc )
    let fsPaths = await findWindowsElmFilesImportingModuleWithValueName({
      folders,
      moduleName,
      typeOrValueName,
    })
    return { matches: [], fsPathsToScan: fsPaths }
  } else {
    // 🐇 Faster version (but requires grep, sed, xargs, cat)
    let results = await Promise.all(
      folders.map((folder) => elmFind({ folder, moduleName, typeOrValueName }))
    )

    let fromItemToLocation = (
      item: QualifiedItem,
      usage: string
    ): vscode.Location => {
      let index = item.usageLine.indexOf(usage)
      return new vscode.Location(
        vscode.Uri.file(item.fsPath),
        new vscode.Range(
          new vscode.Position(item.lineNumber - 1, index),
          new vscode.Position(item.lineNumber - 1, index + usage.length)
        )
      )
    }

    let toMatch = ({ qualified, aliased }: Output): vscode.Location[] => {
      let qualifiedMatches = qualified.map((item) => {
        let usage = `${moduleName}.${typeOrValueName}`
        return fromItemToLocation(item, usage)
      })
      let aliasedMatches = aliased.flatMap((item) => {
        let usage = `${item.aliasName}.${typeOrValueName}`
        return item.matches.map((match) => fromItemToLocation(match, usage))
      })
      return qualifiedMatches.concat(aliasedMatches)
    }

    let fsPathsToScan = results.flatMap((result) =>
      result.exposed.map((x) => x.fsPath)
    )

    return {
      matches: results.flatMap(toMatch),
      fsPathsToScan,
    }
  }
}

//
// In Elm, the only way module "XYZ" could be used is if
// there is at least one line starting with "import XYZ"
//
// Note: This function may overmatch on Windows, because I couldn't find
// a way to make "findstr" distinguish "import XYZ" from "import XYZABC"
// or "import XYZ.ABC"
//
//    findElmFilesImportingModule({
//      moduleName: 'Http',
//      folders: [
//        '/Users/ryan/code/elm-land/vscode/examples/01-hello-world/src'
//      ]
//    })
//

const findWindowsElmFilesImportingModule = async ({
  folders,
  moduleName,
}: {
  folders: string[]
  moduleName: string
}): Promise<string[]> => {
  //
  //   findstr /srm /c:"^import Html" /d:folder1\src;folder2\src *.elm
  //
  const { command, args } = {
    command: "findstr",
    args: [
      `/srm`,
      `/c:"^import ${moduleName}"`,
      `/d:${folders.join(";")}`,
      `*.elm`,
    ],
  }

  return new Promise((resolve) => {
    exec([command, ...args].join(" "), (err, stdout) => {
      if (err) {
        resolve([])
      } else {
        let filepaths = stdout.split("\n").filter((a) => a)
        resolve(filepaths)
      }
    })
  })
}

const findWindowsElmFilesImportingModuleWithValueName = async ({
  folders,
  moduleName,
  typeOrValueName,
}: Input): Promise<string[]> => {
  // Find all filepaths importing the module
  let filepathsImportingModule = await findWindowsElmFilesImportingModule({
    folders,
    moduleName,
  })

  //
  //   findstr /srm /c:"Model" filepath1.elm filepath2.elm
  //
  const { command, args } = {
    command: "findstr",
    args: [`/srm`, `/c:"${typeOrValueName}"`, ...filepathsImportingModule],
  }

  return new Promise((resolve) => {
    exec([command, ...args].join(" "), (err, stdout) => {
      if (err) {
        resolve([])
      } else {
        let filepaths = stdout.split("\n").filter((a) => a)
        resolve(filepaths)
      }
    })
  })
}

export default {
  findElmFiles,
}
