import * as path from "path"
import * as vscode from "vscode"
import * as ElmToAst from "./shared/elm-to-ast"
import * as ElmSyntax from "./shared/elm-to-ast/elm-syntax"
import SharedLogic from "./shared/logic"
import { JumpToDocDetails } from "./autodetect-elm-json"
import { Feature } from "./shared/logic"
import { ElmJsonFile } from "./shared/elm-json-file"

export const feature: Feature = ({ globalState, context }) => {
  vscode.languages.registerDocumentLinkProvider("elm", {
    async provideDocumentLinks(
      document: vscode.TextDocument,
      token: vscode.CancellationToken
    ): Promise<vscode.DocumentLink[]> {
      // Allow user to disable this feature
      let settings: "Enabled" | "Disabled" | "Imports only" =
        vscode.workspace.getConfiguration("elmLand").feature.offlinePackageDocs
      if (settings === "Disabled") {
        return []
      }

      let start = Date.now()
      let text = document.getText()
      let ast = await ElmToAst.run(text)
      let uri = vscode.Uri.parse("command:elmLand.browsePackageDocs")
      let elmJsonFile = SharedLogic.findElmJsonFor(globalState, document.uri)

      if (elmJsonFile && ast) {
        let foo: ElmJsonFile = elmJsonFile
        let packages =
          SharedLogic.getMappingOfPackageNameToDocJsonFilepath(elmJsonFile)
        let details: JumpToDocDetails[] = []
        let links: vscode.DocumentLink[] = []

        for (let importNode of ast.imports) {
          // Add links to imports
          let moduleNameNode = importNode.value.moduleName
          let range = SharedLogic.fromElmRange(moduleNameNode.range)
          let moduleName = moduleNameNode.value.join(".")
          let docsJsonFsPath = packages[moduleName]
          if (docsJsonFsPath) {
            details.push({
              range,
              docsJsonFsPath,
              moduleName,
              typeOrValueName: undefined,
            })
            links.push({ range, target: uri })

            // Links on module aliases
            let moduleAliasNode = importNode.value.moduleAlias
            if (moduleAliasNode) {
              let range = SharedLogic.fromElmRange(moduleAliasNode.range)
              details.push({
                range,
                docsJsonFsPath,
                moduleName,
                typeOrValueName: undefined,
              })
              links.push({ range, target: uri })
            }

            let explicitlyExposed = importNode.value.exposingList?.value
            if (explicitlyExposed?.type === "explicit") {
              for (let explicitExposedValue of explicitlyExposed.explicit) {
                let range = SharedLogic.fromElmRange(explicitExposedValue.range)
                details.push({
                  range,
                  docsJsonFsPath,
                  moduleName,
                  typeOrValueName: ElmSyntax.toTopLevelExposeName(
                    explicitExposedValue.value
                  ),
                })
                links.push({ range, target: uri })
              }
            }
          }
        }

        if (settings === "Enabled") {
          let moduleImportTracker = ElmSyntax.createModuleImportTracker(ast)

          const findPackageLinksInDeclaration = (
            declaration: ElmSyntax.Declaration
          ): vscode.DocumentLink[] => {
            let links: vscode.DocumentLink[] = []
            switch (declaration.type) {
              case "destructuring":
                return findPackageLinksInExpression(
                  declaration.destructuring.expression
                )
              case "function":
                if (
                  declaration.function.signature?.value.typeAnnotation.value
                ) {
                  links.push(
                    ...findPackageLinksInAnnotation(
                      declaration.function.signature.value.typeAnnotation
                    )
                  )
                }
                links.push(
                  ...findPackageLinksInExpression(
                    declaration.function.declaration.value.expression
                  )
                )
                return links
              case "infix":
                return []
              case "port":
                return findPackageLinksInAnnotation(
                  declaration.port.typeAnnotation
                )
              case "typeAlias":
                return findPackageLinksInAnnotation(
                  declaration.typeAlias.typeAnnotation
                )
              case "typedecl":
                for (let constructor of declaration.typedecl.constructors) {
                  for (let arg of constructor.value.arguments) {
                    links.push(...findPackageLinksInAnnotation(arg))
                  }
                }
                return links
            }
          }

          const findPackageLinksInExpression = (
            expression: ElmSyntax.Node<ElmSyntax.Expression>
          ): vscode.DocumentLink[] => {
            let links: vscode.DocumentLink[] = []

            switch (expression.value.type) {
              case "unit":
              case "glsl":
              case "integer":
              case "charLiteral":
              case "literal":
              case "float":
              case "hex":
              case "negation":
              case "operator":
              case "operatorapplication":
              case "prefixoperator":
              case "recordAccessFunction":
                return []
              case "ifBlock":
                for (let node of [
                  expression.value.ifBlock.then,
                  expression.value.ifBlock.else,
                  expression.value.ifBlock.clause,
                ]) {
                  links.push(...findPackageLinksInExpression(node))
                }
                return links
              case "lambda":
                for (let pattern of expression.value.lambda.patterns) {
                  links.push(...findPackageLinksInPattern(pattern))
                }
                links.push(
                  ...findPackageLinksInExpression(
                    expression.value.lambda.expression
                  )
                )
                return links
              case "let":
                for (let declaration of expression.value.let.declarations) {
                  links.push(
                    ...findPackageLinksInDeclaration(declaration.value)
                  )
                }
                links.push(
                  ...findPackageLinksInExpression(
                    expression.value.let.expression
                  )
                )
                return links
              case "list":
                for (let node of expression.value.list) {
                  links.push(...findPackageLinksInExpression(node))
                }
                return links
              case "parenthesized":
                return findPackageLinksInExpression(
                  expression.value.parenthesized
                )
              case "record":
                for (let node of expression.value.record) {
                  links.push(
                    ...findPackageLinksInExpression(node.value.expression)
                  )
                }
                return links
              case "recordAccess":
                // TODO: What's `recordAccess.name`?
                links.push(
                  ...findPackageLinksInExpression(
                    expression.value.recordAccess.expression
                  )
                )
                return links
              case "recordUpdate":
                for (let node of expression.value.recordUpdate.updates) {
                  links.push(
                    ...findPackageLinksInExpression(node.value.expression)
                  )
                }
                return links
              case "tupled":
                for (let node of expression.value.tupled) {
                  links.push(...findPackageLinksInExpression(node))
                }
                return links
              case "application":
                for (let node of expression.value.application) {
                  links.push(...findPackageLinksInExpression(node))
                }
                return links
              case "case":
                links = findPackageLinksInExpression(
                  expression.value.case.expression
                )
                for (let node of expression.value.case.cases) {
                  links.push(...findPackageLinksInPattern(node.pattern))
                  links.push(...findPackageLinksInExpression(node.expression))
                }
                return links
              case "functionOrValue":
                let moduleName =
                  expression.value.functionOrValue.moduleName.join(".")
                let functionOrValueName = expression.value.functionOrValue.name

                let moduleNames =
                  expression.value.functionOrValue.moduleName.length > 0
                    ? moduleImportTracker.findImportedModuleNamesForQualifiedValue(
                      moduleName
                    )
                    : moduleImportTracker.findImportedModuleNamesThatMightHaveExposedThisValue(
                      functionOrValueName
                    )

                for (let moduleName of moduleNames) {
                  let docsJsonFsPath = packages[moduleName]
                  if (docsJsonFsPath) {
                    let typeOrValueName = SharedLogic.doesModuleExposesValue(
                      foo,
                      moduleName,
                      functionOrValueName
                    )
                    if (typeOrValueName) {
                      let range = SharedLogic.fromElmRange(expression.range)
                      details.push({
                        range,
                        docsJsonFsPath,
                        moduleName,
                        typeOrValueName,
                      })
                      links.push({ range, target: uri })
                      return links
                    }
                  }
                }
                return links
            }
          }

          const findPackageLinksInAnnotation = (
            annotation: ElmSyntax.Node<ElmSyntax.TypeAnnotation>
          ): vscode.DocumentLink[] => {
            let links: vscode.DocumentLink[] = []
            switch (annotation.value.type) {
              case "function":
                links.push(
                  ...findPackageLinksInAnnotation(
                    annotation.value.function.left
                  )
                )
                links.push(
                  ...findPackageLinksInAnnotation(
                    annotation.value.function.right
                  )
                )
                return links
              case "generic":
                return []
              case "genericRecord":
                for (let field of annotation.value.genericRecord.values.value) {
                  links.push(
                    ...findPackageLinksInAnnotation(field.value.typeAnnotation)
                  )
                }
                return links
              case "record":
                for (let field of annotation.value.record.value) {
                  links.push(
                    ...findPackageLinksInAnnotation(field.value.typeAnnotation)
                  )
                }
                return links
              case "tupled":
                for (let annotation_ of annotation.value.tupled.values) {
                  links.push(...findPackageLinksInAnnotation(annotation_))
                }
                return links
              case "typed":
                let moduleName =
                  annotation.value.typed.moduleNameAndName.value.moduleName.join(
                    "."
                  )
                let typedAnnotationName =
                  annotation.value.typed.moduleNameAndName.value.name

                let moduleNames =
                  annotation.value.typed.moduleNameAndName.value.moduleName
                    .length > 0
                    ? moduleImportTracker.findImportedModuleNamesForQualifiedValue(
                      moduleName
                    )
                    : moduleImportTracker.findImportedModuleNamesThatMightHaveExposedThisValue(
                      typedAnnotationName
                    )

                for (let moduleName of moduleNames) {
                  let docsJsonFsPath = packages[moduleName]
                  if (docsJsonFsPath) {
                    let typeOrValueName = SharedLogic.doesModuleExposesValue(
                      foo,
                      moduleName,
                      typedAnnotationName
                    )
                    if (typeOrValueName) {
                      let range = SharedLogic.fromElmRange(
                        annotation.value.typed.moduleNameAndName.range
                      )
                      details.push({
                        range,
                        docsJsonFsPath,
                        moduleName,
                        typeOrValueName,
                      })
                      links.push({ range, target: uri })
                    }
                  }
                }

                for (let arg of annotation.value.typed.args) {
                  links.push(...findPackageLinksInAnnotation(arg))
                }

                return links
              case "unit":
                return []
            }
          }

          const findPackageLinksInPattern = (
            pattern: ElmSyntax.Node<ElmSyntax.Pattern>
          ): vscode.DocumentLink[] => {
            return []
          }

          for (let declarationNode of ast.declarations) {
            links.push(...findPackageLinksInDeclaration(declarationNode.value))
          }
        }

        globalState.jumpToDocDetails = details
        console.info(`documentLinks`, `${Date.now() - start}ms`)
        return links
      } else {
        console.info(`documentLinks`, `${Date.now() - start}ms`)
        return []
      }
    },
  })

  // Register the "Browse Elm packages" command
  context.subscriptions.push(
    vscode.commands.registerCommand("elmLand.browsePackageDocs", async () => {
      let cursorPosition: vscode.Position | undefined =
        vscode.window.activeTextEditor?.selection.active

      // Get input from global variable, then clear it's value
      if (!globalState.jumpToDocDetails || cursorPosition === undefined) return
      let input: JumpToDocDetails = globalState.jumpToDocDetails.find((item) =>
        item.range.contains(
          new vscode.Position(
            cursorPosition?.line || 0,
            cursorPosition?.character || 0
          )
        )
      ) as JumpToDocDetails
      // globalState.jumpToDocDetails = undefined

      if (!input) return

      try {
        let [author, package_, version] = input.docsJsonFsPath
          .split("/")
          .slice(-4, -1)

        const panel = vscode.window.createWebviewPanel(
          "webview", // Identifies the type of the webview. Used internally
          `${author}/${package_}`, // Title of the panel displayed to the user
          vscode.ViewColumn.Beside, // Editor column to show the new webview panel in.
          {
            enableScripts: true,
            retainContextWhenHidden: true,
            enableFindWidget: true,
          }
        )
        panel.iconPath = vscode.Uri.joinPath(
          context.extensionUri,
          "src",
          "elm-logo.png"
        )

        // Get docs.json JSON
        let docsJsonUri = vscode.Uri.file(input.docsJsonFsPath)
        let rawDocsJson = (
          await vscode.workspace.openTextDocument(docsJsonUri)
        ).getText()

        // Grab README text
        let readmeUri = vscode.Uri.file(
          input.docsJsonFsPath.split("docs.json").join("README.md")
        )
        let readme = (
          await vscode.workspace.openTextDocument(readmeUri)
        ).getText()

        // Local resources
        const elmLogo = panel.webview.asWebviewUri(
          vscode.Uri.file(
            path.join(context.extensionPath, "src", "elm-logo.png")
          )
        )
        const script = panel.webview.asWebviewUri(
          vscode.Uri.file(
            path.join(
              context.extensionPath,
              "dist",
              "features",
              "offline-package-docs",
              "elm.compiled.js"
            )
          )
        )

        let toJsonString = (json: unknown): string =>
          JSON.stringify(json).split("</").join("<\\/")

        let typeOrValueName =
          input.typeOrValueName
            ? `"${input.typeOrValueName}"`
            : `null`


        function getWebviewContent() {
          return `<!DOCTYPE html>
                <html lang="en">
                <head>
                  <meta charset="UTF-8">
                  <meta name="viewport" content="width=device-width, initial-scale=1.0">
                  <title>Elm Packages</title>
                </head>
                <body>
                  <div id="app"></div>
                  <script src="${script}"></script>
                  <script>
                    Elm.Main.init({
                      node: document.getElementById('app'),
                      flags: {
                        author: "${author}",
                        package: "${package_}",
                        version: "${version}",
                        moduleName: "${input.moduleName}",
                        typeOrValueName: ${typeOrValueName},
                        elmLogoUrl: "${elmLogo}",
                        docs: ${toJsonString(JSON.parse(rawDocsJson))},
                        readme: ${toJsonString(readme)}
                      }
                    })
                  </script>
                </body>
                </html>`
        }

        // And set its HTML content
        panel.webview.html = getWebviewContent()
      } catch (_) { }
    })
  )
}
