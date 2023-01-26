import vscode from 'vscode'
import sharedLogic from './_shared-logic'
import * as ElmSyntax from './elm-to-ast/index.js'
import { ElmJsonFile, GlobalState } from './autodetect-elm-json'

type Packages = { [moduleName: string]: string }

type FindLinkToPackageDocsInput = {
  packages: Packages
  moduleName: string
  typeOrValueName?: string
}

const findLinkToPackageDocs = async ({ packages, moduleName, typeOrValueName }: FindLinkToPackageDocsInput) => {
  let pathToDocsJson = packages[moduleName]
  if (pathToDocsJson) {
    let uri = vscode.Uri.file(pathToDocsJson)

    // Find range of word
    let otherDoc = await vscode.workspace.openTextDocument(uri)
    let rawJsonString = otherDoc.getText()

    let wordToFind = typeOrValueName || moduleName
    let range = sharedLogic.findFirstOccurenceOfWordInFile(wordToFind, rawJsonString)

    // Add metadata to request
    let params = new URLSearchParams()
    params.set('pathToDocsJson', pathToDocsJson)
    params.set('moduleName', moduleName)
    if (typeOrValueName) {
      params.set('typeOrValue', typeOrValueName)
    }

    // @ts-ignore
    uri.query = params.toString()

    return new vscode.Location(
      uri,
      sharedLogic.fromElmRange(range || [1, 1, 1, 1])
    )
  }
}

export default (globalState: GlobalState) => {
  return {
    async provideDefinition(doc: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken) {
      const start = Date.now()
      const text = doc.getText()
      const ast = await ElmSyntax.run(text)

      if (ast) {
        const elmJsonFile = sharedLogic.findElmJsonFor(globalState, doc.uri)

        if (elmJsonFile) {
          // Handle module definitions
          let matchingLocation = handleJumpToLinksForModuleDefinition({ doc, position, ast })
          if (matchingLocation) {
            console.info('provideDefinition', `${Date.now() - start}ms`)
            return matchingLocation
          }

          // Handle module imports
          let packages = sharedLogic.getMappingOfPackageNameToDocJsonFilepath(elmJsonFile)
          matchingLocation = await handleJumpToLinksForImports({ position, ast, elmJsonFile, packages })
          if (matchingLocation) {
            console.info('provideDefinition', `${Date.now() - start}ms`)
            return matchingLocation
          }

          // Handle module declarations
          matchingLocation = await handleJumpToLinksForDeclarations({ position, ast, doc, elmJsonFile, packages })
          if (matchingLocation) {
            console.info('provideDefinition', `${Date.now() - start}ms`)
            return matchingLocation
          }
        }
      }
    }
  }
}


type HandleJumpLinksInput = {
  doc: vscode.TextDocument
  position: vscode.Position
  ast: ElmSyntax.Ast
}

const handleJumpToLinksForModuleDefinition = ({ doc, position, ast }: HandleJumpLinksInput) => {
  const moduleData = ElmSyntax.toModuleData(ast)
  let exposingList = moduleData.exposingList

  if (exposingList.value.type === 'explicit') {
    let explictExports = exposingList.value.explicit
    for (let export_ of explictExports) {
      let range = sharedLogic.fromElmRange(export_.range)
      if (range.contains(position)) {
        let name = ElmSyntax.toTopLevelExposeName(export_.value)
        let declaration = ElmSyntax.findDeclarationWithName(ast, name)

        if (declaration) {
          return new vscode.Location(
            doc.uri,
            sharedLogic.fromElmRange(declaration.range)
          )
        }
      }
    }
  }
}

type HandleJumpToLinksForImportsInput = {
  position: vscode.Position
  ast: ElmSyntax.Ast
  elmJsonFile: ElmJsonFile
  packages: Packages
}

