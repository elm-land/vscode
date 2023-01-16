const vscode = require('vscode')
const sharedLogic = require('./_shared-logic')
const ElmToAst = require('./elm-to-ast/index.js')

// VS code has zero-based ranges and positions, so we need to decrement all values
// returned from ElmToAst so they work with the code editor
const fromElmRange = (array) => new vscode.Range(...array.map(x => x - 1))

module.exports = (globalState) => {
  return {
    async provideDefinition(doc, position, token) {
      const start = Date.now()
      const text = doc.getText()
      const ast = await ElmToAst.run(text)

      if (ast) {
        const elmJsonFile = sharedLogic.findElmJsonFor(globalState, doc.uri)

        if (elmJsonFile) {
          // Handle module definitions
          let matchingLocation = handleJumpToLinksForModuleDefinition({ doc, position, start, elmJsonFile, ast })
          if (matchingLocation) {
            console.info('provideDefinition:moduleDefinition', `${Date.now() - start}ms`)
            return matchingLocation
          }

          // Handle module imports
          let packages = sharedLogic.getMappingOfPackageNamesToUris(elmJsonFile)
          matchingLocation = await handleJumpToLinksForImports({ position, start, ast, elmJsonFile, packages })
          if (matchingLocation) {
            console.info('provideDefinition:imports', `${Date.now() - start}ms`)
            return matchingLocation
          }

          // Handle module declarations
          matchingLocation = await handleJumpToLinksForDeclarations({ position, start, ast, doc, elmJsonFile })
          if (matchingLocation) {
            console.info('provideDefinition:declaration', `${Date.now() - start}ms`)
            return matchingLocation
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

      console.info('provideDocumentLinks', `${Date.now() - start}ms`)
      return links
    },
  }
}

const handleJumpToLinksForModuleDefinition = ({ doc, position, start, ast }) => {
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
          return new vscode.Location(
            doc.uri,
            fromElmRange(declaration.range)
          )
        }
      }
    }
  }
}

