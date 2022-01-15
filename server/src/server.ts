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
  InitializeResult,
  DiagnosticTag
} from 'vscode-languageserver/node'

import { Position, TextDocument, TextEdit } from 'vscode-languageserver-textdocument'
import { URI } from 'vscode-uri'
import { exec } from 'child_process'
import { readFile } from 'fs/promises'

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
      textDocumentSync: TextDocumentSyncKind.Incremental
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

documents.onDidOpen(change => {
  validateTextDocument(change.document)
})

documents.onDidSave(change => {
  validateTextDocument(change.document)
})

// let uris : { [uri: string]: true } = {}

const validateTextDocument = async (textDocument: TextDocument): Promise<void> => {
  const uri = textDocument.uri
  // uris[textDocument.uri] = true
  const settings = await getSettingsCache(uri)

  const parsedUri = URI.parse(uri)

  const error = await Elm.compile({ path: parsedUri.path })

  if (error) {
    const diagnostics = Elm.toDiagnostics({ path: parsedUri.fsPath, error })
    connection.sendDiagnostics({ uri, diagnostics })
  } else {
    // for (let uri of Object.keys(uris)) {
      connection.sendDiagnostics({ uri, diagnostics: [] })
    // }
  }
}

connection.onDidChangeWatchedFiles((_change: unknown) => {
  connection.console.log(`We received a file change event`)
})

documents.listen(connection)

connection.listen()


// LIB

type ElmError
  = { kind: 'compile-errors', errors: CompileError[] }
  | { kind: 'unknown', raw: string }

type CompileError = {
  name: string
  path: string
  problems: CompileErrorProblem[]
}

type CompileErrorProblem = {
  title: string
  region: CompileErrorRegion
  message: ElmMessage
}

type CompileErrorRegion = {
  start: ErrorLocation
  end: ErrorLocation
}

type ErrorLocation = {
  line: number
  column: number
}

type ElmMessage = ElmMessageLine[]

type ElmMessageLine =
  string
  | ElmFormattedLine

type ElmFormattedLine = {
  bold: boolean,
  underline: boolean,
  color: ElmMessageColor | null,
  string: string
}

type ElmMessageColor = 'RED' | 'yellow'

const Elm = {
  compile: (input: { path: string }): Promise<ElmError | undefined> => {

    const command = `npx elm make ${input.path} --output=/dev/null --report=json`

    const promise: Promise<ElmError | undefined> = new Promise((resolve) =>
      exec(command, (err, _, stderr) => {
        if (err) {
          try {
            const json = JSON.parse(stderr)

            switch (json.type) {
              case 'compile-errors':
                return resolve(
                  { kind: 'compile-errors', errors: json.errors }
                )
              default:
                throw new Error("Unhandled error type: " + json.type)
            }
          } catch (ex) {
            resolve({ kind: 'unknown', raw: stderr })
          }
        } else {
          resolve(undefined)
        }
      }))

    return promise
  },

  toDiagnostics: (input: { path: string, error: ElmError }): Diagnostic[] => {
    switch (input.error.kind) {
      case 'compile-errors':
        return input.error.errors.flatMap(error => {
          const problems = error.problems

          if (isCaseInsensitiveMatch(error.path, input.path)) {
            return problems.map(problem => {
              const diagnostic: Diagnostic = {
                severity: DiagnosticSeverity.Error,
                range: {
                  start: Elm.fromErrorLocation(problem.region.start),
                  end: Elm.fromErrorLocation(problem.region.end)
                },
                message: Elm.formatErrorMessage(problem.message)
              }
              return diagnostic
            })
          } else {
            return []
          }
        })
      case 'unknown':
        return []
    }
  },
  fromErrorLocation: (location: ErrorLocation): Position => {
    return { line: location.line - 1, character: location.column - 1 }
  },
  formatErrorMessage: (message: ElmMessage): string => {
    return message.map(line => {
      if (typeof line === 'string') {
        return line
      } else {
        // VS Code Diagnostics do not support color error messages
        // if (line.color === 'RED') {
        //   return "\u001b[31m" + line.string + '\u001b[0m'
        // }
        return line.string
      }
    }).join('')
  }
}


const isCaseInsensitiveMatch = (a : string, b : string) : boolean => {
  return a.toLowerCase() === b.toLowerCase()
}