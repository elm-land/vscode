import * as child_process from 'child_process'
import * as vscode from 'vscode'
import sharedLogic, { Feature } from './shared/logic'
import * as ElmToAst from './shared/elm-to-ast'
import * as ElmSyntax from './shared/elm-to-ast/elm-syntax'
import { GlobalState } from './shared/autodetect-elm-json'

const diagnostics = vscode.languages.createDiagnosticCollection('elmLandUnusedCode')

// Track in-flight cancellation tokens per document URI to cancel stale checks
const cancellationSources = new Map<string, vscode.CancellationTokenSource>()

export const feature: Feature = ({ globalState, context }) => {
  context.subscriptions.push(diagnostics)

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(editor => {
      for (const source of cancellationSources.values()) source.cancel()
      cancellationSources.clear()
      diagnostics.clear()
      if (editor) run(globalState, editor.document)
    })
  )
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument(document => {
      if (document === vscode.window.activeTextEditor?.document) {
        run(globalState, document)
      }
    })
  )
}

type UnusedCodeConfig = {
  exposedDeclarations: boolean
  exposedVariants: boolean
  localDeclarations: boolean
  letInExpressions: boolean
  arguments: boolean
  customTypeVariants: boolean
}

const getConfig = (): UnusedCodeConfig => {
  const raw = vscode.workspace.getConfiguration('elmLand').feature.unusedDeclarations ?? {}
  return {
    exposedDeclarations: raw.exposedDeclarations !== false,
    exposedVariants: raw.exposedVariants !== false,
    localDeclarations: raw.localDeclarations !== false,
    letInExpressions: raw.letInExpressions !== false,
    arguments: raw.arguments !== false,
    customTypeVariants: raw.customTypeVariants !== false,
  }
}

const run = async (globalState: GlobalState, document: vscode.TextDocument) => {
  const config = getConfig()
  const anyEnabled = Object.values(config).some(Boolean)
  if (!anyEnabled) {
    diagnostics.clear()
    return
  }

  if (!document.uri.fsPath.endsWith('.elm')) return

  const elmJsonFile = sharedLogic.findElmJsonFor(globalState, document.uri)
  if (!elmJsonFile) return

  const uriKey = document.uri.toString()
  const existing = cancellationSources.get(uriKey)
  if (existing) existing.cancel()
  const tokenSource = new vscode.CancellationTokenSource()
  cancellationSources.set(uriKey, tokenSource)
  const token = tokenSource.token

  const ast = await ElmToAst.run(document.getText(), token)
  if (!ast || token.isCancellationRequested) return

  const results: vscode.Diagnostic[] = []

  // AST-based checks (fast, no external tool needed).
  // usedNames is shared between the checks that need it to avoid walking the
  // AST twice.
  const needsUsedNames = config.localDeclarations || config.customTypeVariants
  const usedNames = needsUsedNames ? collectAllUsedNamesInFile(ast) : undefined

  if (config.localDeclarations) results.push(...checkLocalDeclarations(ast, usedNames!))
  if (config.letInExpressions) results.push(...checkUnusedLetBindings(ast))
  if (config.arguments) results.push(...checkUnusedArguments(ast))
  if (config.customTypeVariants) results.push(...checkUnusedVariants(ast, usedNames!))

  // elm-find based checks (project-wide, requires elm-find binary)
  if (config.exposedDeclarations || config.exposedVariants) {
    const moduleName = ElmSyntax.toModuleData(ast).moduleName.value.join('.')
    const elmFindBinary: string = vscode.workspace.getConfiguration('elmLand').elmFindFilepath || 'elm-find'
    const projectFolder = elmJsonFile.projectFolder

    if (config.exposedDeclarations) {
      const exposedResults = await checkExposedDeclarations(ast, moduleName, elmFindBinary, projectFolder, token)
      if (token.isCancellationRequested) return
      results.push(...exposedResults)
    }

    if (config.exposedVariants) {
      const variantResults = await checkExposedVariants(ast, moduleName, elmFindBinary, projectFolder, token)
      if (token.isCancellationRequested) return
      results.push(...variantResults)
    }
  }

  if (token.isCancellationRequested) return
  diagnostics.set(document.uri, results)
  cancellationSources.delete(uriKey)
}

