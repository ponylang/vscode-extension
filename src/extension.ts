import { access, constants } from 'node:fs';
import { PlatformPath, posix, win32 } from 'node:path';
import { promisify } from 'node:util';
import { commands, ConfigurationChangeEvent, ExtensionContext, window, StatusBarAlignment, StatusBarItem, workspace, OutputChannel } from 'vscode';
import { LanguageClient, LanguageClientOptions, ServerOptions } from 'vscode-languageclient/node';

const accessAsync = promisify(access);

const PONY_LSP = 'pony-lsp';
const RESTART_COMMAND = 'pony.restartLanguageServer';

// A context key the command palette entry is gated on, so the command is
// offered only after the extension has activated — which happens on opening a
// Pony file. Without the gate a contributed command shows in every window's
// palette, Pony project or not, because invoking it would activate the
// extension.
const ACTIVATED_CONTEXT = 'pony.activated';

// How long deactivate() will wait for the running client to shut down before it
// returns anyway. A client whose server spawned but never answered the LSP
// handshake would otherwise never finish stopping, and the host cannot tear
// down until deactivate() resolves.
const SHUTDOWN_TIMEOUT_MS = 3000;

// How long to wait for pony-lsp to answer the LSP handshake before giving up on
// a start. A server that spawns but never answers — a wrong binary, a batch
// wrapper that blocks — would otherwise leave start() pending forever, and with
// it every queued restart, so no command, Retry, or setting change could
// recover. Generous, so a slow-but-working server is not cut off.
const START_TIMEOUT_MS = 30000;

let client: LanguageClient | undefined;
let outputChannel: OutputChannel | undefined;
let statusBarItem: StatusBarItem | undefined;

// Restarts run one at a time. Each call chains onto the previous, so a run
// cannot begin until the one before it has finished — two of our clients are
// never alive at once, and there is no half-started client for a later run to
// race. `then(f, f)` runs the next start whether the previous run settled or
// rejected — the reject arm is there only in case startLanguageServer breaks
// its contract not to reject, not as a path taken in normal operation.
let queue: Promise<void> = Promise.resolve();

// Set for the duration of deactivate() so a start still on the queue does not
// bring a server up as the host is tearing down.
let shuttingDown = false;

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

// The prefix ponyup installs under, or undefined when it cannot be determined.
// ponyup links the selected toolchain's pony-lsp into `<prefix>/ponyup/bin`, so
// this is where a ponyup install has one even before its bin directory reaches
// PATH.
//
// The prefix is ponyup's own, not the init script's. PONYUP_PREFIX overrides
// everything (ponyup reads an empty value as unset and uses its default);
// otherwise it is the platform's per-user data directory. Off Windows that is
// $XDG_DATA_HOME or $HOME/.local/share — macOS lands there too, because ponyup
// runs appdirs in its unix mode. On Windows ponyup calls the OS for the local
// app-data folder; %LOCALAPPDATA% stands in for that folder and matches it
// unless the folder has been redirected.
function ponyupPrefix(): string | undefined {
  const configured = process.env.PONYUP_PREFIX;
  if (configured !== undefined && configured !== '') {
    return configured;
  }
  if (onWindows()) {
    return process.env.LOCALAPPDATA;
  }
  const xdgDataHome = process.env.XDG_DATA_HOME;
  if (xdgDataHome !== undefined) {
    return xdgDataHome;
  }
  const home = process.env.HOME;
  return home === undefined
    ? undefined
    : platformPath().join(home, '.local', 'share');
}

// ponyup's bin directory, or undefined when there is no usable one.
//
// The prefix must be absolute. A relative or empty one would make the resolve
// in resolvePonyLsp() fall back to the current directory, and the language
// client runs the server in the opened project — so a pony-lsp committed to a
// project would be found and run. That working-directory search was removed
// once before; this guard keeps it removed. pathDirectories() drops empty PATH
// entries for the same reason; this is that guard for this directory.
function ponyupBinDirectory(): string | undefined {
  const prefix = ponyupPrefix();
  if (prefix === undefined || !platformPath().isAbsolute(prefix)) {
    return undefined;
  }
  return platformPath().join(prefix, 'ponyup', 'bin');
}

