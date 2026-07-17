## Stop passing arguments to pony-lsp

Against ponyc 0.67.0, the extension couldn't start the Pony language server. You would get a "Pony language server client failed" warning and `Pony LSP ✗` in the status bar. The language server now starts.

## Launch pony-lsp installed by ponyup on Windows

On Windows, the extension never started the Pony language server for anyone who installed Pony with ponyup. The extension reported pony-lsp as installed, then showed `Pony LSP ✗` in the status bar and gave you no language support. Installing Pony any other way, or working on any other platform, was unaffected. The language server now starts.

