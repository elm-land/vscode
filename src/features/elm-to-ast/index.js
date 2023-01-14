
const run = async (rawElmSource) => {

  // Attempt to load the compiled Elm worker
  let Elm = undefined
  try {
    Elm = require('./worker.min.js').Elm
  } catch (_) {
    console.error(`ElmToAst`, `Missing "worker.min.js"? Please follow the README section titled "Building from scratch"`)
    return undefined
  }

  return new Promise((resolve) => {
    // Start the Elm worker, and subscribe to 
    const app = Elm.Worker.init({
      flags: rawElmSource || ''
    })

    app.ports.onSuccess.subscribe(resolve)
    app.ports.onFailure.subscribe(reason => {
      resolve(undefined)
    })
  })
}

module.exports = {
  run
}
