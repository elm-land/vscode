import { spawn } from "child_process"
import * as path from "path"

export type Output = {
  qualified: QualifiedItem[]
  aliased: AliasedItem[]
  exposed: ExposedItem[]
}

export type QualifiedItem = {
  fsPath: string
  lineNumber: number
  usageLine: string
}
export type AliasedItem = {
  aliasName: string
  matches: QualifiedItem[]
}
export type ExposedItem = { fsPath: string; importLine: string }

export const elmFind = async (options: {
  folder: string
  typeOrValueName: string
  moduleName: string
}): Promise<Output> => {
  let { folder, typeOrValueName } = options
  let moduleName = options.moduleName.split(".").join("\\.")

  let runScript = (filename: string): Promise<string> =>
    new Promise((resolve) => {
      let pathToScript = path.join(__dirname, "scripts", filename)
      let cmd = spawn(`sh`, [pathToScript, folder, moduleName, typeOrValueName])

      let lines = ""
      cmd.stdout.on("data", (line: string) => {
        lines += line.toString()
      })

      cmd.on("close", () => resolve(lines))
    })

  return Promise.all([
    runScript("1.sh").then((line) => line.split("\n").filter((x) => x)),
    runScript("2.sh").then((line) =>
      line.split("\n\n").filter((x) => x.trim().split("\n").length > 1)
    ),
    runScript("3.sh").then((line) => line.split("\n").filter((x) => x)),
  ]).then(toOutput)
}

let toOutput = ([qualified, aliased, exposed]: [
  string[],
  string[],
  string[]
]): Output => ({
  qualified: qualified.flatMap(toQualifiedItem),
  aliased: aliased.flatMap(toAliasedItem),
  exposed: exposed.flatMap(toExposedItem),
})

//
// Example: "/usr/code/src/Main.elm:45:    Ui.Button.view { ... }"
//
const toQualifiedItem = (line: string): QualifiedItem[] => {
  let indexOfFirstColon = line.indexOf(":")
  let indexOfSecondColon =
    indexOfFirstColon + 1 + line.substring(indexOfFirstColon + 1).indexOf(":")
  try {
    let fsPath = line.substring(0, indexOfFirstColon)
    let lineNumber = parseInt(
      line.substring(indexOfFirstColon + 1, indexOfSecondColon)
    )
    let usageLine = line.substring(indexOfSecondColon + 1)
    if (fsPath && usageLine && lineNumber) {
      return [{ fsPath, usageLine, lineNumber }]
    }
  } catch (_) {}
  return []
}

//
// Example:
//     Btn
//     /usr/code/src/Main.elm:45:    Btn.view { ... }
//     /usr/code/src/Main.elm:58:    Btn.view { ... }
//
const toAliasedItem = (line: string): AliasedItem[] => {
  let [aliasName, ...matchingLines] = line.trim().split("\n")

  if (aliasName && matchingLines.length) {
    return [{ aliasName, matches: matchingLines.flatMap(toQualifiedItem) }]
  }

  return []
}

//
// Example: "/usr/code/src/Main.elm:import Ui.Button as Button exposing (..)"
//
const toExposedItem = (line: string): ExposedItem[] => {
  let indexOfFirstColon = line.indexOf(":")

  let fsPath = line.substring(0, indexOfFirstColon)
  let importLine = line.substring(indexOfFirstColon + 1)
  if (fsPath && importLine) {
    return [{ fsPath, importLine }]
  } else {
    return []
  }
}
