import * as vscode from 'vscode'
import * as HtmlToElm from './html-to-elm/index'
import { Feature } from "./shared/logic"


export const feature: Feature = ({ context, globalState }) => {

  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider('elm', {
      provideCodeActions(document, range, context, token) {
        // Allow user to disable this feature
        const isEnabled: boolean = vscode.workspace.getConfiguration('elmLand').feature.htmlToElm
        if (!isEnabled) return

        let selectedText = document.getText(range)
        let codeActions: vscode.CodeAction[] = []

        if (selectedText.trimStart().startsWith('<')) {
          codeActions.push({
            title: 'Convert HTML to Elm',
            kind: vscode.CodeActionKind.QuickFix,
            command: {
              title: 'Convert HTML to Elm',
              command: 'elmLand.htmlToElm'
            }
          })
        }

        return codeActions
      },
    })
  )

  let disposable = vscode.commands.registerCommand('elmLand.htmlToElm', async () => {
    let start = Date.now()
    // Get the current text editor
    let editor = vscode.window.activeTextEditor
    if (!editor) {
      vscode.window.showInformationMessage('No text editor is active.')
      return
    }

    // Get the selected text
    let selection = editor.selection
    let text = editor.document.getText(selection)

    // Convert the selected HTML to Elm code
    let elmCode = await HtmlToElm.run(text)

    // Replace the HTML with Elm  code
    if (elmCode) {
      await editor.edit(editBuilder => {
        editBuilder.replace(selection, elmCode || '')
      })
      console.info(`htmlToElm`, `${Date.now()-start}ms`)
    }
  })

  context.subscriptions.push(disposable)
}