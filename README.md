# Pony Extension for Visual Studio Code

## Build it

```sh
# install dependencies
npm install

# compile the code
npm run compile

# build the package
npm run vsce package
```

Alternatively run `make`!

## Install it

```sh
# uninstall any previously installed extensions
code --uninstall-extension ponylang.pony

# install the newly-built package
code --install-extension "pony-${VERSION}.vsix"
```

## Configure the Language Server

### Prerequisites

Install `pony-lsp` and [`ponyc`](https://github.com/ponylang/ponyc) and ensure they're on your PATH. For example:

```sh
brew install ponyc
```

The extension will show an error if `pony-lsp` is not found.

### Configuration

**`pony.ponyStdLibPath`**: The file path to the Pony standard library. If set, prepended to `PONYPATH`.

```json
{
  "pony.ponyStdLibPath": "/usr/local/lib/ponyc/0.60.5/packages"
}
```
