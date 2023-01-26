import vscode from 'vscode'
import { GlobalState } from './autodetect-elm-json.js'
import * as  ElmSyntax from './elm-to-ast/index.js'
import Grep from './find-usages/grep.js'
import sharedLogic from './_shared-logic'


// VS code has zero-based ranges and positions, so we need to decrement all values
// returned from ElmSyntax so they work with the code editor
const fromElmRange = (elmRange: ElmSyntax.Range): vscode.Range => new vscode.Range(
  elmRange[0] - 1,
  elmRange[1] - 1,
  elmRange[2] - 1,
  elmRange[3] - 1
)

export default (globalState: GlobalState) => {
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
        const ast = await ElmSyntax.run(text)

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
                fromElmRange([1, 1, 1, 1])
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
          ? fromElmRange(signatureNameValue.range)
          : undefined

      let declarationNameValue = declaration.value.function.declaration.value.name
      let declarationNameRange = fromElmRange(declarationNameValue.range)
      let name = declarationNameValue.value

      let cursorInSignatureName = signatureNameRange && signatureNameRange.contains(position)
      if (declarationNameRange.contains(position) || cursorInSignatureName) {
        return name
      }
    } else if (declaration.value.type === 'typeAlias') {
      let range = fromElmRange(declaration.value.typeAlias.name.range)
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
  const ast = await ElmSyntax.run(text)

  if (ast) {
    const otherModuleName = ElmSyntax.toModuleName(ast)
    console.log({ otherModuleName })
  }

  return [
    new vscode.Location(
      uri,
      fromElmRange([1, 1, 1, 1])
    )
  ]
}