// Returns the pony-lsp to launch, or undefined if none was found. Returning the
// path rather than a boolean points the launch at the file that was found, so
// the two cannot pick different pony-lsps.
//
// PATH is searched first, then ponyup's bin directory. PATH keeps precedence,
// so every install found today is found the same way; the ponyup directory is
// only reached when PATH has no pony-lsp. So an install found before this change
// is still found the same way, and the ponyup directory covers a fresh ponyup
// install whose bin directory is on the user's PATH but not yet on this
// process's — the extension host took its PATH when VS Code started and does not
// see a later change. Where ponyup's directory is already on PATH, that
// directory is found there and the fallback is not reached; when it is on PATH
// but holds no pony-lsp, the fallback searches it a second time, which is a few
// failing stats and not a bug.
//
// PATH is walked here rather than left to the shell that launches pony-lsp. A
// shell searches its working directory before PATH, and the language client
// runs the server in the opened project, so a pony-lsp committed to a project
// would win. An absolute path leaves the shell nothing to search for.
async function resolvePonyLsp(): Promise<string | undefined> {
  const directories = pathDirectories();
  const ponyupDirectory = ponyupBinDirectory();
  if (ponyupDirectory !== undefined) {
    directories.push(ponyupDirectory);
  }
  for (const dir of directories) {
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

// The message shown when pony-lsp is found nowhere. It names where the extension
// searched and the setting that overrides the search, so a user who has already
// put pony-lsp on PATH can see what else to try instead of being told again to
// do the thing they just did. ponyup's directory is named only when it was
// searched — it is skipped when its location cannot be determined.
function notFoundMessage(): string {
  const where = ponyupBinDirectory() !== undefined
    ? 'your PATH or ponyup\'s install directory'
    : 'your PATH';
  return `pony-lsp was not found on ${where}. `
    + 'Install pony-lsp (see ponyc\'s install instructions), or set '
    + '"pony.lsp.executable" to its full path. Then run '
    + '"Pony: Restart Language Server" or click Retry — no need to restart VS Code.';
}

type Resolution =
  | { kind: 'found'; path: string; custom: boolean }
  | { kind: 'missing'; message: string };

// Where pony-lsp is, or why it could not be found. A configured
// pony.lsp.executable is used if it points at an executable and is an error if
// it does not — it never falls back to a search, so a set-but-wrong path is not
// silently ignored in favour of some other pony-lsp.
async function resolveExecutable(): Promise<Resolution> {
  const configured = workspace.getConfiguration('pony').get<string>('lsp.executable', '');
  if (configured) {
    if (await checkExecutableFile(configured)) {
      return { kind: 'found', path: configured, custom: true };
    }
    return {
      kind: 'missing',
      message: `Configured pony-lsp executable not found or not executable: ${configured}`
    };
  }
  const resolved = await resolvePonyLsp();
  if (resolved !== undefined) {
    return { kind: 'found', path: resolved, custom: false };
  }
  return { kind: 'missing', message: notFoundMessage() };
}

// Stops and disposes the running client, if any, and forgets it. The client is
// cleared before the dispose is awaited, so a dispose that rejects — as it does
// for a client whose start was still in progress or had failed — still leaves
// nothing behind. dispose() goes through the node client's stop(), which
// schedules a kill of the server process even when the stop itself rejects.
async function retireClient(): Promise<void> {
  const current = client;
  client = undefined;
  if (current === undefined) {
    return;
  }
  try {
    await current.dispose();
  } catch (reason) {
    outputChannel?.appendLine(`ERROR: disposing pony-lsp client failed: ${reason}`);
  }
}

// Shows the not-found error with a Retry action. Fired and not awaited: awaiting
// it would hold up whatever reported the error until the user dismissed the
// notification. The Retry action goes back through the command, so it takes the
// same serialized path as any other restart. The trailing handler catches a
// rejection from either the notification or the command so neither goes
// unhandled.
function reportMissing(channel: OutputChannel, message: string): void {
  channel.appendLine(`ERROR: ${message}`);
  showPony(false);
  Promise.resolve(window.showErrorMessage(message, 'Retry'))
    .then((choice) => (choice === 'Retry' ? commands.executeCommand(RESTART_COMMAND) : undefined))
    .then(undefined, (reason) => {
      channel.appendLine(`ERROR: reporting missing pony-lsp failed: ${reason}`);
    });
}

// Resolves pony-lsp and brings the client up, replacing any running one. It
// reports every failure — through the output channel, a notification, and the
// status bar — and does not reject, because a caller that does not await it
// would leave the rejection unhandled, and activate() awaits it and would fail
// activation on a rejection.
async function startLanguageServer(): Promise<void> {
  await retireClient();
  const channel = outputChannel;
  if (shuttingDown || channel === undefined) {
    return;
  }

  const resolution = await resolveExecutable();
  // A shutdown, or a config change that raced this one, may have landed during
  // the awaits above. Re-check before anything with a visible effect.
  if (shuttingDown || outputChannel === undefined) {
    return;
  }
  if (resolution.kind === 'missing') {
    reportMissing(channel, resolution.message);
    return;
  }
  const lspExecutable = resolution.path;
  channel.appendLine(resolution.custom
    ? `Using custom pony-lsp executable: ${lspExecutable}`
    : `Using ${lspExecutable}`);

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
  const serverOptions: ServerOptions = {
    command: shell ? `"${lspExecutable}"` : lspExecutable,
    options: { env: process.env, shell }
  };

  const clientOptions: LanguageClientOptions = {
    documentSelector: [{ scheme: "file", language: "pony" }],
    diagnosticCollectionName: "Pony",
    stdioEncoding: "utf-8",
    traceOutputChannel: channel,
    outputChannel: channel,
  };

  try {
    // Recorded before start(), not after, so a deactivate() during a hung start
    // has the client to retire and its process to kill.
    const newClient = new LanguageClient('pony', 'Pony Language Server', serverOptions, clientOptions);
    client = newClient;

    channel.appendLine("Pony language server client starting…");
    await startWithTimeout(newClient);
    if (shuttingDown || outputChannel === undefined) {
      await retireClient();
      return;
    }
    channel.appendLine("Pony language server client ready");
    showPony(true);
  } catch (reason) {
    if (shuttingDown || outputChannel === undefined) {
      await retireClient();
      return;
    }
    channel.appendLine(`ERROR: Pony language server client failed: ${reason}`);
    Promise.resolve(window.showWarningMessage(`Pony language server client failed: ${reason}`))
      .then(undefined, () => {});
    showPony(false);
    await retireClient();
  }
}

// Starts the client, but rejects if it has not settled within START_TIMEOUT_MS.
// The start promise is not cancellable, so a timeout leaves it pending; its late
// settlement is swallowed here rather than surfacing as an unhandled rejection.
// The caller's catch retires the timed-out client, which kills its process.
async function startWithTimeout(newClient: LanguageClient): Promise<void> {
  const started = newClient.start();
  started.then(undefined, () => {});
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error(`pony-lsp did not answer within ${START_TIMEOUT_MS}ms`)),
      START_TIMEOUT_MS
    );
  });
  try {
    await Promise.race([started, timeout]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

// The one entry into a restart. Chains onto the queue so restarts serialize,
// and no-ops once shutting down so nothing starts a server after deactivate().
function restart(): Promise<void> {
  if (shuttingDown) {
    return Promise.resolve();
  }
  queue = queue.then(startLanguageServer, startLanguageServer);
  return queue;
}

export async function activate(context: ExtensionContext) {
  shuttingDown = false;
  queue = Promise.resolve();
  outputChannel = window.createOutputChannel("Pony Language Server");

  // Register the ways back into a restart before the first one runs. If
  // resolution returns early because pony-lsp is missing, these must already be
  // in place, or a failed first attempt leaves nothing to retry with.
  // Registering first also survives a thrown activation: the disposables are
  // already in context.subscriptions.
  context.subscriptions.push(
    commands.registerCommand(RESTART_COMMAND, () => restart())
  );
  context.subscriptions.push(
    workspace.onDidChangeConfiguration((event: ConfigurationChangeEvent) => {
      if (event.affectsConfiguration('pony.lsp.executable')) {
        void restart();
      }
    })
  );
  await commands.executeCommand('setContext', ACTIVATED_CONTEXT, true);

  await restart();
}

export async function deactivate(): Promise<void> {
  shuttingDown = true;
  statusBarItem?.dispose();
  statusBarItem = undefined;

  const channel = outputChannel;
  outputChannel = undefined;

  // Retire the client before anything that could stall, so shutting down always
  // kills the server's process. Retiring, not awaiting the queue: a hung start
  // leaves the queue pending forever. The race bounds even a dispose that stalls.
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    retireClient(),
    new Promise<void>((resolve) => { timer = setTimeout(resolve, SHUTDOWN_TIMEOUT_MS); })
  ]);
  if (timer !== undefined) {
    clearTimeout(timer);
  }

  channel?.dispose();
  await commands.executeCommand('setContext', ACTIVATED_CONTEXT, false);
}

export function showPony(good: boolean): void {
  statusBarItem ??= window.createStatusBarItem(StatusBarAlignment.Left);
  statusBarItem.text = good ? `Pony LSP ✓` : `Pony LSP ✗`;
  statusBarItem.show();
}