// ─── 1. Exposed declarations (elm-find) ──────────────────────────────────────
//
// Uses elm-find to search the whole project for usages. Only runs for
// declarations that are actually in the module's exposing list.

const checkExposedDeclarations = async (
  ast: ElmSyntax.Ast,
  moduleName: string,
  binary: string,
  projectFolder: string,
  token: vscode.CancellationToken
): Promise<vscode.Diagnostic[]> => {
  const moduleData = ElmSyntax.toModuleData(ast)
  const isExposingAll = moduleData.exposingList.value.type === 'all'

  const results: vscode.Diagnostic[] = []
  for (const declaration of ast.declarations) {
    if (token.isCancellationRequested) return results

    const name = ElmSyntax.toDeclarationName(declaration)
    if (!name) continue
    if (declaration.value.type === 'port') continue
    if (name === 'main') continue
    if (!isExposingAll && !isExplicitlyExposed(ast, name)) continue

    const kind = getKindForDeclaration(declaration)
    if (!kind) continue

    const definitions = await runElmFind({ binary, name, kind, moduleName, projectFolder, token })
    if (!definitions || token.isCancellationRequested) return results

    const usageCount = definitions.flatMap(d => d.usages).filter(u => u.tag !== 'mention').length
    if (usageCount === 0) {
      const range = getDeclarationNameRange(declaration)
      results.push(new vscode.Diagnostic(range, `\`${name}\` is unused`, vscode.DiagnosticSeverity.Warning))
    }
  }
  return results
}

// ─── 2. Exposed custom type variants (elm-find) ──────────────────────────────
//
// For each custom type whose variants are exposed (either via `exposing (..)`
// or `exposing (MyType(..))`), runs elm-find with --kind ctor for each variant
// to check whether it has any usages across the whole project.

const checkExposedVariants = async (
  ast: ElmSyntax.Ast,
  moduleName: string,
  binary: string,
  projectFolder: string,
  token: vscode.CancellationToken
): Promise<vscode.Diagnostic[]> => {
  const moduleData = ElmSyntax.toModuleData(ast)

  const results: vscode.Diagnostic[] = []
  for (const declaration of ast.declarations) {
    if (token.isCancellationRequested) return results
    if (declaration.value.type !== 'typedecl') continue

    const typeName = declaration.value.typedecl.name.value
    if (!isTypeExposedWithVariants(moduleData.exposingList, typeName)) continue

    for (const variant of declaration.value.typedecl.constructors) {
      if (token.isCancellationRequested) return results

      const name = variant.value.name.value
      const definitions = await runElmFind({ binary, name, kind: 'ctor', moduleName, projectFolder, token })
      if (!definitions || token.isCancellationRequested) return results

      const usageCount = definitions.flatMap(d => d.usages).filter(u => u.tag !== 'mention').length
      if (usageCount === 0) {
        const range = sharedLogic.fromElmRange(variant.value.name.range)
        results.push(new vscode.Diagnostic(range, `\`${name}\` is an unused variant`, vscode.DiagnosticSeverity.Warning))
      }
    }
  }
  return results
}

// ─── 3. Local declarations (AST) ─────────────────────────────────────────────
//
// Top-level declarations not in the module's exposing list can only be used
// within the same file, so we check for references using just the AST.

const checkLocalDeclarations = (ast: ElmSyntax.Ast, usedNames: Set<string>): vscode.Diagnostic[] => {
  const moduleData = ElmSyntax.toModuleData(ast)

  // If the module exposes everything, all declarations are exposed —
  // elm-find handles those, nothing for us to check here.
  if (moduleData.exposingList.value.type === 'all') return []

  const results: vscode.Diagnostic[] = []
  for (const decl of ast.declarations) {
    const name = ElmSyntax.toDeclarationName(decl)
    if (!name) continue
    if (decl.value.type === 'port') continue
    if (name === 'main') continue
    if (isExplicitlyExposed(ast, name)) continue

    // For custom types, consider them used if any of their constructors are used
    if (decl.value.type === 'typedecl') {
      const anyConstructorUsed = decl.value.typedecl.constructors.some(
        ctor => usedNames.has(ctor.value.name.value)
      )
      if (usedNames.has(name) || anyConstructorUsed) continue
    } else if (usedNames.has(name)) {
      continue
    }

    const range = getDeclarationNameRange(decl)
    results.push(new vscode.Diagnostic(range, `\`${name}\` is unused`, vscode.DiagnosticSeverity.Warning))
  }
  return results
}

