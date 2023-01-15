const vscode = require('vscode')
const sharedLogic = require('./_shared-logic')
const ElmToAst = require('./elm-to-ast/index.js')

// VS code has zero-based ranges and positions, so we need to decrement all values
// returned from ElmToAst so they work with the code editor
const fromElmRange = (array) => new vscode.Range(...array.map(x => x - 1))

let info = (message) => {
  // console.info(message)
}

const getNameFromDeclaration = (declaration) => {
  let declarationType = declaration.value.type
  if (declarationType === 'typedecl') {
    return declaration.value.typedecl.name.value
  } else if (declarationType === 'function') {
    return declaration.value.function.declaration.value.name.value
  } else if (declarationType === 'typeAlias') {
    return declaration.value.typeAlias.name.value
  } else {
    console.error('provideDefinition:error:unknownDeclarationType', declaration)
  }
}

const getNameFromModuleNameAndName = (moduleNameAndName) => {
  return [
    ...moduleNameAndName.value.moduleName,
    moduleNameAndName.value.name
  ].join('.')
}

const findDeclarationWithName = (ast, name) => {
  for (let declaration of ast.declarations) {
    let declarationName = getNameFromDeclaration(declaration)
    if (declarationName === name) {
      return declaration
    }
  }
}


module.exports = (globalState) => {
  return {
    async provideDefinition(doc, position, token) {
      const start = Date.now()
      const text = doc.getText()
      const ast = await ElmToAst.run(text)

      if (ast) {
        const elmJsonFile = sharedLogic.findElmJsonFor(globalState, doc.uri)

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

          // Handle things exposed from current module
          let exposingList = ast.moduleDefinition.value.normal.exposingList

          if (exposingList.value.type === 'explicit') {
            let explictExports = exposingList.value.explicit
            for (let export_ of explictExports) {
              let range = fromElmRange(export_.range)
              if (range.contains(position)) {
                let type = export_.value.type
                let name = export_.value[type].name

                let declaration = findDeclarationWithName(ast, name)

                if (declaration) {
                  info('provideDefinition:module-export:file', `${Date.now() - start}ms`)
                  return new vscode.Location(
                    doc.uri,
                    fromElmRange(declaration.range)
                  )
                }
              }
            }
          }

          // Handle module imports
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
                info('provideDefinition:import:file', `${Date.now() - start}ms`)
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
                    info('provideDefinition:exposing:package', `${Date.now() - start}ms`)

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
                        info('provideDefinition:exposing:file', `${Date.now() - start}ms`)
                        return new vscode.Location(
                          fileUri,
                          fromElmRange(declaration.range)
                        )
                      }
                    }
                    info('provideDefinition:exposing:file', `${Date.now() - start}ms`)
                    return new vscode.Location(
                      fileUri,
                      fromElmRange(topOfFileRange)
                    )
                  }
                }
              }
            }
          }

          // Handle module definitions

          // Need to build up a collection of which types and values
          // are being exposed by all imports.
          // (This will be useful later when jumping to definitions)
          let explicitExposingValuesForImports = {}
          let hasUnknownImportsFromExposingAll = []
          let aliasMappingToModuleNames = {}
          const checkValueToImportedModuleName = (moduleName) => {
            let explicitMatches = explicitExposingValuesForImports[moduleName] || []
            return explicitMatches.concat(hasUnknownImportsFromExposingAll)
          }

          for (let import_ of ast.imports) {
            const moduleNameNode = import_.value.moduleName
            const moduleName = moduleNameNode.value.join('.')

            // Keep track of module import aliases
            if (import_.value.moduleAlias) {
              let alias = import_.value.moduleAlias.value[0]
              aliasMappingToModuleNames[alias] = aliasMappingToModuleNames[alias] || []
              aliasMappingToModuleNames[alias].push(moduleName)
            }

            // Keep track of module import `exposing` statements
            if (import_.value.exposingList) {

              let type = import_.value.exposingList.value.type
              if (type === 'explicit') {
                let isExposingAnyCustomVariants =
                  import_.value.exposingList.value.explicit
                    .some(export_ => export_.value.type === 'typeexpose')

                let namesOfExportedThings =
                  import_.value.exposingList.value.explicit
                    .map(export_ => {
                      let type = export_.value.type
                      return export_.value[type].name
                    })

                for (let exportedName of namesOfExportedThings) {
                  explicitExposingValuesForImports[exportedName] = explicitExposingValuesForImports[exportedName] || []
                  explicitExposingValuesForImports[exportedName].push(moduleName)
                }

                if (isExposingAnyCustomVariants) {
                  hasUnknownImportsFromExposingAll.push(moduleName)
                }
              } else if (type === 'all') {
                hasUnknownImportsFromExposingAll.push(moduleName)
              } else {
                console.error('provideDefinition:error:unknownExposingListType', import_.value.exposingList.value)
              }
            }
          }

          const findLocationFromImportedFiles = async (importModuleNames, moduleNameAndName) => {
            let moduleName = moduleNameAndName.value.name

            for (let importedModuleName of importModuleNames) {
              // POST-MATURE OPTIMIZATION: Opportunity to make these filesystem calls in parallel
              let importedModuleNameUri = await findLocalProjectFileUri(importedModuleName)

              if (importedModuleNameUri) {
                let importedDoc = await vscode.workspace.openTextDocument(importedModuleNameUri)

                let importedAst = await ElmToAst.run(importedDoc.getText())

                let declaration = findDeclarationWithName(importedAst, moduleName)

                if (declaration) {
                  info('provideDefinition:function:signature:other-module', `${Date.now() - start}ms`)
                  return new vscode.Location(
                    importedModuleNameUri,
                    fromElmRange(declaration.range)
                  )
                }
              }
            }
          }

          const findLocationForModuleNameAndName = async ({ doc, ast, moduleNameAndName }) => {
            let moduleName = getNameFromModuleNameAndName(moduleNameAndName)
            let couldBeFromThisModuleOrAnImport = moduleNameAndName.value.moduleName.length === 0

            if (couldBeFromThisModuleOrAnImport) {
              let declarationFromThisModule = findDeclarationWithName(ast, moduleName)

              if (declarationFromThisModule) {
                info('provideDefinition:function:signature', `${Date.now() - start}ms`)
                return new vscode.Location(
                  doc.uri,
                  fromElmRange(declarationFromThisModule.range)
                )
              }

              let otherModuleNamesToCheck = checkValueToImportedModuleName(moduleName) || []

              let matchingLocation = await findLocationFromImportedFiles(otherModuleNamesToCheck, moduleNameAndName)

              if (matchingLocation) {
                return matchingLocation
              }
            } else {
              // Example: If a user clicked on "Html.Attributes.Attribute", this
              // would return "Html.Attributes"
              let parentModuleName = moduleNameAndName.value.moduleName.join('.')

              let aliases = aliasMappingToModuleNames[parentModuleName] || []
              let moduleNamesToCheck = [parentModuleName].concat(aliases)

              let matchingLocation = await findLocationFromImportedFiles(moduleNamesToCheck, moduleNameAndName)
              if (matchingLocation) {
                return matchingLocation
              }
            }
          }

          const findLocationForTypeAnnotation = async (typeAnnotation) => {
            if (typeAnnotation.type === 'typed') {
              let moduleNameAndName = typeAnnotation.typed.moduleNameAndName

              let range = fromElmRange(moduleNameAndName.range)
              if (range.contains(position)) {
                let matchingLocation = await findLocationForModuleNameAndName({
                  doc,
                  ast,
                  moduleNameAndName
                })

                if (matchingLocation) {
                  return matchingLocation
                }
              }

              for (let arg of typeAnnotation.typed.args) {
                let matchingLocation = await findLocationForTypeAnnotation(arg.value)

                if (matchingLocation) {
                  return matchingLocation
                }
              }
            } else if (typeAnnotation.type === 'function') {
              let { left, right } = typeAnnotation.function

              for (let arg of [left, right]) {
                let matchingLocation = await findLocationForTypeAnnotation(arg.value)

                if (matchingLocation) {
                  return matchingLocation
                }
              }
            } else if (typeAnnotation.type === 'record') {
              let fieldValues = typeAnnotation.record.value
                .map(field => field.value.typeAnnotation)

              for (let arg of fieldValues) {
                let matchingLocation = await findLocationForTypeAnnotation(arg.value)

                if (matchingLocation) {
                  return matchingLocation
                }
              }
            } else if (typeAnnotation.type === 'tupled') {
              let fieldValues = typeAnnotation.tupled.values

              for (let arg of fieldValues) {
                let matchingLocation = await findLocationForTypeAnnotation(arg.value)

                if (matchingLocation) {
                  return matchingLocation
                }
              }
            } else if (typeAnnotation.type === 'genericRecord') {
              let fieldValues = typeAnnotation.genericRecord.values.value
                .map(field => field.value.typeAnnotation)

              for (let arg of fieldValues) {
                let matchingLocation = await findLocationForTypeAnnotation(arg.value)

                if (matchingLocation) {
                  return matchingLocation
                }
              }
            } else if (typeAnnotation.type === 'generic') {
              return undefined
            } else if (typeAnnotation.type === 'unit') {
              return undefined
            } else {
              console.error('provideDefinition:error:unknownTypeAnnotation', typeAnnotation)
            }
          }

          for (let declaration of ast.declarations) {
            if (declaration.value.type === 'function') {
              let func = declaration.value.function

              // Handle function type annotations
              if (func.signature) {
                let typeAnnotation = func.signature.value.typeAnnotation.value

                let matchingLocation = await findLocationForTypeAnnotation(typeAnnotation)

                if (matchingLocation) {
                  return matchingLocation
                }
              }
            }
          }
        }
      }
    },

    async provideDocumentLinks(doc, token) {
      const start = Date.now()
      const links = []
      const elmJsonFile = sharedLogic.findElmJsonFor(globalState, doc.uri)

      // If we find an elm.json file, we should scan its dependencies
      // and get nice links to the package docation
      if (elmJsonFile) {
        // Scan elm.json for packages
        let packages = sharedLogic.getMappingOfPackageNamesToUris(elmJsonFile)

        const text = doc.getText()
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

      info('provideDocumentLinks', `${Date.now() - start}ms`)
      return links
    },
  }
}