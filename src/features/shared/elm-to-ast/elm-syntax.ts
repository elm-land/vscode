/**
 * The JSON AST encoded by the `stil4m/elm-syntax` package:
 * 
 * https://package.elm-lang.org/packages/stil4m/elm-syntax/7.3.4
 * 
 */

// 
// AST
// 
export type Ast = {
  comments: Node<string>[]
  moduleDefinition: Node<Module>
  imports: Node<Import>[]
  declarations: Node<Declaration>[]
}

export type Node<value> = {
  range: Range
  value: value
}

export type Range = [number, number, number, number]

// 
// Module definition
// 
export type Module
  = { type: 'normal', normal: ModuleData }
  | { type: 'port', port: ModuleData }
  | { type: 'effect', effect: EffectModuleData }

export type ModuleData = {
  moduleName: Node<string[]>
  exposingList: Node<Exposing>
}

export type EffectModuleData = {
  moduleName: Node<string[]>
  exposingList: Node<Exposing>
  command: Node<string> | null
  subscription: Node<string> | null
}

// 
// Imports
// 
export type Import = {
  moduleName: Node<string[]>
  moduleAlias: Node<string[]> | null
  exposingList: Node<Exposing> | null
}

export type Exposing
  = { type: 'explicit', explicit: Node<TopLevelExpose>[] }
  | { type: 'all', range: Range }

export type TopLevelExpose
  = { type: 'typeOrAlias', typeOrAlias: { name: string } }
  | { type: 'typeexpose', typeexpose: { name: string, open: Range } }
  | { type: 'function', function: { name: string } }
  | { type: 'infix', infix: { name: string } }

// 
// Declarations
// 
export type Declaration
  = LetDeclarationExpression
  | { type: 'typeAlias', typeAlias: TypeAlias }
  | { type: 'typedecl', typedecl: TypeDecl }
  | { type: 'port', port: Signature }
  | { type: 'infix', infix: Infix }

export type Function_ = {
  documentation: Node<Documentation> | null
  signature: Node<Signature> | null
  declaration: Node<FunctionDeclaration>
}

export type Documentation = string

export type Signature = {
  name: Node<string>
  typeAnnotation: Node<TypeAnnotation>
}

export type TypeAnnotation
  = { type: 'generic', generic: { value: string } }
  | { type: 'typed', typed: TypedTypeAnnotation }
  | { type: 'unit', unit: {} }
  | { type: 'tupled', tupled: TupledAnnotation }
  | { type: 'function', function: FunctionTypeAnnotation }
  | { type: 'record', record: RecordAnnotation }
  | { type: 'genericRecord', genericRecord: GenericRecordAnnotation }

export type TypedTypeAnnotation = {
  moduleNameAndName: Node<ModuleNameAndName>
  args: Node<TypeAnnotation>[]
}

export type FunctionTypeAnnotation = {
  left: Node<TypeAnnotation>
  right: Node<TypeAnnotation>
}

export type TupledAnnotation = {
  values: Node<TypeAnnotation>[]
}

export type RecordAnnotation = {
  value: Node<RecordFieldAnnotation>[]
}

export type GenericRecordAnnotation = {
  name: Node<string>
  values: Node<Node<RecordFieldAnnotation>[]>
}

export type RecordFieldAnnotation = {
  name: Node<string>
  typeAnnotation: Node<TypeAnnotation>
}

export type ModuleNameAndName = {
  moduleName: string[]
  name: string
}

export type FunctionDeclaration = {
  name: Node<string>
  arguments: Node<Pattern>[]
  expression: Node<Expression>
}

