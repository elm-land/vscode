const child_process = require('child_process')
const vscode = require('vscode')



module.exports = (globalState, collection) => async (document) => {
  let uri = vscode.Uri.file(document.fileName.split('.git')[0])
  let elmJsonFile = findElmJsonFor(globalState, uri)

  let compileElmFile = async (elmJsonFile, elmFilesToCompile) => {
    const error = await Elm.compile({ elmJsonFile, elmFilesToCompile })
    let filesWithErrors = []
    if (error) {
      const items = Elm.toDiagnostics({ error })
      for (var item of items) {
        let { fsPath, diagnostics } = item
        filesWithErrors.push(fsPath)
        collection.set(vscode.Uri.file(fsPath), diagnostics)
      }
    }
    return filesWithErrors
  }

  if (elmJsonFile) {
    let elmFilesToCompile =
      (elmJsonFile.entrypoints.length > 0)
        ? elmJsonFile.entrypoints.concat([uri.fsPath])
        : [uri.fsPath]

    let fsPathsWithErrors = await compileElmFile(elmJsonFile, elmFilesToCompile)

    // Remove stale errors
    collection.forEach(uri => {
      if (fsPathsWithErrors.includes(uri.fsPath) === false) {
        collection.set(uri, undefined)
      }
    })
  } else {
    console.error(`Couldn't find an elm.json file for ${uri.fsPath}`)
  }
}

let findElmJsonFor = (globalState, uri) => {
  let filepath = uri.fsPath

  for (let elmJsonFile of globalState.elmJsonFiles) {
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

  toDiagnostics: (input) => {
    switch (input.error.kind) {
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

const isCaseInsensitiveMatch = (a, b) => {
  return a.toLowerCase() === b.toLowerCase()
}