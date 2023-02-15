import * as vscode from 'vscode'
import { GlobalState } from './shared/autodetect-elm-json'
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
          const moduleName = ElmSyntax.toModuleName(ast)
          const result = getDeclarationNameAndKindAtPosition(ast, position)

          if (result) {
            const referencesInFile = findLocalInstancesOf(ast, result.declarationName, result.kind)

            let usageLocationsFromCurrentModule = referencesInFile.map(range =>
              new vscode.Location(
                document.uri,
                range
              )
            )

            if (ElmSyntax.isExposedFromThisModule(ast, result.declarationName)) {
              let grepStart = Date.now()
              const filepathsImportingModule = await Grep.findElmFilesImportingModuleWithValueName({
                moduleName,
                typeOrValueName: result.declarationName,
                folders: elmJson.sourceDirectories
              })
              console.info(`grep duration`, `${Date.now() - grepStart}ms`)

              let openiningFilesStart = Date.now()
              let fullyQualifiedName = [moduleName, result.declarationName].join('.')
              let astsForOtherFilepaths = await Promise.all(filepathsImportingModule.map(fromFilepathToAst))
              console.info(`parsingFiles duration`, `${Date.now() - openiningFilesStart}ms`)


              let scanningAstsStart = Date.now()
              let usageLocationsInOtherModules = astsForOtherFilepaths.flatMap((item) => {
                if (item) {
                  let { uri, ast } = item
                  let importDetails = findImportDetailsFor({ moduleName, ast, typeOrValueName: result.declarationName })
                  if (importDetails) {
                    let { isExposed, alias } = importDetails
                    let ranges: vscode.Range[] = []

                    if (isExposed) {
                      ranges = ranges.concat(findRemoteInstancesOf(ast, result.declarationName, result.kind))
                    }

                    if (alias) {
                      ranges = ranges.concat(findRemoteInstancesOf(ast, [alias, result.declarationName].join('.'), result.kind))
                    } else {
                      ranges = ranges.concat(findRemoteInstancesOf(ast, fullyQualifiedName, result.kind))
                    }
                    return ranges.map(range => new vscode.Location(uri, range))
                  }
                }
                
                return []
              })
              console.info(`scanningAsts duration`, `${Date.now() - scanningAstsStart}ms`)
              locations = usageLocationsFromCurrentModule.concat(usageLocationsInOtherModules)
            } else {
              locations = usageLocationsFromCurrentModule
            }


          }
        }
      }

      console.info(`findUsages`, `${Date.now() - start}ms`)
      return locations
    }
  }
}

// 
// Determine if an import is using any aliases or may be exposing a specific value from another module
// 
const findImportDetailsFor = ({ moduleName, ast, typeOrValueName }: { moduleName: string, typeOrValueName: string, ast: ElmSyntax.Ast }): { isExposed: boolean, alias: string | undefined } | null => {
  for (let import_ of ast.imports) {
    if (import_.value.moduleName.value.join('.') === moduleName) {
      let isExposed =
        (import_.value.exposingList === null)
          ? false
          : ElmSyntax.isPotentiallyExposed(import_.value.exposingList, typeOrValueName)

      return {
        isExposed,
        alias: import_.value.moduleAlias?.value.join('.')
      }
    }
  }
  return null
}

const fromFilepathToAst = async (fsPath: string): Promise<{ uri: vscode.Uri, ast: ElmSyntax.Ast } | null> => {
  let uri = vscode.Uri.file(fsPath)
  let document = await vscode.workspace.openTextDocument(uri)
  if (document) {
    let ast = await ElmToAst.run(document.getText())
    if (ast) {
      return { uri, ast }
    }
  }
  return null
}

