# elm-grep

This is a tiny helper module for implementing the "Find usages" feature. 

It allows us to scan all `*.elm` files in a project to look for lines that match `import XYZ` in a cross-platform way.

From there, we can scan the AST of the matched files, and help Elm developers find out where code is being used in their application.

```ts
import * as ElmGrep from './elm-grep'

const matchingFilepaths : string[] =
  await findElmFilesImportingModule({
    moduleName: 'Http',
    folders: [
      '/Users/ryan/code/elm-hello-world/src'
    ]
  })
```

The `elm-grep` package overmatches as a starting point, and the idea is to scan each file afterwards to determine if the AST is using a giving import like `Http.get` or `Html.text`.