// ─── 4. Unused let-in bindings (AST) ─────────────────────────────────────────
//
// A let binding is unused if its name never appears in the rest of the
// let block (other bindings or the body expression).

const checkUnusedLetBindings = (ast: ElmSyntax.Ast): vscode.Diagnostic[] => {
  const results: vscode.Diagnostic[] = []
  for (const decl of ast.declarations) {
    if (decl.value.type === 'function') {
      walkExpressionForLetBindings(decl.value.function.declaration.value.expression, results)
    }
  }
  return results
}

const walkExpressionForLetBindings = (
  expr: ElmSyntax.Node<ElmSyntax.Expression>,
  results: vscode.Diagnostic[]
): void => {
  switch (expr.value.type) {
    case 'let': {
      const letBlock = expr.value.let

      // Collect all names used anywhere in this let block (all binding
      // expressions + the body). A binding is unused if its name is absent.
      const usedInBlock = new Set<string>()
      for (const letDecl of letBlock.declarations) {
        const declExpr = letDecl.value.type === 'function'
          ? letDecl.value.function.declaration.value.expression
          : letDecl.value.destructuring.expression
        collectNamesUsedInExpression(declExpr, usedInBlock)
      }
      collectNamesUsedInExpression(letBlock.expression, usedInBlock)

      for (const letDecl of letBlock.declarations) {
        if (letDecl.value.type === 'function') {
          const name = letDecl.value.function.declaration.value.name.value
          if (!name.startsWith('_') && !usedInBlock.has(name)) {
            const range = sharedLogic.fromElmRange(letDecl.value.function.declaration.value.name.range)
            results.push(new vscode.Diagnostic(range, `\`${name}\` is unused`, vscode.DiagnosticSeverity.Warning))
          }
          walkExpressionForLetBindings(letDecl.value.function.declaration.value.expression, results)
        } else {
          // Destructuring: check each bound variable in the pattern
          checkUnusedPatternVars(letDecl.value.destructuring.pattern, usedInBlock, results)
          walkExpressionForLetBindings(letDecl.value.destructuring.expression, results)
        }
      }
      walkExpressionForLetBindings(letBlock.expression, results)
      return
    }
    case 'application':
      expr.value.application.forEach(e => walkExpressionForLetBindings(e, results))
      return
    case 'operatorapplication':
      walkExpressionForLetBindings(expr.value.operatorapplication.left, results)
      walkExpressionForLetBindings(expr.value.operatorapplication.right, results)
      return
    case 'ifBlock':
      walkExpressionForLetBindings(expr.value.ifBlock.clause, results)
      walkExpressionForLetBindings(expr.value.ifBlock.then, results)
      walkExpressionForLetBindings(expr.value.ifBlock.else, results)
      return
    case 'negation':
      walkExpressionForLetBindings(expr.value.negation, results)
      return
    case 'tupled':
      expr.value.tupled.forEach(e => walkExpressionForLetBindings(e, results))
      return
    case 'list':
      expr.value.list.forEach(e => walkExpressionForLetBindings(e, results))
      return
    case 'parenthesized':
      walkExpressionForLetBindings(expr.value.parenthesized, results)
      return
    case 'case':
      walkExpressionForLetBindings(expr.value.case.expression, results)
      expr.value.case.cases.forEach(c => walkExpressionForLetBindings(c.expression, results))
      return
    case 'lambda':
      walkExpressionForLetBindings(expr.value.lambda.expression, results)
      return
    case 'recordAccess':
      walkExpressionForLetBindings(expr.value.recordAccess.expression, results)
      return
    case 'record':
      expr.value.record.forEach(f => walkExpressionForLetBindings(f.value.expression, results))
      return
    case 'recordUpdate':
      expr.value.recordUpdate.updates.forEach(u => walkExpressionForLetBindings(u.value.expression, results))
      return
  }
}

