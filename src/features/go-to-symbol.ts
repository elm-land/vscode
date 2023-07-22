import * as vscode from 'vscode'
import sharedLogic, { Feature } from './shared/logic'
import * as ElmToAst from './shared/elm-to-ast'
import * as ElmSyntax from './shared/elm-to-ast/elm-syntax'

type Fallback = {
  fsPath: string
  symbols: vscode.DocumentSymbol[]
}

export const feature: Feature = ({ context }) => {
  let fallback: Fallback | undefined = undefined

  context.subscriptions.push(
    vscode.languages.registerDocumentSymbolProvider('elm', {
      async provideDocumentSymbols(doc: vscode.TextDocument, token: vscode.CancellationToken) {
        // Allow user to disable this feature
        const isEnabled: boolean = vscode.workspace.getConfiguration('elmLand').feature.goToSymbol
        if (!isEnabled) return

        const start = Date.now()
        const text = doc.getText()
        const ast = await ElmToAst.run(text)

        if (ast) {
          const symbols = ast.declarations.map(declarationToDocumentSymbol)
          fallback = {
            fsPath: doc.uri.fsPath,
            symbols,
          }
          console.info('provideDocumentSymbol', `${Date.now() - start}ms`)
          return symbols
        } else if (fallback !== undefined && doc.uri.fsPath === fallback.fsPath) {
          // When you start editing code, it won’t have correct syntax straight away,
          // but VSCode will re-run this. If you have the Outline panel open in the sidebar,
          // it’s quite distracting if we return an empty list here – it will flash
          // between “no symbols” and all the symbols. So returning the symbols from last
          // time we got any improves the UX a little. Note: If you remove all text in the file,
          // the Outline view shows old stuff that isn’t available – until the file becomes
          // syntactically valid again – but I think it’s fine.
          return fallback.symbols
        }
      }
  })
  )
}

const declarationToDocumentSymbol = (declaration: ElmSyntax.Node<ElmSyntax.Declaration>): vscode.DocumentSymbol => {
  const symbol = (
    name: ElmSyntax.Node<string>,
    symbolKind: vscode.SymbolKind,
    fullRange: ElmSyntax.Range = declaration.range
  ) => new vscode.DocumentSymbol(
    name.value,
    '',
    symbolKind,
    sharedLogic.fromElmRange(fullRange),
    sharedLogic.fromElmRange(name.range)
  )

  const symbolWithChildren = (
    name: ElmSyntax.Node<string>,
    symbolKind: vscode.SymbolKind,
    children: vscode.DocumentSymbol[]
  ) => {
    const documentSymbol = symbol(name, symbolKind)
    documentSymbol.children = children
    return documentSymbol
  }

  switch (declaration.value.type) {
    case 'function':
      return symbolWithChildren(
        declaration.value.function.declaration.value.name,
        vscode.SymbolKind.Function,
        expressionToDocumentSymbols(declaration.value.function.declaration.value.expression.value)
      )

    case 'destructuring':
      return symbolWithChildren(
        {
          value: patternToString(declaration.value.destructuring.pattern.value),
          range: declaration.value.destructuring.pattern.range
        },
        vscode.SymbolKind.Function,
        expressionToDocumentSymbols(declaration.value.destructuring.expression.value)
      )

    case 'typeAlias':
      return symbol(
        declaration.value.typeAlias.name,
        typeAliasSymbolKind(declaration.value.typeAlias.typeAnnotation.value)
      )

    case 'typedecl':
      return symbolWithChildren(
        declaration.value.typedecl.name,
        vscode.SymbolKind.Enum,
        declaration.value.typedecl.constructors.map(constructor =>
          symbol(
            constructor.value.name,
            vscode.SymbolKind.EnumMember,
            constructor.range
          )
        )
      )

    case 'port':
      return symbol(
        declaration.value.port.name,
        vscode.SymbolKind.Function
      )

    case 'infix':
      return symbol(
        declaration.value.infix.operator,
        vscode.SymbolKind.Operator
      )
  }
}

