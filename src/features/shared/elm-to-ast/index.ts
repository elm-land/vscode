import * as ElmSyntax from './elm-syntax'
const Elm: CompiledElmFile = require('./worker.min.js').Elm

type CompiledElmFile = {
  Worker: {
    init: () => ElmApp
  }
}

type ElmApp = {
  ports: {
    input: { send: (rawElmSource: string) => void }
    onSuccess: { subscribe: (fn: (ast: ElmSyntax.Ast) => void) => void }
    onFailure: { subscribe: (fn: (reason: string) => void) => void }
  }
}

let queue: Array<(result: ElmSyntax.Ast | undefined) => void> = []
const app = Elm.Worker.init()
app.ports.onSuccess.subscribe((ast) => {
  queue.shift()?.(ast)
})
app.ports.onFailure.subscribe((reason) => {
  queue.shift()?.(undefined)
})

export const run = async (rawElmSource: string): Promise<ElmSyntax.Ast | undefined> => {
  return new Promise((resolve) => {
    queue.push(resolve)
    app.ports.input.send(rawElmSource)
  })
}