export type Pattern
  = { type: 'all', all: {} }
  | { type: 'unit', unit: {} }
  | { type: 'char', char: { value: string } }
  | { type: 'string', string: { value: string } }
  | { type: 'hex', hex: { value: number } }
  | { type: 'int', int: { value: number } }
  | { type: 'float', float: { value: number } }
  | { type: 'tuple', tuple: { value: Node<Pattern>[] } }
  | { type: 'record', record: { value: Node<string>[] } }
  | { type: 'uncons', uncons: UnconsPattern }
  | { type: 'list', list: { value: Node<Pattern>[] } }
  | { type: 'var', var: { value: string } }
  | { type: 'named', named: NamedPattern }
  | { type: 'as', as: AsPattern }
  | { type: 'parentisized', parentisized: { value: Node<Pattern> } }

export type UnconsPattern = {
  left: Node<Pattern>
  right: Node<Pattern>
}

export type NamedPattern = {
  qualified: ModuleNameAndName
  patterns: Node<Pattern>[]
}

export type AsPattern = {
  name: Node<string>
  pattern: Node<Pattern>
}

export type TypeAlias = {
  documentation: Node<Documentation> | null
  name: Node<string>
  generics: Node<string>[]
  typeAnnotation: Node<TypeAnnotation>
}

export type TypeDecl = {
  documentation: Node<Documentation> | null
  name: Node<string>
  generics: Node<string>[]
  constructors: Node<TypeConstructor>[]
}

export type TypeConstructor = {
  name: Node<string>
  arguments: Node<TypeAnnotation>[]
}

export type Infix = {
  direction: Node<InfixDirection>
  precedence: Node<number>
  operator: Node<string>
  function: Node<string>
}

export type InfixDirection = 'left' | 'right' | 'non'

export type Destructuring = {
  pattern: Node<Pattern>
  expression: Node<Expression>
}

export type Expression
  = { type: 'unit', unit: null }
  | { type: 'application', application: Node<Expression>[] }
  | { type: 'operatorapplication', operatorapplication: OperatorApplication }
  | { type: 'functionOrValue', functionOrValue: FunctionOrValueExpression }
  | { type: 'ifBlock', ifBlock: IfBlockExpression }
  | { type: 'prefixoperator', prefixoperator: string }
  | { type: 'operator', operator: string }
  | { type: 'hex', hex: number }
  | { type: 'integer', integer: number }
  | { type: 'float', float: number }
  | { type: 'negation', negation: Node<Expression> }
  | { type: 'literal', literal: string }
  | { type: 'charLiteral', charLiteral: string }
  | { type: 'tupled', tupled: Node<Expression>[] }
  | { type: 'list', list: Node<Expression>[] }
  | { type: 'parenthesized', parenthesized: Node<Expression> }
  | { type: 'let', let: LetBlockExpression }
  | { type: 'case', case: CaseBlockExpression }
  | { type: 'lambda', lambda: LambdaExpression }
  | { type: 'recordAccess', recordAccess: RecordAccessExpression }
  | { type: 'recordAccessFunction', recordAccessFunction: string }
  | { type: 'record', record: Node<RecordSetterExpression>[] }
  | { type: 'recordUpdate', recordUpdate: RecordUpdateExpression }
  | { type: 'glsl', glsl: string }

export type OperatorApplication = {
  operator: string
  direction: InfixDirection
  left: Node<Expression>
  right: Node<Expression>
}

export type FunctionOrValueExpression = {
  moduleName: string[]
  name: string
}

export type IfBlockExpression = {
  clause: Node<Expression>
  then: Node<Expression>
  else: Node<Expression>
}

export type LetBlockExpression = {
  declarations: Node<LetDeclarationExpression>[]
  expression: Node<Expression>
}

export type LetDeclarationExpression
  = { type: 'function', function: Function_ }
  | { type: 'destructuring', destructuring: Destructuring }

export type CaseBlockExpression = {
  cases: Case[]
  expression: Node<Expression>
}

export type Case = {
  pattern: Node<Pattern>
  expression: Node<Expression>
}

export type LambdaExpression = {
  patterns: Node<Pattern>[]
  expression: Node<Expression>
}

export type RecordAccessExpression = {
  name: Node<string>
  expression: Node<Expression>
}

export type RecordSetterExpression = {
  field: Node<string>
  expression: Node<Expression>
}

