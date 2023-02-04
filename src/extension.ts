import * as vscode from "vscode"
import * as AutodetectElmJson from "./features/autodetect-elm-json"
import { GlobalState } from "./features/autodetect-elm-json"
import * as ElmFormatOnSave from "./features/elm-format-on-save"
import * as ErrorHighlighting from "./features/error-highlighting"
import * as JumpToDefinition from "./features/jump-to-definition"
import * as OfflinePackageDocs from "./features/offline-package-docs"
import * as TypeDrivenAutocomplete from './features/type-driven-autocomplete'
import * as FindUsages from "./features/find-usages"
import * as HtmlToElm from './features/html-to-elm'

export async function activate(context: vscode.ExtensionContext) {
  console.info("ACTIVATE")

  // Global context available to functions below
  let globalState: GlobalState = { elmJsonFiles: [], jumpToDocDetails: undefined }
  context.subscriptions.push({
    dispose: () => { globalState = undefined as any }
  })
  await AutodetectElmJson.initialize({ globalState, context })

  // Highlighted features
  ElmFormatOnSave.feature({ globalState, context })
  ErrorHighlighting.feature({ globalState, context })

  // Additional features
  JumpToDefinition.feature({ globalState, context })
  OfflinePackageDocs.feature({ globalState, context })
  TypeDrivenAutocomplete.feature({ globalState, context })
  FindUsages.feature({ globalState, context })
  HtmlToElm.feature({ globalState, context })
}

export function deactivate() {
  console.info('DEACTIVATE')
}
