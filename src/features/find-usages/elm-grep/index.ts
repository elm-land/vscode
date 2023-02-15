import { exec } from 'node:child_process'

type Input = {
  folders: string[]
  moduleName: string
  typeOrValueName: string
}

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

const findElmFilesImportingModule =
  async ({ folders, moduleName }: {
    folders: string[]
    moduleName: string
  }): Promise<string[]> => {
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
        ? {
          command: 'findstr',
          args: [
            `/srm`,
            `/c:"^import ${moduleName}"`,
            `/d:${folders.join(';')}`,
            `*.elm`
          ]
        }
        : {
          command: 'grep',
          args: [
            `-rl`,
            `'^import ${moduleName}\\s\\|^import ${moduleName}$'`,
            ...folders,
            `--include='*.elm'`
          ]
        }

    console.log('')
    console.log([command, ...args].join(' '))
    console.log('')

    return new Promise((resolve) => {
      exec([command, ...args].join(' '), (err, stdout) => {
        if (err) {
          resolve([])
        } else {
          let filepaths = stdout.split('\n').filter(a => a)
          resolve(filepaths)
        }
      })
    })
  }


const findElmFilesImportingModuleWithValueName =
  async ({ folders, moduleName, typeOrValueName }: Input): Promise<string[]> => {
    // Find all filepaths importing the module
    let filepathsImportingModule = await findElmFilesImportingModule({ folders, moduleName })

    const isWindows = process.platform === "win32"
    // 
    // Example for Linux / MacOS:
    // 
    //   grep -rl 'Model' filepath1.elm filepath2.elm
    // 
    // Example for Windows:
    // 
    //   findstr /srm /c:"Model" filepath1.elm filepath2.elm
    // 
    // 
    const { command, args } =
      isWindows
        ? {
          command: 'findstr',
          args: [
            `/srm`,
            `/c:"${typeOrValueName}"`,
            ...filepathsImportingModule
          ]
        }
        : {
          command: 'grep',
          args: [
            `-rl`,
            `'${typeOrValueName}'`,
            ...filepathsImportingModule
          ]
        }

    return new Promise((resolve) => {
      exec([command, ...args].join(' '), (err, stdout) => {
        if (err) {
          resolve([])
        } else {
          let filepaths = stdout.split('\n').filter(a => a)
          resolve(filepaths)
        }
      })
    })
  }

export default {
  findElmFilesImportingModuleWithValueName
}