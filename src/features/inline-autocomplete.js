const vscode = require('vscode')

const elmJson = {
  "type": "application",
  "source-directories": [
    "/Users/ryan/code/elm-land/vscode/examples/01-hello-world/src"
  ],
  "elm-version": "0.19.1",
  "dependencies": {
    "direct": {
      "elm/browser": "1.0.2",
      "elm/core": "1.0.5",
      "elm/html": "1.0.0"
    },
    "indirect": {
      "elm/json": "1.1.3",
      "elm/time": "1.0.0",
      "elm/url": "1.0.0",
      "elm/virtual-dom": "1.0.3"
    }
  },
  "test-dependencies": {
    "direct": {},
    "indirect": {}
  }
}


module.exports = {
  provideInlineCompletionItems(document, position, context, token) {

    // Every Elm module's name should match the folder it is in,
    // so we can recommend a name for new files my looking at the filepath
    let moduleName = determineModuleNameBasedOnElmJson(document)

    let moduleSuggestion = 'module '
    if (moduleName) {
      moduleSuggestion += moduleName
    }

    if (position.line === 0 && position.character < 'module'.length) {
      return [{ insertText: moduleSuggestion }]
    }

    let recommendations = [
      // modules
      { regex: /^module\s+\S+\s+\S*/, suggestions: ['exposing '] },
      { regex: /^module\s+\S*/, suggestions: [moduleName] },
      // imports
      { regex: /^import\s+\S+\s+\S*/, suggestions: ['exposing ', 'as '] },
      { regex: /^import\s+Html\.\S*/, suggestions: ['Attributes', 'Events'] },
      { regex: /^import\s+Browser\.\S*/, suggestions: ['Dom', 'Events', 'Navigation'] },
      { regex: /^import\s+[^\.\s]+/, suggestions: ['Array', 'Browser', 'Bitwise', 'Dict', 'Process', 'Set', 'Task', 'Html'] },
      // type annotations
      { regex: /:\s+Html\.\S*/, suggestions: ['Html', 'Attribute'] },
      { regex: /->\s+Html\.\S*/, suggestions: ['Html', 'Attribute'] },
      { regex: /:\s+\S*/, suggestions: ['Html'] },
      { regex: /->\s+\S*/, suggestions: ['Html'] },
      // module autocomplete
      { regex: /\s*Html\.Events\.\S*/, suggestions: ['onClick', 'onDoubleClick', 'onMouseDown', 'onMouseUp', 'onMouseEnter', 'onMouseLeave', 'onMouseOver', 'onMouseOut', 'onInput', 'onSubmit'] },
      { regex: /\s*Html\.Attributes\.\S*/, suggestions: ['style', 'property', 'attribute', 'map', 'class', 'classList', 'id', 'title', 'hidden'] },
      { regex: /\s*Html\.\S*/, suggestions: ['Events', 'Attributes', 'text', 'node', 'map', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'div', 'p', 'hr', 'pre', 'blockquote', 'span', 'a', 'code'] }
    ]

    for (let rec of recommendations) {
      let word = document.getWordRangeAtPosition(position, rec.regex)
      if (word) {
        return rec.suggestions.map(name => ({ insertText: name }))
      }
    }
  }
}

// Converts "~/src/Example/File.elm" into "Example.File"
function determineModuleNameBasedOnElmJson(document) {
  let sourceDirectories = elmJson['source-directories']

  for (let directory of sourceDirectories) {
    if (document.fileName.startsWith(directory)) {
      return document.fileName
        .slice(directory.length + 1, -'.elm'.length)
        .split('/').join('.')
    }
  }

  return undefined
}