const getDeclarationNameAndKindAtPosition = (ast: ElmSyntax.Ast, position: vscode.Position): { declarationName: string, kind: 'value' | 'type' } | null => {
  let getDeclarationNameAndKind = (declaration: ElmSyntax.Node<ElmSyntax.Declaration>): { declarationName: string, kind: 'value' | 'type' } | null => {
    switch (declaration.value.type) {
      case 'destructuring':
        return null
      case 'function':
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
        return null
      case 'infix':
        return null
      case 'port':
        let range = sharedLogic.fromElmRange(declaration.value.port.name.range)
        if (range.contains(position)) {
          return {
            declarationName: declaration.value.port.name.value,
            kind: 'value'
          }
        }
        return null
      case 'typeAlias':
        let range2 = sharedLogic.fromElmRange(declaration.value.typeAlias.name.range)
        if (range2.contains(position)) {
          return {
            declarationName: declaration.value.typeAlias.name.value,
            kind: 'type'
          }
        }
        return null
      case 'typedecl':
        let range3 = sharedLogic.fromElmRange(declaration.value.typedecl.name.range)
        if (range3.contains(position)) {
          return {
            declarationName: declaration.value.typedecl.name.value,
            kind: 'type'
          }
        }
        return null
    }
  }

  for (let declaration of ast.declarations) {
    let returnValue = getDeclarationNameAndKind(declaration)
    if (returnValue) {
      return returnValue
    }
  }

  return null
}

const findRemoteInstancesOf = (ast: ElmSyntax.Ast, valueName: string, kind: 'type' | 'value'): vscode.Range[] => { 
  // Check if this declaration is already redefined 
  // 
  // This prevents us from confusing usage of a local `text` function
  // with one that might be from `import Html exposing (..)`
  let isLocallyDefined = ast.declarations.some(ElmSyntax.isDefinedAgainByDeclaration(valueName))
  if (isLocallyDefined) {
    return []
  }

  return findLocalInstancesOf(ast, valueName, kind)
}

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
      let hasLocallyScopedVersion = node.value.function.declaration.value.arguments.some(ElmSyntax.isDefinedAgainByPattern(valueName))
      let matchesFromExpression: vscode.Range[] = []
      if (!hasLocallyScopedVersion) {
        matchesFromExpression = findRangesOfNamedValueInExpression(valueName)(node.value.function.declaration.value.expression)
      }
      return [
        ...node.value.function.declaration.value.arguments.flatMap(findRangesOfNamedValueInPattern(valueName)),
        ...matchesFromExpression
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
        ...node.value.case.cases.flatMap(case_ =>
          (ElmSyntax.isDefinedAgainByPattern(valueName)(case_.pattern))
            ? []
            : [case_.expression]
        )
      ].flatMap(findRangesOfNamedValueInExpression(valueName))
      return fromExpressions.concat(fromPatterns)
    case 'charLiteral':
      return []
    case 'float':
      return []
    case 'functionOrValue':
      let fullName = [...node.value.functionOrValue.moduleName, node.value.functionOrValue.name].join('.')
      if (valueName === fullName) {
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
      let isLocallyDefined = node.value.lambda.patterns.some(ElmSyntax.isDefinedAgainByPattern(valueName))
      let rangesFromExpressions =
        isLocallyDefined
          ? []
          : findRangesOfNamedValueInExpression(valueName)(node.value.lambda.expression)
      return [
        ...node.value.lambda.patterns.flatMap(findRangesOfNamedValueInPattern(valueName)),
        ...rangesFromExpressions,
      ]
    case 'let':
      let isLocallyDefined2 = node.value.let.declarations.some(ElmSyntax.isDefinedAgainByDeclaration(valueName))
      let rangesFromExpressions2 =
        isLocallyDefined2
          ? []
          : findRangesOfNamedValueInExpression(valueName)(node.value.let.expression)
      return [
        ...node.value.let.declarations.flatMap(findRangesOfNamedValueInDeclaration(valueName)),
        ...rangesFromExpressions2
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
      if (typeName.includes(name)) {
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
      if (valueName === fullName) {
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