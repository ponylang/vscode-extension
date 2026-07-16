import * as assert from 'assert';
import { describe as context, describe, it, beforeEach, afterEach } from 'mocha';
import proxyquire from 'proxyquire';
import * as sinon from 'sinon';
import * as vscode from 'vscode';

// A Windows PATH, and the pony-lsp ponyup installs into it.
const WINDOWS_DIR = 'C:\\Users\\pony\\AppData\\Local\\ponyup\\bin';
const WINDOWS_PATH = `C:\\Windows\\system32;${WINDOWS_DIR}`;
const WINDOWS_PATHEXT = '.COM;.EXE;.BAT;.CMD';
const WINDOWS_BAT = `${WINDOWS_DIR}\\pony-lsp.BAT`;
const WINDOWS_EXE = `${WINDOWS_DIR}\\pony-lsp.EXE`;

// The same, off Windows.
const POSIX_DIR = '/usr/local/bin';
const POSIX_PATH = `/usr/bin:${POSIX_DIR}`;
const POSIX_PONY_LSP = `${POSIX_DIR}/pony-lsp`;

interface MockLanguageClient {
  start: sinon.SinonStub<any[], Promise<void>>;
  stop: sinon.SinonStub<any[], Promise<void>>;
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

describe('Extension Test Suite', () => {
  vscode.window.showInformationMessage('Start all tests.');

  let sandbox: sinon.SinonSandbox;
  let languageClientStub: sinon.SinonStub<any[], MockLanguageClient>;
  let mockLanguageClient: MockLanguageClient;
  let sut: ExtensionModule;

  // The files that exist and are executable. The extension finds pony-lsp by
  // asking after candidate paths, so this stands in for what is installed.
  let installed: Set<string>;

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

  // The serverOptions the extension handed the language client.
  function serverOptions(): any {
    assert.ok(languageClientStub.calledOnce, 'language client should be constructed once');
    return languageClientStub.firstCall.args[2];
  }

  function onWindows(path: string, pathext: string = WINDOWS_PATHEXT): void {
    sandbox.stub(process, 'platform').value('win32');
    sandbox.stub(process, 'env').value({ PATH: path, PATHEXT: pathext });
    sut = buildSut();
  }

  function offWindows(path: string = POSIX_PATH): void {
    sandbox.stub(process, 'platform').value('linux');
    sandbox.stub(process, 'env').value({ PATH: path });
    sut = buildSut();
  }

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    installed = new Set<string>();

    mockLanguageClient = {
      start: sandbox.stub().resolves() as sinon.SinonStub<any[], Promise<void>>,
      stop: sandbox.stub().resolves() as sinon.SinonStub<any[], Promise<void>>,
    };
    languageClientStub = sandbox.stub().returns(mockLanguageClient);

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
      extensionContext = {
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
        assert.ok(showErrorMessageStub.firstCall.args[0].includes('pony-lsp not found'),
          'error message should mention "pony-lsp not found"');
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
    });

    context('given the platform is Windows', () => {
      it('finds a pony-lsp installed as a batch file', async () => {
        onWindows(WINDOWS_PATH);
        installed.add(WINDOWS_BAT);

        await sut.activate(extensionContext);

        assert.strictEqual(serverOptions().command, `"${WINDOWS_BAT}"`,
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
        assert.strictEqual(serverOptions().command, WINDOWS_EXE,
          'with no shell to strip them, quotes would become part of the filename');
      });

      it('tries extensions in PATHEXT order', async () => {
        onWindows(WINDOWS_PATH);
        installed.add(WINDOWS_BAT);
        installed.add(WINDOWS_EXE);

        await sut.activate(extensionContext);

        assert.strictEqual(serverOptions().command, WINDOWS_EXE,
          '.EXE precedes .BAT in PATHEXT, so cmd would pick the executable');
      });

      it('takes the first directory on PATH that has a pony-lsp', async () => {
        const earlier = 'C:\\earlier\\bin';
        onWindows(`${earlier};${WINDOWS_DIR}`);
        installed.add(`${earlier}\\pony-lsp.BAT`);
        installed.add(WINDOWS_BAT);

        await sut.activate(extensionContext);

        assert.strictEqual(serverOptions().command, `"${earlier}\\pony-lsp.BAT"`,
          'PATH is searched in order');
      });

      it('reads a quoted PATH entry', async () => {
        onWindows(`"${WINDOWS_DIR}"`);
        installed.add(WINDOWS_BAT);

        await sut.activate(extensionContext);

        assert.strictEqual(serverOptions().command, `"${WINDOWS_BAT}"`,
          'Windows permits a quoted PATH entry; the quotes are not part of the directory name');
      });

      it('falls back to a default PATHEXT when PATHEXT is unset', async () => {
        sandbox.stub(process, 'platform').value('win32');
        sandbox.stub(process, 'env').value({ PATH: WINDOWS_DIR });
        sut = buildSut();
        installed.add(WINDOWS_BAT);

        await sut.activate(extensionContext);

        assert.strictEqual(serverOptions().command, `"${WINDOWS_BAT}"`,
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

        assert.strictEqual(serverOptions().command, POSIX_PONY_LSP,
          'should launch the path it found, unquoted');
      });

      it('runs pony-lsp without a shell', async () => {
        await sut.activate(extensionContext);

        assert.strictEqual(serverOptions().options.shell, false,
          'nothing off Windows needs a shell, and a shell would re-parse the path');
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

          assert.strictEqual(serverOptions().command, '/custom/path/to/pony-lsp',
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

          assert.strictEqual(serverOptions().command, '/custom/path/to/pony-lsp',
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
            assert.strictEqual(serverOptions().command, `"${configured}"`,
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
            assert.strictEqual(serverOptions().command, configured,
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

        it('returns early without starting language client', async () => {
          await sut.activate(extensionContext);

          assert.ok(languageClientStub.notCalled,
            'should not create language client when executable validation fails');
        });
      });
    });
  });

  describe('Integration', () => {
    beforeEach(() => {
      offWindows();
      installed.add(POSIX_PONY_LSP);
    });

    it('should allow activate and deactivate cycle', async () => {
      const extensionContext: vscode.ExtensionContext = {
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

      await sut.activate(extensionContext);
      const result = await sut.deactivate();

      assert.ok(result === undefined, 'deactivate should complete successfully');
    });
  });
});