export type RecordUpdateExpression = {
  name: Node<string>
  updates: Node<RecordSetterExpression>[]
}


export const toModuleData = (ast: Ast): ModuleData => {
  let type = ast.moduleDefinition.value.type
  return (ast.moduleDefinition.value as any)[type]
}

export const toModuleName = (ast: Ast): string => {
  return toModuleData(ast).moduleName.value.join('.')
}

export const toTopLevelExposeName = (exposing: TopLevelExpose): string => {
  let type = exposing.type
  return (exposing as any)[type].name
}

export const toDeclarationName = (declaration: Node<Declaration>): string | null => {
  switch (declaration.value.type) {
    case 'typedecl':
      return declaration.value.typedecl.name.value
    case 'function':
      return declaration.value.function.declaration.value.name.value
    case 'typeAlias':
      return declaration.value.typeAlias.name.value
    case 'port':
      return declaration.value.port.name.value
    case 'destructuring':
      return null
    case 'infix':
      return null
  }
}

export const findDeclarationWithName = (ast: Ast, name: string): Node<Declaration> | undefined => {
  for (let declaration of ast.declarations) {
    let declarationName = toDeclarationName(declaration)
    if (declarationName === name) {
      return declaration
    }
  }
}

export const getNameFromModuleNameAndName = (moduleNameAndName: Node<ModuleNameAndName>): string => {
  return [
    ...moduleNameAndName.value.moduleName,
    moduleNameAndName.value.name
  ].join('.')
}

export const findCustomTypeVariantWithName = (ast: Ast, name: string): Node<TypeConstructor> | undefined => {
  for (let declaration of ast.declarations) {
    if (declaration.value.type === 'typedecl') {
      let customTypeVariants = declaration.value.typedecl.constructors
      for (let variant of customTypeVariants) {
        if (variant.value.name.value === name) {
          return variant
        }
      }
    }
  }
}

export const isFunctionDeclaration =
  (declaration: Node<Declaration>)
    : declaration is Node<{
      type: 'function',
      function: Function_
    }> =>
    declaration.value.type === 'function'

export const isTypeAliasDeclaration =
  (declaration: Node<Declaration>)
    : declaration is Node<{
      type: 'typeAlias';
      typeAlias: TypeAlias;
    }> =>
    declaration.value.type === 'typeAlias'

export const isCustomTypeDeclaration =
  (declaration: Node<Declaration>)
    : declaration is Node<{
      type: 'typedecl';
      typedecl: TypeDecl;
    }> =>
    declaration.value.type === 'typedecl'

export type ModuleImportTracker = {
  findImportedModuleNamesThatMightHaveExposedThisValue: (typeOrValueName: string) => string[]
  findImportedModuleNamesForQualifiedValue: (moduleName: string) => string[]
}

const toMap = <V>(record: Record<string, V>): Map<string, V> =>
  new Map(Object.entries(record))

// Need to build up a collection of which types and values
// are being exposed by all imports.
// (This will be useful later when jumping to definitions)
// 
// This starts by accounting for the stuff implicitly imported in
// every Elm module:
// 
//    import Basics exposing (..)
//    import List exposing (List, (::))
//    import Maybe exposing (Maybe(..))
//    import Result exposing (Result(..))
//    import String exposing (String)
//    import Char exposing (Char)
//    import Tuple
//    import Debug
//    import Platform exposing ( Program )
//    import Platform.Cmd as Cmd exposing ( Cmd )
//    import Platform.Sub as Sub exposing ( Sub )
// 
type ImportAlias = string
type ExposedValue = string
type ModuleName = string
type InitialPreludeData = {
  explicitExposingValuesForImports: Map<ExposedValue, ModuleName[]>
  hasUnknownImportsFromExposingAll: ModuleName[]
  aliasMappingToModuleNames: Map<ImportAlias, ModuleName[]>
}
export let getInitialPreludeMappings = (): InitialPreludeData => ({
  explicitExposingValuesForImports: toMap({
    'List': ['List'],
    '(::)': ['List'],
    'Maybe': ['Maybe'],
    'Just': ['Maybe'],
    'Nothing': ['Maybe'],
    'Result': ['Result'],
    'Ok': ['Result'],
    'Err': ['Result'],
    'String': ['String'],
    'Char': ['Char'],
    'Program': ['Platform'],
    'Cmd': ['Platform.Cmd'],
    'Sub': ['Platform.Sub'],
  }),
  hasUnknownImportsFromExposingAll: ['Basics'],
  aliasMappingToModuleNames: toMap({
    'Cmd': ['Platform.Cmd'],
    'Sub': ['Platform.Sub']
  })
})

