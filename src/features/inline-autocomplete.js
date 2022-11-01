const sharedLogic = require('./_shared-logic')
const vscode = require('vscode')



module.exports = (globalState) => {
  return {
    provideInlineCompletionItems(document, position, context, token) {
      // TODO: Actually check which one applies to the current document
      // ( steal logic from the error-highlighting feature! )
      let elmJsonFile = sharedLogic.findElmJsonFor(globalState, document.uri)
      if (elmJsonFile) {
        let plainModuleNames =
          elmJsonFile.dependencies
            .flatMap(package => package.docs)
            .map(module_ => module_.name)

        let availableModulesToImport =
          Object.entries(
            plainModuleNames
              .filter(notInElmPrelude)
              .reduce(buildModuleImportRegexSuggestion, {})
          )
            .sort(byModuleDepthDescending)
            .map(toRegexSuggestionEntry)

        return provideRecommendations({
          document,
          position,
          sourceDirectories: elmJsonFile.sourceDirectories,
          availableModulesToImport,
          plainModuleNames
        })
      } else {
        return provideRecommendations({
          document,
          position,
          sourceDirectories: [],
          availableModulesToImport: [],
          plainModuleNames: []
        })
      }
    }
  }
}

const provideRecommendations = ({
  document,
  position,
  sourceDirectories,
  availableModulesToImport,
  plainModuleNames
}) => {
  // Every Elm module's name should match the folder it is in,
  // so we can recommend a name for new files my looking at the filepath
  let moduleName = determineModuleNameBasedOnElmJson(document, sourceDirectories)

  let moduleSuggestion = 'module '
  if (moduleName) {
    moduleSuggestion += moduleName
  }

  if (position.line === 0 && position.character < 'module'.length) {
    return [{ insertText: moduleSuggestion, completeBracketPairs: true }]
  }

  let recommendations = [
    // modules
    { regex: /^module\s+\S+\s+\S*/, suggestions: ['exposing '] },
    { regex: /^module\s+\S*/, suggestions: [moduleName] },
    // imports
    { regex: /^import\s+\S+\s+\S*/, suggestions: ['exposing ', 'as '] },
    ...availableModulesToImport,
    { regex: /^import\s+[^\.\s]+/, suggestions: plainModuleNames.filter(areTopLevelModules) },
    // type annotations
    { regex: /:\s+Html\.[^\.\s]+/, suggestions: ['Html', 'Attribute'] },
    { regex: /->\s+Html\.[^\.\s]+/, suggestions: ['Html', 'Attribute'] },
    { regex: /^main\s+:\s+[^\.\s]*/, suggestions: ['Html msg', 'Program () Model Msg'] },
    { regex: /:\s+[^\.\s]+/, suggestions: ['Html'] },
    { regex: /->\s+[^\.\s]+/, suggestions: ['Html'] },
    // module autocomplete
    { regex: /\s*Html\.Events\.[^\.\s]+/, suggestions: ['onClick', 'onDoubleClick', 'onMouseDown', 'onMouseUp', 'onMouseEnter', 'onMouseLeave', 'onMouseOver', 'onMouseOut', 'onInput', 'onSubmit'] },
    { regex: /\s*Html\.Attributes\.[^\.\s]+/, suggestions: ['style', 'property', 'attribute', 'map', 'class', 'classList', 'id', 'title', 'hidden'] },
    { regex: /\s*Html\.[^\.\s]+/, suggestions: ['Events', 'Attributes', 'text', 'node', 'map', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'div', 'p', 'hr', 'pre', 'blockquote', 'span', 'a', 'code', 'button'] }
  ]

  for (let rec of recommendations) {
    let word = document.getWordRangeAtPosition(position, rec.regex)
    if (word) {
      return rec.suggestions.map(name => ({ insertText: name }))
    }
  }
}

// Converts "~/src/Example/File.elm" into "Example.File"
function determineModuleNameBasedOnElmJson(document, sourceDirectories) {
  for (let directory of sourceDirectories) {
    if (document.fileName.startsWith(directory)) {
      return document.fileName
        .slice(directory.length + 1, -'.elm'.length)
        .split('/').join('.')
    }
  }

  return undefined
}

const preludeModuleNames =
  'Basics List Maybe Result String Char Tuple Debug Platform Platform.Cmd Platform.Sub'.split(' ')

const preludeModuleAliases =
  'Basics List Maybe Result String Char Tuple Debug Platform Cmd Sub'.split(' ')

const notInElmPrelude = (name) =>
  preludeModuleNames.indexOf(name) === -1

const areTopLevelModules = (name) =>
  name.indexOf('.') === -1

const emptyNode = (depth) =>
  ({ depth, suggestions: [] })

const buildModuleImportRegexSuggestion = (regexToSuggestionsMap, modulePath) => {
  let segments = modulePath.split('.')

  for (let i = 0; i < segments.length; i++) { // 0 1
    if (i === segments.length - 1) {
      let name = segments.join('.')
      let regex = `^import\\s+${name}\\.[^\\.\\s]+`

      regexToSuggestionsMap[regex] = regexToSuggestionsMap[regex] || emptyNode(i)
    } else {
      let name = segments.slice(0, i + 1).join('.')
      let child = segments.slice(i + 1, segments.length).join('.')
      let regex = `^import\\s+${name}\\.[^\\.\\s]+`

      regexToSuggestionsMap[regex] = regexToSuggestionsMap[regex] || emptyNode(i)
      regexToSuggestionsMap[regex].suggestions.push(child)
    }
  }

  return regexToSuggestionsMap
}

const byModuleDepthDescending = ([k1, v1], [k2, v2]) =>
  v2.depth - v1.depth

const toRegexSuggestionEntry = ([regex, value]) =>
  ({ regex: new RegExp(regex), suggestions: value.suggestions })