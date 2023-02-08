import path = require('path')
import * as vscode from 'vscode'
import { Alias, BinOp, Dependency, ElmJsonFile, ModuleDoc, Union, Value } from './shared/elm-json-file'
import SharedLogic, { Feature } from './shared/logic'
import * as ElmToAst from './elm-to-ast'
import * as ElmSyntax from './elm-to-ast/elm-syntax'

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

          let regex = /((?:[A-Z][_A-Za-z]+\.)+)$/
          let match = textBeforeCursor.match(regex)

          if (match) {
            let moduleNameTheUserTyped = match[0].slice(0, -1)
            let packages: Record<ModuleName, vscode.CompletionItem[]> = {}

            let elmStuffFolder = path.join(elmJson.projectFolder, 'elm-stuff', '0.19.1')
            let elmiFilepaths = await vscode.workspace.fs.readDirectory(vscode.Uri.file(elmStuffFolder))

            // Get a list of all local project modules starting with that name
            let allModuleNames : string[] = []
            for (let [filename] of elmiFilepaths) {
              if (filename.endsWith('.elmi')) {
                let dashSeparated = filename.slice(0, -'.elmi'.length)
                let moduleName = dashSeparated.split('-').join('.')
                if (moduleName.startsWith(moduleNameTheUserTyped)) {
                  allModuleNames.push(moduleName)
                }
              }
            }

            // Include all the package module names
            let packageModuleDocs : [ModuleDoc, Dependency][] = []
            for (let dependency of elmJson.dependencies) {
              for (let moduleDoc of dependency.docs) {
                if (moduleDoc.name.startsWith(moduleNameTheUserTyped)) {
                  packageModuleDocs.push([moduleDoc, dependency])
                  allModuleNames.push(moduleDoc.name)
                }
              }
            }

            for (let [moduleDoc, dependency] of packageModuleDocs) {
              packages[moduleDoc.name] = toCompletionItems(
                moduleDoc,
                allModuleNames,
                dependency.packageUserAndName
              )
            }

            let aliasMap = getAliasesForCurrentFile(document)
            for (let [alias, moduleNames] of Object.entries(aliasMap)) {
              for (let moduleName of moduleNames) {
                packages[alias] = packages[moduleName] || []
              }
            }

            let matchingAliasedModules = aliasMap[moduleNameTheUserTyped]
            let moduleName = matchingAliasedModules && matchingAliasedModules[0] || moduleNameTheUserTyped

            let value = packages[moduleName]

            if (value) {
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

  let areCasesExposed = (unionName: string) : boolean => {
    if (moduleDefinition.exposingList.value.type === 'all') {
      return true
    } else {
      moduleDefinition.exposingList.value.explicit.find(node => {
        if (node.value.type === 'typeexpose') {
          if (node.value.typeexpose.name === unionName) {
            return true
          }
        }
      })
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
          // TODO: Need a faster elmi-to-json for type inference
          type: ''
        }
        values.push(value)
      } else if (ElmSyntax.isTypeAliasDeclaration(declarationNode)) {
        let alias: Alias = {
          name: declarationNode.value.typeAlias.name.value,
          comment: declarationNode.value.typeAlias.documentation?.value || '',
          args: declarationNode.value.typeAlias.generics.map(node => node.value),
          // TODO: Need a faster elmi-to-json for type inference
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
  let subModules = Object.keys(
    allModuleNames
      .filter(name => name.startsWith(moduleDoc.name))
      .reduce((obj : Record<string, boolean>, name : string) => {
        let partAfterThisModule = name.slice(moduleDoc.name.length + 1).split('.')
        if (partAfterThisModule[0]) {
          obj[partAfterThisModule[0]] = true
        }
        return obj
      }, {})
  )
  return [
    ...subModules.map(toNamespaceCompletionItem(packageUserAndName)),
    ...moduleDoc.aliases.map(toAliasCompletionItem(packageUserAndName)),
    ...moduleDoc.unions.flatMap(toUnionCompletionItems(packageUserAndName)),
    ...moduleDoc.values.map(toValueCompletionItem(packageUserAndName)),
  ]
}

const toNamespaceCompletionItem = (packageUserAndName?: string) => (moduleName : string) : vscode.CompletionItem => ({
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
  let typeCompletionItem : vscode.CompletionItem = {
    label: {
      label: unionName,
      description: packageUserAndName
    },
    kind: vscode.CompletionItemKind.TypeParameter,
    documentation: new vscode.MarkdownString(union.comment)
  }
  let exposedConstructors : vscode.CompletionItem[] =
    union.cases.map(([name, args]) => ({
      label: {
        label: name,
        description: packageUserAndName,
        detail: simplifyAnnotation([...args, unionName].join(' -> ')),
      },
      kind: vscode.CompletionItemKind.Constructor,
      documentation: new vscode.MarkdownString(union.comment)
    }))
  
  return [ typeCompletionItem ].concat(exposedConstructors)
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