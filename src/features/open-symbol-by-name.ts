import * as vscode from 'vscode'
import { Feature } from './shared/logic'

// This finds all top-level declarations (type, type alias, values, functions, ports)
// with the following caveats:
// - Odd spacing or inline comments can cause declarations to be missed.
// - False positives might be found in multiline comments or multiline strings.
// But it’s a very fast way of computing an important feature!
// If there are a couple of false positives you can jump to, that’s not the end of the world.
// For example, if you comment out some code using multiline comments, you’ll still be able
// to jump to it, which is a bit unexpected but not super weird.
// Parts come from here: https://github.com/rtfeldman/node-test-runner/blob/eedf853fc9b45afd73a0db72decebdb856a69771/lib/Parser.js#L229-L234
const topLevelDeclarationRegex = /\n|(?<=^type(?: +alias)? +)\p{Lu}[_\d\p{L}]*|^\p{Ll}[_\d\p{L}]*(?=.*=$)|^(?<=port +)\p{Ll}[_\d\p{L}]*(?= *:)/gmu

export const feature: Feature = ({ context }) => {
  context.subscriptions.push(
    vscode.languages.registerWorkspaceSymbolProvider({
      async provideWorkspaceSymbols(query: string, token: vscode.CancellationToken) {
        // Allow user to disable this feature
        const isEnabled: boolean = vscode.workspace.getConfiguration('elmLand').feature.openSymbolByName
        if (!isEnabled) return

        const start = Date.now()
        const symbols: vscode.SymbolInformation[] = []
        const uris = await vscode.workspace.findFiles('**/*.elm', '**/{node_modules,elm-stuff}/**')

        for (const uri of uris) {
          const buffer = await vscode.workspace.fs.readFile(uri)
          if (token.isCancellationRequested) return
          const fileContents = Buffer.from(buffer).toString('utf8')
          let line = 0
          let lineIndex = 0
          for (const match of fileContents.matchAll(topLevelDeclarationRegex)) {
            const { 0: name, index: matchIndex = 0 } = match
            if (name === '\n') {
              line++
              lineIndex = matchIndex
            } else if (nameMatchesQuery(name, query)) {
              const firstLetter = name.slice(0, 1)
              const character = matchIndex - lineIndex - 1
              symbols.push(
                new vscode.SymbolInformation(
                  name,
                  firstLetter.toUpperCase() === firstLetter ? vscode.SymbolKind.Variable : vscode.SymbolKind.Function,
                  '',
                  new vscode.Location(
                    uri,
                    new vscode.Range(
                      new vscode.Position(line, character),
                      new vscode.Position(line, character + name.length)
                    )
                  )
                )
              )
            }
          }
        }

        console.info('provideWorkspaceSymbol', `${symbols.length} results in ${Date.now() - start}ms`)
        return symbols
      }
    })
  )
}

// Checks that the characters of `query` appear in their order in a candidate symbol,
// as documented here: https://code.visualstudio.com/api/references/vscode-api#WorkspaceSymbolProvider
const nameMatchesQuery = (name: string, query: string): boolean => {
  const nameChars = Array.from(name)
  let nameIndex = 0
  outer: for (const char of query) {
    for (; nameIndex < nameChars.length; nameIndex++) {
      if (nameChars[nameIndex] === char) continue outer
    }
    return false
  }
  return true
}