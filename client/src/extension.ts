import * as path from 'path'
import { ExtensionContext, workspace } from 'vscode'

import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
  TransportKind
} from 'vscode-languageclient/node'

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
    },
  }

  const clientOptions: LanguageClientOptions = {
    documentSelector: [
      { scheme: 'file', language: 'elm' }
    ],
    synchronize: {
      fileEvents: workspace.createFileSystemWatcher('**/elm-stuff')
    }
  }

  client = new LanguageClient(
    'elmLand',
    'Elm Land',
    serverOptions,
    clientOptions
  )
}

export const deactivate = (): Thenable<void> | undefined => {
  if (client) {
    return client.stop()
  }
}