// ─── 5. Unused arguments (AST) ───────────────────────────────────────────────
//
// Checks function arguments (top-level, let-bound, and lambda) that are never
// referenced in the function body. Names starting with _ are intentionally
// ignored by convention and are skipped.

const checkUnusedArguments = (ast: ElmSyntax.Ast): vscode.Diagnostic[] => {
  const results: vscode.Diagnostic[] = []
  for (const decl of ast.declarations) {
    if (decl.value.type === 'function') {
      checkFunctionArguments(decl.value.function.declaration, results)
    }
  }
  return results
}

const checkFunctionArguments = (
  funcDecl: ElmSyntax.Node<ElmSyntax.FunctionDeclaration>,
  results: vscode.Diagnostic[]
): void => {
  const usedInBody = new Set<string>()
  collectNamesUsedInExpression(funcDecl.value.expression, usedInBody)

  for (const argPattern of funcDecl.value.arguments) {
    checkUnusedPatternVars(argPattern, usedInBody, results)
  }

  // Recurse into the body to find nested functions and lambdas
  walkExpressionForArguments(funcDecl.value.expression, results)
}

const walkExpressionForArguments = (
  expr: ElmSyntax.Node<ElmSyntax.Expression>,
  results: vscode.Diagnostic[]
): void => {
  switch (expr.value.type) {
    case 'let': {
      const letBlock = expr.value.let
      for (const letDecl of letBlock.declarations) {
        if (letDecl.value.type === 'function') {
          checkFunctionArguments(letDecl.value.function.declaration, results)
        } else {
          walkExpressionForArguments(letDecl.value.destructuring.expression, results)
        }
      }
      walkExpressionForArguments(letBlock.expression, results)
      return
    }
    case 'lambda': {
      const usedInBody = new Set<string>()
      collectNamesUsedInExpression(expr.value.lambda.expression, usedInBody)
      for (const argPattern of expr.value.lambda.patterns) {
        checkUnusedPatternVars(argPattern, usedInBody, results)
      }
      walkExpressionForArguments(expr.value.lambda.expression, results)
      return
    }
    case 'application':
      expr.value.application.forEach(e => walkExpressionForArguments(e, results))
      return
    case 'operatorapplication':
      walkExpressionForArguments(expr.value.operatorapplication.left, results)
      walkExpressionForArguments(expr.value.operatorapplication.right, results)
      return
    case 'ifBlock':
      walkExpressionForArguments(expr.value.ifBlock.clause, results)
      walkExpressionForArguments(expr.value.ifBlock.then, results)
      walkExpressionForArguments(expr.value.ifBlock.else, results)
      return
    case 'negation':
      walkExpressionForArguments(expr.value.negation, results)
      return
    case 'tupled':
      expr.value.tupled.forEach(e => walkExpressionForArguments(e, results))
      return
    case 'list':
      expr.value.list.forEach(e => walkExpressionForArguments(e, results))
      return
    case 'parenthesized':
      walkExpressionForArguments(expr.value.parenthesized, results)
      return
    case 'case':
      walkExpressionForArguments(expr.value.case.expression, results)
      expr.value.case.cases.forEach(c => walkExpressionForArguments(c.expression, results))
      return
    case 'recordAccess':
      walkExpressionForArguments(expr.value.recordAccess.expression, results)
      return
    case 'record':
      expr.value.record.forEach(f => walkExpressionForArguments(f.value.expression, results))
      return
    case 'recordUpdate':
      expr.value.recordUpdate.updates.forEach(u => walkExpressionForArguments(u.value.expression, results))
      return
  }
}

