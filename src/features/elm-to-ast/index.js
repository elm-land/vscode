// @ts-check

/**
 * @typedef {import('./index.js').Ast} Ast
 * @typedef {import('./index.js').ModuleData} ModuleData
 */

/**
 * @type {(rawElmSource: string) => Promise<Ast | undefined>}
 */
const run = async (rawElmSource) => {

  // Attempt to load the compiled Elm worker
  let Elm = undefined
  try {
    // @ts-ignore
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
    app.ports.onFailure.subscribe((_reason) => {
      resolve(undefined)
    })
  })
}

// Helper functions

/**
 * 
 * @type {(ast: Ast) => string}
 */
const toModuleName = (ast) => {
  let type = ast.moduleDefinition.value.type

  /** @type {ModuleData} */
  let thing = ast.moduleDefinition.value[ast.moduleDefinition.value.type]

  return thing.moduleName.value.join('.')
}

module.exports = {
  run,
  toModuleName
}
