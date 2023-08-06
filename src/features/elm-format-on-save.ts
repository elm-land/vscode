import * as vscode from "vscode"
import * as os from "os"
import * as child_process from "child_process"
import sharedLogic, { Feature } from "./shared/logic"

export const feature: Feature = ({ context }) => {
  context.subscriptions.push(
    vscode.commands.registerCommand('elmLand.installElmFormat', () => {
      const terminal = vscode.window.createTerminal(`Install elm-format`)
      terminal.sendText(`(cd ${os.homedir()} && npm install -g elm-format@0.8.7)`)
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
  const start = Date.now()
  // User should disable this feature in the `[elm]` language settings
  try {
    let text = await runElmFormat(document)
    console.info('formatOnSave', `${Date.now() - start}ms`)
    return [vscode.TextEdit.replace(getFullDocRange(document), text)]
  } catch (_) {
    return []
  }
}

function runElmFormat(document: vscode.TextDocument): Promise<string> {
  const command = `elm-format --stdin --yes`
  const original = document.getText()
  return new Promise((resolve, reject) => {
    const process_ = child_process.exec(
      command,
      {
        env: sharedLogic.npxEnv()
      },
      async (err, stdout, stderr) => {
      if (err) {
        const ELM_FORMAT_BINARY_NOT_FOUND = 127
        if (err.code === ELM_FORMAT_BINARY_NOT_FOUND || err.message.includes(`'elm-format' is not recognized`)) {
          let response = await vscode.window.showWarningMessage(
            'The "Format on save" feature requires "elm-format"',
            { modal: false },
            'Install'
          )
          if (response === 'Install') {
            vscode.commands.executeCommand('elmLand.installElmFormat')
          }
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
