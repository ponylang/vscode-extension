import { execSync } from 'node:child_process';
import { access, constants } from 'node:fs';
import { promisify } from 'node:util';
import { ExtensionContext, window, StatusBarAlignment, StatusBarItem, workspace, OutputChannel } from 'vscode';
import { LanguageClient, LanguageClientOptions, ServerOptions, TransportKind } from 'vscode-languageclient/node';

const accessAsync = promisify(access);

let client: LanguageClient | undefined;
let outputChannel: OutputChannel;
let statusBarItem: StatusBarItem | undefined;

function checkPonyLspExists(): boolean {
  try {
    const command = process.platform === 'win32' ? 'where pony-lsp' : 'which pony-lsp';
    execSync(command, { stdio: 'pipe' });
    return true;
  } catch (error) {
    return false;
  }
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
    // If no configured executable, check if pony-lsp is available on PATH
    lspExecutable = 'pony-lsp';
    if (!checkPonyLspExists()) {
      const errorMessage = `${lspExecutable} not found on PATH. Please install ${lspExecutable} and ensure it is available in your system PATH.`;
      window.showErrorMessage(errorMessage);
      outputChannel.appendLine(`ERROR: ${errorMessage}`);
      showPony(false);
      return;
    }
    outputChannel.appendLine(`Using ${lspExecutable} from PATH`);
  }
  showPony(true);

  // Set or append to PONYPATH environment variable
  const ponyStdLibPath = config.get<string>('ponyStdLibPath', '');
  const env = { ...process.env };
  if (ponyStdLibPath) {
    if (env.PONYPATH) {
      const pathSeparator = process.platform === 'win32' ? ';' : ':';
      env.PONYPATH = `${ponyStdLibPath}${pathSeparator}${env.PONYPATH}`;
      outputChannel.appendLine(`Prepending to PONYPATH: ${ponyStdLibPath}`);
      outputChannel.appendLine(`Full PONYPATH: ${env.PONYPATH}`);
    } else {
      env.PONYPATH = ponyStdLibPath;
      outputChannel.appendLine(`Setting PONYPATH: ${ponyStdLibPath}`);
    }
  } else if (env.PONYPATH) {
    outputChannel.appendLine(`Using existing PONYPATH: ${env.PONYPATH}`);
  }

  // If the extension is launched in debug mode then the debug server options are used
  // Otherwise the run options are used
  let serverOptions: ServerOptions = {
    command: lspExecutable,
    args: ["stdio"],
    transport: TransportKind.stdio,
    options: { env }
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
  return client
    .start()
    .then(() => {
      outputChannel.appendLine("Pony language server client ready");
    })
    .catch((reason) => {
      window.showWarningMessage(`Pony language server client failed: ${reason}`);
      showPony(false);
      client = undefined;
    });
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