const handleJumpToLinksForImports = async ({ position, start, ast, elmJsonFile, packages }) => {
  for (let import_ of ast.imports) {

    // Add any links to locally imported modules
    let range = fromElmRange(import_.value.moduleName.range)
    if (range.contains(position)) {
      const moduleNameNode = import_.value.moduleName
      const moduleName = moduleNameNode.value.join('.')

      let fileUri = await findLocalProjectFileUri(elmJsonFile, moduleName)
      if (fileUri) {
        let otherDocument = await vscode.workspace.openTextDocument(fileUri)
        let otherAst = await ElmToAst.run(otherDocument.getText())
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

            return // TODO: Make this link to the docs preview pane?
          }

          // Check if module is a local project file
          let fileUri = await findLocalProjectFileUri(elmJsonFile, moduleName)
          if (fileUri) {

            let otherDocument = await vscode.workspace.openTextDocument(fileUri)
            let otherAst = await ElmToAst.run(otherDocument.getText())
            const topOfFileRange = otherAst.moduleDefinition.value.normal.moduleName.range
            for (let declaration of otherAst.declarations) {
              let declarationName = getNameFromDeclaration(declaration)
              if (declarationName === name) {

                return new vscode.Location(
                  fileUri,
                  fromElmRange(declaration.range)
                )
              }
            }

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

const handleJumpToLinksForDeclarations = async ({ position, start, ast, doc, elmJsonFile }) => {
  // Need to build up a collection of which types and values
  // are being exposed by all imports.
  // (This will be useful later when jumping to definitions)
  let explicitExposingValuesForImports = {}
  let hasUnknownImportsFromExposingAll = []
  let aliasMappingToModuleNames = {}

  const findImportedModuleNamesThatMightHaveExposedThisValue = (moduleName) => {
    let explicitMatches = explicitExposingValuesForImports[moduleName] || []
    return explicitMatches.concat(hasUnknownImportsFromExposingAll)
  }

  const findLocationOfItemFromImportedFiles = ({ findItemWithName, isItemExposedFromModule }) => async (importModuleNames, moduleName) => {
    for (let importedModuleName of importModuleNames) {
      // POST-MATURE OPTIMIZATION: Opportunity to make these filesystem calls in parallel
      let importedModuleNameUri = await findLocalProjectFileUri(elmJsonFile, importedModuleName)

      if (importedModuleNameUri) {
        let importedDoc = await vscode.workspace.openTextDocument(importedModuleNameUri)
        let importedAst = await ElmToAst.run(importedDoc.getText())

        let item = findItemWithName(importedAst, moduleName)

        if (item && isItemExposedFromModule(importedAst, moduleName)) {
          return new vscode.Location(
            importedModuleNameUri,
            fromElmRange(item.range)
          )
        }
      }
    }
  }

  const isDeclarationExposed = (exposingList, itemName) => {
    for (let item of exposingList) {
      if (item.value.type === 'typeOrAlias') {
        if (item.value.typeOrAlias.name === itemName) {
          return true
        }
      } else if (item.value.type === 'function') {
        if (item.value.function.name === itemName) {
          return true
        }
      } else if (item.value.type === 'typeexpose') {
        if (item.value.typeexpose.name === itemName) {
          return true
        }
      } else {
        console.error('provideDefinition:error:unhandledExposedMember', item.value)
      }
    }
    return false
  }

  const isCustomTypeVariantExposed = (exposingList, itemName, ast) => {
    for (let item of exposingList) {
      if (item.value.type === 'typeOrAlias') {
        // keep looping
      } else if (item.value.type === 'function') {
        // keep looping
      } else if (item.value.type === 'typeexpose') {

        // "Is the custom type exposing it's variants?"
        if (item.value.typeexpose.open) {
          let listOfCustomVariantNames = findCustomVariantNamesInModule(ast, item.value.typeexpose.name)

          // "Does the custom type actually have a variant with the name we're looking for?"
          for (let customVariantName of listOfCustomVariantNames) {
            if (customVariantName === itemName) {
              return true
            }
          }
        }
      } else {
        console.error('provideDefinition:error:unhandledExposedMember', item.value)
      }
    }
    return false
  }

  const findCustomVariantNamesInModule = (ast, customTypeName) => {
    for (let declaration of ast.declarations) {
      if (declaration.value.type === 'typedecl') {
        let typeDeclaration = declaration.value.typedecl
        if (typeDeclaration.name.value === customTypeName) {
          return typeDeclaration.constructors.map(constructor => constructor.value.name.value)
        }
      }
    }
    return []
  }

  const isItemExposedFromModule = ({ isExplicitItemExposed }) => (ast, itemName) => {
    let exposingList = ast.moduleDefinition.value.normal.exposingList

    if (exposingList.value.type === 'all') {
      return true
    } else if (exposingList.value.type === 'explicit') {
      return isExplicitItemExposed(
        exposingList.value.explicit,
        itemName,
        ast
      )
    } else {
      console.error('provideDefinition:error:unhandledExposingList', exposingList.value)
    }

    return false
  }



  const isDeclarationExposedFromModule = isItemExposedFromModule({
    isExplicitItemExposed: isDeclarationExposed
  })

  const isCustomTypeVariantExposedFromModule = isItemExposedFromModule({
    isExplicitItemExposed: isCustomTypeVariantExposed
  })

  const findLocationOfDeclarationFromImportedFiles =
    findLocationOfItemFromImportedFiles({
      findItemWithName: findDeclarationWithName,
      isItemExposedFromModule: isDeclarationExposedFromModule
    })
  const findLocationOfCustomTypeVariantFromImportedFiles =
    findLocationOfItemFromImportedFiles({
      findItemWithName: findCustomTypeVariantWithName,
      isItemExposedFromModule: isCustomTypeVariantExposedFromModule
    })

  const findLocationOfItemForModuleName = ({ findItemWithName, findLocationOfItem }) =>
    async ({ doc, ast, moduleName }) => {
      let couldBeFromThisModuleOrAnImport = moduleName.split('.').length === 1
      let parentModules = moduleName.split('.').slice(0, -1)
      let name = moduleName.split('.').slice(-1)[0]

      if (couldBeFromThisModuleOrAnImport) {
        let item = findItemWithName(ast, moduleName)

        if (item) {
          return new vscode.Location(
            doc.uri,
            fromElmRange(item.range)
          )
        }

        let otherModuleNamesToCheck = findImportedModuleNamesThatMightHaveExposedThisValue(moduleName) || []

        let matchingLocation = await findLocationOfItem(otherModuleNamesToCheck, name)
        if (matchingLocation) return matchingLocation
      } else {
        // Example: If a user clicked on "Html.Attributes.Attribute", this
        // would return "Html.Attributes"
        let parentModuleName = parentModules.join('.')

        let aliases = aliasMappingToModuleNames[parentModuleName] || []
        let moduleNamesToCheck = [parentModuleName].concat(aliases)

        let matchingLocation = await findLocationOfItem(moduleNamesToCheck, name)
        if (matchingLocation) return matchingLocation
      }
    }

  const findLocationOfCustomTypeVariantForModuleName =
    findLocationOfItemForModuleName({
      findItemWithName: findCustomTypeVariantWithName,
      findLocationOfItem: findLocationOfCustomTypeVariantFromImportedFiles,
    })

  const findLocationOfDeclarationForModuleName =
    findLocationOfItemForModuleName({
      findItemWithName: findDeclarationWithName,
      findLocationOfItem: findLocationOfDeclarationFromImportedFiles,
    })

  const findLocationOfCustomTypeForPattern = async (pattern, range) => {
    if (['var', 'all', 'unit', 'char', 'string', 'int', 'hex', 'float', 'record'].includes(pattern.type)) {
      return
    } else if (pattern.type === 'parentisized') {
      return findLocationOfCustomTypeForPattern(pattern.parentisized.value.value, range)
    } else if (pattern.type === 'named') {
      let moduleName = [...pattern.named.qualified.moduleName, pattern.named.qualified.name].join('.')

      // Workaround because there's no range information for the qualified
      let args = pattern.named.patterns
      let isNotOneOfArguments = args.every(arg => !fromElmRange(arg.range).contains(position))

      if (range.contains(position) && isNotOneOfArguments) {
        let matchingLocation = await findLocationOfCustomTypeVariantForModuleName({ doc, ast, moduleName })
        if (matchingLocation) return matchingLocation
      }

      for (let argument of args) {
        let matchingLocation = await findLocationOfCustomTypeForPattern(argument.value, fromElmRange(argument.range))
        if (matchingLocation) return matchingLocation
      }
    } else if (pattern.type === 'uncons') {
      let left = pattern.uncons.left
      let right = pattern.uncons.right

      for (let item of [left, right]) {
        let range = fromElmRange(item.range)
        if (range.contains(position)) {
          let matchingLocation = await findLocationOfCustomTypeForPattern(item.value, range)
          if (matchingLocation) return matchingLocation
        }
      }
    } else if (pattern.type === 'list') {
      for (let item of pattern.list.value) {
        let range = fromElmRange(item.range)
        if (range.contains(position)) {
          let matchingLocation = await findLocationOfCustomTypeForPattern(item.value, range)
          if (matchingLocation) return matchingLocation
        }
      }
    } else if (pattern.type === 'as') {
      let item = pattern.as.pattern
      let range = fromElmRange(item.range)
      if (range.contains(position)) {
        let matchingLocation = await findLocationOfCustomTypeForPattern(item.value, range)
        if (matchingLocation) return matchingLocation
      }
    } else {
      console.error('provideDefinition:error:unhandledPattern', pattern)
    }
  }

  const findLocationForExpressionWithName = async ({ args, name, localDeclarations }) => {
    // Check for if in current function's argument list
    for (let argument of args) {
      let matchingArgument = findArgumentWithMatchingName({ argument, name })
      if (matchingArgument) {
        return new vscode.Location(
          doc.uri,
          fromElmRange(matchingArgument.range)
        )
      }
    }

    // Check through any locally scoped expressions from a let-in block
    for (let declaration of localDeclarations) {
      let declarationName = declaration.value.function.declaration.value.name.value
      if (declarationName === name) {
        return new vscode.Location(
          doc.uri,
          fromElmRange(declaration.range)
        )
      }
    }

    // Check for any function declarations
    let matchingLocation = await findLocationOfDeclarationForModuleName({ doc, ast, moduleName: name })
    if (matchingLocation) return matchingLocation

    // Check for any custom type variants
    matchingLocation = await findLocationOfCustomTypeVariantForModuleName({ doc, ast, moduleName: name })
    if (matchingLocation) return matchingLocation
  }

  const findLocationOfItemsForExpression = async (expression, args, localDeclarations) => {
    if ([
      'unit',
      'hex',
      'negation',
      'integer',
      'float',
      'literal',
      'charLiteral',
      'glsl',
      'recordAccessFunction'
    ].includes(expression.type)) {
      return
    } else if (expression.type === 'application') {
      for (let item of expression.application) {
        let range = fromElmRange(item.range)
        if (range.contains(position)) {
          return findLocationOfItemsForExpression(item.value, args, localDeclarations)
        }
      }
    } else if (expression.type === 'functionOrValue') {
      let name = [...expression.functionOrValue.moduleName, expression.functionOrValue.name].join('.')
      return findLocationForExpressionWithName({ name, args, localDeclarations })
    } else if (expression.type === 'parenthesized') {
      return findLocationOfItemsForExpression(expression.parenthesized.value, args, localDeclarations)
    } else if (expression.type === 'list') {
      let items = expression.list
      for (let item of items) {
        let range = fromElmRange(item.range)
        if (range.contains(position)) {
          return findLocationOfItemsForExpression(item.value, args, localDeclarations)
        }
      }
    } else if (expression.type === 'tupled') {
      let items = expression.tupled
      for (let item of items) {
        let range = fromElmRange(item.range)
        if (range.contains(position)) {
          return findLocationOfItemsForExpression(item.value, args, localDeclarations)
        }
      }
    } else if (expression.type === 'record') {
      let items = expression.record.map(field => field.value.expression)

      for (let item of items) {
        let range = fromElmRange(item.range)
        if (range.contains(position)) {
          return findLocationOfItemsForExpression(item.value, args, localDeclarations)
        }
      }
    } else if (expression.type === 'case') {
      // Handle the expression between the "case" and "of"
      let caseOfRange = fromElmRange(expression.case.expression.range)
      if (caseOfRange.contains(position)) {
        return findLocationOfItemsForExpression(expression.case.expression.value, args, localDeclarations)
      }

      // Handle each branch of the case expression
      let items = expression.case.cases

      for (let item of items) {
        // The part before the "->"
        let patternRange = fromElmRange(item.pattern.range)
        if (patternRange.contains(position)) {
          return findLocationOfCustomTypeForPattern(item.pattern.value, patternRange)
        }

        // The expression after the "->"
        let expressionRange = fromElmRange(item.expression.range)
        if (expressionRange.contains(position)) {
          return findLocationOfItemsForExpression(item.expression.value, args, localDeclarations)
        }
      }
    } else if (expression.type === 'recordAccess') {
      let range = fromElmRange(expression.recordAccess.expression.range)
      if (range.contains(position)) {
        return findLocationOfItemsForExpression(expression.recordAccess.expression.value, args, localDeclarations)
      }
    } else if (expression.type === 'recordUpdate') {
      // Try to link the the part before the "|"
      let range = fromElmRange(expression.recordUpdate.name.range)
      if (range.contains(position)) {
        return findLocationForExpressionWithName({ args, name: expression.recordUpdate.name.value, localDeclarations })
      }

      // Try to link to items within expression
      let items = expression.recordUpdate.updates.map(update => update.value.expression)
      for (let item of items) {
        let range = fromElmRange(item.range)
        if (range.contains(position)) {
          return findLocationOfItemsForExpression(item.value, args, localDeclarations)
        }
      }
    } else if (expression.type === 'ifBlock') {
      let items = [
        expression.ifBlock.clause,
        expression.ifBlock.then,
        expression.ifBlock.else
      ]

      for (let item of items) {
        let range = fromElmRange(item.range)
        if (range.contains(position)) {
          return findLocationOfItemsForExpression(item.value, args, localDeclarations)
        }
      }
    } else if (expression.type === 'let') {
      let letDeclarations = expression.let.declarations
      let newLocalDeclarations = localDeclarations.concat(letDeclarations)

      // Handle declarations between "let" and "in" keywords
      for (let declaration of letDeclarations) {
        let range = fromElmRange(declaration.range)
        if (range.contains(position)) {
          return findLocationForFunctionDeclaration(
            declaration,
            args,
            newLocalDeclarations
          )
        }
      }

      // Handle expression after the "in" keyword
      let range = fromElmRange(expression.let.expression.range)
      if (range.contains(position)) {
        return findLocationOfItemsForExpression(expression.let.expression.value, args, newLocalDeclarations)
      }
    } else if (expression.type === 'lambda') {
      let patterns = expression.lambda.patterns

      for (let pattern of patterns) {
        let range = fromElmRange(pattern.range)
        if (range.contains(position)) {
          return findLocationOfCustomTypeForPattern(pattern.value, range)
        }
      }

      let item = expression.lambda.expression
      let range = fromElmRange(item.range)
      if (range.contains(position)) {
        return findLocationOfItemsForExpression(item.value, args, localDeclarations)
      }
    }

    else {
      console.error('provideDefinition:error:unhandledExpression', expression)
    }
  }

  const findArgumentWithMatchingName = ({ argument, name }) => {
    if (['all', 'unit', 'char', 'string', 'int', 'hex', 'float'].includes(argument.value.type)) {
      return
    } else if (argument.value.type === 'var') {
      if (argument.value.var.value === name) {
        return argument
      }
    } else {
      console.error('provideDefinition:error:unhandledArgumentPattern', argument.value)
    }
    //   [
    //     'var',
    //     'all',
    //     'unit',
    //     'char',
    //     'string', 'int', 'hex', 'float', 'record'
    //   'parentisized'
    //   'named'
    //   'uncons'
    //   'list'
    //   'as'
    // ]
  }

  const findLocationForTypeAnnotation = async (typeAnnotation) => {
    if (typeAnnotation.type === 'typed') {
      let moduleNameAndName = typeAnnotation.typed.moduleNameAndName

      let range = fromElmRange(moduleNameAndName.range)
      if (range.contains(position)) {
        let matchingLocation = await findLocationOfDeclarationForModuleName({
          doc,
          ast,
          moduleName: getNameFromModuleNameAndName(moduleNameAndName)
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
      console.error('provideDefinition:error:unhandledTypeAnnotation', typeAnnotation)
    }
  }

  const findLocationForFunctionDeclaration = async (declaration, existingArgs, localDeclarations) => {
    let func = declaration.value.function

    // Handle function type annotations
    if (func.signature) {
      let typeAnnotation = func.signature.value.typeAnnotation.value

      let matchingLocation = await findLocationForTypeAnnotation(typeAnnotation)
      if (matchingLocation) return matchingLocation
    }

    // Handle function arguments (Destructuring custom types)
    let args = func.declaration.value.arguments

    for (let arg of args) {
      let matchingLocation = await findLocationOfCustomTypeForPattern(arg.value, fromElmRange(arg.range))
      if (matchingLocation) return matchingLocation
    }

    // Handle function expression
    let range = fromElmRange(func.declaration.value.expression.range)
    if (range.contains(position)) {
      let matchingLocation = await findLocationOfItemsForExpression(
        func.declaration.value.expression.value,
        existingArgs.concat(args),
        localDeclarations
      )
      if (matchingLocation) return matchingLocation
    }
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
        console.error('provideDefinition:error:unhandledExposingListType', import_.value.exposingList.value)
      }
    }
  }

  for (let declaration of ast.declarations) {
    let range = fromElmRange(declaration.range)
    if (range.contains(position)) {
      if (declaration.value.type === 'function') {
        return findLocationForFunctionDeclaration(declaration, [], [])
      } else if (declaration.value.type === 'typeAlias') {
        let typeAnnotation = declaration.value.typeAlias.typeAnnotation.value

        let matchingLocation = await findLocationForTypeAnnotation(typeAnnotation)
        if (matchingLocation) return matchingLocation
      } else if (declaration.value.type === 'typedecl') {
        let constructorArguments =
          declaration.value.typedecl.constructors
            .flatMap(constructor => constructor.value.arguments)

        for (var customTypeVariantArg of constructorArguments) {
          let matchingLocation = await findLocationForTypeAnnotation(customTypeVariantArg.value)
          if (matchingLocation) return matchingLocation
        }
      } else {
        console.error(`provideDefinition:error:unhandledDeclarationType`, declaration.value)
      }
    }
  }
}


// UTILITIES

const getNameFromDeclaration = (declaration) => {
  let declarationType = declaration.value.type
  if (declarationType === 'typedecl') {
    return declaration.value.typedecl.name.value
  } else if (declarationType === 'function') {
    return declaration.value.function.declaration.value.name.value
  } else if (declarationType === 'typeAlias') {
    return declaration.value.typeAlias.name.value
  } else {
    console.error('provideDefinition:error:unhandledDeclarationType', declaration)
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

const findCustomTypeVariantWithName = (ast, name) => {
  for (let declaration of ast.declarations) {
    if (declaration.value.type === 'typedecl') {
      let customTypeVariants = declaration.value.typedecl.constructors
      for (let variant of customTypeVariants) {
        if (variant.value.name.value === name) {
          return variant
        }
      }
    }
  }
}

const findLocalProjectFileUri = async (elmJsonFile, moduleName) => {
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