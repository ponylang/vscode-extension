// https://github.com/zigtools/zls-vscode/blob/master/src/extension.ts

// git tags by date
// git tag --sort=-creatordate

import { ExtensionContext, window, StatusBarAlignment, StatusBarItem, workspace, OutputChannel } from 'vscode';
import { execSync } from 'child_process';
import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
  TransportKind,
} from 'vscode-languageclient/node';

let client: LanguageClient | undefined;
let outputChannel: OutputChannel;

function checkPonyLspExists(): boolean {
  try {
    const command = process.platform === 'win32' ? 'where pony-lsp' : 'which pony-lsp';
    execSync(command, { stdio: 'pipe' });
    return true;
  } catch (error) {
    return false;
  }
}

export async function activate(_context: ExtensionContext) {
  outputChannel = window.createOutputChannel("Pony Language Server");

  // Check if pony-lsp is available on PATH
  if (!checkPonyLspExists()) {
    const errorMessage = 'pony-lsp not found on PATH. Please install pony-lsp and ensure it is available in your system PATH.';
    window.showErrorMessage(errorMessage);
    outputChannel.appendLine(`ERROR: ${errorMessage}`);
    showPony(false);
    return;
  }

  showPony(true);

  // Get configuration
  const config = workspace.getConfiguration('pony');
  const ponyStdLibPath = config.get<string>('ponyStdLibPath', '');

  // Prepare environment variables
  const env = { ...process.env };

  // Set or append to PONYPATH
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
    command: "pony-lsp",
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

  outputChannel.appendLine("PonyLSP client ready");
  // Start the client. This will also launch the server
  return client.start().catch(reason => {
    window.showWarningMessage(`Failed to run Pony Language Server (PLS): ${reason}`);
    showPony(false);
    client = undefined;
  });
}

export async function deactivate(): Promise<void> {
  return client?.stop();
}

export var ponyVerEntry: StatusBarItem;

export function showPony(good: boolean) {
  ponyVerEntry = window.createStatusBarItem(StatusBarAlignment.Left);
  if (good) ponyVerEntry.text = `Pony LSP ✓`;
  else ponyVerEntry.text = `Pony LSP ✗`;
  ponyVerEntry.show();
}