// Reports a diagnostic for each `var` pattern whose name is not in `usedNames`.
// Recurses into composite patterns (tuples, lists, named, as, record).
const checkUnusedPatternVars = (
  pattern: ElmSyntax.Node<ElmSyntax.Pattern>,
  usedNames: Set<string>,
  results: vscode.Diagnostic[]
): void => {
  switch (pattern.value.type) {
    case 'var': {
      const name = pattern.value.var.value
      if (!name.startsWith('_') && !usedNames.has(name)) {
        const range = sharedLogic.fromElmRange(pattern.range)
        results.push(new vscode.Diagnostic(range, `\`${name}\` is unused`, vscode.DiagnosticSeverity.Warning))
      }
      return
    }
    case 'as': {
      checkUnusedPatternVars(pattern.value.as.pattern, usedNames, results)
      const name = pattern.value.as.name.value
      if (!name.startsWith('_') && !usedNames.has(name)) {
        const range = sharedLogic.fromElmRange(pattern.value.as.name.range)
        results.push(new vscode.Diagnostic(range, `\`${name}\` is unused`, vscode.DiagnosticSeverity.Warning))
      }
      return
    }
    case 'record':
      for (const fieldNode of pattern.value.record.value) {
        const name = fieldNode.value
        if (!name.startsWith('_') && !usedNames.has(name)) {
          const range = sharedLogic.fromElmRange(fieldNode.range)
          results.push(new vscode.Diagnostic(range, `\`${name}\` is unused`, vscode.DiagnosticSeverity.Warning))
        }
      }
      return
    case 'tuple':
      pattern.value.tuple.value.forEach(p => checkUnusedPatternVars(p, usedNames, results))
      return
    case 'list':
      pattern.value.list.value.forEach(p => checkUnusedPatternVars(p, usedNames, results))
      return
    case 'uncons':
      checkUnusedPatternVars(pattern.value.uncons.left, usedNames, results)
      checkUnusedPatternVars(pattern.value.uncons.right, usedNames, results)
      return
    case 'named':
      pattern.value.named.patterns.forEach(p => checkUnusedPatternVars(p, usedNames, results))
      return
    case 'parentisized':
      checkUnusedPatternVars(pattern.value.parentisized.value, usedNames, results)
      return
  }
}

// ─── 6. Unused custom type variants (AST) ────────────────────────────────────
//
// Checks constructors that are never referenced anywhere in the file. Skips
// types that are exposed with (..) since their variants may be used externally.

const checkUnusedVariants = (ast: ElmSyntax.Ast, usedNames: Set<string>): vscode.Diagnostic[] => {
  const moduleData = ElmSyntax.toModuleData(ast)

  // If the module exposes everything, variants are externally visible
  if (moduleData.exposingList.value.type === 'all') return []

  const results: vscode.Diagnostic[] = []
  for (const decl of ast.declarations) {
    if (decl.value.type !== 'typedecl') continue

    const typeName = decl.value.typedecl.name.value

    // If the type is exposed with (..), its variants may be used in other files
    if (isTypeExposedWithVariants(moduleData.exposingList, typeName)) continue

    for (const variant of decl.value.typedecl.constructors) {
      const name = variant.value.name.value
      if (!usedNames.has(name)) {
        const range = sharedLogic.fromElmRange(variant.value.name.range)
        results.push(new vscode.Diagnostic(range, `\`${name}\` is an unused variant`, vscode.DiagnosticSeverity.Warning))
      }
    }
  }
  return results
}

const isTypeExposedWithVariants = (
  exposingList: ElmSyntax.Node<ElmSyntax.Exposing>,
  typeName: string
): boolean => {
  if (exposingList.value.type === 'all') return true
  return exposingList.value.explicit.some(expose =>
    expose.value.type === 'typeexpose' && expose.value.typeexpose.name === typeName
  )
}

// ─── Shared helpers ───────────────────────────────────────────────────────────

// A precise check for whether a name is explicitly listed in this module's
// own exposing clause. Unlike ElmSyntax.isExposedFromThisModule (which uses
// isPotentiallyExposed), the `typeexpose` case here checks the actual type
// name rather than returning true for every name when any Type(..) is present.
const isExplicitlyExposed = (ast: ElmSyntax.Ast, name: string): boolean => {
  const exposingList = ElmSyntax.toModuleData(ast).exposingList
  if (exposingList.value.type === 'all') return true
  return exposingList.value.explicit.some(expose => {
    switch (expose.value.type) {
      case 'function': return expose.value.function.name === name
      case 'typeOrAlias': return expose.value.typeOrAlias.name === name
      case 'typeexpose': return expose.value.typeexpose.name === name
      case 'infix': return false
    }
  })
}

// ─── Shared name-collection helpers ──────────────────────────────────────────