const handleJumpToLinksForImports =
  async ({ position, ast, elmJsonFile, packages }: HandleJumpToLinksForImportsInput)
    : Promise<vscode.Location | undefined> => {

    for (let import_ of ast.imports) {

      // Add any links to locally imported modules
      let range = sharedLogic.fromElmRange(import_.value.moduleName.range)
      if (range.contains(position)) {
        const moduleNameNode = import_.value.moduleName
        const moduleName = moduleNameNode.value.join('.')

        let fileUri = await findLocalProjectFileUri(elmJsonFile, moduleName)
        if (fileUri) {
          let otherDocument = await vscode.workspace.openTextDocument(fileUri)
          let otherAst = await ElmSyntax.run(otherDocument.getText())
          if (otherAst) {
            const otherModuleData: ElmSyntax.ModuleData = ElmSyntax.toModuleData(otherAst)
            return new vscode.Location(
              fileUri,
              sharedLogic.fromElmRange(otherModuleData.moduleName.range)
            )
          }
        }

        // Check if this is from an Elm package
        let linkToPackageDocs = await findLinkToPackageDocs({
          packages,
          moduleName
        })
        if (linkToPackageDocs) return linkToPackageDocs
      }

      // Check if user is hovering over an exposed import value
      if (import_.value.exposingList && import_.value.exposingList.value.type === 'explicit') {
        const explicitlyImportedValues = import_.value.exposingList.value.explicit
        for (let explicitImport of explicitlyImportedValues) {
          let range = sharedLogic.fromElmRange(explicitImport.range)
          if (range.contains(position)) {
            const name = ElmSyntax.toTopLevelExposeName(explicitImport.value)

            const moduleNameNode = import_.value.moduleName.value.join('.')
            const moduleName = moduleNameNode

            // Check if this is from an Elm package
            let linkToPackageDocs = await findLinkToPackageDocs({
              packages,
              moduleName,
              typeOrValueName: name
            })
            if (linkToPackageDocs) return linkToPackageDocs

            // Check if module is a local project file
            let fileUri = await findLocalProjectFileUri(elmJsonFile, moduleName)
            if (fileUri) {

              let otherDocument = await vscode.workspace.openTextDocument(fileUri)
              let otherAst = await ElmSyntax.run(otherDocument.getText())

              if (otherAst) {
                const topOfFileRange = ElmSyntax.toModuleData(otherAst).moduleName.range

                for (let declaration of otherAst.declarations) {
                  let declarationName = ElmSyntax.toDeclarationName(declaration)
                  if (declarationName === name) {

                    return new vscode.Location(
                      fileUri,
                      sharedLogic.fromElmRange(declaration.range)
                    )
                  }
                }

                return new vscode.Location(
                  fileUri,
                  sharedLogic.fromElmRange(topOfFileRange)
                )
              }
            }
          }
        }
      }
    }
  }

type HandleJumpToLinksForDeclarationsInput = {
  position: vscode.Position
  ast: ElmSyntax.Ast,
  doc: vscode.TextDocument
  elmJsonFile: ElmJsonFile
  packages: Packages
}

