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

    // Use proxyquire to stub child_process.execSync and LanguageClient
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
