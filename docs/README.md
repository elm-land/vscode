# Documentation
> Documentation for the Elm Land VS code plugin

### __Table of contents__

- 📚 [Features](#features)
  - [Syntax highlighting](#syntax-highlighting)
  - [Format on save](#format-on-save)
  - [Error highlighting](#error-highlighting)
  - [Jump-to-definition](#jump-to-definition)
  - [Offline package docs](#offline-package-docs)
  - [Module import autocomplete](#module-import-autocomplete)
  - [Convert HTML to Elm](#convert-html-to-elm)
- 📊 [Performance Table](#performance-table)
- 💖 [Thank you, Elm community](#thank-you-elm-community)

## __Features__

With the Elm Land plugin, every feature (except "Syntax highlighting") is fully optional. By default, all features are enabled. If you prefer a more minimal editing experience, you can disable any feature in your [VS Code "User Settings"](https://code.visualstudio.com/docs/getstarted/settings).

This section breaks down what each feature does, and the VS code configuration setting that enable/disable it.

---

### __Syntax highlighting__

__Setting:__ _None_ 

Provides basic [syntax highlighting](https://en.wikipedia.org/wiki/Syntax_highlighting) to help you visually scan your Elm code, increase readability, and provide context. This feature is the only one that cannot be disabled.

![Syntax highlighting demo](./syntax-highlighting.jpg)

---

### __Format on save__

__Setting:__ `formatOnSave`

Uses [elm-format](https://github.com/avh4/elm-format) to automatically format your code on save. This requires the `elm-format` command to be installed on your computer, and the VS code plugin can take care of that for you if you already have [Node.js](https://nodejs.org/en/download/) installed.

![Format on save demo](./format-on-save.gif)

---

### __Error highlighting__

__Setting:__ `elmLand.feature.errorHighlighting`

If your Elm code doesn't compile, this feature will underline the relevant problems in your editor. It depends on a local installation of `elm` on your computer.

When you open an Elm file, or save one, you'll see a red underline under each compiler error. 

![Error highlighting demo](./error-highlighting.gif)

__Note:__ The Elm Land plugin will also check the `elmLand.entrypointFilepaths` setting to compile the top-level Elm program. This allows the editor to report errors in other files. If your project doesn't use `src/Main.elm` as the program's entrypoint, change the `elmLand.entrypointFilepaths` settings in that workspace's `.vscode/settings.json` file. 

---

### __Jump to definition__

__Setting:__ `elmLand.feature.jumpToDefinition`

You can jump to the definition of any function or value, even if it's defined in another module. This is helpful for quickly navigating around.

![Jump to definition](./jump-to-definition.gif)

---

### __Offline package docs__

__Setting:__ `elmLand.feature.offlinePackageDocs`

Every Elm package in the ecosystem comes with built-in documentation. With this feature, even if you're offline, you can access this documentation from within your editor.

![Offline package docs demo](./offline-package-docs.gif)

---

### __Module import autocomplete__

__Setting:__ `elmLand.feature.autocomplete`

Every Elm module in your project, and any Elm package you installed will provide autocomplete information for the exposed types, functions, and values. To see more detailed documentation, you can even toggle details panel for each autocomplete suggestion.

![Autocomplete demo](./autocomplete.gif)

---

### __Convert HTML to Elm__

__Setting:__ `elmLand.feature.htmlToElm`

To help you convert HTML snippets to Elm code and help newcomers learn the syntax of Elm, this plugin comes with a built-in "HTML to Elm" action whenever you highlight over a snippet of HTML code.

![HTML to Elm demo with a TailwindCSS snippet](./html-to-elm.gif)

---

## __Performance Table__

Elm's [editor plugins repo](https://github.com/elm/editor-plugins) recommends doing performance profiling to help others learn how different editors implement features, and also to help try to think of ways to bring down costs.

This VS code plugin was specifically designed to have __near-zero memory overhead [¹](#¹-ram-overhead)__, and to __avoid in-memory indexing__ that cache your codebase before invoking features. For this reason, it's been very effective at [Vendr](https://vendr.com), even though the frontend codebase is __over 400k lines__ of Elm code.

---

### `rtfeldman/elm-spa-example` (4K LOC, 34 files)

These benchmarks were taken on a __Windows PC [²](#²-pc-specs)__ testing this plugin against [rtfeldman/elm-spa-example](https://github.com/rtfeldman/elm-spa-example) repository, which has 3.8k lines of Elm code across 34 files.

Feature | Average Speed | Constant RAM Overhead | Cumulative CPU Costs | Battery Implications
:------ | :------------ | :-------------------- | :------------------- | :-------------------
__Format on save__ | <500ms | _None_ | On command | notable
__Error highlighting__| <500ms | _None_ | On file open and save | minimal
__Jump-to-definition__ | <150ms | _None_ | On file open and save | notable
__Offline package docs__ | <100ms | _None_ | On command | minimal
__Module import autocomplete__ | <100ms | _None_ | On key stroke | minimal
__Convert HTML to Elm__ | <100ms | _None_ | On command | minimal


#### __¹. RAM overhead__

The only in-memory overhead from this plugin comes from caching the contents of your `elm.json` files within the current workspace, and any `docs.json` files for packages that you are using.

For example, if your project is using `elm/http@2.0.0`, the contents of `$ELM_HOME/0.19.1/packages/elm/http/2.0.0/docs.json` would be cached in working RAM to improve performance for the [Offline package docs](#offline-package-docs), [Module import autocomplete](#module-import-autocomplete), and [Jump-to-definition](#jump-to-definition) features.

This means a __tiny project with 10 lines of Elm code__ and a __huge project with 500k+ lines of Elm code__, would have __the same RAM overhead__, assuming they had the same Elm package dependencies!

#### __². PC Specs__

The Windows PC has the following specifications:
- __OS__: Windows 11 Home 64-bit
- __Processor__: Intel(R) Core(TM) i9-9980HK CPU @ 2.40GHz (16 CPUs), ~2.4GHz
- __Memory:__ 16GB RAM

## __Thank you, Elm community!__

This VS Code plugin was made possible by the following open-source projects. Thank you to everyone for doing the hard work of making compilation, formatting, syntax highlighting, and AST parsing a solved problem:

### __Evan Czaplicki__ ([@evancz](https://github.com/evancz))

Evan laid an incredible foundation for this plugin project. This includes everything from helpful READMEs like the ones in [elm/editor-plugins](https://github.com/elm/editor-plugins) to the design choices like storing documentation offline in the `ELM_HOME` directory. 

I couldn't have done __Error highlighting__ without the [elm/compiler](https://github.com/elm/compiler), nor 
implemented the __Offline package docs__ UI without helpful packages like [elm/project-metadata-utils](https://github.com/elm/project-metadata-utils). 

Thanks so much, Evan- you made the plugin authoring experience a breeze!

### __Mats Stijlaart__ ([@stil4m](https://github.com/stil4m))

The [stil4m/elm-syntax](https://github.com/stil4m/elm-syntax) package made it possible for me to include __Jump to definition__, __Module import autocomplete__, and the __Offline Package Docs__ features. Creating a reliable Elm parser that I could run within my VS code extension would have been a difficult hurdle for me.

Thank you, Mats! This AST parser was a _huge_ part of the plugin work.

### __Aaron VonderHaar__ ([@avh4](https://github.com/avh4))

Aaron's work on [avh4/elm-format](https://github.com/avh4/elm-format) made it possible for me to quickly provide the __Format on save__ feature by running your CLI tool directly. The performance is great, and the NPM installer makes it easy for folks to install it on their machines.

Thank you, Aaron, `elm-format` is awesome!

### __Kolja Lampe__ ([@razzeee](https://github.com/razzeee))

Kolja's work on the [elm-tooling/elm-language-client-vscode](https://github.com/elm-tooling/elm-language-client-vscode) made __Syntax highlighting__ possible. The [`elm-syntax.json`](https://github.com/elm-tooling/elm-language-client-vscode/blob/23bf1ae459f7053cc100aa129e2c4d8faca0dabf/syntaxes/elm-syntax.json) and [`codeblock.json`](https://github.com/elm-tooling/elm-language-client-vscode/blob/23bf1ae459f7053cc100aa129e2c4d8faca0dabf/syntaxes/codeblock.json) were already battle-tested and reliable from the existing [Elm LS plugin](https://marketplace.visualstudio.com/items?itemName=Elmtooling.elm-ls-vscode).

Thank you Kolja, and the folks in `elm-community`, for providing this open-source project for tooling authors like me to learn from and build!

### __The Sett__ ([@the-sett](https://github.com/the-sett))

When adding the __HTML to Elm__ feature, both the [the-sett/elm-pretty-printer](https://github.com/the-sett/elm-pretty-printer) and [the-sett/elm-syntax-dsl](https://github.com/the-sett/elm-syntax-dsl) allowed me to turn an Elm AST into an `elm-format` compatible string.

Thank you [Rupert](https://github.com/rupertlssmith) and [pwentz](https://github.com/pwentz) for your contributions to these repos!

### __Jim Sagevid__ ([@jims](https://github.com/jims))

Jim provided the HTML parser that powers the __HTML to Elm__ feature. The [jims/html-parser](https://github.com/jims/html-parser) package made it easy for to add the feature to help lower the learning curve for newcomers to Elm.

Thank you, Jim! Your Elm package rocks!
