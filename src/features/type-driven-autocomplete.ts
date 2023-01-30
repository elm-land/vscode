import * as vscode from 'vscode'
import { Alias, BinOp, Dependency, Union, Value } from './shared/elm-json-file'
import SharedLogic, { Feature } from './shared/logic'

export const feature: Feature = ({ globalState, context }) => {
  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider({ scheme: 'file', language: '*' }, {
      provideCompletionItems: async (document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken): Promise<vscode.CompletionItem[]> => {
        let start = Date.now()
        let elmJson = SharedLogic.findElmJsonFor(globalState, document.uri)

        if (elmJson) {
          let line = document.lineAt(position)
          let range = new vscode.Range(line.range.start, position)
          let textBeforeCursor = document.getText(range)

          let lookup: Record<ModuleName, vscode.CompletionItem[]> = {}

          for (let dependency of elmJson.dependencies) {
            for (let moduleDoc of dependency.docs) {
              lookup[moduleDoc.name] = [
                ...moduleDoc.aliases.map(toAliasCompletionItem(dependency)),
                ...moduleDoc.binops.map(toBinopCompletionItem(dependency)),
                ...moduleDoc.unions.map(toUnionCompletionItem(dependency)),
                ...moduleDoc.values.map(toValueCompletionItem(dependency)),
              ]
            }
          }

          let aliasMap = getAliasesForCurrentFile(document)
          for (let [alias, moduleNames] of Object.entries(aliasMap)) {
            for (let moduleName of moduleNames) {
              lookup[alias] = lookup[moduleName] || []
            }
          }

          let moduleNamesSortedByDescendingLength: ModuleName[] =
            Object.keys(lookup).sort(descendingLength)

          for (let moduleName of moduleNamesSortedByDescendingLength) {
            let value = lookup[moduleName] || []
            if (textBeforeCursor.endsWith(`${moduleName}.`)) {
              console.info(`autocomplete`, `${Date.now() - start}ms`)
              return value
            }
          }

        }

        // return an empty array if the suggestions are not applicable
        console.info(`autocomplete`, `${Date.now() - start}ms`)
        return []
      }
    }, '.')
  )
}

const toAliasCompletionItem = (dependency: Dependency) => (alias: Alias): vscode.CompletionItem => ({
  label: {
    label: alias.name,
    description: dependency.packageUserAndName
  },
  kind: vscode.CompletionItemKind.Struct,
  documentation: new vscode.MarkdownString(alias.comment)
})

const toBinopCompletionItem = (dependency: Dependency) => (binop: BinOp): vscode.CompletionItem => ({
  label: {
    label: binop.name,
    description: dependency.packageUserAndName,
    detail: simplifyAnnotation(binop.type)
  },
  kind: vscode.CompletionItemKind.Operator,
  documentation: new vscode.MarkdownString(binop.comment)
})

const toUnionCompletionItem = (dependency: Dependency) => (union: Union): vscode.CompletionItem => ({
  label: {
    label: union.name,
    description: dependency.packageUserAndName
  },
  kind: vscode.CompletionItemKind.TypeParameter,
  documentation: new vscode.MarkdownString(union.comment)
})


const toValueCompletionItem = (dependency: Dependency) => (value: Value): vscode.CompletionItem => ({
  label: {
    label: value.name,
    description: dependency.packageUserAndName,
    detail: simplifyAnnotation(value.type)
  },
  kind: vscode.CompletionItemKind.Function,
  documentation: new vscode.MarkdownString(value.comment)
})

const descendingLength = (a: string, b: string): number =>
  b.length - a.length

const simplifyAnnotation = (type: string): string => {
  let simplifiedAnnotation =
    type.replace(/(\b[A-Za-z]+\.)+/g, "")

  return ` : ${simplifiedAnnotation}`
}

type ModuleName = string

// 
// This scans the file with a regex, so we can still provide
// a good autocomplete experience, even for incomplete Elm files.
// 
const getAliasesForCurrentFile = (document: vscode.TextDocument): Record<string, ModuleName[]> => {
  let code = document.getText()

  // Start with the two aliases implicitly included
  // in every Elm file:
  let alias: Record<string, string[]> = {
    Cmd: ['Platform.Cmd'],
    Sub: ['Platform.Sub'],
  }

  // Regular expression to match import statements
  let importRegex = /import\s([\w\.]+)(\sas\s(\w+))?/g

  let match;
  while ((match = importRegex.exec(code)) !== null) {
    let moduleName = match[1]
    let aliasName = match[3]
    if (moduleName && aliasName) {
      alias[aliasName] = alias[aliasName] || []
      alias[aliasName]?.push(moduleName)
    }
  }
  return alias
}