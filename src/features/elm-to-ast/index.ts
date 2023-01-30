import * as ElmSyntax from './elm-syntax'

type CompiledElmFile = {
  Worker: {
    init: (args: { flags: string }) => ElmApp
  }
}

type ElmApp = {
  ports: {
    onSuccess: { subscribe: (fn: (ast: ElmSyntax.Ast) => void) => void }
    onFailure: { subscribe: (fn: (reason: string) => void) => void }
  }
}

export const run = async (rawElmSource: string): Promise<ElmSyntax.Ast | undefined> => {
  // Attempt to load the compiled Elm worker
  try {
    // @ts-ignore
    let Elm: CompiledElmFile = require('./worker.min.js').Elm
    return new Promise((resolve) => {
      // Start the Elm worker, and subscribe to 
      const app = Elm.Worker.init({
        flags: rawElmSource || ''
      })

      app.ports.onSuccess.subscribe(resolve)
      app.ports.onFailure.subscribe((reason) => {
        resolve(undefined)
      })
    })
  } catch (_) {
    console.error(`ElmToAst`, `Missing "worker.min.js"? Please follow the README section titled "Building from scratch"`)
    return undefined
  }
}