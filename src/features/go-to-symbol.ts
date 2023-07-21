import * as vscode from 'vscode'
import sharedLogic, { Feature } from './shared/logic'
import * as ElmToAst from './shared/elm-to-ast'
import * as ElmSyntax from './shared/elm-to-ast/elm-syntax'
import { GlobalState } from './shared/autodetect-elm-json'
import { ElmJsonFile } from './shared/elm-json-file'

export const feature: Feature = ({ globalState, context }) => {
  context.subscriptions.push(
    vscode.languages.registerDocumentSymbolProvider('elm', provider(globalState))
  )
}

// TODO: Inline and remove globalState?
const provider = (globalState: GlobalState) => {
  return {
    // TODO: vscode.ProviderResult<vscode.DocumentSymbol[] | vscode.SymbolInformation[]>
    async provideDocumentSymbols(doc: vscode.TextDocument, token: vscode.CancellationToken) {
      // Allow user to disable this feature
      const isEnabled: boolean = vscode.workspace.getConfiguration('elmLand').feature.goToSymbol
      if (!isEnabled) return

      const start = Date.now()
      const text = doc.getText()
      const ast = await ElmToAst.run(text)

      if (ast) {
        const symbols = ast.declarations.map(declaration => {
          const a = new vscode.DocumentSymbol(
            /**
             * The name of this symbol.
             */
            "Namn",

            /**
             * More detail for this symbol, e.g. the signature of a function.
             */
            // TODO: Provide the signature?
            "(detail)",

            /**
             * The kind of this symbol.
             */
            // TODO: Depends on what kind of declaration.
            vscode.SymbolKind.Function,

            /**
             * Tags for this symbol.
             */
            // TODO: Can look for @deprecated and mark as deprecated?
            // tags?: readonly SymbolTag[],

            /**
             * The range enclosing this symbol not including leading/trailing whitespace but everything else, e.g. comments and code.
             */
            sharedLogic.fromElmRange(declaration.range),

            /**
             * The range that should be selected and reveal when this symbol is being picked, e.g. the name of a function.
             * Must be contained by the {@linkcode DocumentSymbol.range range}.
             */
            // TODO: Closer range
            sharedLogic.fromElmRange(declaration.range),

            /**
             * Children of this symbol, e.g. properties of a class.
             */
            // TODO: let bindings?
            // and how to add them? mutate it afterwards?
            // yep
            // [],

          )
          a.children = [
            new vscode.DocumentSymbol("child", "", vscode.SymbolKind.Constant, sharedLogic.fromElmRange(declaration.range), sharedLogic.fromElmRange(declaration.range))
          ]
          // Seems to just be a less advanced variant?
          // const b: vscode.SymbolInformation = x
          return a
        })

        console.info('provideDocumentSymbol', `${Date.now() - start}ms`)
        return symbols
      }
    }
  }
}
