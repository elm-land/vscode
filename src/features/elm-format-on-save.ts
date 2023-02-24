import * as vscode from "vscode"
import * as child_process from "child_process"
import { Feature } from "./shared/logic"

export const feature: Feature = ({ context }) => {
  context.subscriptions.push(
    vscode.commands.registerCommand('elmLand.installElmFormat', () => {
      const terminal = vscode.window.createTerminal(`Install elm-format`)
      terminal.sendText("npm install -g elm-format")
      terminal.show()
    })
  )
  context.subscriptions.push(
    vscode.languages.registerDocumentFormattingEditProvider("elm", {
      provideDocumentFormattingEdits,
    })
  )
}

const provideDocumentFormattingEdits = async (
  document: vscode.TextDocument,
  options: vscode.FormattingOptions,
  token: vscode.CancellationToken
) => {
  // User should disable this feature in the `[elm]` language settings
  try {
    let text = await runElmFormat(document)
    return [vscode.TextEdit.replace(getFullDocRange(document), text)]
  } catch (_) {
    return []
  }
}
const isWindows = process.platform === "win32"

function runElmFormat(document: vscode.TextDocument): Promise<string> {
  const command = isWindows
    ? `npx elm-format --stdin --yes`
    : `elm-format --stdin --yes`

  const original = document.getText()
  return new Promise((resolve, reject) => {
    const process_ = child_process.exec(command, async (err, stdout, stderr) => {
      if (err) {
        let response = await vscode.window.showErrorMessage(
          'Format on save requires "elm-format"',
          { modal: true, detail: 'Please click "Install" or disable "Format on save" in your settings.' },
          'Install'
        )
        if (response === 'Install') {
          vscode.commands.executeCommand('elmLand.installElmFormat')
        }
        reject(err)
      } else {
        resolve(stdout)
      }
    })
    process_.stdin?.write(original)
    process_.stdin?.end()
    return process_
  })
}

function getFullDocRange(document: vscode.TextDocument): vscode.Range {
  return document.validateRange(
    new vscode.Range(
      new vscode.Position(0, 0),
      new vscode.Position(Number.MAX_VALUE, Number.MAX_VALUE)
    )
  )
}