// Collects all names referenced anywhere in the file: expressions (including
// case patterns for constructor names), type annotations, and type declarations.
const collectAllUsedNamesInFile = (ast: ElmSyntax.Ast): Set<string> => {
  const usedNames = new Set<string>()
  for (const decl of ast.declarations) {
    switch (decl.value.type) {
      case 'function':
        if (decl.value.function.signature) {
          collectNamesUsedInTypeAnnotation(decl.value.function.signature.value.typeAnnotation, usedNames)
        }
        collectNamesUsedInExpression(decl.value.function.declaration.value.expression, usedNames)
        break
      case 'typeAlias':
        collectNamesUsedInTypeAnnotation(decl.value.typeAlias.typeAnnotation, usedNames)
        break
      case 'typedecl':
        for (const ctor of decl.value.typedecl.constructors) {
          for (const arg of ctor.value.arguments) {
            collectNamesUsedInTypeAnnotation(arg, usedNames)
          }
        }
        break
    }
  }
  return usedNames
}

const collectNamesUsedInExpression = (
  expr: ElmSyntax.Node<ElmSyntax.Expression>,
  names: Set<string>
): void => {
  switch (expr.value.type) {
    case 'functionOrValue':
      names.add(expr.value.functionOrValue.name)
      return
    case 'application':
      expr.value.application.forEach(e => collectNamesUsedInExpression(e, names))
      return
    case 'operatorapplication':
      collectNamesUsedInExpression(expr.value.operatorapplication.left, names)
      collectNamesUsedInExpression(expr.value.operatorapplication.right, names)
      return
    case 'ifBlock':
      collectNamesUsedInExpression(expr.value.ifBlock.clause, names)
      collectNamesUsedInExpression(expr.value.ifBlock.then, names)
      collectNamesUsedInExpression(expr.value.ifBlock.else, names)
      return
    case 'negation':
      collectNamesUsedInExpression(expr.value.negation, names)
      return
    case 'tupled':
      expr.value.tupled.forEach(e => collectNamesUsedInExpression(e, names))
      return
    case 'list':
      expr.value.list.forEach(e => collectNamesUsedInExpression(e, names))
      return
    case 'parenthesized':
      collectNamesUsedInExpression(expr.value.parenthesized, names)
      return
    case 'let':
      expr.value.let.declarations.forEach(d => {
        if (d.value.type === 'function') {
          if (d.value.function.signature) {
            collectNamesUsedInTypeAnnotation(d.value.function.signature.value.typeAnnotation, names)
          }
          collectNamesUsedInExpression(d.value.function.declaration.value.expression, names)
        } else {
          collectNamesUsedInExpression(d.value.destructuring.expression, names)
        }
      })
      collectNamesUsedInExpression(expr.value.let.expression, names)
      return
    case 'case':
      collectNamesUsedInExpression(expr.value.case.expression, names)
      expr.value.case.cases.forEach(c => {
        collectNamesUsedInPattern(c.pattern, names)
        collectNamesUsedInExpression(c.expression, names)
      })
      return
    case 'lambda':
      collectNamesUsedInExpression(expr.value.lambda.expression, names)
      return
    case 'recordAccess':
      collectNamesUsedInExpression(expr.value.recordAccess.expression, names)
      return
    case 'record':
      expr.value.record.forEach(f => collectNamesUsedInExpression(f.value.expression, names))
      return
    case 'recordUpdate':
      names.add(expr.value.recordUpdate.name.value)
      expr.value.recordUpdate.updates.forEach(u => collectNamesUsedInExpression(u.value.expression, names))
      return
  }
}

// Collects constructor names used in patterns (e.g. case branches)
const collectNamesUsedInPattern = (
  pattern: ElmSyntax.Node<ElmSyntax.Pattern>,
  names: Set<string>
): void => {
  switch (pattern.value.type) {
    case 'named':
      names.add(pattern.value.named.qualified.name)
      pattern.value.named.patterns.forEach(p => collectNamesUsedInPattern(p, names))
      return
    case 'tuple':
      pattern.value.tuple.value.forEach(p => collectNamesUsedInPattern(p, names))
      return
    case 'list':
      pattern.value.list.value.forEach(p => collectNamesUsedInPattern(p, names))
      return
    case 'uncons':
      collectNamesUsedInPattern(pattern.value.uncons.left, names)
      collectNamesUsedInPattern(pattern.value.uncons.right, names)
      return
    case 'as':
      collectNamesUsedInPattern(pattern.value.as.pattern, names)
      return
    case 'parentisized':
      collectNamesUsedInPattern(pattern.value.parentisized.value, names)
      return
  }
}

