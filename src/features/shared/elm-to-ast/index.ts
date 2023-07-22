import * as path from 'path'
import * as vscode from 'vscode'
import * as WorkerThreads from 'worker_threads'
import * as ElmSyntax from './elm-syntax'

type WorkerState =
  | { tag: 'NotRunning' }
  | { tag: 'Idle', worker: WorkerThreads.Worker }
  | { tag: 'Busy', worker: WorkerThreads.Worker }

let workerState: WorkerState = { tag: 'NotRunning' }

export const run = async (rawElmSource: string, token: vscode.CancellationToken): Promise<ElmSyntax.Ast | undefined> => {
  return new Promise((resolve) => {
    const worker = getWorker(resolve)
    const newWorkerState: WorkerState = { tag: 'Busy', worker }
    token.onCancellationRequested(() => {
      if (workerState === newWorkerState) {
        // Maybe it’s better to never terminate? Just let the thread chug along?
        // or queue things? only terminate if cancellation requested?
        console.info('CANCEL!!!')
        worker.terminate()
      } else {
        console.info('DONT CANCEL')
      }
    })
    workerState = newWorkerState
    worker.postMessage(rawElmSource)
  })
}

const getWorker = (resolve: (result: ElmSyntax.Ast | undefined) => void): WorkerThreads.Worker => {
  console.info('STATE', workerState.tag)
  switch (workerState.tag) {
    case 'NotRunning':
      return initWorker(resolve)

    case 'Idle':
      return workerState.worker

    case 'Busy':
      workerState.worker.terminate()
      return initWorker(resolve)
  }
}

const initWorker = (resolve: (result: ElmSyntax.Ast | undefined) => void): WorkerThreads.Worker => {
  const worker = new WorkerThreads.Worker(path.join(__dirname, './worker.js'))

  worker.on('error', (error) => {
    console.error(`ElmToAst`, `Worker error:`, error)
    worker.terminate()
    workerState = { tag: 'NotRunning' }
    resolve(undefined)
  })

  worker.on('messageerror', (error) => {
    console.error(`ElmToAst`, `Worker messageerror:`, error)
    worker.terminate()
    workerState = { tag: 'NotRunning' }
    resolve(undefined)
  })

  worker.on('exit', () => {
    // Most likely, we terminated a busy worker, so there is no error to report.
    resolve(undefined)
  })

  worker.on('message', (result) => {
    workerState = { tag: 'Idle', worker }
    resolve(result)
  })

  return worker
}