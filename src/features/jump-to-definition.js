const sharedLogic = require('./_shared-logic')
const vscode = require('vscode')

// Example: "import Html"
const toImportRegex = () => new RegExp(`^import\\s+(\\S+)`, 'gm')

const getRangeForImportRegex = (document, match) => {
  const start = document.positionAt(match.index + 7)
  const end = document.positionAt(match.index + match[0].length)

  return new vscode.Range(start, end)
}

// Example: "Html.Events.onClick"
const toModuleAccessRegex = () => /(?<!module)([\s\(]+)([A-Z][A-Za-z_\.]+)/gm

const getRangeForModuleAccessRegex = (document, match) => {
  const start = document.positionAt(match.index + match[1].length)
  const end = document.positionAt(match.index + match[0].length)

  return new vscode.Range(start, end)
}


module.exports = (globalState) => {

  return {
    async provideDefinition(document, position, token) {
      console.log('provideDefinition', position)
      const { packages, files, findLocalProjectFileUriAndCacheResult } = createSharedContext(globalState)

      const text = document.getText()

      let regex = toImportRegex()
      let match = undefined
      while (match = regex.exec(text)) {
        const range = getRangeForImportRegex(document, match)
        if (range.contains(position)) {
          // This is a match– let's link to the module!
          const moduleName = match[1]
          let fileUri = files[moduleName] || await findLocalProjectFileUriAndCacheResult(moduleName)
          return new vscode.Location(
            fileUri,
            new vscode.Range(0, 0, 1, 0)
          )
        }
      }
    },

    async provideDocumentLinks(document, token) {
      const { packages } = createSharedContext(globalState)

      const links = []
      const text = document.getText()

      // Handle "import" statements ( both package docs and )
      let regex = toImportRegex()
      let match = undefined
      while (match = regex.exec(text)) {
        const moduleName = match[1]
        const range = getRangeForImportRegex(document, match)
        const target = packages[moduleName] // || files[moduleName] || await findLocalProjectFileUriAndCacheResult(moduleName)
        if (target) {
          links.push(new vscode.DocumentLink(range, target))
        }
      }

      // Handle "module access" statements ( like "Html.text" or "Pages.Home_.Model" )
      regex = toModuleAccessRegex()
      match = undefined
      while (match = regex.exec(text)) {
        const moduleSegments = match[2].split('.')
        const moduleName = moduleSegments.slice(0, -1).join('.')
        const lastItem = moduleSegments.slice(-1)[0]
        const range = getRangeForModuleAccessRegex(document, match)
        let target = undefined
        if (packages[moduleName]) {
          let packageUri = vscode.Uri.from(packages[moduleName])
          packageUri.fragment = lastItem
          target = packageUri
        }
        if (target) {
          links.push(new vscode.DocumentLink(range, target))
        }
      }

      return links
    },
  }
}



// Shared context used by both "jump-to-definition" and "link" providers above
const createSharedContext = (globalState) => {
  let packages = {}
  let files = {}
  let findLocalProjectFileUriAndCacheResult = async (moduleName) => undefined

  // If we have found an elm.json file, we should scan its dependencies
  // to make nice links to the documentation
  if (globalState.elmJsonFiles[0]) {
    const elmJsonFile = globalState.elmJsonFiles[0]

    const dependencies = elmJsonFile.dependencies

    for (let dep of dependencies) {
      for (let doc of dep.docs) {
        packages[doc.name] = vscode.Uri.parse(`https://package.elm-lang.org/packages/${dep.packageUserAndName}/${dep.packageVersion}/${doc.name.split('.').join('-')}`)
      }
    }

    findLocalProjectFileUriAndCacheResult = async (moduleName) => {
      // Search for a local file matching the module name
      let localFileUri =
        await Promise.all(
          elmJsonFile.sourceDirectories
            .map(folder => vscode.Uri.file(folder + '/' + moduleName.split('.').join('/') + '.elm'))
            .map(fileUri =>
              vscode.workspace.fs.stat(fileUri)
                .then(stat => stat ? fileUri : false)
                .catch(_ => false)
            )
        )
          .then(files => files.filter(a => a)[0])
          .catch(_ => undefined)

      // If we find a match, add it to the "files" cache to save time later
      if (localFileUri) {
        files[moduleName] = localFileUri
      }

      // Return the file URI
      return localFileUri
    }
  }

  return {
    packages,
    files,
    findLocalProjectFileUriAndCacheResult
  }
}