const collectNamesUsedInTypeAnnotation = (
  node: ElmSyntax.Node<ElmSyntax.TypeAnnotation>,
  names: Set<string>
): void => {
  switch (node.value.type) {
    case 'typed':
      names.add(node.value.typed.moduleNameAndName.value.name)
      node.value.typed.args.forEach(a => collectNamesUsedInTypeAnnotation(a, names))
      return
    case 'function':
      collectNamesUsedInTypeAnnotation(node.value.function.left, names)
      collectNamesUsedInTypeAnnotation(node.value.function.right, names)
      return
    case 'tupled':
      node.value.tupled.values.forEach(v => collectNamesUsedInTypeAnnotation(v, names))
      return
    case 'record':
      node.value.record.value.forEach(f => collectNamesUsedInTypeAnnotation(f.value.typeAnnotation, names))
      return
    case 'genericRecord':
      node.value.genericRecord.values.value.forEach(f => collectNamesUsedInTypeAnnotation(f.value.typeAnnotation, names))
      return
  }
}

// ─── elm-find types and runner ────────────────────────────────────────────────

type ElmFindKind = 'value' | 'type' | 'ctor'

type ElmFindRegion = {
  start: { line: number; column: number }
  end: { line: number; column: number }
}

type ElmFindUsage = {
  file: string
  module: string
  region: ElmFindRegion
  tag: 'usage' | 'mention'
}

type ElmFindDefinition = {
  name: string
  kind: ElmFindKind
  file: string
  module: string
  region: ElmFindRegion
  usages: ElmFindUsage[]
}

type RunElmFindInput = {
  binary: string
  name: string
  kind: ElmFindKind | undefined
  moduleName: string
  projectFolder: string
  token: vscode.CancellationToken
}

const runElmFind = (input: RunElmFindInput): Promise<ElmFindDefinition[] | undefined> => {
  return new Promise((resolve) => {
    const { binary, name, kind, moduleName, projectFolder, token } = input

    const args = [name, '--module', moduleName, '--project', projectFolder]
    if (kind) args.push('--kind', kind)
    const child = child_process.spawn(binary, args, { env: sharedLogic.npxEnv() })

    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (data: Buffer) => { stdout += data.toString() })
    child.stderr.on('data', (data: Buffer) => { stderr += data.toString() })

    child.on('error', (err: Error & { code?: string }) => {
      if (err.code !== 'ENOENT') {
        console.error('elm-find error:', err.message)
      }
      resolve(undefined)
    })

    child.on('close', (code: number) => {
      if (code !== 0) {
        resolve(undefined)
        return
      }
      try {
        const definitions: ElmFindDefinition[] = JSON.parse(stdout)
        resolve(definitions)
      } catch (_) {
        resolve(undefined)
      }
    })

    token.onCancellationRequested(() => {
      child.kill()
      resolve(undefined)
    })
  })
}

const getKindForDeclaration = (declaration: ElmSyntax.Node<ElmSyntax.Declaration>): ElmFindKind | undefined => {
  switch (declaration.value.type) {
    case 'function': return 'value'
    case 'typeAlias': return 'type'
    case 'typedecl': return 'type'
    default: return undefined
  }
}

const getDeclarationNameRange = (declaration: ElmSyntax.Node<ElmSyntax.Declaration>): vscode.Range => {
  switch (declaration.value.type) {
    case 'function':
      return sharedLogic.fromElmRange(declaration.value.function.declaration.value.name.range)
    case 'typeAlias':
      return sharedLogic.fromElmRange(declaration.value.typeAlias.name.range)
    case 'typedecl':
      return sharedLogic.fromElmRange(declaration.value.typedecl.name.range)
    default:
      return sharedLogic.fromElmRange(declaration.range)
  }
}
