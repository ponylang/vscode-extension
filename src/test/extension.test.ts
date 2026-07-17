import * as assert from 'assert';
import { describe as context, describe, it, beforeEach, afterEach } from 'mocha';
import proxyquire from 'proxyquire';
import * as sinon from 'sinon';
import * as vscode from 'vscode';

const RESTART_COMMAND = 'pony.restartLanguageServer';
const ACTIVATED_CONTEXT = 'pony.activated';

// A directory on PATH the tests place pony-lsp in. Not ponyup's install
// location — the ponyup fixtures below are separate, so a test can tell "found
// on PATH" from "found in ponyup's directory".
const WINDOWS_PATH_DIR = 'C:\\tools\\bin';
const WINDOWS_PATH = `C:\\Windows\\system32;${WINDOWS_PATH_DIR}`;
const WINDOWS_PATHEXT = '.COM;.EXE;.BAT;.CMD';
const WINDOWS_BAT = `${WINDOWS_PATH_DIR}\\pony-lsp.BAT`;
const WINDOWS_EXE = `${WINDOWS_PATH_DIR}\\pony-lsp.EXE`;

// ponyup's Windows layout, reached through %LOCALAPPDATA%.
const WINDOWS_LOCALAPPDATA = 'C:\\Users\\pony\\AppData\\Local';
const WINDOWS_PONYUP_DIR = `${WINDOWS_LOCALAPPDATA}\\ponyup\\bin`;
const WINDOWS_PONYUP_BAT = `${WINDOWS_PONYUP_DIR}\\pony-lsp.BAT`;

// Off Windows.
const POSIX_DIR = '/usr/local/bin';
const POSIX_PATH = `/usr/bin:${POSIX_DIR}`;
const POSIX_PONY_LSP = `${POSIX_DIR}/pony-lsp`;

// ponyup's POSIX layouts: via XDG_DATA_HOME, and via $HOME/.local/share.
const POSIX_HOME = '/home/pony';
const POSIX_XDG = '/home/pony/.local/share';
const POSIX_XDG_PONY_LSP = `${POSIX_XDG}/ponyup/bin/pony-lsp`;
const POSIX_HOME_PONY_LSP = `${POSIX_HOME}/.local/share/ponyup/bin/pony-lsp`;

// A stand-in working directory for the tests that prove a relative or empty
// ponyup prefix is never resolved against the current directory.
const POSIX_CWD = '/opt/project';

interface MockLanguageClient {
  start: sinon.SinonStub<any[], Promise<void>>;
  stop: sinon.SinonStub<any[], Promise<void>>;
  dispose: sinon.SinonStub<any[], Promise<void>>;
}

type MockOutputChannel = Partial<vscode.LogOutputChannel> & {
  appendLine: sinon.SinonStub<[string], void>;
  append: sinon.SinonStub<[string], void>;
  clear: sinon.SinonStub<[], void>;
  show: sinon.SinonStub<any[], void>;
  hide: sinon.SinonStub<[], void>;
  dispose: sinon.SinonStub<[], void>;
  name: string;
  replace: sinon.SinonStub<[string], void>;
};

type MockStatusBarItem = Partial<vscode.StatusBarItem> & {
  text: string;
  show: sinon.SinonStub<[], void>;
  hide: sinon.SinonStub<[], void>;
  dispose: sinon.SinonStub<[], void>;
};

interface ExtensionModule {
  activate(context: vscode.ExtensionContext): Promise<void>;
  deactivate(): Promise<void>;
}

interface MockConfig extends Partial<vscode.WorkspaceConfiguration> {
  get: sinon.SinonStub<any[], any>;
}

function makeExtensionContext(): vscode.ExtensionContext {
  return {
    subscriptions: [],
    workspaceState: {
      get: () => undefined,
      update: async () => {},
      keys: () => []
    } as vscode.Memento,
    globalState: {
      get: () => undefined,
      update: async () => {},
      keys: () => [],
      setKeysForSync: () => {}
    } as vscode.Memento & { setKeysForSync(keys: readonly string[]): void },
    extensionPath: '',
    asAbsolutePath: (relativePath: string) => relativePath,
    storagePath: undefined,
    globalStoragePath: '',
    logPath: '',
    extensionUri: vscode.Uri.file(''),
    environmentVariableCollection: {} as vscode.GlobalEnvironmentVariableCollection,
    extensionMode: vscode.ExtensionMode.Test,
    storageUri: undefined,
    globalStorageUri: vscode.Uri.file(''),
    logUri: vscode.Uri.file(''),
    secrets: {
      get: async () => undefined,
      store: async () => {},
      delete: async () => {},
      keys: async () => [],
      onDidChange: new vscode.EventEmitter<vscode.SecretStorageChangeEvent>().event
    } as vscode.SecretStorage,
    extension: {
      id: 'test.extension',
      extensionUri: vscode.Uri.file(''),
      extensionPath: '',
      isActive: true,
      packageJSON: {},
      extensionKind: vscode.ExtensionKind.UI,
      exports: undefined,
      activate: async () => {},
    } as vscode.Extension<unknown>,
    languageModelAccessInformation: {
      onDidChange: new vscode.EventEmitter<void>().event,
      canSendRequest: () => undefined
    } as vscode.LanguageModelAccessInformation,
  };
}

