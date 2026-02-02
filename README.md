# Pony Extension for Visual Studio Code

## How to Build

```sh
# install dependencies
npm install

# compile the code
npm run compile

# build the package
npm run vsce package

# uninstall any previously installed extensions
code --uninstall-extension ponylang.pony

# install the newly-built package
code --install-extension "pony-${VERSION}.vsix"
```
