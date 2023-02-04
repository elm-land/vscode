
type CompiledElmFile = {
  Main: {
    init: (args: { flags: string }) => ElmApp
  }
}

type ElmApp = {
  ports: {
    onSuccess: { subscribe: (fn: (elmCode: string) => void) => void }
    onFailure: { subscribe: (fn: (reason: string) => void) => void }
  }
}

export const run = async (rawHtmlSnippet: string): Promise<string | undefined> => {
  // Attempt to load the compiled Elm worker
  try {
    // @ts-ignore
    let Elm: CompiledElmFile = require('./elm.compiled.js').Elm
    return new Promise((resolve) => {
      // Start the Elm worker, and subscribe to 
      const app = Elm.Main.init({
        flags: rawHtmlSnippet || ''
      })

      app.ports.onSuccess.subscribe(resolve)
      app.ports.onFailure.subscribe((reason) => {
        resolve(undefined)
      })
    })
  } catch (_) {
    console.error(`HtmlToElm`, `Please run 'npm run build:elm' before trying again.`)
    return undefined
  }
}