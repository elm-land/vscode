import * as path from 'path'
import * as vscode from 'vscode'
import * as WorkerThreads from 'worker_threads'
import * as ElmSyntax from './elm-syntax'

type WorkerState =
  | { tag: 'NotRunning' }
  | { tag: 'Idle', worker: WorkerThreads.Worker }
  | { tag: 'Busy', worker: WorkerThreads.Worker, resolve: (result: ElmSyntax.Ast | undefined) => void, queue: QueueItem[] }

type QueueItem = {
  rawElmSource: string
  resolve: (result: ElmSyntax.Ast | undefined) => void,
}

let workerState: WorkerState = { tag: 'NotRunning' }

export const run = async (rawElmSource: string, token: vscode.CancellationToken): Promise<ElmSyntax.Ast | undefined> => {
  return new Promise((resolve) => {
    token.onCancellationRequested(() => {
      if (workerState.tag === 'Busy' && workerState.resolve === resolve) {
        workerState.worker.terminate()
      }
    })

    switch (workerState.tag) {
      case 'NotRunning':
        workerState = { tag: 'Busy', worker: initWorker(), resolve, queue: [] }
        workerState.worker.postMessage(rawElmSource)
        break

      case 'Idle':
        workerState = { tag: 'Busy', worker: workerState.worker, resolve, queue: [] }
        workerState.worker.postMessage(rawElmSource)
        break

      case 'Busy':
        workerState.queue.push({ rawElmSource, resolve })
        break
    }
  })
}

const initWorker = (): WorkerThreads.Worker => {
  const worker = new WorkerThreads.Worker(path.join(__dirname, './worker.js'))

  worker.on('error', (error) => {
    console.error(`ElmToAst`, `Worker error:`, error)
    worker.terminate()
    if (workerState.tag === 'Busy') {
      workerState.resolve(undefined)
      for (const queueItem of workerState.queue) {
        queueItem.resolve(undefined)
      }
    }
    workerState = { tag: 'NotRunning' }
  })

  const finish = (result: ElmSyntax.Ast | undefined) => {
    if (workerState.tag === 'Busy') {
      workerState.resolve(result)
      const next = workerState.queue.shift()
      if (next === undefined) {
        workerState = { tag: 'Idle', worker: workerState.worker }
      } else {
        workerState.resolve = next.resolve
        workerState.worker.postMessage(next.rawElmSource)
      }
    }
  }

  worker.on('exit', () => {
    // Most likely, we terminated a busy worker, so there is no error to report.
    if (workerState.tag === 'Busy') {
      workerState.resolve(undefined)
      const next = workerState.queue.shift()
      if (next === undefined) {
        workerState = { tag: 'Idle', worker: initWorker() }
      } else {
        workerState.resolve = next.resolve
        workerState.worker = initWorker()
        workerState.worker.postMessage(next.rawElmSource)
      }
    } else {
      workerState = { tag: 'NotRunning' }
    }
  })

  worker.on('message', (result: ElmSyntax.Ast | undefined) => {
    if (workerState.tag === 'Busy') {
      workerState.resolve(result)
      const next = workerState.queue.shift()
      if (next === undefined) {
        workerState = { tag: 'Idle', worker: workerState.worker }
      } else {
        workerState.resolve = next.resolve
        workerState.worker.postMessage(next.rawElmSource)
      }
    }
  })

  return worker
}