describe('Extension Test Suite', () => {
  vscode.window.showInformationMessage('Start all tests.');

  let sandbox: sinon.SinonSandbox;
  let languageClientStub: sinon.SinonStub<any[], MockLanguageClient>;
  let sut: ExtensionModule;

  // The files that exist and are executable. The extension finds pony-lsp by
  // asking after candidate paths, so this stands in for what is installed.
  let installed: Set<string>;

  // The command handlers and configuration listeners the extension registered.
  // vscode.commands and workspace.onDidChangeConfiguration are real API here, so
  // registering into the process-global registry twice would throw; these stubs
  // capture the registrations instead and let a test drive them.
  let commandHandlers: Map<string, (...args: any[]) => any>;
  let configListeners: Array<(event: vscode.ConfigurationChangeEvent) => any>;
  let registerCommandStub: sinon.SinonStub;
  let executeCommandStub: sinon.SinonStub;
  let onDidChangeConfigurationStub: sinon.SinonStub;

  function makeMockClient(): MockLanguageClient {
    return {
      start: sandbox.stub().resolves() as sinon.SinonStub<any[], Promise<void>>,
      stop: sandbox.stub().resolves() as sinon.SinonStub<any[], Promise<void>>,
      dispose: sandbox.stub().resolves() as sinon.SinonStub<any[], Promise<void>>,
    };
  }

  function buildSut(): ExtensionModule {
    return proxyquire('../extension', {
      'node:fs': {
        access: (filePath: string, _mode: number, callback: (err: Error | null) => void) => {
          callback(installed.has(filePath) ? null : new Error('ENOENT'));
        },
        constants: { F_OK: 0, X_OK: 1 }
      },
      'node:util': {
        promisify: <T extends (...args: unknown[]) => void>(fn: T) => {
          return (...args: unknown[]) => new Promise((resolve, reject) => {
            fn(...args, (err: Error | null, result?: unknown) => {
              if (err) reject(err);
              else resolve(result);
            });
          });
        }
      },
      'vscode-languageclient/node': {
        LanguageClient: languageClientStub
      }
    });
  }

  // The serverOptions handed to the index-th constructed language client.
  function serverOptions(index: number = 0): any {
    assert.ok(languageClientStub.callCount > index,
      `language client should be constructed at least ${index + 1} time(s)`);
    return languageClientStub.getCall(index).args[2];
  }

  // The command the index-th constructed client was launched with.
  function command(index: number = 0): string {
    return serverOptions(index).command;
  }

  // The index-th constructed client.
  function constructedClient(index: number): MockLanguageClient {
    assert.ok(languageClientStub.callCount > index,
      `client ${index} should have been constructed`);
    return languageClientStub.returnValues[index]!;
  }

  function onWindows(
    path: string = WINDOWS_PATH,
    pathext: string = WINDOWS_PATHEXT,
    extraEnv: Record<string, string> = {}
  ): void {
    sandbox.stub(process, 'platform').value('win32');
    sandbox.stub(process, 'env').value({ PATH: path, PATHEXT: pathext, ...extraEnv });
    sut = buildSut();
  }

  function offWindows(
    path: string = POSIX_PATH,
    extraEnv: Record<string, string> = {}
  ): void {
    sandbox.stub(process, 'platform').value('linux');
    sandbox.stub(process, 'env').value({ PATH: path, ...extraEnv });
    sut = buildSut();
  }

  function fireConfigChange(section: string): void {
    const event = {
      affectsConfiguration: (candidate: string) => candidate === section
    } as vscode.ConfigurationChangeEvent;
    for (const listener of configListeners) {
      listener(event);
    }
  }

  async function invokeRestartCommand(): Promise<void> {
    const handler = commandHandlers.get(RESTART_COMMAND);
    assert.ok(handler, 'restart command should be registered');
    await handler();
  }

  // Lets floated restart work (the configuration listener does not await its
  // restart) settle before assertions.
  function settle(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 25));
  }

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    installed = new Set<string>();

    languageClientStub = sandbox.stub().callsFake(() => makeMockClient());

    commandHandlers = new Map();
    configListeners = [];

    registerCommandStub = sandbox.stub(vscode.commands, 'registerCommand')
      .callsFake((id: string, handler: (...args: any[]) => any) => {
        commandHandlers.set(id, handler);
        return { dispose: sandbox.stub() };
      });
    executeCommandStub = sandbox.stub(vscode.commands, 'executeCommand')
      .callsFake((id: string, ...args: any[]) => {
        const handler = commandHandlers.get(id);
        return Promise.resolve(handler ? handler(...args) : undefined);
      });
    onDidChangeConfigurationStub = sandbox.stub(vscode.workspace, 'onDidChangeConfiguration')
      .callsFake((listener: (event: vscode.ConfigurationChangeEvent) => any) => {
        configListeners.push(listener);
        return { dispose: sandbox.stub() };
      });

    sut = buildSut();
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('deactivate()', () => {
    it('returns a promise', async () => {
      const result = sut.deactivate();
      assert.ok(result instanceof Promise, 'deactivate should return a Promise');
      await result;
    });

    it('completes without errors', async () => {
      await sut.deactivate();
    });

    it('handles multiple deactivate calls', async () => {
      await sut.deactivate();
      await sut.deactivate();
    });
  });

  describe('activate()', () => {
    let extensionContext: vscode.ExtensionContext;
    let showErrorMessageStub: sinon.SinonStub;
    let showWarningMessageStub: sinon.SinonStub;
    let mockConfig: MockConfig;
    let createOutputChannelStub: sinon.SinonStub<[string, any?], vscode.LogOutputChannel>;
    let mockOutputChannel: MockOutputChannel;
    let mockStatusBarItem: MockStatusBarItem;

    function configureExecutable(value: string): void {
      mockConfig.get = sandbox.stub().callsFake(<T>(key: string, defaultValue?: T): T => {
        if (key === 'lsp.executable') {
          return value as T;
        }
        return defaultValue as T;
      });
    }

    beforeEach(() => {
      extensionContext = makeExtensionContext();

      mockOutputChannel = {
        appendLine: sandbox.stub(),
        append: sandbox.stub(),
        clear: sandbox.stub(),
        show: sandbox.stub(),
        hide: sandbox.stub(),
        dispose: sandbox.stub(),
        name: 'Pony Language Server',
        replace: sandbox.stub(),
      };

      mockStatusBarItem = {
        text: '',
        show: sandbox.stub(),
        hide: sandbox.stub(),
        dispose: sandbox.stub(),
      };

      showErrorMessageStub = sandbox.stub(vscode.window, 'showErrorMessage');
      showWarningMessageStub = sandbox.stub(vscode.window, 'showWarningMessage');
      createOutputChannelStub = sandbox.stub(vscode.window, 'createOutputChannel').returns(mockOutputChannel as vscode.LogOutputChannel);
      sandbox.stub(vscode.window, 'createStatusBarItem').returns(mockStatusBarItem as vscode.StatusBarItem);

      // Default configuration with no custom executable
      mockConfig = {
        get: sandbox.stub().callsFake(<T>(key: string, defaultValue?: T): T => {
          if (key === 'lsp.executable') {
            return '' as T;
          }
          return defaultValue as T;
        })
      };
      sandbox.stub(vscode.workspace, 'getConfiguration').returns(mockConfig as vscode.WorkspaceConfiguration);
    });

    context('given pony-lsp is on PATH', () => {
      beforeEach(() => {
        offWindows();
        installed.add(POSIX_PONY_LSP);
      });

      it('creates an output channel', async () => {
        await sut.activate(extensionContext);

        assert.ok(createOutputChannelStub.calledOnce,
          'createOutputChannel should be called once');
        assert.ok(createOutputChannelStub.calledWith('Pony Language Server'),
          'createOutputChannel should be called with correct channel name');
      });

      it('does not show error or warning message', async () => {
        await sut.activate(extensionContext);

        assert.ok(showErrorMessageStub.notCalled,
          'should not show error message when pony-lsp is found');
        assert.ok(showWarningMessageStub.notCalled,
          'should not show warning message when pony-lsp is found');
      });

      it('returns a promise', async () => {
        const result = sut.activate(extensionContext);
        assert.ok(result instanceof Promise, 'activate should always return a Promise');
        await result;
      });

      it('builds server options that add no pony-lsp arguments', async () => {
        await sut.activate(extensionContext);

        assert.deepStrictEqual(Object.keys(serverOptions()).sort(), ['command', 'options'],
          'server options should carry command and options and nothing else');
      });
    });

    context('given pony-lsp is not on PATH', () => {
      beforeEach(() => {
        offWindows();
      });

      it('shows an error message', async () => {
        await sut.activate(extensionContext);

        assert.ok(showErrorMessageStub.calledOnce, 'should show error message');
        assert.ok(showErrorMessageStub.firstCall.args[0].includes('was not found'),
          'error message should say pony-lsp was not found');
        assert.ok(showErrorMessageStub.firstCall.args[0].includes('pony.lsp.executable'),
          'error message should name the pony.lsp.executable setting');
      });

      it('returns early without starting language client', async () => {
        await sut.activate(extensionContext);

        assert.ok(languageClientStub.notCalled, 'should not create a language client');
        const clientReadyMessage = mockOutputChannel.appendLine.getCalls().find((call: sinon.SinonSpyCall<[string], void>) =>
          call.args[0] && call.args[0].includes('Pony language server client starting')
        );
        assert.strictEqual(clientReadyMessage, undefined, 'should not log "Pony language server client starting" when returning early');
      });

      it('does not look for pony-lsp when PATH is unset', async () => {
        sandbox.stub(process, 'env').value({});
        sut = buildSut();

        await sut.activate(extensionContext);

        assert.ok(showErrorMessageStub.calledOnce, 'should report pony-lsp missing rather than throw');
      });

      it('still registers the command, the listener, and the context key', async () => {
        await sut.activate(extensionContext);

        assert.ok(registerCommandStub.calledWith(RESTART_COMMAND),
          'the restart command must be registered even when pony-lsp is missing');
        assert.ok(onDidChangeConfigurationStub.called,
          'the configuration listener must be registered even when pony-lsp is missing');
        assert.ok(executeCommandStub.calledWith('setContext', ACTIVATED_CONTEXT, true),
          'the context key must be set even when pony-lsp is missing');
      });
    });

    context('given the platform is Windows', () => {
      it('finds a pony-lsp installed as a batch file', async () => {
        onWindows(WINDOWS_PATH);
        installed.add(WINDOWS_BAT);

        await sut.activate(extensionContext);

        assert.strictEqual(command(), `"${WINDOWS_BAT}"`,
          'should launch the batch file it found, quoted');
      });

      it('runs a batch file through a shell', async () => {
        onWindows(WINDOWS_PATH);
        installed.add(WINDOWS_BAT);

        await sut.activate(extensionContext);

        assert.strictEqual(serverOptions().options.shell, true,
          'Node runs a batch file no other way');
      });

      it('runs an executable without a shell', async () => {
        onWindows(WINDOWS_PATH);
        installed.add(WINDOWS_EXE);

        await sut.activate(extensionContext);

        assert.strictEqual(serverOptions().options.shell, false,
          'an executable needs no shell, so cmd should not stand between us and it');
        assert.strictEqual(command(), WINDOWS_EXE,
          'with no shell to strip them, quotes would become part of the filename');
      });

      it('tries extensions in PATHEXT order', async () => {
        onWindows(WINDOWS_PATH);
        installed.add(WINDOWS_BAT);
        installed.add(WINDOWS_EXE);

        await sut.activate(extensionContext);

        assert.strictEqual(command(), WINDOWS_EXE,
          '.EXE precedes .BAT in PATHEXT, so cmd would pick the executable');
      });

      it('takes the first directory on PATH that has a pony-lsp', async () => {
        const earlier = 'C:\\earlier\\bin';
        onWindows(`${earlier};${WINDOWS_PATH_DIR}`);
        installed.add(`${earlier}\\pony-lsp.BAT`);
        installed.add(WINDOWS_BAT);

        await sut.activate(extensionContext);

        assert.strictEqual(command(), `"${earlier}\\pony-lsp.BAT"`,
          'PATH is searched in order');
      });

      it('reads a quoted PATH entry', async () => {
        onWindows(`"${WINDOWS_PATH_DIR}"`);
        installed.add(WINDOWS_BAT);

        await sut.activate(extensionContext);

        assert.strictEqual(command(), `"${WINDOWS_BAT}"`,
          'Windows permits a quoted PATH entry; the quotes are not part of the directory name');
      });

      it('falls back to a default PATHEXT when PATHEXT is unset', async () => {
        sandbox.stub(process, 'platform').value('win32');
        sandbox.stub(process, 'env').value({ PATH: WINDOWS_PATH_DIR });
        sut = buildSut();
        installed.add(WINDOWS_BAT);

        await sut.activate(extensionContext);

        assert.strictEqual(command(), `"${WINDOWS_BAT}"`,
          'a batch file should still be found with no PATHEXT to read');
      });
    });

    context('given the platform is not Windows', () => {
      beforeEach(() => {
        offWindows();
        installed.add(POSIX_PONY_LSP);
      });

      it('launches the pony-lsp it found', async () => {
        await sut.activate(extensionContext);

        assert.strictEqual(command(), POSIX_PONY_LSP,
          'should launch the path it found, unquoted');
      });

      it('runs pony-lsp without a shell', async () => {
        await sut.activate(extensionContext);

        assert.strictEqual(serverOptions().options.shell, false,
          'nothing off Windows needs a shell, and a shell would re-parse the path');
      });
    });

    context('given pony-lsp is in ponyup\'s directory but not on PATH', () => {
      it('finds it via XDG_DATA_HOME off Windows', async () => {
        offWindows('/usr/bin', { XDG_DATA_HOME: POSIX_XDG });
        installed.add(POSIX_XDG_PONY_LSP);

        await sut.activate(extensionContext);

        assert.strictEqual(command(), POSIX_XDG_PONY_LSP,
          'ponyup\'s XDG bin directory is searched after PATH');
      });

      it('falls back to $HOME/.local/share when XDG_DATA_HOME is unset', async () => {
        offWindows('/usr/bin', { HOME: POSIX_HOME });
        installed.add(POSIX_HOME_PONY_LSP);

        await sut.activate(extensionContext);

        assert.strictEqual(command(), POSIX_HOME_PONY_LSP,
          'with no XDG_DATA_HOME, ponyup installs under $HOME/.local/share');
      });

      it('finds a ponyup batch file on Windows, run through a shell, quoted', async () => {
        onWindows('C:\\Windows\\system32', WINDOWS_PATHEXT, { LOCALAPPDATA: WINDOWS_LOCALAPPDATA });
        installed.add(WINDOWS_PONYUP_BAT);

        await sut.activate(extensionContext);

        assert.strictEqual(command(), `"${WINDOWS_PONYUP_BAT}"`,
          'ponyup writes pony-lsp.bat, found via %LOCALAPPDATA% and quoted');
        assert.strictEqual(serverOptions().options.shell, true,
          'a batch file runs only through a shell');
      });

      it('lets PATH win when both PATH and ponyup have a pony-lsp', async () => {
        offWindows(POSIX_PATH, { XDG_DATA_HOME: POSIX_XDG });
        installed.add(POSIX_PONY_LSP);
        installed.add(POSIX_XDG_PONY_LSP);

        await sut.activate(extensionContext);

        assert.strictEqual(command(), POSIX_PONY_LSP,
          'PATH is searched first, so its pony-lsp wins');
      });

      it('lets PONYUP_PREFIX win over the platform default', async () => {
        offWindows('/usr/bin', { PONYUP_PREFIX: '/opt/pony', XDG_DATA_HOME: POSIX_XDG });
        installed.add('/opt/pony/ponyup/bin/pony-lsp');
        installed.add(POSIX_XDG_PONY_LSP);

        await sut.activate(extensionContext);

        assert.strictEqual(command(), '/opt/pony/ponyup/bin/pony-lsp',
          'PONYUP_PREFIX overrides the platform default');
      });

      it('treats an empty PONYUP_PREFIX as unset', async () => {
        offWindows('/usr/bin', { PONYUP_PREFIX: '', XDG_DATA_HOME: POSIX_XDG });
        installed.add(POSIX_XDG_PONY_LSP);

        await sut.activate(extensionContext);

        assert.strictEqual(command(), POSIX_XDG_PONY_LSP,
          'ponyup reads an empty PONYUP_PREFIX as unset, so the default applies');
      });
    });

    context('given a ponyup directory that must not be searched', () => {
      // Each of these plants a pony-lsp where an unguarded search would resolve
      // the relative or empty prefix: against the working directory, which is
      // the opened project. Finding it there is the committed-pony-lsp attack.
      // The stubbed cwd is what the extension's path.resolve reads, so without
      // the guard the plant is found and the assertion fails.
      it('does not search a relative PONYUP_PREFIX', async () => {
        offWindows('/usr/bin', { PONYUP_PREFIX: 'relative/prefix' });
        sandbox.stub(process, 'cwd').returns(POSIX_CWD);
        installed.add(`${POSIX_CWD}/relative/prefix/ponyup/bin/pony-lsp`);

        await sut.activate(extensionContext);

        assert.ok(languageClientStub.notCalled,
          'a relative prefix must not be resolved against the working directory');
        assert.ok(showErrorMessageStub.calledOnce, 'and pony-lsp is reported missing');
      });

      it('does not search an empty XDG_DATA_HOME, and does not fall back to HOME', async () => {
        offWindows('/usr/bin', { XDG_DATA_HOME: '', HOME: POSIX_HOME });
        sandbox.stub(process, 'cwd').returns(POSIX_CWD);
        installed.add(`${POSIX_CWD}/ponyup/bin/pony-lsp`);
        installed.add(POSIX_HOME_PONY_LSP);

        await sut.activate(extensionContext);

        assert.ok(languageClientStub.notCalled,
          'an empty XDG_DATA_HOME is neither searched against cwd nor replaced by the HOME default');
        assert.ok(showErrorMessageStub.calledOnce, 'and pony-lsp is reported missing');
      });

      it('does not search a relative XDG_DATA_HOME', async () => {
        offWindows('/usr/bin', { XDG_DATA_HOME: 'relative/data' });
        sandbox.stub(process, 'cwd').returns(POSIX_CWD);
        installed.add(`${POSIX_CWD}/relative/data/ponyup/bin/pony-lsp`);

        await sut.activate(extensionContext);

        assert.ok(languageClientStub.notCalled,
          'a relative XDG_DATA_HOME must not be resolved against the working directory');
        assert.ok(showErrorMessageStub.calledOnce, 'and pony-lsp is reported missing');
      });

      it('does not search a relative PONYUP_PREFIX on Windows', async () => {
        onWindows('C:\\Windows\\system32', WINDOWS_PATHEXT, { PONYUP_PREFIX: 'relative\\prefix' });
        sandbox.stub(process, 'cwd').returns('C:\\opt\\project');
        installed.add('C:\\opt\\project\\relative\\prefix\\ponyup\\bin\\pony-lsp.EXE');

        await sut.activate(extensionContext);

        assert.ok(languageClientStub.notCalled,
          'win32.isAbsolute rejects the relative prefix, so it is not resolved against cwd');
        assert.ok(showErrorMessageStub.calledOnce, 'and pony-lsp is reported missing');
      });

      it('does not crash when LOCALAPPDATA is unset on Windows', async () => {
        onWindows('C:\\Windows\\system32', WINDOWS_PATHEXT, {});

        await sut.activate(extensionContext);

        assert.ok(showErrorMessageStub.calledOnce,
          'with no LOCALAPPDATA there is no ponyup directory, and pony-lsp is reported missing');
      });
    });

    context('given custom LSP executable is configured', () => {
      context('and the executable file is valid', () => {
        beforeEach(() => {
          offWindows();
          configureExecutable('/custom/path/to/pony-lsp');
          installed.add('/custom/path/to/pony-lsp');
        });

        it('does not search PATH', async () => {
          installed.add(POSIX_PONY_LSP);

          await sut.activate(extensionContext);

          assert.strictEqual(command(), '/custom/path/to/pony-lsp',
            'a configured executable should win over one on PATH');
        });

        it('uses the configured executable file', async () => {
          await sut.activate(extensionContext);

          const customExecLog = mockOutputChannel.appendLine.getCalls().find((call: sinon.SinonSpyCall<[string], void>) =>
            call.args[0] && call.args[0].includes('Using custom pony-lsp executable')
          );
          assert.ok(customExecLog, 'should log that custom executable is being used');
        });

        it('does not show error message', async () => {
          await sut.activate(extensionContext);

          assert.ok(showErrorMessageStub.notCalled, 'should not show error message when custom executable is valid');
        });

        it('launches the configured executable', async () => {
          await sut.activate(extensionContext);

          assert.strictEqual(command(), '/custom/path/to/pony-lsp',
            'should launch the configured executable');
          assert.strictEqual(serverOptions().options.shell, false,
            'nothing off Windows needs a shell');
        });

        context('and the platform is Windows', () => {
          it('runs a configured batch file through a quoted shell command', async () => {
            const configured = 'C:\\Program Files\\ponyup\\bin\\pony-lsp.bat';
            onWindows(WINDOWS_PATH);
            configureExecutable(configured);
            installed.add(configured);

            await sut.activate(extensionContext);

            assert.strictEqual(serverOptions().options.shell, true,
              'a configured executable can be a batch file too');
            assert.strictEqual(command(), `"${configured}"`,
              'a configured path can contain a space, so it must arrive quoted');
          });

          it('runs a configured executable without a shell', async () => {
            const configured = 'C:\\Program Files\\ponyc\\bin\\pony-lsp.exe';
            onWindows(WINDOWS_PATH);
            configureExecutable(configured);
            installed.add(configured);

            await sut.activate(extensionContext);

            assert.strictEqual(serverOptions().options.shell, false,
              'an executable needs no shell wherever it came from');
            assert.strictEqual(command(), configured,
              'with no shell to strip them, quotes would become part of the filename');
          });
        });
      });

      context('and the executable file is not valid', () => {
        beforeEach(() => {
          offWindows();
          configureExecutable('/invalid/path/to/pony-lsp');
        });

        it('shows an error message', async () => {
          await sut.activate(extensionContext);

          assert.ok(showErrorMessageStub.calledOnce, 'should show error message');
          assert.ok(showErrorMessageStub.firstCall.args[0].includes('not found or not executable'),
            'error message should mention executable is not found or not executable');
          assert.ok(showErrorMessageStub.firstCall.args[0].includes('/invalid/path/to/pony-lsp'),
            'error message should include the configured path');
        });

        it('does not fall back to pony-lsp on PATH', async () => {
          installed.add(POSIX_PONY_LSP);

          await sut.activate(extensionContext);

          assert.ok(languageClientStub.notCalled,
            'a configured executable that is not there is an error, not a reason to search PATH');
        });

        it('does not fall back to ponyup\'s directory', async () => {
          sandbox.stub(process, 'env').value({ PATH: '/usr/bin', XDG_DATA_HOME: POSIX_XDG });
          sut = buildSut();
          installed.add(POSIX_XDG_PONY_LSP);

          await sut.activate(extensionContext);

          assert.ok(languageClientStub.notCalled,
            'a configured executable that is not there is an error, not a reason to search ponyup');
        });

        it('returns early without starting language client', async () => {
          await sut.activate(extensionContext);

          assert.ok(languageClientStub.notCalled,
            'should not create language client when executable validation fails');
        });
      });
    });

    context('restart and shutdown', () => {
      beforeEach(() => {
        offWindows();
        installed.add(POSIX_PONY_LSP);
      });

      it('starts the client when pony-lsp appears after activation', async () => {
        installed.clear();
        await sut.activate(extensionContext);
        assert.ok(languageClientStub.notCalled, 'nothing to start yet');

        installed.add(POSIX_PONY_LSP);
        await invokeRestartCommand();

        assert.strictEqual(command(), POSIX_PONY_LSP,
          'the restart resolves pony-lsp that was not there at activation');
      });

      it('re-runs resolution when pony.lsp.executable changes', async () => {
        await sut.activate(extensionContext);

        configureExecutable('/custom/path/to/pony-lsp');
        installed.add('/custom/path/to/pony-lsp');
        fireConfigChange('pony.lsp.executable');
        await settle();

        assert.strictEqual(command(1), '/custom/path/to/pony-lsp',
          'a change to the setting starts the newly configured executable');
      });

      it('does not restart for an unrelated configuration change', async () => {
        await sut.activate(extensionContext);

        fireConfigChange('pony.trace.server');
        await settle();

        assert.strictEqual(languageClientStub.callCount, 1,
          'only a pony.lsp.executable change re-runs resolution');
      });

      it('recovers the restart chain after a start hangs', async () => {
        // pony-lsp spawned but never answered the handshake: the first start
        // never settles. Without the start timeout the queue would wedge and
        // every later restart would silently no-op.
        const clock = sandbox.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        const hungStart = new Promise<void>(() => {});
        languageClientStub.onFirstCall().callsFake(() => {
          const mock = makeMockClient();
          mock.start = sandbox.stub().returns(hungStart) as sinon.SinonStub<any[], Promise<void>>;
          return mock;
        });

        const activation = sut.activate(extensionContext);
        await clock.tickAsync(60000);
        await activation;

        assert.ok(showWarningMessageStub.called, 'the hung start is reported');
        assert.ok(constructedClient(0).dispose.calledOnce,
          'the hung client is retired, killing its process');

        await commandHandlers.get(RESTART_COMMAND)!();

        assert.strictEqual(languageClientStub.callCount, 2,
          'a later restart still runs, so the chain was not wedged');
        assert.ok(constructedClient(1).start.calledOnce, 'and it starts a new client');
      });

      it('retires the previous client before constructing a new one', async () => {
        await sut.activate(extensionContext);
        const first = constructedClient(0);

        await invokeRestartCommand();

        assert.ok(first.dispose.calledOnce, 'the previous client is disposed');
        assert.strictEqual(languageClientStub.callCount, 2, 'a new client is constructed');
        assert.ok(first.dispose.calledBefore(constructedClient(1).start),
          'the previous client is retired before the new one starts');
      });

      it('leaves one live client when a second restart arrives during a start', async () => {
        // Hold the first client's start pending, queue a second restart behind
        // it, then let the first finish. The second must run only after the
        // first settles, and must retire the first — never two live at once.
        let releaseFirst!: () => void;
        const firstStart = new Promise<void>((resolve) => { releaseFirst = resolve; });
        languageClientStub.onFirstCall().callsFake(() => {
          const mock = makeMockClient();
          mock.start = sandbox.stub().returns(firstStart) as sinon.SinonStub<any[], Promise<void>>;
          return mock;
        });

        const activation = sut.activate(extensionContext);
        await settle();
        const secondRestart = commandHandlers.get(RESTART_COMMAND)!();
        releaseFirst();
        await activation;
        await secondRestart;

        assert.strictEqual(languageClientStub.callCount, 2, 'the second restart ran after the first');
        assert.ok(constructedClient(0).dispose.calledOnce, 'the first client was retired');
        assert.ok(constructedClient(1).dispose.notCalled, 'the second client is live');
      });

      it('leaves exactly one live client after two restarts', async () => {
        await sut.activate(extensionContext);
        await invokeRestartCommand();

        const first = constructedClient(0);
        const second = constructedClient(1);
        assert.ok(first.dispose.calledOnce, 'the first client was retired');
        assert.ok(second.dispose.notCalled, 'the second client is still live');
        assert.ok(second.start.calledOnce, 'and it was started');
      });

      it('leaves no client running when a restart\'s resolution fails', async () => {
        await sut.activate(extensionContext);
        const first = constructedClient(0);

        installed.clear();
        await invokeRestartCommand();

        assert.ok(first.dispose.calledOnce, 'the running client is retired before resolving');
        assert.strictEqual(languageClientStub.callCount, 1, 'and nothing new is started');
        assert.ok(showErrorMessageStub.called, 'the failure is reported');
      });

      it('keeps the chain alive after a run fails to construct a client', async () => {
        languageClientStub.onFirstCall().throws(new Error('construction failed'));

        await sut.activate(extensionContext);
        await invokeRestartCommand();

        assert.strictEqual(languageClientStub.callCount, 2,
          'the second restart runs even though the first threw');
        assert.ok(constructedClient(1).start.calledOnce,
          'and the second client is started');
      });

      it('does not create a second output channel on restart', async () => {
        await sut.activate(extensionContext);
        await invokeRestartCommand();

        assert.ok(createOutputChannelStub.calledOnce,
          'the output channel is created once, in activate, not per restart');
      });

      it('starts nothing when restart is called after deactivate', async () => {
        await sut.activate(extensionContext);
        const constructedBefore = languageClientStub.callCount;
        await sut.deactivate();

        await invokeRestartCommand();

        assert.strictEqual(languageClientStub.callCount, constructedBefore,
          'a restart after deactivate must not bring a server up');
      });

      it('does not warn or resurrect the status bar when a start fails during shutdown', async () => {
        // A start still in flight when deactivate runs, then rejecting, must not
        // report a failure or recreate a status bar item deactivate disposed —
        // the extension is shutting down, and the failure is a symptom of it.
        let rejectStart!: (reason: Error) => void;
        const hungStart = new Promise<void>((_resolve, reject) => { rejectStart = reject; });
        languageClientStub.callsFake(() => {
          const mock = makeMockClient();
          mock.start = sandbox.stub().returns(hungStart) as sinon.SinonStub<any[], Promise<void>>;
          return mock;
        });
        const createStatusBarStub = vscode.window.createStatusBarItem as sinon.SinonStub;

        const activation = sut.activate(extensionContext);
        await settle();
        await sut.deactivate();
        const statusBarCallsAfterShutdown = createStatusBarStub.callCount;

        rejectStart(new Error('server died during shutdown'));
        await settle();
        await activation;

        assert.ok(showWarningMessageStub.notCalled,
          'a failure during shutdown is not reported to the user');
        assert.strictEqual(createStatusBarStub.callCount, statusBarCallsAfterShutdown,
          'the late failure does not create a new status bar item');
      });

      it('offers a Retry action that invokes the restart command', async () => {
        installed.clear();
        // Click Retry once, then dismiss — otherwise the still-missing pony-lsp
        // would re-offer Retry and the stubbed click would loop forever.
        showErrorMessageStub.resolves(undefined);
        showErrorMessageStub.onFirstCall().resolves('Retry');

        await sut.activate(extensionContext);
        await settle();

        assert.ok(executeCommandStub.calledWith(RESTART_COMMAND),
          'clicking Retry runs the restart command');
      });

      it('retires the client on deactivate, and only once across repeated calls', async () => {
        await sut.activate(extensionContext);
        const first = constructedClient(0);

        await sut.deactivate();
        await sut.deactivate();

        assert.ok(first.dispose.calledOnce, 'the client is disposed exactly once');
      });

      it('disposes the output channel on deactivate, and only once', async () => {
        await sut.activate(extensionContext);

        await sut.deactivate();
        await sut.deactivate();

        assert.ok(mockOutputChannel.dispose.calledOnce,
          'the output channel is disposed exactly once');
      });

      it('clears the palette context key on deactivate', async () => {
        await sut.activate(extensionContext);

        await sut.deactivate();

        assert.ok(executeCommandStub.calledWith('setContext', ACTIVATED_CONTEXT, false),
          'the command palette gate is cleared as the extension tears down');
      });
    });
  });

  describe('Integration', () => {
    beforeEach(() => {
      offWindows();
      installed.add(POSIX_PONY_LSP);
    });

    it('should allow activate and deactivate cycle', async () => {
      const extensionContext = makeExtensionContext();

      await sut.activate(extensionContext);
      const result = await sut.deactivate();

      assert.ok(result === undefined, 'deactivate should complete successfully');
    });
  });
});
