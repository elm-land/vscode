import * as vscode from 'vscode'
import { GlobalState } from './autodetect-elm-json'
import * as ElmToAst from './shared/elm-to-ast'
import * as ElmSyntax from './shared/elm-to-ast/elm-syntax'
import Grep from './find-usages/elm-grep'
import sharedLogic, { Feature } from './shared/logic'

export const feature: Feature = ({ globalState, context }) => {
  context.subscriptions.push(
    vscode.languages.registerReferenceProvider('elm', provider(globalState))
  )
}

const provider = (globalState: GlobalState) => {
  return {
    provideReferences: async (
      document: vscode.TextDocument,
      position: vscode.Position,
      context: vscode.ReferenceContext,
      token: vscode.CancellationToken
    ) => {
      // Allow user to disable this feature
      const isEnabled: boolean = vscode.workspace.getConfiguration('elmLand').feature.findUsages
      if (!isEnabled) return

      const start = Date.now()
      let locations: vscode.Location[] = []
      const elmJson = sharedLogic.findElmJsonFor(globalState, document.uri)

      if (elmJson) {
        const text = document.getText()
        const ast = await ElmToAst.run(text)

        if (ast) {
          // const moduleName = ElmSyntax.toModuleName(ast)
          const result = getDeclarationNameAndKindAtPosition(ast, position)

          if (result) {
            // TODO: Check current file for local references
            const referencesInFile = findLocalInstancesOf(ast, result.declarationName, result.kind)

            // const filepathsImportingModule = await Grep.findElmFilesImportingModule({
            //   moduleName,
            //   folders: elmJson.sourceDirectories
            // })
            let usageLocationsFromCurrentModule = referencesInFile.map(range =>
              new vscode.Location(
                document.uri,
                range
              )
            )

            // let nestedLists: vscode.Location[][] = await Promise.all(filepathsImportingModule.map(scanForUsagesOf({ moduleName, declarationName: result.declarationName })))
            // let usageLocationsInOtherModules = nestedLists.flatMap(locations => locations)

            locations = usageLocationsFromCurrentModule //.concat(usageLocationsInOtherModules)
          }
        }
      }

      console.info(`findUsages`, `${Date.now() - start}ms`)
      return locations
    }
  }
}

const getDeclarationNameAndKindAtPosition = (ast: ElmSyntax.Ast, position: vscode.Position): { declarationName: string, kind: 'value' | 'type' } | undefined => {
  for (let declaration of ast.declarations) {
    if (declaration.value.type === 'function') {
      let signatureNameValue = declaration.value.function.signature?.value.name
      let signatureNameRange =
        signatureNameValue
          ? sharedLogic.fromElmRange(signatureNameValue.range)
          : undefined

      let declarationNameValue = declaration.value.function.declaration.value.name
      let declarationNameRange = sharedLogic.fromElmRange(declarationNameValue.range)

      let cursorInSignatureName = signatureNameRange && signatureNameRange.contains(position)
      if (declarationNameRange.contains(position) || cursorInSignatureName) {
        return {
          declarationName: declarationNameValue.value,
          kind: 'value'
        }
      }
    } else if (declaration.value.type === 'typeAlias') {
      let range = sharedLogic.fromElmRange(declaration.value.typeAlias.name.range)
      if (range.contains(position)) {
        return {
          declarationName: declaration.value.typeAlias.name.value,
          kind: 'type'
        }
      }
    } else if (declaration.value.type === 'typedecl') {
      let range = sharedLogic.fromElmRange(declaration.value.typedecl.name.range)
      if (range.contains(position)) {
        return {
          declarationName: declaration.value.typedecl.name.value,
          kind: 'type'
        }
      }
    } else if (declaration.value.type === 'port') {
      let range = sharedLogic.fromElmRange(declaration.value.port.name.range)
      if (range.contains(position)) {
        return {
          declarationName: declaration.value.port.name.value,
          kind: 'value'
        }
      }
    } else {
      console.error(`findUsages:unhandledDeclarationType`, declaration.value)
    }
  }
}

