import * as path from "path"
import * as vscode from "vscode"
import * as ElmToAst from "./shared/elm-to-ast"
import * as ElmSyntax from "./shared/elm-to-ast/elm-syntax"
import SharedLogic from "./shared/logic"
import { JumpToDocDetails } from "./shared/autodetect-elm-json"
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
        let packages = await SharedLogic.getMappingOfModuleNameToDocJsonFilepath(globalState, elmJsonFile)
        let details: JumpToDocDetails[] = []
        let links: vscode.DocumentLink[] = []

        for (let importNode of ast.imports) {
          // Add links to imports
          let moduleNameNode = importNode.value.moduleName
          let range = SharedLogic.fromElmRange(moduleNameNode.range)
          let moduleName = moduleNameNode.value.join(".")
          let docsJsonFsPath = packages.get(moduleName)
          if (docsJsonFsPath !== undefined) {
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

          const findPackageLinksInDeclaration = async (
            declaration: ElmSyntax.Declaration,
            namesToIgnore: string[]
          ): Promise<vscode.DocumentLink[]> => {
            let links: vscode.DocumentLink[] = []
            switch (declaration.type) {
              case "destructuring":
                return findPackageLinksInExpression(
                  declaration.destructuring.expression,
                  namesToIgnore
                )
              case "function":
                namesToIgnore = namesToIgnore.concat(declaration.function.declaration.value.arguments.flatMap(ElmSyntax.toPatternDefinitionNames))
                if (
                  declaration.function.signature?.value.typeAnnotation.value
                ) {
                  links.push(
                    ...await findPackageLinksInAnnotation(
                      declaration.function.signature.value.typeAnnotation,
                      namesToIgnore
                    )
                  )
                }
                links.push(
                  ...await findPackageLinksInExpression(
                    declaration.function.declaration.value.expression,
                    namesToIgnore
                  )
                )
                return links
              case "infix":
                return []
              case "port":
                return findPackageLinksInAnnotation(
                  declaration.port.typeAnnotation,
                  namesToIgnore
                )
              case "typeAlias":
                return findPackageLinksInAnnotation(
                  declaration.typeAlias.typeAnnotation,
                  namesToIgnore
                )
              case "typedecl":
                for (let constructor of declaration.typedecl.constructors) {
                  for (let arg of constructor.value.arguments) {
                    links.push(...await findPackageLinksInAnnotation(arg, namesToIgnore))
                  }
                }
                return links
            }
          }

          const findPackageLinksInExpression = async (
            expression: ElmSyntax.Node<ElmSyntax.Expression>,
            namesToIgnore: string[]
          ): Promise<vscode.DocumentLink[]> => {
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
                  links.push(...await findPackageLinksInExpression(node, namesToIgnore))
                }
                return links
              case "lambda":
                for (let pattern of expression.value.lambda.patterns) {
                  links.push(...findPackageLinksInPattern(pattern, namesToIgnore))
                }
                let newNamesToIgnore = namesToIgnore.concat(expression.value.lambda.patterns.flatMap(ElmSyntax.toPatternDefinitionNames))
                links.push(
                  ...await findPackageLinksInExpression(
                    expression.value.lambda.expression,
                    newNamesToIgnore
                  )
                )
                return links
              case "let":
                let newNamesToIgnore2 = namesToIgnore.concat(expression.value.let.declarations.map(ElmSyntax.toDeclarationName).filter(isNotNull))
                for (let declaration of expression.value.let.declarations) {
                  links.push(
                    ...await findPackageLinksInDeclaration(declaration.value, newNamesToIgnore2)
                  )
                }
                links.push(
                  ...await findPackageLinksInExpression(
                    expression.value.let.expression,
                    newNamesToIgnore2
                  )
                )
                return links
              case "list":
                for (let node of expression.value.list) {
                  links.push(...await findPackageLinksInExpression(node, namesToIgnore))
                }
                return links
              case "parenthesized":
                return findPackageLinksInExpression(
                  expression.value.parenthesized,
                  namesToIgnore
                )
              case "record":
                for (let node of expression.value.record) {
                  links.push(
                    ...await findPackageLinksInExpression(node.value.expression, namesToIgnore)
                  )
                }
                return links
              case "recordAccess":
                // TODO: What's `recordAccess.name`?
                links.push(
                  ...await findPackageLinksInExpression(
                    expression.value.recordAccess.expression,
                    namesToIgnore
                  )
                )
                return links
              case "recordUpdate":
                for (let node of expression.value.recordUpdate.updates) {
                  links.push(
                    ...await findPackageLinksInExpression(node.value.expression, namesToIgnore)
                  )
                }
                return links
              case "tupled":
                for (let node of expression.value.tupled) {
                  links.push(...await findPackageLinksInExpression(node, namesToIgnore))
                }
                return links
              case "application":
                for (let node of expression.value.application) {
                  links.push(...await findPackageLinksInExpression(node, namesToIgnore))
                }
                return links
              case "case":
                links = await findPackageLinksInExpression(
                  expression.value.case.expression,
                  namesToIgnore
                )
                for (let node of expression.value.case.cases) {
                  let newNamesToIgnore = namesToIgnore.concat(ElmSyntax.toPatternDefinitionNames(node.pattern))

                  links.push(...findPackageLinksInPattern(node.pattern, namesToIgnore))
                  links.push(...await findPackageLinksInExpression(node.expression, newNamesToIgnore))
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
                  let docsJsonFsPath = packages.get(moduleName)
                  if (docsJsonFsPath !== undefined) {
                    let typeOrValueName = await SharedLogic.doesModuleExposesValue(
                      globalState,
                      foo,
                      moduleName,
                      functionOrValueName
                    )
                    if (typeOrValueName && !namesToIgnore.includes(typeOrValueName)) {
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

          const findPackageLinksInAnnotation = async (
            annotation: ElmSyntax.Node<ElmSyntax.TypeAnnotation>,
            namesToIgnore: string[]
          ): Promise<vscode.DocumentLink[]> => {
            let links: vscode.DocumentLink[] = []
            switch (annotation.value.type) {
              case "function":
                links.push(
                  ...await findPackageLinksInAnnotation(
                    annotation.value.function.left,
                    namesToIgnore
                  )
                )
                links.push(
                  ...await findPackageLinksInAnnotation(
                    annotation.value.function.right,
                    namesToIgnore
                  )
                )
                return links
              case "generic":
                return []
              case "genericRecord":
                for (let field of annotation.value.genericRecord.values.value) {
                  links.push(
                    ...await findPackageLinksInAnnotation(field.value.typeAnnotation, namesToIgnore)
                  )
                }
                return links
              case "record":
                for (let field of annotation.value.record.value) {
                  links.push(
                    ...await findPackageLinksInAnnotation(field.value.typeAnnotation, namesToIgnore)
                  )
                }
                return links
              case "tupled":
                for (let annotation_ of annotation.value.tupled.values) {
                  links.push(...await findPackageLinksInAnnotation(annotation_, namesToIgnore))
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
                  let docsJsonFsPath = packages.get(moduleName)
                  if (docsJsonFsPath !== undefined) {
                    let typeOrValueName = await SharedLogic.doesModuleExposesValue(
                      globalState,
                      foo,
                      moduleName,
                      typedAnnotationName
                    )
                    if (typeOrValueName || moduleName === 'List') {
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
                  links.push(...await findPackageLinksInAnnotation(arg, namesToIgnore))
                }

                return links
              case "unit":
                return []
            }
          }

          const findPackageLinksInPattern = (
            pattern: ElmSyntax.Node<ElmSyntax.Pattern>,
            namesToIgnore: string[]
          ): vscode.DocumentLink[] => {
            return []
          }

          let isNotNull = <T>(x: T | null): x is T => x !== null
          let declarationNames = ast.declarations.map(ElmSyntax.toDeclarationName).filter(isNotNull)
          for (let declarationNode of ast.declarations) {
            links.push(...await findPackageLinksInDeclaration(declarationNode.value, declarationNames))
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

      if (!input) return

      let [author, package_, version] = input.docsJsonFsPath
        .split(path.sep)
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

      try {
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
      } catch (_) {
        panel.webview.html = `<!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Elm Packages</title>
          <style>
            body { line-height: 1.5; }
          </style>
        </head>
        <body>
          <h1>Elm Packages</h1>
          <p>You're seeing this page because the Elm Land plugin couldn't find <code>${author}/${package_}</code> installed on this machine.</p>
          <p>This usually only happens if your <code>ELM_HOME</code> directory was deleted some time after opening VS code.</p>
          <p>The plugin should have <strong>automatically</strong> fixed this issue, but you can resolve it manually by following these steps:</p>
          <ol>
            <li>Delete your <code>elm-stuff</code> folder</li>
            <li>Save any <code>.elm</code> file in your project</li>
          </ol>
          <p>After that, your package links should be working as expected!</p>
        </body>
        </html>`
      }
    })
  )
}
