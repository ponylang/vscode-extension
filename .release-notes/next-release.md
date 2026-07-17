## Stop passing arguments to pony-lsp

Against ponyc 0.67.0, the extension couldn't start the Pony language server. You would get a "Pony language server client failed" warning and `Pony LSP ✗` in the status bar. The language server now starts.

## Launch pony-lsp installed by ponyup on Windows

On Windows, the extension never started the Pony language server for anyone who installed Pony with ponyup. The extension reported pony-lsp as installed, then showed `Pony LSP ✗` in the status bar and gave you no language support. Installing Pony any other way, or working on any other platform, was unaffected. The language server now starts.

## Find a newly installed pony-lsp without restarting VS Code

When the extension couldn't find pony-lsp, installing it did nothing until you fully restarted VS Code. The extension checked for pony-lsp when it started and never again.

You no longer have to restart. After you install pony-lsp, run the **Pony: Restart Language Server** command or click **Retry** on the error and the language server starts. Setting `pony.lsp.executable` takes effect the same way. The extension now finds pony-lsp installed by ponyup as well as on your PATH.

