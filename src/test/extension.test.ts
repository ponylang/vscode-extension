import * as assert from 'assert';
import { describe as context, describe, it, beforeEach, afterEach } from 'mocha';
import proxyquire from 'proxyquire';
import * as sinon from 'sinon';
import * as vscode from 'vscode';

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
  let execSyncStub: sinon.SinonStub<any[], Buffer>;
  let languageClientStub: sinon.SinonStub<any[], MockLanguageClient>;
  let mockLanguageClient: MockLanguageClient;
  let sut: ExtensionModule;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    execSyncStub = sandbox.stub();

    mockLanguageClient = {
      start: sandbox.stub().resolves() as sinon.SinonStub<any[], Promise<void>>,
      stop: sandbox.stub().resolves() as sinon.SinonStub<any[], Promise<void>>,
    };
    languageClientStub = sandbox.stub().returns(mockLanguageClient);

    // Default proxyquire setup - can be overridden in specific test contexts
    sut = proxyquire('../extension', {
      'node:child_process': {
        execSync: execSyncStub
      },
      'vscode-languageclient/node': {
        LanguageClient: languageClientStub,
        TransportKind: { stdio: 0 }
      }
    });
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
    let getConfigurationStub: sinon.SinonStub;
    let mockConfig: MockConfig;
    let createOutputChannelStub: sinon.SinonStub<[string, any?], vscode.LogOutputChannel>;
    let createStatusBarItemStub: sinon.SinonStub<[vscode.StatusBarAlignment?, number?], vscode.StatusBarItem>;
    let mockOutputChannel: MockOutputChannel;
    let mockStatusBarItem: MockStatusBarItem;

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
      createStatusBarItemStub = sandbox.stub(vscode.window, 'createStatusBarItem').returns(mockStatusBarItem as vscode.StatusBarItem);

      // Default configuration with no custom executable
      mockConfig = {
        get: sandbox.stub().callsFake(<T>(key: string, defaultValue?: T): T => {
          if (key === 'lsp.executable') {
            return '' as T;
          }
          return defaultValue as T;
        })
      };
      getConfigurationStub = sandbox.stub(vscode.workspace, 'getConfiguration').returns(mockConfig as vscode.WorkspaceConfiguration);
    });

    context('given pony-lsp exists', () => {
      beforeEach(() => {
        execSyncStub.returns(Buffer.from('/usr/local/bin/pony-lsp'));
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
    });

    context('given pony-lsp does not exist', () => {
      beforeEach(() => {
        execSyncStub.throws(new Error('pony-lsp not found'));
      });

      it('shows an error message', async () => {
        await sut.activate(extensionContext);

        assert.ok(showErrorMessageStub.calledOnce, 'should show error message');
        assert.ok(showErrorMessageStub.firstCall.args[0].includes('pony-lsp not found'),
          'error message should mention "pony-lsp not found"');
      });

      it('returns early without starting language client', async () => {
        const result = await sut.activate(extensionContext);

        // Verify it did not create the language client
        const clientReadyMessage = mockOutputChannel.appendLine.getCalls().find((call: sinon.SinonSpyCall<[string], void>) =>
          call.args[0] && call.args[0].includes('PonyLSP client ready')
        );
        assert.strictEqual(clientReadyMessage, undefined, 'should not log "PonyLSP client ready" when returning early');
      });
    });

    context('given custom LSP executable is configured', () => {
      context('and the executable file is valid', () => {
        let accessStub: sinon.SinonStub;

        beforeEach(() => {
          // Configure a custom executable path
          mockConfig.get = sandbox.stub().callsFake(<T>(key: string, defaultValue?: T): T => {
            if (key === 'lsp.executable') {
              return '/custom/path/to/pony-lsp' as T;
            }
            return defaultValue as T;
          });

          // Stub fs.access to succeed (file exists and is executable)
          accessStub = sandbox.stub().yields(null);

          languageClientStub = sandbox.stub().returns(mockLanguageClient);

          sut = proxyquire('../extension', {
            'node:child_process': {
              execSync: execSyncStub
            },
            'node:fs': {
              access: accessStub,
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
              LanguageClient: languageClientStub,
              TransportKind: { stdio: 0 }
            }
          });
        });

        it('does not check PATH for pony-lsp', async () => {
          await sut.activate(extensionContext);

          assert.ok(execSyncStub.notCalled, 'should not call execSync to check PATH when custom executable is provided');
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
      });

      context('and the executable file is not valid', () => {
        let accessStub: sinon.SinonStub;

        beforeEach(() => {
          // Configure a custom executable path
          mockConfig.get = sandbox.stub().callsFake(<T>(key: string, defaultValue?: T): T => {
            if (key === 'lsp.executable') {
              return '/invalid/path/to/pony-lsp' as T;
            }
            return defaultValue as T;
          });

          // Stub fs.access to fail (file doesn't exist or not executable)
          accessStub = sandbox.stub().yields(new Error('ENOENT'));

          languageClientStub = sandbox.stub().returns(mockLanguageClient);

          sut = proxyquire('../extension', {
            'node:child_process': {
              execSync: execSyncStub
            },
            'node:fs': {
              access: accessStub,
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
              LanguageClient: languageClientStub,
              TransportKind: { stdio: 0 }
            }
          });
        });

        it('shows an error message', async () => {
          await sut.activate(extensionContext);

          assert.ok(showErrorMessageStub.calledOnce, 'should show error message');
          assert.ok(showErrorMessageStub.firstCall.args[0].includes('not found or not executable'),
            'error message should mention executable is not found or not executable');
          assert.ok(showErrorMessageStub.firstCall.args[0].includes('/invalid/path/to/pony-lsp'),
            'error message should include the configured path');
        });

        it('does not check PATH for pony-lsp', async () => {
          await sut.activate(extensionContext);

          assert.ok(execSyncStub.notCalled,
            'should not check PATH when custom executable is configured (even if invalid)');
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
      execSyncStub.returns(Buffer.from('/usr/local/bin/pony-lsp'));
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
