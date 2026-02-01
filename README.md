# Pony Extension for Visual Studio Code

## How to Build

```sh
# compile the code
npm install
npm run compile
# build the package
vsce package "${VERSION}"
# uninstall any previously installed packages
code --uninstall-extension undefined_publisher.pony-lsp
# install the package
code --install-extension "pony-lsp-${VERSION}.vsix"
```
