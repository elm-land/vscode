const path = require('path')
const child_process = require('child_process')

// Cross platform build script
let elmApps = {
  elmToAst: {
    name: 'elm-to-ast',
    folder: path.join(__dirname, 'src', 'features', 'shared', 'elm-to-ast'),
    entrypoint: path.join(__dirname, 'src', 'features', 'shared', 'elm-to-ast', 'src', 'Worker.elm'),
    dist_output: path.join(__dirname, 'dist', 'features', 'shared', 'elm-to-ast', 'worker.min.js'),
  },
  offlinePackageDocs: {
    name: 'offline-package-docs',
    folder: path.join(__dirname, 'src', 'features', 'offline-package-docs'),
    entrypoint: path.join(__dirname, 'src', 'features', 'offline-package-docs', 'src', 'Main.elm'),
    dist_output: path.join(__dirname, 'dist', 'features', 'offline-package-docs', 'elm.compiled.js'),
  },
  htmlToElm: {
    name: 'html-to-elm',
    folder: path.join(__dirname, 'src', 'features', 'html-to-elm'),
    entrypoint: path.join(__dirname, 'src', 'features', 'html-to-elm', 'src', 'Main.elm'),
    dist_output: path.join(__dirname, 'dist', 'features', 'html-to-elm', 'elm.compiled.js'),
  }
}

let bold = str => '\033[36m' + str + '\033[0m'

let copyElmFindScripts = () => {
  let isWindows = process.platform === 'win32'

  let command = isWindows
    ? `xcopy /sy src\\experiments\\find-usages\\elm-find\\scripts\\* dist\\experiments\\find-usages\\elm-find\\scripts\\`
    : `cp -r src/experiments/find-usages/elm-find/scripts/* dist/experiments/find-usages/elm-find/scripts`


  child_process.exec(command, (err, stdout, stderr) => {
    if (err) {
      console.error(err)
      process.exit(err.code)
    } else {
      console.log(` ✅ Copied ${bold('elm-find')} scripts`)
    }
  })
}

const buildElmProject = ({ name, folder, entrypoint, dist_output }) => {
  child_process.exec(`cd ${folder} && npx elm make ${entrypoint} --optimize --output=${dist_output} && npx terser ${dist_output} --compress "pure_funcs=[F2,F3,F4,F5,F6,F7,F8,F9,A2,A3,A4,A5,A6,A7,A8,A9],pure_getters,keep_fargs=false,unsafe_comps,unsafe" | npx terser --mangle --output ${dist_output}`,
    (err, stdout, stderr) => {
      if (err) {
        console.error(err)
        process.exit(err.code)
      } else {
        console.log(` ✅ Compiled ${bold(name)} project`)
      }
    }
  )
}

console.log(`Building Elm projects...`)
buildElmProject(elmApps.elmToAst)
buildElmProject(elmApps.offlinePackageDocs)
buildElmProject(elmApps.htmlToElm)