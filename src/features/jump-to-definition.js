const vscode = require('vscode')
const sharedLogic = require('./_shared-logic')
const ElmToAst = require('./elm-to-ast/index.js')

// VS code has zero-based ranges and positions, so we need to decrement all values
// returned from ElmToAst so they work with the code editor
const fromElmRange = (array) => new vscode.Range(...array.map(x => x - 1))

const getNameFromDeclaration = (declaration) => {
  let declarationType = declaration.value.type
  if (declarationType === 'typedecl') {
    return declaration.value.typedecl.name.value
  } else if (declarationType === 'function') {
    return declaration.value.function.signature.value.name.value
  } else if (declarationType === 'typeAlias') {
    return declaration.value.typeAlias.name.value
  } else {
    console.error('provideDefinition:error:unknownDeclarationType', declaration)
  }
}

module.exports = (globalState) => {
  return {
    async provideDefinition(document, position, token) {
      const start = Date.now()
      const text = document.getText()
      const ast = await ElmToAst.run(text)

      if (ast) {
        const elmJsonFile = sharedLogic.findElmJsonFor(globalState, document.uri)

        if (elmJsonFile) {
          let packages = sharedLogic.getMappingOfPackageNamesToUris(elmJsonFile)

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

          // Add links to exported members of the current module
          let exposingList = ast.moduleDefinition.value.normal.exposingList

          if (exposingList.value.type === 'explicit') {
            let explictExports = exposingList.value.explicit
            for (let export_ of explictExports) {
              let range = fromElmRange(export_.range)
              if (range.contains(position)) {
                let type = export_.value.type
                let name = export_.value[type].name

                for (let declaration of ast.declarations) {
                  let declarationName = getNameFromDeclaration(declaration)
                  if (declarationName === name) {
                    console.info('provideDefinition:module-export:file', `${Date.now() - start}ms`)
                    return new vscode.Location(
                      document.uri,
                      fromElmRange(declaration.range)
                    )
                  }
                }
              }
            }
          }


          for (let import_ of ast.imports) {

            // Add any links to locally imported modules
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

            // Check if user is hovering over an exposed import value
            if (import_.value.exposingList && import_.value.exposingList.value.type === 'explicit') {
              const explicitlyImportedValues = import_.value.exposingList.value.explicit
              for (let explicitImport of explicitlyImportedValues) {
                let range = fromElmRange(explicitImport.range)
                if (range.contains(position)) {
                  const type = explicitImport.value.type
                  const name = explicitImport.value[type] ? explicitImport.value[type].name : undefined

                  const moduleNameNode = import_.value.moduleName.value.join('.')
                  const moduleName = moduleNameNode

                  // Check if module is from an Elm package
                  let packageUri = packages[moduleName]
                  if (packageUri) {
                    console.info('provideDefinition:exposing:package', `${Date.now() - start}ms`)

                    return // TODO: Make this link to the specific function
                  }

                  // Check if module is a local project file
                  let fileUri = await findLocalProjectFileUri(moduleName)
                  if (fileUri) {

                    let otherDocument = await vscode.workspace.openTextDocument(fileUri)
                    let otherAst = await ElmToAst.run(otherDocument.getText())
                    const topOfFileRange = otherAst.moduleDefinition.value.normal.moduleName.range
                    for (let declaration of otherAst.declarations) {
                      let declarationName = getNameFromDeclaration(declaration)
                      if (declarationName === name) {
                        console.info('provideDefinition:exposing:file', `${Date.now() - start}ms`)
                        return new vscode.Location(
                          fileUri,
                          fromElmRange(declaration.range)
                        )
                      }
                    }
                    console.info('provideDefinition:exposing:file', `${Date.now() - start}ms`)
                    return new vscode.Location(
                      fileUri,
                      fromElmRange(topOfFileRange)
                    )
                  }
                }
              }
            }
          }
        }
      }
    },

    async provideDocumentLinks(document, token) {
      const start = Date.now()
      const links = []
      const elmJsonFile = sharedLogic.findElmJsonFor(globalState, document.uri)

      // If we find an elm.json file, we should scan its dependencies
      // and get nice links to the package documentation
      if (elmJsonFile) {
        // Scan elm.json for packages
        let packages = sharedLogic.getMappingOfPackageNamesToUris(elmJsonFile)

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