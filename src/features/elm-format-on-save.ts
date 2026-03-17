import * as vscode from "vscode"
import * as os from "os"
import * as child_process from "child_process"
import sharedLogic, { Feature } from "./shared/logic"

export const feature: Feature = ({ context }) => {
  context.subscriptions.push(
    vscode.commands.registerCommand('elmLand.installElmFormat', () => {
      const terminal = vscode.window.createTerminal(`Install elm-format`)
      terminal.sendText(`npm install -g elm-format@0.8.7`)
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
    const original = document.getText()
    const formatted = await runElmFormat(original)
    console.info('formatOnSave', `${Date.now() - start}ms`)
    return minimalEdit(document, original, formatted)
  } catch (_) {
    return []
  }
}

// Returns a single TextEdit covering only the characters that changed between
// original and formatted. VS Code uses the edit range to preserve the cursor
// position, so keeping it small prevents the viewport from jumping on save.
const minimalEdit = (
  document: vscode.TextDocument,
  original: string,
  formatted: string
): vscode.TextEdit[] => {
  if (original === formatted) return []

  // Walk inward from both ends to find the changed region
  let start = 0
  while (start < original.length && start < formatted.length && original[start] === formatted[start]) {
    start++
  }

  let endOriginal = original.length
  let endFormatted = formatted.length
  while (endOriginal > start && endFormatted > start && original[endOriginal - 1] === formatted[endFormatted - 1]) {
    endOriginal--
    endFormatted--
  }

  return [vscode.TextEdit.replace(
    new vscode.Range(document.positionAt(start), document.positionAt(endOriginal)),
    formatted.slice(start, endFormatted)
  )]
}

function runElmFormat(original: string): Promise<string> {
  const command = `elm-format --stdin --yes`
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
