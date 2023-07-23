import * as vscode from 'vscode'
import sharedLogic, { Feature } from './shared/logic'
import * as ElmToAst from './shared/elm-to-ast'
import * as ElmSyntax from './shared/elm-to-ast/elm-syntax'
import { GlobalState } from './shared/autodetect-elm-json'
import { ElmJsonFile } from './shared/elm-json-file'

export const feature: Feature = ({ globalState, context }) => {
  context.subscriptions.push(
    vscode.languages.registerDefinitionProvider('elm', provider(globalState))
  )
}

const provider = (globalState: GlobalState) => {
  type Packages = { [moduleName: string]: string }

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
    return null
  }

  type HandleJumpToLinksForImportsInput = {
    document: vscode.TextDocument
    position: vscode.Position
    ast: ElmSyntax.Ast
    elmJsonFile: ElmJsonFile
    packages: Packages
  }

  const handleJumpToLinksForImports =
    async ({ document, position, ast, elmJsonFile, packages }: HandleJumpToLinksForImportsInput)
      : Promise<vscode.Location | null> => {

      for (let import_ of ast.imports) {

        // Add any links to locally imported modules
        let range = sharedLogic.fromElmRange(import_.value.moduleName.range)
        if (range.contains(position)) {
          const moduleNameNode = import_.value.moduleName
          const moduleName = moduleNameNode.value.join('.')

          let fileUri = await findLocalProjectFileUri(elmJsonFile, moduleName)
          if (fileUri) {
            let otherDocument = await vscode.workspace.openTextDocument(fileUri)
            let otherAst = await ElmToAst.run(otherDocument.getText())
            if (otherAst) {
              const otherModuleData: ElmSyntax.ModuleData = ElmSyntax.toModuleData(otherAst)
              return new vscode.Location(
                fileUri,
                sharedLogic.fromElmRange(otherModuleData.moduleName.range)
              )
            }
          }
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

              // Check if module is a local project file
              let fileUri = await findLocalProjectFileUri(elmJsonFile, moduleName)
              if (fileUri) {

                let otherDocument = await vscode.workspace.openTextDocument(fileUri)
                let otherAst = await ElmToAst.run(otherDocument.getText())

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
      return null
    }

  type HandleJumpToLinksForDeclarationsInput = {
    position: vscode.Position
    ast: ElmSyntax.Ast,
    doc: vscode.TextDocument
    elmJsonFile: ElmJsonFile
    packages: Packages
  }

  const handleJumpToLinksForDeclarations = async ({ position, ast, doc, elmJsonFile, packages }: HandleJumpToLinksForDeclarationsInput): Promise<vscode.Location | null> => {
    let {
      aliasMappingToModuleNames,
      explicitExposingValuesForImports,
      hasUnknownImportsFromExposingAll
    } = ElmSyntax.getInitialPreludeMappings()

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
            let importedModuleNameUri = await findLocalProjectFileUri(elmJsonFile, importedModuleName)

            if (importedModuleNameUri) {
              let importedDoc = await vscode.workspace.openTextDocument(importedModuleNameUri)
              let importedAst = await ElmToAst.run(importedDoc.getText())

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
        } else if (item.value.type === 'infix') {
          return false
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
        } else if (item.value.type === 'infix') {
          return false
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
        : Promise<vscode.Location | null> => {
        if (['var', 'all', 'unit', 'char', 'string', 'int', 'hex', 'float', 'record'].includes(pattern.type)) {
          return null
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
        } else if (pattern.type === 'tuple') {
          for (let item of pattern.tuple.value) {
            let range = sharedLogic.fromElmRange(item.range)
            if (range.contains(position)) {
              let matchingLocation = await findLocationOfCustomTypeForPattern(item.value, range)
              if (matchingLocation) return matchingLocation
            }
          }
        }
        return null
      }

    type FindLocationForExpressionInput = {
      name: string
      args: ElmSyntax.Node<ElmSyntax.Pattern>[]
      localDeclarations: ElmSyntax.Node<ElmSyntax.Declaration>[]
      localPatterns: ElmSyntax.Node<ElmSyntax.Pattern>[]
    }

    const findLocationForExpressionWithName = async ({ name, args, localDeclarations, localPatterns }: FindLocationForExpressionInput): Promise<vscode.Location | null> => {
      // Check for if in current function's argument list
      for (let argument of args) {
        let range = findArgumentWithMatchingName({ argument, name })
        if (range) {
          return new vscode.Location(
            doc.uri,
            sharedLogic.fromElmRange(range)
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

      // Check through any locally scoped patterns from a case expression
      for (let pattern of localPatterns) {
        let localVariables = fromPatternToLocalVariableNodes(pattern)

        for (let nameNode of localVariables) {
          if (nameNode.value === name) {
            return new vscode.Location(
              doc.uri,
              sharedLogic.fromElmRange(nameNode.range)
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

      return null
    }

    const fromPatternToLocalVariableNodes = (pattern: ElmSyntax.Node<ElmSyntax.Pattern>): ElmSyntax.Node<string>[] => {
      switch (pattern.value.type) {
        case "string":
        case "unit":
        case "all":
        case "hex":
        case "float":
        case "char":
        case 'int':
          return []
        case 'record':
          return pattern.value.record.value
        case 'list':
          return pattern.value.list.value.flatMap(fromPatternToLocalVariableNodes)
        case 'tuple':
          return pattern.value.tuple.value.flatMap(fromPatternToLocalVariableNodes)
        case 'uncons':
          return [pattern.value.uncons.left, pattern.value.uncons.right].flatMap(fromPatternToLocalVariableNodes)
        case 'var':
          return [{
            range: pattern.range,
            value: pattern.value.var.value
          }]
        case 'named':
          return pattern.value.named.patterns.flatMap(fromPatternToLocalVariableNodes)
        case 'as':
          return [pattern.value.as.name, ...fromPatternToLocalVariableNodes(pattern.value.as.pattern)]
        case 'parentisized':
          return fromPatternToLocalVariableNodes(pattern.value.parentisized.value)
      }
    }

    const findLocationOfItemsForExpression = async (
      expression: ElmSyntax.Node<ElmSyntax.Expression>,
      args: ElmSyntax.Node<ElmSyntax.Pattern>[],
      localDeclarations: ElmSyntax.Node<ElmSyntax.Declaration>[],
      localPatterns: ElmSyntax.Node<ElmSyntax.Pattern>[]
    ): Promise<vscode.Location | null> => {
      switch (expression.value.type) {
        case 'application':
          for (let item of expression.value.application) {
            let range = sharedLogic.fromElmRange(item.range)
            if (range.contains(position)) {
              return findLocationOfItemsForExpression(item, args, localDeclarations, localPatterns)
            }
          }
          return null
        case 'case':
          // Handle the expression between the "case" and "of"
          let caseOfRange = sharedLogic.fromElmRange(expression.value.case.expression.range)
          if (caseOfRange.contains(position)) {
            return findLocationOfItemsForExpression(expression.value.case.expression, args, localDeclarations, localPatterns)
          }

          // Handle each branch of the case expression
          let cases = expression.value.case.cases

          for (let item of cases) {
            // The part before the "->"
            let patternRange = sharedLogic.fromElmRange(item.pattern.range)
            if (patternRange.contains(position)) {
              return findLocationOfCustomTypeForPattern(item.pattern.value, patternRange)
            }

            // The expression after the "->"
            let expressionRange = sharedLogic.fromElmRange(item.expression.range)
            if (expressionRange.contains(position)) {
              return findLocationOfItemsForExpression(item.expression, args, localDeclarations, localPatterns.concat([item.pattern]))
            }
          }
          return null
        case 'charLiteral':
          return null
        case 'float':
          return null
        case 'functionOrValue':
          let name = [...expression.value.functionOrValue.moduleName, expression.value.functionOrValue.name].join('.')
          return findLocationForExpressionWithName({ name, args, localDeclarations, localPatterns })
        case 'glsl':
          return null
        case 'hex':
          return null
        case 'ifBlock':
          let expressions = [
            expression.value.ifBlock.clause,
            expression.value.ifBlock.then,
            expression.value.ifBlock.else
          ]

          for (let item of expressions) {
            let range = sharedLogic.fromElmRange(item.range)
            if (range.contains(position)) {
              return findLocationOfItemsForExpression(item, args, localDeclarations, localPatterns)
            }
          }
          return null
        case 'integer':
          return null
        case 'lambda':
          let patterns = expression.value.lambda.patterns

          for (let pattern of patterns) {
            let range = sharedLogic.fromElmRange(pattern.range)
            if (range.contains(position)) {
              return findLocationOfCustomTypeForPattern(pattern.value, range)
            }
          }

          let item = expression.value.lambda.expression
          let range = sharedLogic.fromElmRange(item.range)
          if (range.contains(position)) {
            return findLocationOfItemsForExpression(item, args, localDeclarations, localPatterns.concat(patterns))
          }
          return null
        case 'let':
          let letDeclarations = expression.value.let.declarations
          let newLocalDeclarations = localDeclarations.concat(letDeclarations)

          // Handle declarations between "let" and "in" keywords
          for (let declaration of letDeclarations) {
            let range = sharedLogic.fromElmRange(declaration.range)
            if (range.contains(position) && ElmSyntax.isFunctionDeclaration(declaration)) {
              return findLocationForFunctionDeclaration(
                declaration.value.function,
                args,
                newLocalDeclarations,
                localPatterns
              )
            }
          }

          // Handle expression after the "in" keyword
          let range2 = sharedLogic.fromElmRange(expression.value.let.expression.range)
          if (range2.contains(position)) {
            return findLocationOfItemsForExpression(expression.value.let.expression, args, newLocalDeclarations, localPatterns)
          }
          return null
        case 'list':
          let listExpressions = expression.value.list
          for (let item of listExpressions) {
            let range = sharedLogic.fromElmRange(item.range)
            if (range.contains(position)) {
              return findLocationOfItemsForExpression(item, args, localDeclarations, localPatterns)
            }
          }
          return null
        case 'literal':
          return null
        case 'negation':
          return findLocationOfItemsForExpression(expression.value.negation, args, localDeclarations, localPatterns)
        case 'operator':
          return null
        case 'operatorapplication':
          let operatorExpressions = [
            expression.value.operatorapplication.left,
            expression.value.operatorapplication.right
          ]
          for (let item of operatorExpressions) {
            let range = sharedLogic.fromElmRange(item.range)
            if (range.contains(position)) {
              return findLocationOfItemsForExpression(item, args, localDeclarations, localPatterns)
            }
          }
          return null
        case 'parenthesized':
          return findLocationOfItemsForExpression(expression.value.parenthesized, args, localDeclarations, localPatterns)
        case 'prefixoperator':
          return null
        case 'record':
          let recordExpressions = expression.value.record.map(field => field.value.expression)

          for (let item of recordExpressions) {
            let range = sharedLogic.fromElmRange(item.range)
            if (range.contains(position)) {
              return findLocationOfItemsForExpression(item, args, localDeclarations, localPatterns)
            }
          }
          return null
        case 'recordAccess':
          let range3 = sharedLogic.fromElmRange(expression.value.recordAccess.expression.range)
          if (range3.contains(position)) {
            return findLocationOfItemsForExpression(expression.value.recordAccess.expression, args, localDeclarations, localPatterns)
          }
          return null
        case 'recordAccessFunction':
          return null
        case 'recordUpdate':
          // Try to link the the part before the "|"
          let range4 = sharedLogic.fromElmRange(expression.value.recordUpdate.name.range)
          if (range4.contains(position)) {
            return findLocationForExpressionWithName({
              name: expression.value.recordUpdate.name.value,
              args,
              localDeclarations,
              localPatterns
            })
          }

          // Try to link to items within expression
          let items: ElmSyntax.Node<ElmSyntax.Expression>[] =
            expression.value.recordUpdate.updates
              .map(update => update.value.expression)

          for (let item of items) {
            let range = sharedLogic.fromElmRange(item.range)
            if (range.contains(position)) {
              return findLocationOfItemsForExpression(item, args, localDeclarations, localPatterns)
            }
          }
          return null
        case 'tupled':
          let tupledItems = expression.value.tupled
          for (let item of tupledItems) {
            let range = sharedLogic.fromElmRange(item.range)
            if (range.contains(position)) {
              return findLocationOfItemsForExpression(item, args, localDeclarations, localPatterns)
            }
          }
          return null
        case 'unit':
          return null
      }
    }

    const findArgumentWithMatchingName = ({ argument, name }: { argument: ElmSyntax.Node<ElmSyntax.Pattern>, name: string }): ElmSyntax.Range | null => {
      let match: ElmSyntax.Node<ElmSyntax.Pattern> | undefined
      switch (argument.value.type) {
        case 'all':
          return null
        case 'as':
          return null
        case 'char':
          return null
        case 'float':
          return null
        case 'hex':
          return null
        case 'int':
          return null
        case 'list':
          match = argument.value.list.value.find(arg => findArgumentWithMatchingName({ argument: arg, name }))
          if (match) {
            return match.range
          } else {
            return null
          }
        case 'named':
          match = argument.value.named.patterns.find(arg => findArgumentWithMatchingName({ argument: arg, name }))
          if (match) {
            return match.range
          } else {
            return null
          }
        case 'parentisized':
          return findArgumentWithMatchingName({
            argument: argument.value.parentisized.value,
            name
          })
        case 'record':
          let matchingNode = argument.value.record.value.find(x => x.value === name)
          if (matchingNode) {
            matchingNode.range
          }
        case 'string':
          return null
        case 'tuple':
          match = argument.value.tuple.value.find(arg => findArgumentWithMatchingName({ argument: arg, name }))
          if (match) {
            return match.range
          } else {
            return null
          }
        case 'var':
          if (argument.value.var.value === name) {
            return argument.range
          } else {
            return null
          }
        case 'uncons':
          return null
        case 'unit':
          return null
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
      }
    }

    const findLocationForFunctionDeclaration = async (
      func: ElmSyntax.Function_,
      existingArgs: ElmSyntax.Node<ElmSyntax.Pattern>[],
      localDeclarations: ElmSyntax.Node<ElmSyntax.Declaration>[],
      localPatterns: ElmSyntax.Node<ElmSyntax.Pattern>[]
    ): Promise<vscode.Location | null> => {
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
          func.declaration.value.expression,
          existingArgs.concat(args),
          localDeclarations,
          localPatterns
        )
        if (matchingLocation) return matchingLocation
      }

      return null
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
        } else if (import_.value.exposingList.value.type === 'all') {
          hasUnknownImportsFromExposingAll.push(moduleName)
        }
      }
    }

    for (let declaration of ast.declarations) {
      let range = sharedLogic.fromElmRange(declaration.range)
      if (range.contains(position)) {
        if (declaration.value.type === 'function') {
          return findLocationForFunctionDeclaration(declaration.value.function, [], [], [])
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
        } else if (declaration.value.type === 'port') {
          let typeAnnotation = declaration.value.port.typeAnnotation.value

          let matchingLocation = await findLocationForTypeAnnotation(typeAnnotation)
          if (matchingLocation) return matchingLocation
        } else if (declaration.value.type === 'destructuring') {
          let func: ElmSyntax.Function_ = {
            documentation: null,
            signature: null,
            declaration: {
              value: {
                name: { value: '???', range: declaration.range },
                arguments: [],
                expression: declaration.value.destructuring.expression
              },
              range: declaration.range
            }
          }
          return findLocationForFunctionDeclaration(func, [], [], [])
        } else if (declaration.value.type === 'infix') {
          return null
        }
      }
    }

    return null
  }


  // UTILITIES

  const findLocalProjectFileUri = async (elmJsonFile: ElmJsonFile, moduleName: string): Promise<vscode.Uri | undefined> => {
    // Search for a local file matching the module name
    let localFileUri: vscode.Uri | undefined =
      await Promise.all(
        elmJsonFile.sourceDirectories
          .map(folder => vscode.Uri.file(folder + '/' + moduleName.split('.').join('/') + '.elm'))
          .map(fileUri => {
            return (vscode.workspace.fs.stat(fileUri)
              .then(stat => stat ? fileUri : undefined) as Promise<vscode.Uri | undefined>)
              .catch((reason: unknown) => undefined)
          })
      )
        .then(files => files.filter(a => a)[0])
        .catch(_ => undefined)

    // Return the file URI
    return localFileUri
  }
  return {
    async provideDefinition(doc: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken) {
      // Allow user to disable this feature
      const isEnabled: boolean = vscode.workspace.getConfiguration('elmLand').feature.jumpToDefinition
      if (!isEnabled) return

      const start = Date.now()
      const text = doc.getText()
      const ast = await ElmToAst.run(text)


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
          let packages = await sharedLogic.getMappingOfModuleNameToDocJsonFilepath(globalState, elmJsonFile)
          matchingLocation = await handleJumpToLinksForImports({ document: doc, position, ast, elmJsonFile, packages })
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
