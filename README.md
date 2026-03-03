# Pony Extension for Visual Studio Code

## Build it

First, ensure you have Node.js and npm installed.

```sh
# build the extension
make
```

## Install it

```sh
# uninstall any previously installed extensions
code --uninstall-extension ponylang.pony

# install the newly-built package
code --install-extension "build/release/pony-${VERSION}.vsix"
```

## Configure the Language Server

### Prerequisites

Install `pony-lsp` and [`ponyc`](https://github.com/ponylang/ponyc) and ensure they're on your PATH. For example:

```sh
brew install ponyc
```

> [!IMPORTANT]
> `pony-lsp` 0.61.0 or above is required, to ensure it correctly locates the Pony standard library and accepts the needed configuration options.

The extension will show an error if `pony-lsp` is not found.

### Configuration

**`pony.lsp.executable`**: The file path to the `pony-lsp` executable. If not set, the extension will search for `pony-lsp` on your `PATH`.

**`pony.trace.server`**: Traces the communication between VS Code and the Pony language server. Accepted values are `"off"` (default), `"messages"`, and `"verbose"`.

```json
{
  "pony.lsp.executable": "/usr/local/bin/pony-lsp",
  "pony.trace.server": "off"
}
```
