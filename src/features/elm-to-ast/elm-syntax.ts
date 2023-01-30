/**
 * The JSON AST encoded by the `stil4m/elm-syntax` package:
 * 
 * https://package.elm-lang.org/packages/stil4m/elm-syntax/7.2.9
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
  = { type: 'function', function: Function_ }
  | { type: 'typeAlias', typeAlias: TypeAlias }
  | { type: 'typedecl', typedecl: TypeDecl }
  | { type: 'port', port: Signature }
  | { type: 'infix', infix: Infix }
  | { type: 'destructuring', destructuring: Destructuring }

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
  updates: Node<Expression>[]
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