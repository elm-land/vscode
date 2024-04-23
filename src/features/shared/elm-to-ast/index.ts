import * as path from 'path'
import * as vscode from 'vscode'
import * as WorkerThreads from 'worker_threads'
import * as ElmSyntax from './elm-syntax'

type WorkerState =
  | { tag: 'Idle' }
  | { tag: 'Busy', resolve: (result: ElmSyntax.Ast | undefined) => void, queue: QueueItem[] }

type QueueItem = {
  rawElmSource: string
  resolve: (result: ElmSyntax.Ast | undefined) => void,
}

let worker: WorkerThreads.Worker
let workerState: WorkerState = { tag: 'Idle' }

const initWorker = () => {
  worker = new WorkerThreads.Worker(path.join(__dirname, './worker.js'))

  const finish = (result: ElmSyntax.Ast | undefined) => {
    if (workerState.tag === 'Busy') {
      workerState.resolve(result)
      const next = workerState.queue.shift()
      if (next === undefined) {
        workerState = { tag: 'Idle' }
      } else {
        workerState.resolve = next.resolve
        worker.postMessage(next.rawElmSource)
      }
    }
  }

  worker.on('exit', () => {
    // Most likely, we terminated a busy worker.
    initWorker()
    finish(undefined)
  })

  worker.on('message', finish)
}

initWorker()

export const run = async (rawElmSource: string, token: vscode.CancellationToken): Promise<ElmSyntax.Ast | undefined> => {
  return new Promise((resolve) => {
    token.onCancellationRequested(() => {
      if (workerState.tag === 'Busy' && workerState.resolve === resolve) {
        worker.terminate()
      }
    })

    switch (workerState.tag) {
      case 'Idle':
        workerState = { tag: 'Busy', resolve, queue: [] }
        worker.postMessage(rawElmSource)
        break

      case 'Busy':
        workerState.queue.push({ rawElmSource, resolve })
        break
    }
  })
}