type ScanForUsagesInput = {
  moduleName: string
  declarationName: string
}

const scanForUsagesOf = ({ moduleName, declarationName }: ScanForUsagesInput) => async (fsPath: string) => {
  const uri = vscode.Uri.file(fsPath)
  const document = await vscode.workspace.openTextDocument(uri)
  const text = document.getText()
  const ast = await ElmToAst.run(text)

  if (ast) {
    const otherModuleName = ElmSyntax.toModuleName(ast)
    console.log({ otherModuleName })
  }

  return [
    new vscode.Location(
      uri,
      sharedLogic.fromElmRange([1, 1, 1, 1])
    )
  ]
}

// TODO: Make sure to handle edge cases for local types and values when using the `exposing` keyword.
// 
// For example, if a user is looking for all definitions of `Math.add`, and another module
// imports `Math` like this:
// 
//     1|  import Math exposing (..)
//     2| 
//     3|  add : Int -> Int -> Int
//     4|  add a b =
//     5|     Math.add a b
//     6|  
//     7|  double : Int -> Int
//     8|  double num =
//     9|     add num num
// 
// We want to make sure __only line 5 gets a match__, even though all members of `Math`
// are exposed and we found an "add" on line 9.
// 
const findLocalInstancesOf = (ast: ElmSyntax.Ast, valueName: string, kind: 'type' | 'value'): vscode.Range[] => {
  switch (kind) {
    case 'value':
      return ast.declarations.flatMap(findRangesOfNamedValueInDeclaration(valueName))
    case 'type':
      return ast.declarations.flatMap(findRangesOfNamedTypeInDeclaration(valueName))
  }
}

const findRangesOfNamedValueInDeclaration = (valueName: string) => (node: ElmSyntax.Node<ElmSyntax.Declaration>): vscode.Range[] => {
  switch (node.value.type) {
    case 'destructuring':
      return [
        ...findRangesOfNamedValueInExpression(valueName)(node.value.destructuring.expression)
      ]
    case 'function':
      return [
        ...node.value.function.declaration.value.arguments.flatMap(findRangesOfNamedValueInPattern(valueName)),
        ...findRangesOfNamedValueInExpression(valueName)(node.value.function.declaration.value.expression)
      ]
    case 'infix':
      return []
    case 'port':
      return []
    case 'typeAlias':
      return []
    case 'typedecl':
      return []
  }
}

const findRangesOfNamedTypeInDeclaration = (typeName: string) => (node: ElmSyntax.Node<ElmSyntax.Declaration>): vscode.Range[] => {
  switch (node.value.type) {
    case 'destructuring':
      return findRangesOfNamedTypeInExpression(typeName)(node.value.destructuring.expression)
    case 'function':
      return [
        ...(
          node.value.function.signature
            ? findRangesOfNamedTypeInAnnotation(typeName)(node.value.function.signature.value.typeAnnotation)
            : []
        ),
        ...findRangesOfNamedTypeInExpression(typeName)(node.value.function.declaration.value.expression)
      ]
    case 'infix':
      return []
    case 'port':
      return findRangesOfNamedTypeInAnnotation(typeName)(node.value.port.typeAnnotation)
    case 'typeAlias':
      return findRangesOfNamedTypeInAnnotation(typeName)(node.value.typeAlias.typeAnnotation)
    case 'typedecl':
      return node.value.typedecl.constructors
        .flatMap(x => x.value.arguments)
        .flatMap(findRangesOfNamedTypeInAnnotation(typeName))
  }
}

