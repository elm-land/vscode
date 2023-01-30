import * as path from 'path'
import * as vscode from 'vscode'
import { JumpToDocDetails } from './autodetect-elm-json'
import { Feature } from './shared/logic'

export const feature: Feature = ({ globalState, context }) => {

  // Listens for jump-to-definition events in order to trigger
  // the offline web view
  vscode.window.onDidChangeTextEditorSelection(event => {
    if (globalState.jumpToDocDetails) {
      let jumpToDocDetails: JumpToDocDetails = {
        ...globalState.jumpToDocDetails
      }
      globalState.jumpToDocDetails = undefined

      if ([
        vscode.TextEditorSelectionChangeKind.Mouse,
        undefined
      ].includes(event.kind)
        || event.selections.some(selection => jumpToDocDetails.range.contains(selection.start))
      ) {
        vscode.commands.executeCommand('elmLand.browsePackageDocs', jumpToDocDetails)
      }
    }
  })

  // Register the "Browse Elm packages" command
  context.subscriptions.push(vscode.commands.registerCommand('elmLand.browsePackageDocs',
    async (input: JumpToDocDetails) => {

      try {

        let [author, package_, version] = input.docsJsonFsPath.split('/').slice(-4, -1)

        const panel = vscode.window.createWebviewPanel(
          'webview', // Identifies the type of the webview. Used internally
          `${author}/${package_}`, // Title of the panel displayed to the user
          vscode.ViewColumn.Beside, // Editor column to show the new webview panel in.
          {
            enableScripts: true,
            retainContextWhenHidden: true,
            enableFindWidget: true,
          }
        )
        panel.iconPath = vscode.Uri.joinPath(context.extensionUri, "src", "elm-logo.png");

        // Get docs.json JSON
        let docsJsonUri = vscode.Uri.file(input.docsJsonFsPath)
        let rawDocsJson = (await vscode.workspace.openTextDocument(docsJsonUri)).getText()

        // Grab README text
        let readmeUri = vscode.Uri.file(input.docsJsonFsPath.split('docs.json').join('README.md'))
        let readme = (await vscode.workspace.openTextDocument(readmeUri)).getText()

        // Local resources
        const elmLogo = panel.webview.asWebviewUri(vscode.Uri.file(
          path.join(context.extensionPath, 'src', 'elm-logo.png')
        ))
        const script = panel.webview.asWebviewUri(vscode.Uri.file(
          path.join(context.extensionPath, 'dist', 'features', 'offline-package-docs', 'elm.compiled.js')
        ))


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
                        typeOrValueName: ${input.typeOrValueName ? `"${input.typeOrValueName}"` : `null`},
                        elmLogoUrl: "${elmLogo}",
                        docs: ${JSON.stringify(JSON.parse(rawDocsJson))},
                        readme: \`${readme.split('`').join('\\`')}\`
                      }
                    })
                  </script>
                </body>
                </html>`;
        }

        // And set its HTML content
        panel.webview.html = getWebviewContent()
      } catch (_) { }
    }
  ))
}