const expressionToDocumentSymbols = (expression: ElmSyntax.Expression): vscode.DocumentSymbol[] => {
  switch (expression.type) {
    case 'unit':
      return []

    case 'application':
      return expression.application.flatMap(node => expressionToDocumentSymbols(node.value))

    case 'operatorapplication':
      return [
        ...expressionToDocumentSymbols(expression.operatorapplication.left.value),
        ...expressionToDocumentSymbols(expression.operatorapplication.right.value),
      ]

    case 'functionOrValue':
      return []

    case 'ifBlock':
      return [
        ...expressionToDocumentSymbols(expression.ifBlock.clause.value),
        ...expressionToDocumentSymbols(expression.ifBlock.then.value),
        ...expressionToDocumentSymbols(expression.ifBlock.else.value),
      ]

    case 'prefixoperator':
      return []

    case 'operator':
      return []

    case 'hex':
      return []

    case 'integer':
      return []

    case 'float':
      return []

    case 'negation':
      return expressionToDocumentSymbols(expression.negation.value)

    case 'literal':
      return []

    case 'charLiteral':
      return []

    case 'tupled':
      return expression.tupled.flatMap(node => expressionToDocumentSymbols(node.value))

    case 'list':
      return expression.list.flatMap(node => expressionToDocumentSymbols(node.value))

    case 'parenthesized':
      return expressionToDocumentSymbols(expression.parenthesized.value)

    case 'let':
      return [
        ...expression.let.declarations.map(declarationToDocumentSymbol),
        ...expressionToDocumentSymbols(expression.let.expression.value),
      ]

    case 'case':
      return [
        ...expressionToDocumentSymbols(expression.case.expression.value),
        ...expression.case.cases.flatMap(node => expressionToDocumentSymbols(node.expression.value)),
      ]

    case 'lambda':
      return expressionToDocumentSymbols(expression.lambda.expression.value)

    case 'recordAccess':
      return expressionToDocumentSymbols(expression.recordAccess.expression.value)

    case 'recordAccessFunction':
      return []

    case 'record':
      return expression.record.flatMap(item => expressionToDocumentSymbols(item.value.expression.value))

    case 'recordUpdate':
      return expression.recordUpdate.updates.flatMap(item => expressionToDocumentSymbols(item.value.expression.value))

    case 'glsl':
      return []
  }
}

const patternToString = (pattern: ElmSyntax.Pattern): string => {
  switch (pattern.type) {
    case 'string': return 'STRING' // should not happen
    case 'all': return '_'
    case 'unit': return '()'
    case 'char': return 'CHAR' // should not happen
    case 'hex': return 'HEX' // should not happen
    case 'int': return 'INT' // should not happen
    case 'float': return 'FLOAT' // should not happen
    case 'tuple': return `( ${pattern.tuple.value.map(value => patternToString(value.value)).join(', ')} )`
    case 'record': return `{ ${pattern.record.value.map(node => node.value).join(', ')} }`
    case 'uncons': return 'UNCONS' // should not happen
    case 'list': return 'LIST' // should not happen
    case 'var': return pattern.var.value
    case 'named': return pattern.named.patterns.map(node => patternToString(node.value)).join(' ')
    case 'as': return pattern.as.name.value
    case 'parentisized': return patternToString(pattern.parentisized.value.value)
  }
}

const typeAliasSymbolKind = (typeAnnotation: ElmSyntax.TypeAnnotation): vscode.SymbolKind => {
  switch (typeAnnotation.type) {
    // Note: In VSCode, TypeScript `type Foo =` gets `vscode.SymbolKind.Variable`.
    case 'function': return vscode.SymbolKind.Variable
    case 'generic': return vscode.SymbolKind.Variable
    case 'typed': return vscode.SymbolKind.Variable
    case 'unit': return vscode.SymbolKind.Variable
    case 'tupled': return vscode.SymbolKind.Variable
    // `vscode.SymbolKind.Object` gives a nice icon looking like this: {}
    case 'record': return vscode.SymbolKind.Object
    case 'genericRecord': return vscode.SymbolKind.Object
  }
}