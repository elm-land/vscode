import * as vscode from 'vscode'
import { GlobalState } from './autodetect-elm-json'
import * as ElmToAst from './elm-to-ast'
import * as ElmSyntax from './elm-to-ast/elm-syntax'
import Grep from './elm-grep'
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
      const start = Date.now()
      let locations: vscode.Location[] = []
      const elmJson = sharedLogic.findElmJsonFor(globalState, document.uri)

      if (elmJson) {
        const text = document.getText()
        const ast = await ElmToAst.run(text)

        if (ast) {
          const moduleName = ElmSyntax.toModuleName(ast)
          const declarationName = getDeclarationNameAtPosition(ast, position)

          if (declarationName) {
            const filepathsImportingModule = await Grep.findElmFilesImportingModule({
              moduleName,
              folders: elmJson.sourceDirectories
            })
            // TODO: Check current file for local references
            let usageLocationsFromCurrentModule = [
              new vscode.Location(
                document.uri,
                sharedLogic.fromElmRange([1, 1, 1, 1])
              )
            ]

            let nestedLists: vscode.Location[][] = await Promise.all(filepathsImportingModule.map(scanForUsagesOf({ moduleName, declarationName })))
            let usageLocationsInOtherModules = nestedLists.flatMap(locations => locations)

            locations = usageLocationsFromCurrentModule.concat(usageLocationsInOtherModules)
          }
        }
      }

      console.info(`findUsages`, `${Date.now() - start}ms`)
      return locations
    }
  }
}

const getDeclarationNameAtPosition = (ast: ElmSyntax.Ast, position: vscode.Position): string | undefined => {
  for (let declaration of ast.declarations) {
    if (declaration.value.type === 'function') {
      let signatureNameValue = declaration.value.function.signature?.value.name
      let signatureNameRange =
        signatureNameValue
          ? sharedLogic.fromElmRange(signatureNameValue.range)
          : undefined

      let declarationNameValue = declaration.value.function.declaration.value.name
      let declarationNameRange = sharedLogic.fromElmRange(declarationNameValue.range)
      let name = declarationNameValue.value

      let cursorInSignatureName = signatureNameRange && signatureNameRange.contains(position)
      if (declarationNameRange.contains(position) || cursorInSignatureName) {
        return name
      }
    } else if (declaration.value.type === 'typeAlias') {
      let range = sharedLogic.fromElmRange(declaration.value.typeAlias.name.range)
      let name = declaration.value.typeAlias.name.value
      if (range.contains(position)) {
        return name
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