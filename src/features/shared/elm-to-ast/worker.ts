import * as WorkerThreads from 'worker_threads'
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

const {parentPort} = WorkerThreads
if (parentPort === null) {
  throw new Error('parentPort is null')
}

const app = Elm.Worker.init()
app.ports.onSuccess.subscribe((ast) => {
  parentPort.postMessage(ast)
})
app.ports.onFailure.subscribe((reason) => {
  parentPort.postMessage(undefined)
})

parentPort.on('message', (rawElmSource: string) => {
  app.ports.input.send(rawElmSource)
})