const vscode = require('vscode')
const ElmToAst = require('../elm-to-ast/index.js')

// VS code has zero-based ranges and positions, so we need to decrement all values
// returned from ElmToAst so they work with the code editor
const fromElmRange = (array) => new vscode.Range(...array.map(x => x - 1))

module.exports = (globalState) => {

  return {
    async provideDefinition(document, position, token) {
      const start = Date.now()
      const text = document.getText()
      const ast = await ElmToAst.run(text)

      if (ast && globalState.elmJsonFiles[0]) {
        const elmJsonFile = globalState.elmJsonFiles[0]

        const findLocalProjectFileUri = async (moduleName) => {
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

          // Return the file URI
          return localFileUri
        }

        // Check if this is an "import"
        for (let import_ of ast.imports) {
          let range = fromElmRange(import_.value.moduleName.range)
          if (range.contains(position)) {
            const moduleNameNode = import_.value.moduleName
            const moduleName = moduleNameNode.value.join('.')

            let fileUri = await findLocalProjectFileUri(moduleName)
            if (fileUri) {
              let otherDocument = await vscode.workspace.openTextDocument(fileUri)
              let otherAst = await ElmToAst.run(otherDocument.getText())
              console.info('provideDefinition:import:file', `${Date.now() - start}ms`)
              return new vscode.Location(
                fileUri,
                fromElmRange(otherAst.moduleDefinition.value.normal.moduleName.range)
              )
            }
          }
        }
      }

    },

    async provideDocumentLinks(document, token) {
      const start = Date.now()
      const links = []

      // If we find an elm.json file, we should scan its dependencies
      // and get nice links to the package documentation
      if (globalState.elmJsonFiles[0]) {
        // Scan elm.json for packages
        let packages = {}
        const elmJsonFile = globalState.elmJsonFiles[0]
        const dependencies = elmJsonFile.dependencies
        for (let dep of dependencies) {
          for (let doc of dep.docs) {
            packages[doc.name] = vscode.Uri.parse(`https://package.elm-lang.org/packages/${dep.packageUserAndName}/${dep.packageVersion}/${doc.name.split('.').join('-')}`)
          }
        }

        const text = document.getText()
        const ast = await ElmToAst.run(text)

        if (ast) {
          // Add links to all package imports
          for (let import_ of ast.imports) {
            const moduleNameNode = import_.value.moduleName
            const moduleName = moduleNameNode.value.join('.')
            const packageUri = packages[moduleName]

            if (packageUri) {
              links.push(
                new vscode.DocumentLink(
                  fromElmRange(moduleNameNode.range),
                  packageUri
                )
              )
            }
          }
        }
      }

      console.info('provideDocumentLinks', `${Date.now() - start}ms`)
      return links
    },
  }
}