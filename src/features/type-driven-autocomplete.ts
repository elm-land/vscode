import path = require('path')
import * as vscode from 'vscode'
import { Alias, BinOp, Dependency, ElmJsonFile, getDocumentationForElmPackage, ModuleDoc, Union, Value } from './shared/elm-json-file'
import SharedLogic, { Feature } from './shared/logic'
import * as ElmToAst from './shared/elm-to-ast'
import * as ElmSyntax from './shared/elm-to-ast/elm-syntax'

export const feature: Feature = ({ globalState, context }) => {
  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider({ scheme: 'file', language: '*' }, {
      provideCompletionItems: async (document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken): Promise<vscode.CompletionItem[]> => {
        // Allow user to disable this feature
        const isEnabled: boolean = vscode.workspace.getConfiguration('elmLand').feature.autocomplete
        if (!isEnabled) return []

        let start = Date.now()
        let elmJson = SharedLogic.findElmJsonFor(globalState, document.uri)

        if (elmJson) {
          let line = document.lineAt(position)
          let range = new vscode.Range(line.range.start, position)
          let textBeforeCursor = document.getText(range)

          let match = textBeforeCursor.match(autocompleteRegex)

          if (match) {
            let packages = new Map<ModuleName, vscode.CompletionItem[]>()
            let moduleNameTheUserTyped = match[0].slice(0, -1)

            let aliasMap = getAliasesForCurrentFile(document)
            for (let [alias, moduleNames] of Object.entries(aliasMap)) {
              for (let moduleName of moduleNames) {
                packages.set(alias, packages.get(moduleName) ?? [])
              }
            }

            let matchingAliasedModules = aliasMap.get(moduleNameTheUserTyped)
            let moduleName = matchingAliasedModules?.[0] ?? moduleNameTheUserTyped

            let elmStuffFolder = path.join(elmJson.projectFolder, 'elm-stuff', '0.19.1')
            let elmiFilepaths = await vscode.workspace.fs.readDirectory(vscode.Uri.file(elmStuffFolder))

            // Get a list of all local project modules starting with that name
            let allModuleNames: string[] = []
            for (let [filename] of elmiFilepaths) {
              if (filename.endsWith('.elmi')) {
                let dashSeparated = filename.slice(0, -'.elmi'.length)
                let elmiModuleName = dashSeparated.split('-').join('.')
                if (elmiModuleName.startsWith(moduleName)) {
                  allModuleNames.push(elmiModuleName)
                }
              }
            }

            // Include all the package module names
            let packageModuleDocs: [ModuleDoc, Dependency][] = []
            for (let dependency of elmJson.dependencies) {
              let docs = await getDocumentationForElmPackage(globalState, dependency.fsPath)
              for (let moduleDoc of docs) {
                if (moduleDoc.name.startsWith(moduleName)) {
                  packageModuleDocs.push([moduleDoc, dependency])
                  allModuleNames.push(moduleDoc.name)
                }
              }
            }

            for (let [moduleDoc, dependency] of packageModuleDocs) {
              packages.set(moduleDoc.name, toCompletionItems(
                moduleDoc,
                allModuleNames,
                dependency.packageUserAndName
              ))
            }

            let value = packages.get(moduleName)

            if (value !== undefined) {
              console.info(`autocomplete`, `${Date.now() - start}ms`)
              return value
            }

            let elmJsonFile = SharedLogic.findElmJsonFor(globalState, document.uri)

            if (elmJsonFile) {
              let moduleDoc = await findLocalElmModuleDoc({ elmJsonFile, moduleName })
              if (moduleDoc) {
                console.info(`autocomplete`, `${Date.now() - start}ms`)
                return toCompletionItems(moduleDoc, allModuleNames)
              }
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


// SCANNING LOCAL PROJECT FILES

const findLocalElmModuleDoc =
  async ({ elmJsonFile, moduleName }: { elmJsonFile: ElmJsonFile, moduleName: string }): Promise<ModuleDoc | undefined> => {

    let matchingFilepaths = await SharedLogic.keepFilesThatExist(elmJsonFile.sourceDirectories
      .map(folder => path.join(folder, ...moduleName.split('.')) + '.elm'))

    let matchingFilepath = matchingFilepaths[0]

    if (matchingFilepath) {
      let uri = vscode.Uri.file(matchingFilepath)
      let document = await vscode.workspace.openTextDocument(uri)
      if (document) {
        let ast = await ElmToAst.run(document.getText())
        if (ast) {
          return toModuleDoc(ast)
        }
      }
    }

    return undefined
  }

const toModuleDoc = (ast: ElmSyntax.Ast): ModuleDoc => {
  let moduleDefinition = ElmSyntax.toModuleData(ast)

  let exposedDeclarations = moduleDefinition.exposingList.value.type === 'explicit'
    ? moduleDefinition.exposingList.value.explicit.map(node => ElmSyntax.toTopLevelExposeName(node.value))
    : []

  let isDeclarationExposed = (declarationNode: ElmSyntax.Node<ElmSyntax.Declaration>) => {
    if (moduleDefinition.exposingList.value.type === 'all') {
      return true
    } else {
      let declarationName = ElmSyntax.toDeclarationName(declarationNode)
      if (declarationName) {
        return exposedDeclarations.includes(declarationName)
      } else {
        return false
      }
    }
  }

  let areCasesExposed = (unionName: string): boolean => {
    if (moduleDefinition.exposingList.value.type === 'all') {
      return true
    } else {
      let match = moduleDefinition.exposingList.value.explicit.find(node => {
        if (node.value.type === 'typeexpose') {
          if (node.value.typeexpose.name === unionName) {
            return true
          }
        }
      })
      if (match) {
        return true
      }
    }
    return false
  }


  let aliases: Alias[] = []
  let unions: Union[] = []
  let values: Value[] = []
  let binops: BinOp[] = []

  for (let declarationNode of ast.declarations) {
    if (isDeclarationExposed(declarationNode)) {
      if (ElmSyntax.isFunctionDeclaration(declarationNode)) {
        let value: Value = {
          name: declarationNode.value.function.declaration.value.name.value,
          comment: declarationNode.value.function.documentation?.value || '',
          type: declarationNode.value.function.signature?.value.typeAnnotation
            ? ElmSyntax.fromTypeAnnotationToString(declarationNode.value.function.signature?.value.typeAnnotation)
            : ''
        }
        values.push(value)
      } else if (ElmSyntax.isTypeAliasDeclaration(declarationNode)) {
        let alias: Alias = {
          name: declarationNode.value.typeAlias.name.value,
          comment: declarationNode.value.typeAlias.documentation?.value || '',
          args: declarationNode.value.typeAlias.generics.map(node => node.value),
          type: ''
        }
        aliases.push(alias)
      } else if (ElmSyntax.isCustomTypeDeclaration(declarationNode)) {
        let shouldExposeVariants = areCasesExposed(declarationNode.value.typedecl.name.value)
        let union: Union = {
          name: declarationNode.value.typedecl.name.value,
          comment: declarationNode.value.typedecl.documentation?.value || '',
          args: declarationNode.value.typedecl.generics.map(node => node.value),
          cases: shouldExposeVariants
            ? declarationNode.value.typedecl.constructors.map(node => [
              node.value.name.value,
              node.value.arguments.map(ElmSyntax.fromTypeAnnotationToString)
            ])
            : []
        }
        unions.push(union)
      }
    }
  }

  return {
    name: moduleDefinition.moduleName.value.join('.'),
    comment: '',
    aliases,
    unions,
    values,
    binops
  }
}


// COMPLETION ITEMS

const toCompletionItems = (moduleDoc: ModuleDoc, allModuleNames: string[], packageUserAndName?: string): vscode.CompletionItem[] => {
  const modulePrefix = `${moduleDoc.name}.`
  const subModules = new Set<string>()

  for (const moduleName of allModuleNames) {
    if (moduleName.startsWith(modulePrefix)) {
      const partAfterThisModule = moduleName.slice(modulePrefix.length).split('.')[0]
      if (partAfterThisModule !== undefined) {
        subModules.add(partAfterThisModule)
      }
    }
  }

  return [
    ...Array.from(subModules, toNamespaceCompletionItem(packageUserAndName)),
    ...moduleDoc.aliases.map(toAliasCompletionItem(packageUserAndName)),
    ...moduleDoc.unions.flatMap(toUnionCompletionItems(packageUserAndName)),
    ...moduleDoc.values.map(toValueCompletionItem(packageUserAndName)),
  ]
}

const toNamespaceCompletionItem = (packageUserAndName?: string) => (moduleName: string): vscode.CompletionItem => ({
  label: {
    label: moduleName,
    description: packageUserAndName
  },
  kind: vscode.CompletionItemKind.Module
})

const toAliasCompletionItem = (packageUserAndName?: string) => (alias: Alias): vscode.CompletionItem => ({
  label: {
    label: alias.name,
    description: packageUserAndName
  },
  kind: vscode.CompletionItemKind.Struct,
  documentation: new vscode.MarkdownString(alias.comment)
})

const toBinopCompletionItem = (packageUserAndName?: string) => (binop: BinOp): vscode.CompletionItem => ({
  label: {
    label: binop.name,
    description: packageUserAndName,
    detail: simplifyAnnotation(binop.type)
  },
  kind: vscode.CompletionItemKind.Operator,
  documentation: new vscode.MarkdownString(binop.comment)
})

const toUnionCompletionItems = (packageUserAndName?: string) => (union: Union): vscode.CompletionItem[] => {
  let unionName = [union.name, ...union.args].join(' ')
  let typeCompletionItem: vscode.CompletionItem = {
    label: {
      label: unionName,
      description: packageUserAndName
    },
    kind: vscode.CompletionItemKind.TypeParameter,
    documentation: new vscode.MarkdownString(union.comment)
  }
  let exposedConstructors: vscode.CompletionItem[] =
    union.cases.map(([name, args]) => ({
      label: {
        label: name,
        description: packageUserAndName,
        detail: simplifyAnnotation([...args, unionName].join(' -> ')),
      },
      kind: vscode.CompletionItemKind.Constructor,
      documentation: new vscode.MarkdownString(union.comment)
    }))

  return [typeCompletionItem].concat(exposedConstructors)
}


const toValueCompletionItem = (packageUserAndName?: string) => (value: Value): vscode.CompletionItem => ({
  label: {
    label: value.name,
    description: packageUserAndName,
    detail: simplifyAnnotation(value.type)
  },
  kind: vscode.CompletionItemKind.Function,
  documentation: new vscode.MarkdownString(value.comment)
})

const simplifyAnnotation = (type: string): string => {
  if (!type) return ''

  const simplifiedAnnotation =
    type.replace(moduleQualifierRegex, "")

  return ` : ${simplifiedAnnotation}`
}

type ModuleName = string

// Parts for these regexes are taken from here: https://github.com/rtfeldman/node-test-runner/blob/eedf853fc9b45afd73a0db72decebdb856a69771/lib/Parser.js#L234
//
// Regular expression to match import statements.
// Note: This might match inside multiline comments and multiline strings.
const importRegex = /^import\s+(\p{Lu}[_\d\p{L}]*(?:\.\p{Lu}[_\d\p{L}]*)*)(?:\s+as\s+(\p{Lu}[_\d\p{L}]*))?/gmu
// Regular expression to match the `Module.Name.` part of `Module.Name.function`.
const moduleQualifierRegex = /(\b\p{Lu}[_\d\p{L}]*\.)+/gu
// Regular expression to match `Module.Name.` before the cursor, for triggering autocomplete.
const autocompleteRegex = /(?:\p{Lu}[_\d\p{L}]*\.)+$/u

// 
// This scans the file with a regex, so we can still provide
// a good autocomplete experience, even for incomplete Elm files.
// 
const getAliasesForCurrentFile = (document: vscode.TextDocument): Map<string, ModuleName[]> => {
  let code = document.getText()

  // Start with the two aliases implicitly included
  // in every Elm file:
  let alias = new Map<string, string[]>([
    ['Cmd', ['Platform.Cmd']],
    ['Sub', ['Platform.Sub']],
  ])

  for (const match of code.matchAll(importRegex)) {
    const [, moduleName, aliasName] = match
    if (moduleName !== undefined && aliasName !== undefined) {
      const previous = alias.get(aliasName)
      if (previous === undefined) {
        alias.set(aliasName, [moduleName])
      } else {
        previous.push(moduleName)
      }
    }
  }
  return alias
}