export const createModuleImportTracker = (ast: Ast): ModuleImportTracker => {
  let {
    aliasMappingToModuleNames,
    explicitExposingValuesForImports,
    hasUnknownImportsFromExposingAll
  } = getInitialPreludeMappings()
  // Keep track of module import `exposing` statements
  for (let import_ of ast.imports) {
    const moduleNameNode = import_.value.moduleName
    const moduleName = moduleNameNode.value.join('.')

    // Keep track of module import aliases
    if (import_.value.moduleAlias) {
      let alias = import_.value.moduleAlias.value[0]
      if (alias !== undefined) {
        const previous = aliasMappingToModuleNames.get(alias)
        if (previous === undefined) {
          aliasMappingToModuleNames.set(alias, [moduleName])
        } else {
          previous.push(moduleName)
        }
      }
    }

    if (import_.value.exposingList) {
      if (import_.value.exposingList.value.type === 'explicit') {
        let topLevelExposeNodes = import_.value.exposingList.value.explicit
        let isExposingAnyCustomVariants =
          topLevelExposeNodes
            .some(export_ => export_.value.type === 'typeexpose')

        let namesOfExportedThings =
          topLevelExposeNodes
            .map(node => toTopLevelExposeName(node.value))

        for (let exportedName of namesOfExportedThings) {
          const previous = explicitExposingValuesForImports.get(exportedName)
          if (previous === undefined) {
            explicitExposingValuesForImports.set(exportedName, [moduleName])
          } else {
            previous.push(moduleName)
          }
        }

        if (isExposingAnyCustomVariants) {
          hasUnknownImportsFromExposingAll.push(moduleName)
        }
      } else if (import_.value.exposingList.value.type === 'all') {
        hasUnknownImportsFromExposingAll.push(moduleName)
      }
    }
  }

  return {
    findImportedModuleNamesThatMightHaveExposedThisValue: (typeOrValueName: string): string[] => {
      let explicitMatches = explicitExposingValuesForImports.get(typeOrValueName) ?? []
      return explicitMatches.concat(hasUnknownImportsFromExposingAll)
    },
    findImportedModuleNamesForQualifiedValue: (moduleName: string): string[] => {
      let aliases = aliasMappingToModuleNames.get(moduleName) ?? []
      let moduleNamesToCheck = [moduleName].concat(aliases)
      return moduleNamesToCheck
    }
  }
}

export const fromTypeAnnotationToString = (node: Node<TypeAnnotation>): string => {
  switch (node.value.type) {
    case 'function':
      const leftSide =
        (node.value.function.left.value.type === 'function')
          ? '(' + fromTypeAnnotationToString(node.value.function.left) + ')'
          : fromTypeAnnotationToString(node.value.function.left)

      return `${leftSide} -> ${fromTypeAnnotationToString(node.value.function.right)}`
    case 'generic':
      return node.value.generic.value
    case 'genericRecord':
      let fields = node.value.genericRecord.values.value
      return fields.length === 0
        ? `{}`
        : `{ ${node.value.genericRecord.name.value} | ${fields.map(fromRecordFieldToString).join(', ')} }`
    case 'record':
      let recordFields = node.value.record.value
      return recordFields.length === 0
        ? `{}`
        : `{ ${recordFields.map(fromRecordFieldToString).join(', ')} }`
    case 'tupled':
      let tupledFields = node.value.tupled.values
      return tupledFields.length === 0
        ? '()'
        : `( ${tupledFields.map(fromTypeAnnotationToString).join(', ')} )`
    case 'typed':
      let typeArgs = node.value.typed.args.length === 0
        ? ''
        : ' ' + node.value.typed.args.map(fromTypeAnnotationToString).join(' ')
      return `${getNameFromModuleNameAndName(node.value.typed.moduleNameAndName)}${typeArgs}`
    case 'unit':
      return '()'
  }
}

