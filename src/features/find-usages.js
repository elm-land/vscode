// @ts-check

const vscode = require('vscode')
const ElmSyntax = require('./elm-to-ast/index.js')
const Grep = require('./find-usages/grep.js')
const sharedLogic = require('./_shared-logic')


// VS code has zero-based ranges and positions, so we need to decrement all values
// returned from ElmSyntax so they work with the code editor
/** @type {(array: ElmSyntax.Range) => vscode.Range} */
const fromElmRange = (elmRange) => new vscode.Range(
  elmRange[0] - 1,
  elmRange[1] - 1,
  elmRange[2] - 1,
  elmRange[3] - 1
)

module.exports = (globalState) => {
  return {
    provideReferences: async (document, position, context, token) => {
      const start = Date.now()
      let locations = []
      const elmJson = sharedLogic.findElmJsonFor(globalState, document.uri)

      if (elmJson) {
        const text = document.getText()
        const ast = await ElmSyntax.run(text)

        const moduleName = getModuleNameFromAst(ast)
        const declarationName = getDeclarationName(ast, position)

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

          let usageLocationsInOtherModules = (await Promise.all(filepathsImportingModule.map(scanForUsagesOf({ moduleName, declarationName })))).flatMap(a => a)

          locations = usageLocationsFromCurrentModule.concat(usageLocationsInOtherModules)
        }


      }

      console.info(`findUsages`, `${Date.now() - start}ms`)
      return locations
    }
  }
}

// Returns something like "Html.Attributes"
const getModuleNameFromAst = (ast) => {
  const moduleType = ast.moduleDefinition.value.type

  return ast.moduleDefinition.value[moduleType].moduleName.value.join('.')
}

const getDeclarationName = (ast, position) => {
  for (let declaration of ast.declarations) {
    if (declaration.value.type === 'function') {
      let signatureNameValue = declaration.value.function.signature.value.name
      let declarationNameValue = declaration.value.function.declaration.value.name
      let declarationNameRange = fromElmRange(declarationNameValue.range)
      let signatureNameRange = fromElmRange(signatureNameValue.range)
      let name = declarationNameValue.value
      if (declarationNameRange.contains(position) || signatureNameRange.contains(position)) {
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

const scanForUsagesOf = ({ moduleName, declarationName }) => async (fsPath) => {
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