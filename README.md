# @elm-land/vscode
> a minimal VS Code plugin for Elm

## features

- [x] Syntax highlighting
- [x] Underline Elm compiler errors
- [x] Run elm format on save
- [ ] Provide color error message output
- [ ] Jump to definition
- [ ] Module and record autocomplete on "."

---

## contributing

### bundle the plugin

```
npm run bundle
```

This command will rebuild the `elm-land-1.0.0.vsix` file you see at the root of this repo.

You can use this VSIX file to install the extension by hand, without it needing to be published on the VS code store.


### local development

```
npm run dev
```

This command will make sure your TypeScript code is always compiling in the background.

You can play around with the plugin in your debugger. Press `F5` to run it!