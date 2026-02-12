## Add the Pony icon to the VS Code extension

Users now see the Pony icon when viewing the extension in Visual Studio Code.
## Ensure only one Pony status bar item is displayed

In some error scenarios, two Pony status bar items were created and displayed to the user. This is now fixed.

## Add configurable LSP executable path

Added a new configuration option `pony.lsp.executable` to specify a custom path to the Pony language server executable. If not set, the extension falls back to searching for `pony-lsp` on the system PATH as before.