const fromRecordFieldToString = (node: Node<RecordFieldAnnotation>): string => {
  return `${node.value.name.value} : ${fromTypeAnnotationToString(node.value.typeAnnotation)}`
}


// 
// Determine if a value is potentially being exposed by the current AST
// 
export const isExposedFromThisModule = (ast: Ast, typeOrValueName: string): boolean => {
  let data = toModuleData(ast)
  return isPotentiallyExposed(data.exposingList, typeOrValueName)
}

// 
// Determines if an imported value might be exposed by that import
// 
// For example:
//     
// 
export const isPotentiallyExposed = (node: Node<Exposing>, typeOrValueName: string): boolean => {
  let isPotentiallyExposedFromTopLevelExpose = (topLevelExposeNode: Node<TopLevelExpose>): boolean => {
    switch (topLevelExposeNode.value.type) {
      case 'function':
        return topLevelExposeNode.value.function.name === typeOrValueName
      case 'infix':
        return false
      case 'typeOrAlias':
        return topLevelExposeNode.value.typeOrAlias.name === typeOrValueName
      case 'typeexpose':
        return true
    }
  }
  switch (node.value.type) {
    case 'all':
      return true
    case 'explicit':
      return node.value.explicit.some(isPotentiallyExposedFromTopLevelExpose)
  }
}


// 
// Check if the declaration defines a local version of one of the `valueNames`
// 
export const isDefinedAgainByDeclaration = (valueName: string) => (node: Node<Declaration>): boolean => {
  let declarationName = toDeclarationName(node)
  if (declarationName) {
    return valueName === declarationName
  } else {
    return false
  }
}



// 
// Check if the pattern defines a local version of one of the `valueNames`
// 
export const isDefinedAgainByPattern = (valueName: string) => (node: Node<Pattern>): boolean => {
  switch (node.value.type) {
    case 'all':
      return false
    case 'as':
      return valueName === node.value.as.name.value
    case 'char':
      return false
    case 'float':
      return false
    case 'hex':
      return false
    case 'int':
      return false
    case 'list':
      return node.value.list.value.some(isDefinedAgainByPattern(valueName))
    case 'named':
      return false
    case 'parentisized':
      return isDefinedAgainByPattern(valueName)(node.value.parentisized.value)
    case 'record':
      return node.value.record.value.some(nameNode => valueName === nameNode.value)
    case 'string':
      return false
    case 'tuple':
      return node.value.tuple.value.some(isDefinedAgainByPattern(valueName))
    case 'uncons':
      return false
    case 'unit':
      return false
    case 'var':
      return valueName === node.value.var.value
  }
}


export const toPatternDefinitionNames = (node: Node<Pattern>): string[] => {
  switch (node.value.type) {
    case 'all':
      return []
    case 'as':
      return [node.value.as.name.value]
    case 'char':
      return []
    case 'float':
      return []
    case 'hex':
      return []
    case 'int':
      return []
    case 'list':
      return node.value.list.value.flatMap(toPatternDefinitionNames)
    case 'named':
      return []
    case 'parentisized':
      return toPatternDefinitionNames(node.value.parentisized.value)
    case 'record':
      return node.value.record.value.map(nameNode => nameNode.value)
    case 'string':
      return []
    case 'tuple':
      return node.value.tuple.value.flatMap(toPatternDefinitionNames)
    case 'uncons':
      return []
    case 'unit':
      return []
    case 'var':
      return [node.value.var.value]
  }
}