const findRangesOfNamedValueInExpression = (valueName: string) => (node: ElmSyntax.Node<ElmSyntax.Expression>): vscode.Range[] => {
  switch (node.value.type) {
    case 'application':
      return node.value.application.flatMap(findRangesOfNamedValueInExpression(valueName))
    case 'case':
      let fromPatterns = node.value.case.cases.map(case_ => case_.pattern).flatMap(findRangesOfNamedValueInPattern(valueName))
      let fromExpressions = [
        node.value.case.expression,
        ...node.value.case.cases.map(case_ => case_.expression)
      ].flatMap(findRangesOfNamedValueInExpression(valueName))
      return fromExpressions.concat(fromPatterns)
    case 'charLiteral':
      return []
    case 'float':
      return []
    case 'functionOrValue':
      let fullName = [...node.value.functionOrValue.moduleName, node.value.functionOrValue.name].join('.')
      if (fullName === valueName) {
        return [sharedLogic.fromElmRange(node.range)]
      } else {
        return []
      }
    case 'glsl':
      return []
    case 'hex':
      return []
    case 'ifBlock':
      return [
        node.value.ifBlock.clause,
        node.value.ifBlock.then,
        node.value.ifBlock.else,
      ].flatMap(findRangesOfNamedValueInExpression(valueName))
    case 'integer':
      return []
    case 'lambda':
      return [
        ...node.value.lambda.patterns.flatMap(findRangesOfNamedValueInPattern(valueName)),
        ...findRangesOfNamedValueInExpression(valueName)(node.value.lambda.expression),
      ]
    case 'let':
      return [
        ...node.value.let.declarations.flatMap(findRangesOfNamedValueInDeclaration(valueName)),
        ...findRangesOfNamedValueInExpression(valueName)(node.value.let.expression)
      ]
    case 'list':
      return node.value.list.flatMap(findRangesOfNamedValueInExpression(valueName))
    case 'literal':
      return []
    case 'negation':
      return findRangesOfNamedValueInExpression(valueName)(node.value.negation)
    case 'operator':
      return []
    case 'operatorapplication':
      return [
        node.value.operatorapplication.left,
        node.value.operatorapplication.right,
      ].flatMap(findRangesOfNamedValueInExpression(valueName))
    case 'parenthesized':
      return findRangesOfNamedValueInExpression(valueName)(node.value.parenthesized)
    case 'prefixoperator':
      return []
    case 'record':
      return node.value.record.map(field => field.value.expression).flatMap(findRangesOfNamedValueInExpression(valueName))
    case 'recordAccess':
      return findRangesOfNamedValueInExpression(valueName)(node.value.recordAccess.expression)
    case 'recordAccessFunction':
      return []
    case 'recordUpdate':
      return node.value.recordUpdate.updates.map(x => x.value.expression).flatMap(findRangesOfNamedValueInExpression(valueName))
    case 'tupled':
      return node.value.tupled.flatMap(findRangesOfNamedValueInExpression(valueName))
    case 'unit':
      return []
  }
}


