const child_process = require('child_process')
const path = require('path')
const vscode = require('vscode')
const sharedLogic = require('./_shared-logic')

module.exports = async (globalState, collection, document, event) => {
  let uri =
    document.fileName.includes('.git')
      ? vscode.Uri.file(document.fileName.split('.git')[0])
      : document.uri

  const isElmFile = uri.fsPath && uri.fsPath.endsWith('.elm')
  const isElmJsonFile = uri.fsPath && uri.fsPath.endsWith('elm.json')

  if (isElmFile || isElmJsonFile) {
    let elmJsonFile = findElmJsonFor(globalState, uri)

    let compileElmFile = async (elmJsonFile, elmFilesToCompile) => {
      const error = await Elm.compile({ elmJsonFile, elmFilesToCompile })

      if (error) {
        const items = Elm.toDiagnostics(elmJsonFile, { error })
        for (var item of items) {
          let { fsPath, diagnostics } = item
          collection.set(vscode.Uri.file(fsPath), diagnostics)
        }
      }

    }

    // Remove stale errors
    collection.clear()

    if (elmJsonFile) {
      let entrypoints = await verifyEntrypointExists(elmJsonFile.entrypoints)
      let elmFilesToCompile = isElmFile ? entrypoints.concat([uri.fsPath]) : entrypoints

      if (elmFilesToCompile.length > 0) {
        await compileElmFile(elmJsonFile, elmFilesToCompile)
      }
    } else {
      console.error(`Couldn't find an elm.json file for ${uri.fsPath}`)
    }
  }
}

let findElmJsonFor = (globalState, uri) => {
  let filepath = uri.fsPath

  for (let elmJsonFile of globalState.elmJsonFiles) {
    if (elmJsonFile.uri.fsPath === filepath) {
      return elmJsonFile
    }
    for (let sourceDirectory of elmJsonFile.sourceDirectories) {
      if (filepath.startsWith(sourceDirectory)) {
        return elmJsonFile
      }
    }
  }
}

const Elm = {
  compile: (input) => {
    let deduplicated = [...new Set(input.elmFilesToCompile)]
    const command = `(cd ${input.elmJsonFile.projectFolder} && npx elm make ${deduplicated.join(' ')} --output=/dev/null --report=json)`
    const promise = new Promise((resolve) =>
      child_process.exec(command, (err, _, stderr) => {
        if (err) {
          try {
            const json = JSON.parse(stderr)
            switch (json.type) {
              case 'compile-errors':
                return resolve(
                  { kind: 'compile-errors', errors: json.errors }
                )
              case 'error':
                return resolve(
                  {
                    kind: 'error',
                    title: json.title,
                    path: json.path,
                    message: json.message
                  }
                )
              default:
                throw new Error("Unhandled error type: " + json.type)
            }
          } catch (ex) {
            resolve({ kind: 'unknown', raw: stderr })
          }
        } else {
          resolve(undefined)
        }
      }))

    return promise
  },

  toDiagnostics: (elmJsonFile, input) => {
    switch (input.error.kind) {
      case 'error':
        const entireFileRange = {
          start: new vscode.Position(0, 0),
          end: new vscode.Position(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER)
        }
        let items = []

        if (input.error.title === 'MISSING SOURCE DIRECTORY') {
          let directory = input.error.message.slice(1, -1).map(x => x.string)[0]
          if (directory) {
            let elmRange = sharedLogic.findFirstOccurenceOfWordInFile(directory, elmJsonFile.rawFileContents)
            if (elmRange) {
              items = [
                toDiagnosticItem({
                  filepath: elmJsonFile.uri.fsPath,
                  problems: [
                    {
                      range: sharedLogic.fromElmRange(elmRange),
                      title: input.error.title,
                      message: input.error.message
                    }
                  ]
                })
              ]
            }
          }
        } else if (input.error.title === 'MISSING SOURCE DIRECTORIES') {
          let directories = input.error.message.filter(x => typeof x === 'object').map(x => x.string)
          if (directories) {
            items = [
              toDiagnosticItem({
                filepath: elmJsonFile.uri.fsPath,
                problems: directories
                  .map(directory => {
                    let elmRange = sharedLogic.findFirstOccurenceOfWordInFile(directory, elmJsonFile.rawFileContents)
                    if (elmRange) {
                      return {
                        range: sharedLogic.fromElmRange(elmRange),
                        title: input.error.title,
                        message: input.error.message
                      }
                    }
                  }).filter(a => a)
              })
            ]
          }
        } else {
          items = [
            toDiagnosticItem({
              filepath:
                input.error.path
                  ? path.join(elmJsonFile.projectFolder, input.error.path)
                  : elmJsonFile.uri.fsPath,
              problems: [
                {
                  range: entireFileRange,
                  title: input.error.title,
                  message: input.error.message
                }
              ]
            })
          ]
        }
        return items
      case 'compile-errors':
        return input.error.errors.flatMap(error => {
          const problems = error.problems

          let diagnostics = problems.map(problem => {
            const diagnostic = {
              severity: vscode.DiagnosticSeverity.Error,
              range: {
                start: Elm.fromErrorLocation(problem.region.start),
                end: Elm.fromErrorLocation(problem.region.end)
              },
              message: Elm.formatErrorMessage(problem.title, problem.message)
            }
            return diagnostic
          })

          return { fsPath: error.path, diagnostics }
        })
      case 'unknown':
        return []
    }
  },
  fromErrorLocation: (location) => {
    return { line: location.line - 1, character: location.column - 1 }
  },
  formatErrorMessage: (title, message) => {
    return title + '\n\n' + message.map(line => {
      if (typeof line === 'string') {
        return line
      } else {
        // VS Code Diagnostics do not support color error messages
        if (line.color === 'RED') {
          return line.string
        }
        return line.string
      }
    }).join('') + '\n'
  }
}

const toDiagnosticItem = ({ filepath, problems }) => {
  let diagnostics = problems.map(({ range, title, message }) => ({
    severity: vscode.DiagnosticSeverity.Error,
    range,
    message: Elm.formatErrorMessage(title, message)
  }))
  return {
    fsPath: filepath,
    diagnostics
  }
}

const verifyEntrypointExists = async (entrypoints) => {
  let files = await Promise.all(entrypoints.map(verifyFileExists))
  return files.filter(a => a)
}

const verifyFileExists = async (fsPath) => {
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