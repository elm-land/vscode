import {
  createConnection,
  TextDocuments,
  Diagnostic,
  DiagnosticSeverity,
  ProposedFeatures,
  InitializeParams,
  DidChangeConfigurationNotification,
  CompletionItem,
  CompletionItemKind,
  TextDocumentPositionParams,
  TextDocumentSyncKind,
  InitializeResult
} from 'vscode-languageserver/node'

import { TextDocument } from 'vscode-languageserver-textdocument'

const pluginName = `elmLand`

const connection = createConnection(ProposedFeatures.all)

const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument)

let hasConfigurationCapability = false
let hasWorkspaceFolderCapability = false
let hasDiagnosticRelatedInformationCapability = false

connection.onInitialize((params: InitializeParams) => {
  const capabilities = params.capabilities

  hasConfigurationCapability = !!capabilities.workspace?.configuration
  hasWorkspaceFolderCapability = !!capabilities.workspace?.workspaceFolders
  hasDiagnosticRelatedInformationCapability = !!capabilities.textDocument?.publishDiagnostics?.relatedInformation

  const result: InitializeResult = {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      completionProvider: { // "This server supports code completion"
        resolveProvider: true
      }
    }
  }

  if (hasWorkspaceFolderCapability) {
    result.capabilities.workspace = {
      workspaceFolders: {
        supported: true
      }
    }
  }

  return result
})

connection.onInitialized(() => {
  if (hasConfigurationCapability) {
    connection.client.register(DidChangeConfigurationNotification.type, undefined)
  }
  if (hasWorkspaceFolderCapability) {
    connection.workspace.onDidChangeWorkspaceFolders(_event => {
      connection.console.log(`Workspace folder change event received.`)
    })
  }
})

interface ExampleSettings {
  maxNumberOfProblems: number
}

const defaultSettings: ExampleSettings = { maxNumberOfProblems: 1000 }
let globalSettings: ExampleSettings = defaultSettings

let settingsCache: Map<string, Thenable<ExampleSettings>> = new Map()

connection.onDidChangeConfiguration(change => {
  if (hasConfigurationCapability) {
    settingsCache.clear()
  } else {
    globalSettings = <ExampleSettings>(change.settings[pluginName] || defaultSettings)
  }

  documents.all().forEach(validateTextDocument)
})

const getSettingsCache = (uri: string): Thenable<ExampleSettings> => {
  if (!hasConfigurationCapability) {
    return Promise.resolve(globalSettings)
  }

  let result = settingsCache.get(uri)
  if (!result) {
    result = connection.workspace.getConfiguration({
      scopeUri: uri,
      section: pluginName
    })
    settingsCache.set(uri, result)
  }
  return result
}

documents.onDidClose(e => {
  settingsCache.delete(e.document.uri)
})

documents.onDidChangeContent(change => {
  validateTextDocument(change.document)
})

const validateTextDocument = async (textDocument: TextDocument): Promise<void> => {
  const uri = textDocument.uri
  const settings = await getSettingsCache(uri)

  const text = textDocument.getText()
  const pattern = /\b[A-Z]{2,}\b/g
  let m: RegExpExecArray | null = null

  let problems = 0
  let diagnostics: Diagnostic[] = []

  while ((m = pattern.exec(text)) && problems < settings.maxNumberOfProblems) {
    problems++
    let diagnostic: Diagnostic = {
      severity: DiagnosticSeverity.Warning,
      range: {
        start: textDocument.positionAt(m.index),
        end: textDocument.positionAt(m.index + m[0].length),
      },
      message: `${m[0]} is all uppercase`,
      source: 'ex'
    }

    if (hasDiagnosticRelatedInformationCapability) {
      diagnostic.relatedInformation = [
        {
          message: 'Spelling matters',
          location: {
            uri,
            range: Object.assign({}, diagnostic.range)
          }
        },
        {
          message: 'Particularly for names',
          location: {
            uri,
            range: Object.assign({}, diagnostic.range)
          }
        }
      ]
    }
    diagnostics.push(diagnostic)
  }

  connection.sendDiagnostics({ uri, diagnostics })
}

connection.onDidChangeWatchedFiles((_change: unknown) => {
  connection.console.log(`We received a file change event`)
})

connection.onCompletion((_textDocPosition: TextDocumentPositionParams): CompletionItem[] => {
  return [
    {
      label: 'TypeScript',
      kind: CompletionItemKind.Text,
      data: 1
    },
    {
      label: 'JavaScript',
      kind: CompletionItemKind.Text,
      data: 2
    }
  ]
})

connection.onCompletionResolve((item: CompletionItem): CompletionItem => {
  switch (item.data) {
    case 1:
      item.detail = 'TypeScript details'
      item.documentation = 'TypeScript documentation'
      return item
    case 2:
      item.detail = 'JavaScript details'
      item.documentation = 'JavaScript documentation'
      return item
    default:
      return item
  }
})

documents.listen(connection)

connection.listen()