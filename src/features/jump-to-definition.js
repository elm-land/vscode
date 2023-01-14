const sharedLogic = require('./_shared-logic')
const vscode = require('vscode')

module.exports = (globalState) => {
  return {
    async provideDocumentLinks(document, token) {
      const links = []
      const text = document.getText()

      // If we have found an elm.json file, we should scan its dependencies
      // to make nice links to the documentation
      let packages = {}
      let findLocalProjectFileUri = async (moduleName) => undefined

      if (globalState.elmJsonFiles[0]) {
        const elmJsonFile = globalState.elmJsonFiles[0]

        const dependencies = elmJsonFile.dependencies

        for (let dep of dependencies) {
          for (let doc of dep.docs) {
            packages[doc.name] = vscode.Uri.parse(`https://package.elm-lang.org/packages/${dep.packageUserAndName}/${dep.packageVersion}/${doc.name.split('.').join('-')}`)
          }
        }

        findLocalProjectFileUri = async (moduleName) => {
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

          return localFileUri
        }
      }

      const regex = new RegExp(`^import\\s+(\\S+)`, 'gm')
      let match

      while (match = regex.exec(text)) {
        const key = match[1]
        const start = document.positionAt(match.index + 7)
        const end = document.positionAt(match.index + match[0].length)
        const range = new vscode.Range(start, end)
        const target = packages[key] || await findLocalProjectFileUri(key)
        if (target) {
          links.push(new vscode.DocumentLink(range, target))
        }
      }

      return links
    },
  }
}
