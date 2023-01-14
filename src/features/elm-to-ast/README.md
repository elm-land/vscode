# Elm to AST
> A script that turns raw Elm source code into a structured JSON value

This script is intentionally commited to source control so there's no extra build step needed to run this plugin.

## Building from scratch

1. Install these NPM terminal commands

```
npm i -g elm terser
```

1. Build and minify the "src/Worker.elm" file

```
elm make src/Worker.elm --output=dist/worker.js --optimize
terser dist/worker.js --compress 'pure_funcs=[F2,F3,F4,F5,F6,F7,F8,F9,A2,A3,A4,A5,A6,A7,A8,A9],pure_getters,keep_fargs=false,unsafe_comps,unsafe' | terser --mangle --output worker.min.js
```

### Example Usage

```js
const ElmToAst = require('./elm-to-ast/index.js')

const ast = await ElmToAst.run(`
module Main exposing (main)

import Html exposing (Html)


main : Html msg
main =
    Html.text "Hello, world!"
`).catch(_ => undefined)

console.log(ast)
```