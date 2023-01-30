import * as vscode from 'vscode'
import * as child_process from "child_process"
import { Feature } from './shared/logic'

export const feature: Feature = ({ context }) => {
  context.subscriptions.push(
    vscode.languages.registerDocumentFormattingEditProvider('elm', {
      provideDocumentFormattingEdits
    })
  )
}

const provideDocumentFormattingEdits = async (
  document: vscode.TextDocument,
  options: vscode.FormattingOptions,
  token: vscode.CancellationToken
) => {
  try {
    let text = await runElmFormat(document)
    return [vscode.TextEdit.replace(getFullDocRange(document), text)]
  } catch (_) {
    return []
  }
}

function runElmFormat(document: vscode.TextDocument): Promise<string> {
  const command = `npx elm-format --stdin --yes`
  const original = document.getText()
  return new Promise((resolve, reject) => {
    const process_ = child_process.exec(command, (err, stdout, stderr) => {
      if (err) {
        reject(original)
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
  );
}