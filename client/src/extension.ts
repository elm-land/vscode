import { exec } from 'child_process'
import * as path from 'path'
import {
  CancellationToken,
  DocumentFormattingEditProvider,
  ExtensionContext,
  FormattingOptions,
  languages,
  Position,
  ProviderResult,
  Range,
  SnippetString,
  TextDocument,
  TextEdit,
  Uri,
  Webview,
  WebviewView,
  WebviewViewProvider,
  WebviewViewResolveContext,
  window,
  workspace
} from 'vscode'
import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
  TransportKind
} from 'vscode-languageclient/node'

const config = {
  extensionId: 'elmLand',
  extensionLabel: 'Elm Land'
}

let client: LanguageClient

export const activate = (context: ExtensionContext): void => {
  const serverModulePath = context.asAbsolutePath(
    path.join('server', 'dist', 'server.js')
  )

  const serverOptions: ServerOptions = {
    run: {
      module: serverModulePath,
      transport: TransportKind.ipc
    },
    debug: {
      module: serverModulePath,
      transport: TransportKind.ipc,
      options: {
        execArgv: [
          '--nolazy',
          '--inspect=6009'
        ]
      }
    }
  }

  const clientOptions: LanguageClientOptions = {
    documentSelector: [
      { scheme: 'file', language: 'elm' }
    ],
    synchronize: {
      fileEvents: workspace.createFileSystemWatcher('**/elm-stuff')
    }
  }

  const provider = new ElmLandWebview(context.extensionUri)

  context.subscriptions.push(
    window.registerWebviewViewProvider(ElmLandWebview.viewType, provider)
  )

  context.subscriptions.push(
    languages.registerDocumentFormattingEditProvider(
      DocumentFormatter.selector,
      new DocumentFormatter()
    )
  )

  client = new LanguageClient(
    config.extensionId,
    config.extensionLabel,
    serverOptions,
    clientOptions
  )

  client.start()
}

export const deactivate = (): Thenable<void> | undefined => {
  if (client) {
    return client.stop()
  }
}

class DocumentFormatter implements DocumentFormattingEditProvider {
  static selector = 'elm'
  public async provideDocumentFormattingEdits(document: TextDocument) {
    try {
      const start = Date.now()
      const text = await ElmFormat.run(document)
      console.log({ elapsed: Date.now() - start + 'ms' })
      return [TextEdit.replace(getFullDocRange(document), text)]
    } catch {
      return []
    }
  }
}

const ElmFormat = {
  run: (document: TextDocument): Promise<string> => {
    const command = `npx elm-format --stdin --yes`
    const original = document.getText()
    return new Promise((resolve, reject) => {
      const process_ = exec(command, (err, stdout, stderr) => {
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
}

function getFullDocRange(document: TextDocument): Range {
  return document.validateRange(
    new Range(
      new Position(0, 0),
      new Position(Number.MAX_VALUE, Number.MAX_VALUE)
    )
  );
}

class ElmLandWebview implements WebviewViewProvider {

  public static readonly viewType = `${config.extensionId}.webview`

  private _view?: WebviewView

  constructor(
    private readonly _extensionUri: Uri,
  ) { }

  public resolveWebviewView(
    webviewView: WebviewView,
    _context: WebviewViewResolveContext,
    _token: CancellationToken,
  ) {
    this._view = webviewView

    webviewView.webview.options = {
      localResourceRoots: [
        this._extensionUri
      ]
    }

    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview)

    this._view.show?.(true)
  }

  private _getHtmlForWebview(webview: Webview) {
    const stylesUri =
      webview.asWebviewUri(Uri.joinPath(this._extensionUri, 'webview', 'style.css'))

    return `<!DOCTYPE html>
			<html lang="en">
			<head>
				<meta charset="UTF-8">
				<meta name="viewport" content="width=device-width, initial-scale=1.0">
				<link href="${stylesUri}" rel="stylesheet">
				<title>${config.extensionLabel}</title>
			</head>
			<body>
				<h1>Hello!</h1>
			</body>
			</html>`
  }
}
