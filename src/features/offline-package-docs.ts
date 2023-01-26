import * as path from 'path'
import * as vscode from 'vscode'
import { GlobalState, JumpToDocDetails } from './autodetect-elm-json'

export default {
  enable: ({ globalState, context }: { globalState: GlobalState, context: vscode.ExtensionContext }) => {

    // Listens for jump-to-definition events in order to trigger
    // the offline web view
    vscode.window.onDidChangeTextEditorSelection(event => {
      if (globalState.jumpToDocDetails) {
        let jumpToDocDetails: JumpToDocDetails = {
          ...globalState.jumpToDocDetails
        }
        globalState.jumpToDocDetails = undefined

        const JUMP_TO_DEFINITION = undefined
        if (event.kind === JUMP_TO_DEFINITION) {
          vscode.commands.executeCommand('elmLand.browsePackageDocs', jumpToDocDetails)
        }
      }
    })

    // Register the "Browse Elm packages" command
    context.subscriptions.push(vscode.commands.registerCommand('elmLand.browsePackageDocs',
      async (jumpToDocDetails: JumpToDocDetails) => {
        console.log({ jumpToDocDetails })
        const panel = vscode.window.createWebviewPanel(
          'webview', // Identifies the type of the webview. Used internally
          'Elm Packages', // Title of the panel displayed to the user
          vscode.ViewColumn.One, // Editor column to show the new webview panel in.
          {
            enableScripts: true,
            retainContextWhenHidden: true
          }
        )

        // Get docs
        let uri = vscode.Uri.file(jumpToDocDetails.docsJsonFsPath)
        let document = await vscode.workspace.openTextDocument(uri)
        let text = document.getText()
        console.log({ text })

        // Get path to resource on disk
        const onDiskPath = vscode.Uri.file(
          path.join(context.extensionPath, 'dist', 'features', 'offline-package-docs', 'elm.compiled.js')
        );

        // And get the special URI to use with the webview
        const script = panel.webview.asWebviewUri(onDiskPath);

        console.log({ script })
        function getWebviewContent() {
          return `<!DOCTYPE html>
      <html lang="en">
      <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Elm packages</title>
      </head>
      <body>
          <div id="app"></div>
          <script src="${script}"></script>
          <script>
            Elm.Main.init({
              node: document.getElementById('app'),
              flags: {
                author: "elm",
                package: "html",
                version: "1.0.5",
                moduleName: "Html",
                typeOrValueName: "text",
                docs: ${JSON.stringify(JSON.parse(text))}
              }
            })
          </script>
      </body>
      </html>`;
        }

        // And set its HTML content
        panel.webview.html = getWebviewContent()
      }))
  }
}