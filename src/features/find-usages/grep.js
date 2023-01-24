// @ts-check
const { exec } = require('node:child_process')

// 
// In Elm, the only way module "XYZ" could be used is if
// there is at least one line starting with "import XYZ"
// 
// Note: This function may overmatch on Windows, because I couldn't find
// a way to make "findstr" distinguish "import XYZ" from "import XYZABC" 
// or "import XYZ.ABC"
// 
//    findElmFilesImportingModule({
//      moduleName: 'Http',
//      folders: [
//        '/Users/ryan/code/elm-land/vscode/examples/01-hello-world/src'
//      ]
//    })
// 

/**
 * @type {(input: { folders: string[], moduleName: string }) => Promise<string[]>}
 */
const findElmFilesImportingModule = async ({ folders, moduleName }) => {
  const isWindows = process.platform === "win32"
  // 
  // Example for Linux / MacOS:
  // 
  //   grep -rl '^import Html\s\|^import Html$' folder1/src folder2/src --include='*.elm'
  // 
  // Example for Windows:
  // 
  //   findstr /srm /c:"^import Html" /d:folder1\src;folder2\src *.elm
  // 
  // 
  const { command, args } =
    isWindows
      ? { command: 'findstr', args: [`/srm`, `/c:"^import ${moduleName}"`, `/d:${folders.join(';')}`, `*.elm`] }
      : { command: 'grep', args: [`-rl`, `'^import ${moduleName}\\s\\|^import ${moduleName}$'`, ...folders, `--include='*.elm'`] }

  return new Promise((resolve) => {
    exec([command, ...args].join(' '), (err, stdout) => {
      if (err) {
        resolve([])
      } else {
        resolve(stdout.split('\n').filter(a => a))
      }
    })
  })
}

/**
 * 
 * 
 * 
 */


module.exports = {
  findElmFilesImportingModule
}