const handleJumpToLinksForDeclarations = async ({ position, ast, doc, elmJsonFile, packages }: HandleJumpToLinksForDeclarationsInput) => {
  // Need to build up a collection of which types and values
  // are being exposed by all imports.
  // (This will be useful later when jumping to definitions)
  let explicitExposingValuesForImports: Record<string, string[]> = {}
  let hasUnknownImportsFromExposingAll: string[] = []
  let aliasMappingToModuleNames: Record<string, string[]> = {}

  const findImportedModuleNamesThatMightHaveExposedThisValue = (moduleName: string): string[] => {
    let explicitMatches = explicitExposingValuesForImports[moduleName] || []
    return explicitMatches.concat(hasUnknownImportsFromExposingAll)
  }

  type FindLocationOfItemFromImportedFilesInput<item> = {
    findItemWithName: (ast: ElmSyntax.Ast, moduleName: string) => ElmSyntax.Node<item> | undefined
    isItemExposedFromModule: (ast: ElmSyntax.Ast, moduleName: string) => boolean
  }

  const findLocationOfItemFromImportedFiles =
    <item>({ findItemWithName, isItemExposedFromModule }: FindLocationOfItemFromImportedFilesInput<item>) =>
      async (importModuleNames: string[], moduleName: string) => {
        for (let importedModuleName of importModuleNames) {
          // POST-MATURE OPTIMIZATION: Opportunity to make these filesystem calls in parallel
          let importedModuleNameUri = await findLocalProjectFileUri(elmJsonFile, importedModuleName)

          if (importedModuleNameUri) {
            let importedDoc = await vscode.workspace.openTextDocument(importedModuleNameUri)
            let importedAst = await ElmSyntax.run(importedDoc.getText())

            if (importedAst) {
              let item = findItemWithName(importedAst, moduleName)

              if (item && isItemExposedFromModule(importedAst, moduleName)) {
                return new vscode.Location(
                  importedModuleNameUri,
                  sharedLogic.fromElmRange(item.range)
                )
              }
            }
          }
        }
      }

  const isDeclarationExposed = (
    exposingList: ElmSyntax.Node<ElmSyntax.TopLevelExpose>[],
    itemName: string
  ): boolean => {
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

  const isCustomTypeVariantExposed = (
    exposingList: ElmSyntax.Node<ElmSyntax.TopLevelExpose>[],
    itemName: string,
    ast: ElmSyntax.Ast
  ) => {
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

  const findCustomVariantNamesInModule = (ast: ElmSyntax.Ast, customTypeName: string) => {
    for (let declaration of ast.declarations) {
      if (declaration.value.type === 'typedecl') {
        let typeDeclaration = declaration.value.typedecl
        if (typeDeclaration.name.value === customTypeName) {
          return typeDeclaration.constructors.map((constructor: ElmSyntax.Node<ElmSyntax.TypeConstructor>) => constructor.value.name.value)
        }
      }
    }
    return []
  }

  type IsExplicitItemExposed =
    (a: ElmSyntax.Node<ElmSyntax.TopLevelExpose>[],
      b: string,
      ast: ElmSyntax.Ast

    ) => boolean

  const isItemExposedFromModule =
    ({ isExplicitItemExposed }: { isExplicitItemExposed: IsExplicitItemExposed }) =>
      (ast: ElmSyntax.Ast, itemName: string): boolean => {
        const moduleData: ElmSyntax.ModuleData = ElmSyntax.toModuleData(ast)
        let exposingList = moduleData.exposingList

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

  const findLocationOfDeclarationFromImportedFiles = findLocationOfItemFromImportedFiles({
    findItemWithName: ElmSyntax.findDeclarationWithName,
    isItemExposedFromModule: isDeclarationExposedFromModule
  })

  const findLocationOfCustomTypeVariantFromImportedFiles = findLocationOfItemFromImportedFiles({
    findItemWithName: ElmSyntax.findCustomTypeVariantWithName,
    isItemExposedFromModule: isCustomTypeVariantExposedFromModule
  })

  type FindLocationOfItemForModuleNameInput<item> = {
    findItemWithName: (ast: ElmSyntax.Ast, moduleName: string) => ElmSyntax.Node<item> | undefined
    findLocationOfItem: (otherModuleNames: string[], name: string) => Promise<vscode.Location | undefined>
  }

  const findLocationOfItemForModuleName = <item>({ findItemWithName, findLocationOfItem }: FindLocationOfItemForModuleNameInput<item>) =>
    async ({ doc, ast, moduleName }: { doc: vscode.TextDocument, ast: ElmSyntax.Ast, moduleName: string }): Promise<vscode.Location | undefined> => {
      let couldBeFromThisModuleOrAnImport = moduleName.split('.').length === 1
      let parentModules = moduleName.split('.').slice(0, -1)
      let name = moduleName.split('.').slice(-1)[0]

      if (couldBeFromThisModuleOrAnImport) {
        let item = findItemWithName(ast, moduleName)

        if (item) {
          return new vscode.Location(
            doc.uri,
            sharedLogic.fromElmRange(item.range)
          )
        }

        let otherModuleNamesToCheck = findImportedModuleNamesThatMightHaveExposedThisValue(moduleName) || []

        // Check local project files
        if (name) {
          let matchingLocation = await findLocationOfItem(otherModuleNamesToCheck, name)
          if (matchingLocation) return matchingLocation
        }

        // Check installed Elm packages
        for (let moduleName of otherModuleNamesToCheck) {
          let linkToPackageDocs = await findLinkToPackageDocs({
            packages,
            moduleName,
            typeOrValueName: name
          })
          if (linkToPackageDocs) return linkToPackageDocs
        }
      } else {
        // Example: If a user clicked on "Html.Attributes.Attribute", this
        // would return "Html.Attributes"
        let parentModuleName = parentModules.join('.')

        let aliases = aliasMappingToModuleNames[parentModuleName] || []
        let moduleNamesToCheck = [parentModuleName].concat(aliases)

        // Check local project files
        if (name) {
          let matchingLocation = await findLocationOfItem(moduleNamesToCheck, name)
          if (matchingLocation) return matchingLocation
        }

        // Check installed Elm packages
        for (var moduleName of moduleNamesToCheck) {
          let linkToPackageDocs = await findLinkToPackageDocs({
            packages,
            moduleName,
            typeOrValueName: name
          })
          if (linkToPackageDocs) return linkToPackageDocs
        }

      }
    }

  const findLocationOfCustomTypeVariantForModuleName = findLocationOfItemForModuleName({
    findItemWithName: ElmSyntax.findCustomTypeVariantWithName,
    findLocationOfItem: findLocationOfCustomTypeVariantFromImportedFiles,
  })

  const findLocationOfDeclarationForModuleName = findLocationOfItemForModuleName({
    findItemWithName: ElmSyntax.findDeclarationWithName,
    findLocationOfItem: findLocationOfDeclarationFromImportedFiles,
  })

  const findLocationOfCustomTypeForPattern =
    async (pattern: ElmSyntax.Pattern, range: vscode.Range)
      : Promise<vscode.Location | undefined> => {
      if (['var', 'all', 'unit', 'char', 'string', 'int', 'hex', 'float', 'record'].includes(pattern.type)) {
        return
      } else if (pattern.type === 'parentisized') {
        return findLocationOfCustomTypeForPattern(pattern.parentisized.value.value, range)
      } else if (pattern.type === 'named') {
        let moduleName = [...pattern.named.qualified.moduleName, pattern.named.qualified.name].join('.')

        // Workaround because there's no range information for the qualified
        let args = pattern.named.patterns
        let isNotOneOfArguments = args.every(arg => !sharedLogic.fromElmRange(arg.range).contains(position))

        if (range.contains(position) && isNotOneOfArguments) {
          let matchingLocation = await findLocationOfCustomTypeVariantForModuleName({ doc, ast, moduleName })
          if (matchingLocation) return matchingLocation
        }

        for (let argument of args) {
          let matchingLocation = await findLocationOfCustomTypeForPattern(argument.value, sharedLogic.fromElmRange(argument.range))
          if (matchingLocation) return matchingLocation
        }
      } else if (pattern.type === 'uncons') {
        let left = pattern.uncons.left
        let right = pattern.uncons.right

        for (let item of [left, right]) {
          let range = sharedLogic.fromElmRange(item.range)
          if (range.contains(position)) {
            let matchingLocation = await findLocationOfCustomTypeForPattern(item.value, range)
            if (matchingLocation) return matchingLocation
          }
        }
      } else if (pattern.type === 'list') {
        for (let item of pattern.list.value) {
          let range = sharedLogic.fromElmRange(item.range)
          if (range.contains(position)) {
            let matchingLocation = await findLocationOfCustomTypeForPattern(item.value, range)
            if (matchingLocation) return matchingLocation
          }
        }
      } else if (pattern.type === 'as') {
        let item = pattern.as.pattern
        let range = sharedLogic.fromElmRange(item.range)
        if (range.contains(position)) {
          let matchingLocation = await findLocationOfCustomTypeForPattern(item.value, range)
          if (matchingLocation) return matchingLocation
        }
      } else {
        console.error('provideDefinition:error:unhandledPattern', pattern)
      }
    }

  type FindLocationForExpressionInput = {
    name: string
    args: ElmSyntax.Node<ElmSyntax.Pattern>[]
    localDeclarations: ElmSyntax.Node<ElmSyntax.Declaration>[]
  }

  const findLocationForExpressionWithName = async ({ name, args, localDeclarations }: FindLocationForExpressionInput): Promise<vscode.Location | undefined> => {
    // Check for if in current function's argument list
    for (let argument of args) {
      let matchingArgument = findArgumentWithMatchingName({ argument, name })
      if (matchingArgument) {
        return new vscode.Location(
          doc.uri,
          sharedLogic.fromElmRange(matchingArgument.range)
        )
      }
    }

    // Check through any locally scoped expressions from a let-in block
    for (let declaration of localDeclarations) {
      if (ElmSyntax.isFunctionDeclaration(declaration)) {
        let declarationName = declaration.value.function.declaration.value.name.value
        if (declarationName === name) {
          return new vscode.Location(
            doc.uri,
            sharedLogic.fromElmRange(declaration.range)
          )
        }
      }
    }

    // Check for any custom type variants
    let matchingLocation = await findLocationOfCustomTypeVariantForModuleName({ doc, ast, moduleName: name })
    if (matchingLocation) return matchingLocation

    // Check for any function declarations
    matchingLocation = await findLocationOfDeclarationForModuleName({ doc, ast, moduleName: name })
    if (matchingLocation) return matchingLocation

    // Check if this is from an Elm package
    let moduleName = name.split('.').slice(0, -1).join('.')
    let typeOrValueName = name.split('.').slice(-1)[0]

    if (moduleName) {
      // Check if this is from an Elm package
      let linkToPackageDocs = findLinkToPackageDocs({
        packages,
        moduleName,
        typeOrValueName: typeOrValueName
      })
      if (linkToPackageDocs) return linkToPackageDocs
    }
  }

  const findLocationOfItemsForExpression = async (
    expression: ElmSyntax.Expression,
    args: ElmSyntax.Node<ElmSyntax.Pattern>[],
    localDeclarations: ElmSyntax.Node<ElmSyntax.Declaration>[]): Promise<vscode.Location | undefined> => {
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
        let range = sharedLogic.fromElmRange(item.range)
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
        let range = sharedLogic.fromElmRange(item.range)
        if (range.contains(position)) {
          return findLocationOfItemsForExpression(item.value, args, localDeclarations)
        }
      }
    } else if (expression.type === 'tupled') {
      let items = expression.tupled
      for (let item of items) {
        let range = sharedLogic.fromElmRange(item.range)
        if (range.contains(position)) {
          return findLocationOfItemsForExpression(item.value, args, localDeclarations)
        }
      }
    } else if (expression.type === 'record') {
      let items = expression.record.map(field => field.value.expression)

      for (let item of items) {
        let range = sharedLogic.fromElmRange(item.range)
        if (range.contains(position)) {
          return findLocationOfItemsForExpression(item.value, args, localDeclarations)
        }
      }
    } else if (expression.type === 'case') {
      // Handle the expression between the "case" and "of"
      let caseOfRange = sharedLogic.fromElmRange(expression.case.expression.range)
      if (caseOfRange.contains(position)) {
        return findLocationOfItemsForExpression(expression.case.expression.value, args, localDeclarations)
      }

      // Handle each branch of the case expression
      let items = expression.case.cases

      for (let item of items) {
        // The part before the "->"
        let patternRange = sharedLogic.fromElmRange(item.pattern.range)
        if (patternRange.contains(position)) {
          return findLocationOfCustomTypeForPattern(item.pattern.value, patternRange)
        }

        // The expression after the "->"
        let expressionRange = sharedLogic.fromElmRange(item.expression.range)
        if (expressionRange.contains(position)) {
          return findLocationOfItemsForExpression(item.expression.value, args, localDeclarations)
        }
      }
    } else if (expression.type === 'recordAccess') {
      let range = sharedLogic.fromElmRange(expression.recordAccess.expression.range)
      if (range.contains(position)) {
        return findLocationOfItemsForExpression(expression.recordAccess.expression.value, args, localDeclarations)
      }
    } else if (expression.type === 'recordUpdate') {
      // Try to link the the part before the "|"
      let range = sharedLogic.fromElmRange(expression.recordUpdate.name.range)
      if (range.contains(position)) {
        return findLocationForExpressionWithName({
          name: expression.recordUpdate.name.value,
          args,
          localDeclarations
        })
      }

      // Try to link to items within expression
      let items: ElmSyntax.Node<ElmSyntax.Expression>[] =
        expression.recordUpdate.updates
          .map(update => (update.value as any).expression)

      for (let item of items) {
        let range = sharedLogic.fromElmRange(item.range)
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
        let range = sharedLogic.fromElmRange(item.range)
        if (range.contains(position)) {
          return findLocationOfItemsForExpression(item.value, args, localDeclarations)
        }
      }
    } else if (expression.type === 'let') {
      let letDeclarations = expression.let.declarations
      let newLocalDeclarations = localDeclarations.concat(letDeclarations)

      // Handle declarations between "let" and "in" keywords
      for (let declaration of letDeclarations) {
        let range = sharedLogic.fromElmRange(declaration.range)
        if (range.contains(position) && ElmSyntax.isFunctionDeclaration(declaration)) {
          return findLocationForFunctionDeclaration(
            declaration,
            args,
            newLocalDeclarations
          )
        }
      }

      // Handle expression after the "in" keyword
      let range = sharedLogic.fromElmRange(expression.let.expression.range)
      if (range.contains(position)) {
        return findLocationOfItemsForExpression(expression.let.expression.value, args, newLocalDeclarations)
      }
    } else if (expression.type === 'lambda') {
      let patterns = expression.lambda.patterns

      for (let pattern of patterns) {
        let range = sharedLogic.fromElmRange(pattern.range)
        if (range.contains(position)) {
          return findLocationOfCustomTypeForPattern(pattern.value, range)
        }
      }

      let item = expression.lambda.expression
      let range = sharedLogic.fromElmRange(item.range)
      if (range.contains(position)) {
        return findLocationOfItemsForExpression(item.value, args, localDeclarations)
      }
    }

    else {
      console.error('provideDefinition:error:unhandledExpression', expression)
    }
  }

  const findArgumentWithMatchingName = ({ argument, name }: { argument: ElmSyntax.Node<ElmSyntax.Pattern>, name: string }) => {
    if (['all', 'unit', 'char', 'string', 'int', 'hex', 'float'].includes(argument.value.type)) {
      return
    } else if (argument.value.type === 'var') {
      if (argument.value.var.value === name) {
        return argument
      }
    } else {
      console.error('provideDefinition:error:unhandledArgumentPattern', argument.value)
    }
  }

  const findLocationForTypeAnnotation = async (typeAnnotation: ElmSyntax.TypeAnnotation): Promise<vscode.Location | undefined> => {
    if (typeAnnotation.type === 'typed') {
      let moduleNameAndName = typeAnnotation.typed.moduleNameAndName

      let range = sharedLogic.fromElmRange(moduleNameAndName.range)
      if (range.contains(position)) {
        let moduleName = ElmSyntax.getNameFromModuleNameAndName(moduleNameAndName)
        let matchingLocation = await findLocationOfDeclarationForModuleName({
          doc,
          ast,
          moduleName
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

  const findLocationForFunctionDeclaration = async (
    declaration: ElmSyntax.Node<{
      type: "function"
      function: ElmSyntax.Function_
    }>,
    existingArgs: ElmSyntax.Node<ElmSyntax.Pattern>[],
    localDeclarations: ElmSyntax.Node<ElmSyntax.Declaration>[]) => {
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
      let matchingLocation = await findLocationOfCustomTypeForPattern(arg.value, sharedLogic.fromElmRange(arg.range))
      if (matchingLocation) return matchingLocation
    }

    // Handle function expression
    let range = sharedLogic.fromElmRange(func.declaration.value.expression.range)
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
      if (alias !== undefined) {
        aliasMappingToModuleNames[alias] = aliasMappingToModuleNames[alias] || [] as string[]
        (aliasMappingToModuleNames[alias] as any).push(moduleName)
      }
    }

    // Keep track of module import `exposing` statements
    if (import_.value.exposingList) {

      let type = import_.value.exposingList.value.type
      if (import_.value.exposingList.value.type === 'explicit') {
        let topLevelExposeNodes = import_.value.exposingList.value.explicit
        let isExposingAnyCustomVariants =
          topLevelExposeNodes
            .some(export_ => export_.value.type === 'typeexpose')

        let namesOfExportedThings =
          topLevelExposeNodes
            .map(node => ElmSyntax.toTopLevelExposeName(node.value))

        for (let exportedName of namesOfExportedThings) {
          explicitExposingValuesForImports[exportedName] = explicitExposingValuesForImports[exportedName] || [] as string[]
          (explicitExposingValuesForImports[exportedName] as string[]).push(moduleName)
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
    let range = sharedLogic.fromElmRange(declaration.range)
    if (range.contains(position)) {
      if (ElmSyntax.isFunctionDeclaration(declaration)) {
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

const findLocalProjectFileUri = async (elmJsonFile: ElmJsonFile, moduleName: string) => {
  // Search for a local file matching the module name
  let localFileUri =
    await Promise.all(
      elmJsonFile.sourceDirectories
        .map(folder => vscode.Uri.file(folder + '/' + moduleName.split('.').join('/') + '.elm'))
        .map(fileUri => {
          vscode.workspace.fs.stat(fileUri)
            .then(stat => stat ? fileUri : false)
        })
    )
      .then(files => files.filter(a => a)[0])
      .catch(_ => undefined)

  // Return the file URI
  return localFileUri
}