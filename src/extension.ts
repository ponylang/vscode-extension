import { access, constants } from 'node:fs';
import { PlatformPath, posix, win32 } from 'node:path';
import { promisify } from 'node:util';
import { ExtensionContext, window, StatusBarAlignment, StatusBarItem, workspace, OutputChannel } from 'vscode';
import { LanguageClient, LanguageClientOptions, ServerOptions } from 'vscode-languageclient/node';

const accessAsync = promisify(access);

const PONY_LSP = 'pony-lsp';

let client: LanguageClient | undefined;
let outputChannel: OutputChannel;
let statusBarItem: StatusBarItem | undefined;

function onWindows(): boolean {
  return process.platform === 'win32';
}

// Windows and POSIX split PATH differently and join a path differently, and
// `node:path` binds those to the host it was imported on. Taking them from the
// same condition as the rest of the Windows handling keeps this one decision
// rather than two that can drift apart.
function platformPath(): PlatformPath {
  return onWindows() ? win32 : posix;
}

// The extensions that make a name executable, in the order Windows tries them.
// Elsewhere a name carries its own extension if it has one.
function executableExtensions(): string[] {
  if (!onWindows()) {
    return [''];
  }
  const pathext = process.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD';
  return pathext.split(';').filter((ext) => ext !== '');
}

// The directories on PATH, in search order. Windows permits a quoted entry.
function pathDirectories(): string[] {
  const dirs = (process.env.PATH ?? '').split(platformPath().delimiter);
  const unquoted = onWindows()
    ? dirs.map((dir) => dir.replace(/^"(.*)"$/, '$1'))
    : dirs;
  return unquoted.filter((dir) => dir !== '');
}

// Returns where pony-lsp is installed, or undefined if it isn't on PATH.
// Returning the path rather than a boolean points the launch at the file that
// was found, so the two cannot pick different pony-lsps.
//
// PATH is walked here rather than left to the shell that launches pony-lsp. A
// shell searches its working directory before PATH, and the language client
// runs the server in the opened project, so a pony-lsp committed to a project
// would win. An absolute path leaves the shell nothing to search for.
async function resolvePonyLsp(): Promise<string | undefined> {
  for (const dir of pathDirectories()) {
    for (const ext of executableExtensions()) {
      const candidate = platformPath().resolve(dir, PONY_LSP + ext);
      if (await checkExecutableFile(candidate)) {
        return candidate;
      }
    }
  }
  return undefined;
}

// Windows runs an executable directly and everything else — a batch file, a
// script — only through a shell. A filename's suffix is what says which, so
// ask a pony-lsp what it is rather than assume from the platform that it needs
// one.
function needsShell(lspExecutable: string): boolean {
  if (!onWindows()) {
    return false;
  }
  const directlyRunnable = ['.exe', '.com'];
  return !directlyRunnable.includes(platformPath().extname(lspExecutable).toLowerCase());
}

async function checkExecutableFile(filePath: string): Promise<boolean> {
  try {
    await accessAsync(filePath, constants.F_OK | constants.X_OK);
    return true;
  } catch (error) {
    return false;
  }
}

export async function activate(_context: ExtensionContext) {
  outputChannel = window.createOutputChannel("Pony Language Server");
  const config = workspace.getConfiguration('pony');

  // Check if custom LSP executable is provided or use pony-lsp from PATH
  let lspExecutable = config.get<string>('lsp.executable', '');
  if (lspExecutable) {
    // If custom executable is provided, validate it's an executable file
    const isValidExecutable = await checkExecutableFile(lspExecutable);
    if (!isValidExecutable) {
      const errorMessage = `Configured pony-lsp executable not found or not executable: ${lspExecutable}`;
      window.showErrorMessage(errorMessage);
      outputChannel.appendLine(`ERROR: ${errorMessage}`);
      showPony(false);
      return;
    }
    outputChannel.appendLine(`Using custom pony-lsp executable: ${lspExecutable}`);
  } else {
    // If no configured executable, find pony-lsp on PATH
    const resolved = await resolvePonyLsp();
    if (resolved === undefined) {
      const errorMessage = 'pony-lsp not found on PATH. Please install pony-lsp and ensure it is available in your system PATH.';
      window.showErrorMessage(errorMessage);
      outputChannel.appendLine(`ERROR: ${errorMessage}`);
      showPony(false);
      return;
    }
    lspExecutable = resolved;
    outputChannel.appendLine(`Using ${lspExecutable} from PATH`);
  }

  // Nothing here may become a pony-lsp argument. As of ponyc 0.67.0, pony-lsp
  // declares no positional arguments and no option beyond --version and --help
  // (see ponyc's tools/pony-lsp), and exits 1 on anything else before it
  // speaks LSP. `args` is passed through as-is; `transport` appends --stdio.
  //
  // A batch file runs only through a shell, so a pony-lsp installed as one
  // needs cmd standing between this process and the server. An executable does
  // not, and putting cmd there anyway would make pony-lsp a grandchild of this
  // process for nothing. Off Windows nothing needs a shell.
  //
  // A shell re-parses the command, so where there is one the path is quoted:
  // unquoted, a space in it would split the command and the tail would arrive
  // as pony-lsp arguments. Quoting does not carry a path containing `%`, which
  // cmd expands inside quotes regardless of them.
  const shell = needsShell(lspExecutable);
  let serverOptions: ServerOptions = {
    command: shell ? `"${lspExecutable}"` : lspExecutable,
    options: { env: process.env, shell }
  };

  // Options to control the language client
  let clientOptions: LanguageClientOptions = {
    documentSelector: [{ scheme: "file", language: "pony" }],
    diagnosticCollectionName: "Pony",
    stdioEncoding: "utf-8",
    traceOutputChannel: outputChannel,
    outputChannel: outputChannel,
  };

  // Create the language client and start the client.
  client = new LanguageClient(
    'pony',
    'Pony Language Server',
    serverOptions,
    clientOptions
  );

  outputChannel.appendLine("Pony language server client starting…");
  // Start the client. This will also launch the server
  try {
    await client.start();
    outputChannel.appendLine("Pony language server client ready");
    showPony(true);
  } catch (reason) {
    window.showWarningMessage(`Pony language server client failed: ${reason}`);
    showPony(false);
    client = undefined;
  }
}

export async function deactivate(): Promise<void> {
  statusBarItem?.dispose();
  statusBarItem = undefined;
  return client?.stop();
}

export function showPony(good: boolean): void {
  statusBarItem ??= window.createStatusBarItem(StatusBarAlignment.Left);
  statusBarItem.text = good ? `Pony LSP ✓` : `Pony LSP ✗`;
  statusBarItem.show();
}