const findRangesOfNamedTypeInExpression = (typeName: string) => (node: ElmSyntax.Node<ElmSyntax.Expression>): vscode.Range[] => {
  switch (node.value.type) {
    case 'application':
      return node.value.application.flatMap(findRangesOfNamedTypeInExpression(typeName))
    case 'case':
      return [
        node.value.case.expression,
        ...node.value.case.cases.map(case_ => case_.expression)
      ].flatMap(findRangesOfNamedTypeInExpression(typeName))
    case 'charLiteral':
      return []
    case 'float':
      return []
    case 'functionOrValue':
      return []
    case 'glsl':
      return []
    case 'hex':
      return []
    case 'ifBlock':
      return [
        node.value.ifBlock.clause,
        node.value.ifBlock.then,
        node.value.ifBlock.else,
      ].flatMap(findRangesOfNamedTypeInExpression(typeName))
    case 'integer':
      return []
    case 'lambda':
      return findRangesOfNamedTypeInExpression(typeName)(node.value.lambda.expression)
    case 'let':
      return [
        ...node.value.let.declarations.flatMap(findRangesOfNamedValueInDeclaration(typeName)),
        ...findRangesOfNamedTypeInExpression(typeName)(node.value.let.expression)
      ]
    case 'list':
      return node.value.list.flatMap(findRangesOfNamedTypeInExpression(typeName))
    case 'literal':
      return []
    case 'negation':
      return findRangesOfNamedTypeInExpression(typeName)(node.value.negation)
    case 'operator':
      return []
    case 'operatorapplication':
      return [
        node.value.operatorapplication.left,
        node.value.operatorapplication.right,
      ].flatMap(findRangesOfNamedTypeInExpression(typeName))
    case 'parenthesized':
      return findRangesOfNamedTypeInExpression(typeName)(node.value.parenthesized)
    case 'prefixoperator':
      return []
    case 'record':
      return node.value.record.map(field => field.value.expression).flatMap(findRangesOfNamedTypeInExpression(typeName))
    case 'recordAccess':
      return findRangesOfNamedTypeInExpression(typeName)(node.value.recordAccess.expression)
    case 'recordAccessFunction':
      return []
    case 'recordUpdate':
      return node.value.recordUpdate.updates.map(x => x.value.expression).flatMap(findRangesOfNamedTypeInExpression(typeName))
    case 'tupled':
      return node.value.tupled.flatMap(findRangesOfNamedTypeInExpression(typeName))
    case 'unit':
      return []
  }
}

const findRangesOfNamedTypeInAnnotation = (typeName: string) => (node: ElmSyntax.Node<ElmSyntax.TypeAnnotation>): vscode.Range[] => {
  switch (node.value.type) {
    case 'function':
      return [
        node.value.function.left,
        node.value.function.right,
      ].flatMap(findRangesOfNamedTypeInAnnotation(typeName))
    case 'generic':
      return []
    case 'genericRecord':
      return node.value.genericRecord.values.value
        .map(node => node.value.typeAnnotation)
        .flatMap(findRangesOfNamedTypeInAnnotation(typeName))
    case 'record':
      return node.value.record.value
        .map(node => node.value.typeAnnotation)
        .flatMap(findRangesOfNamedTypeInAnnotation(typeName))
    case 'tupled':
      return node.value.tupled.values.flatMap(findRangesOfNamedTypeInAnnotation(typeName))
    case 'typed':
      let ranges: vscode.Range[] = node.value.typed.args.flatMap(findRangesOfNamedTypeInAnnotation(typeName))
      let moduleNameAndName = node.value.typed.moduleNameAndName
      let name = ElmSyntax.getNameFromModuleNameAndName(moduleNameAndName)
      if (name === typeName) {
        ranges.push(sharedLogic.fromElmRange(moduleNameAndName.range))
      }
      return ranges
    case 'unit':
      return []
  }
}

const findRangesOfNamedValueInPattern = (valueName: string) => (node: ElmSyntax.Node<ElmSyntax.Pattern>): vscode.Range[] => {
  switch (node.value.type) {
    case 'all':
      return []
    case 'as':
      return findRangesOfNamedValueInPattern(valueName)(node.value.as.pattern)
    case 'char':
      return []
    case 'float':
      return []
    case 'hex':
      return []
    case 'int':
      return []
    case 'list':
      return node.value.list.value.flatMap(findRangesOfNamedValueInPattern(valueName))
    case 'named':
      let ranges: vscode.Range[] = node.value.named.patterns.flatMap(findRangesOfNamedValueInPattern(valueName))
      let fullName = [...node.value.named.qualified.moduleName, node.value.named.qualified.name].join('.')
      if (fullName === valueName) {
        ranges.push(sharedLogic.fromElmRange(node.range))
      }
      return ranges
    case 'parentisized':
      return findRangesOfNamedValueInPattern(valueName)(node.value.parentisized.value)
    case 'record':
      return []
    case 'string':
      return []
    case 'tuple':
      node.value.tuple.value.flatMap(findRangesOfNamedValueInPattern(valueName))
    case 'uncons':
      return []
    case 'unit':
      return []
    case 'var':
      return []
  }
}