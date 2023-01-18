const vscode = require('vscode')
const ElmToAst = require('./elm-to-ast/index.js')
const Grep = require('./find-usages/grep.js')
const sharedLogic = require('./_shared-logic')


// VS code has zero-based ranges and positions, so we need to decrement all values
// returned from ElmToAst so they work with the code editor
const fromElmRange = (array) => new vscode.Range(...array.map(x => x - 1))

module.exports = (globalState) => {
  return {
    provideReferences: async (document, position, context, token) => {
      const start = Date.now()
      let locations = []
      const elmJson = sharedLogic.findElmJsonFor(globalState, document.uri)

      if (elmJson) {
        const text = document.getText()
        const ast = await ElmToAst.run(text)

        const moduleName = getModuleNameFromAst(ast)
        const declarationName = getDeclarationName(ast, position)

        console.log(declarationName)
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

      console.log(`findUsages`, `${Date.now() - start}ms`)
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
    if (declaration.value.type === 'typeAlias') {
      let range = fromElmRange(declaration.value.typeAlias.name.range)
      let name = declaration.value.typeAlias.name.value
      if (range.contains) {
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
  const ast = await ElmToAst.run(text)
  const otherModuleName = ast.moduleDefinition.value.normal.moduleName.value.join('.')

  console.log('Parsing AST for', otherModuleName)

  return [
    new vscode.Location(
      uri,
      fromElmRange([1, 1, 1, 1])
    )
  ]
}