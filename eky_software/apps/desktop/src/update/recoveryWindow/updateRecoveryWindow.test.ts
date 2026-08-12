import { EventEmitter } from 'node:events';

import type {
  BrowserWindow,
  BrowserWindowConstructorOptions,
  IpcMainInvokeEvent,
} from 'electron';
import { describe, expect, it, vi } from 'vitest';

import {
  closeUpdateRecoveryIpcChannel,
  createUpdateRecoverySupportBundleIpcChannel,
  openUpdateRecoveryLogsIpcChannel,
  selectUpdateRecoveryPackageIpcChannel,
} from './updateRecoveryProtocol.js';
import {
  createUpdateRecoveryWindowController,
  createUpdateRecoveryWindowOptions,
  type UpdateRecoveryWindowInput,
} from './updateRecoveryWindow.js';

describe('update recovery window', () => {
  it('uses a sandboxed recovery-only window without application privileges', () => {
    const options = createUpdateRecoveryWindowOptions({
      preloadPath: 'C:\\Eky\\updateRecoveryPreload.cjs',
      recovery: recoveryInput,
    });

    expect(options.show).toBe(false);
    expect(options.webPreferences).toMatchObject({
      allowRunningInsecureContent: false,
      contextIsolation: true,
      devTools: false,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      sandbox: true,
      webSecurity: true,
      webviewTag: false,
    });
    expect(options.webPreferences?.additionalArguments).toEqual(
      expect.arrayContaining([
        '--eky-update-recovery-error=UPDATE_RECOVERY_REQUIRED',
        '--eky-update-recovery-version=0.1.0-alpha.1',
        `--eky-update-recovery-build=${buildRevision}`,
        '--eky-update-recovery-rollback=yes',
      ]),
    );
  });

  it('accepts only zero-argument actions from the recovery main frame', async () => {
    const fixture = createFixture();
    const controller = createUpdateRecoveryWindowController(fixture.options);
    const recoveryWindow = fixture.window;
    const createSupportBundle = fixture.handlers.get(
      createUpdateRecoverySupportBundleIpcChannel,
    )!;

    await expect(createSupportBundle(trustedEvent(recoveryWindow))).resolves.toEqual({
      status: 'completed',
    });
    expect(fixture.createSupportBundle).toHaveBeenCalledOnce();

    await expect(
      createSupportBundle(trustedEvent(recoveryWindow), 'forbidden-path'),
    ).resolves.toMatchObject({ status: 'failed' });
    await expect(
      createSupportBundle({ sender: {}, senderFrame: {} } as IpcMainInvokeEvent),
    ).resolves.toMatchObject({ status: 'failed' });
    expect(fixture.createSupportBundle).toHaveBeenCalledOnce();

    controller.dispose();
    expect(fixture.handlers.size).toBe(0);
  });

  it('denies popups, webviews, and navigation away from its fixed page', () => {
    const fixture = createFixture();
    const controller = createUpdateRecoveryWindowController(fixture.options);

    expect(fixture.window.webContents.windowOpenHandler?.()).toEqual({
      action: 'deny',
    });
    const webviewEvent = { preventDefault: vi.fn() };
    fixture.window.emitWebContents('will-attach-webview', webviewEvent);
    expect(webviewEvent.preventDefault).toHaveBeenCalledOnce();

    const denied = { preventDefault: vi.fn() };
    fixture.window.emitWebContents(
      'will-navigate',
      denied,
      'https://example.com/forbidden',
    );
    expect(denied.preventDefault).toHaveBeenCalledOnce();

    const allowed = { preventDefault: vi.fn() };
    fixture.window.emitWebContents(
      'will-navigate',
      allowed,
      fixture.window.loadedUrls[0],
    );
    expect(allowed.preventDefault).not.toHaveBeenCalled();
    controller.dispose();
  });

  it('does not expose manual rollback when the recovery state forbids it', async () => {
    const fixture = createFixture({
      input: {
        ...recoveryInput,
        rollbackPackageSelectionAllowed: false,
      },
    });
    const controller = createUpdateRecoveryWindowController(fixture.options);
    const selectRollback = fixture.handlers.get(
      selectUpdateRecoveryPackageIpcChannel,
    )!;

    await expect(selectRollback(trustedEvent(fixture.window))).resolves.toMatchObject({
      status: 'failed',
    });
    expect(fixture.selectRollbackPackage).not.toHaveBeenCalled();
    controller.dispose();
  });

  it('registers only the four named recovery actions', () => {
    const fixture = createFixture();
    const controller = createUpdateRecoveryWindowController(fixture.options);

    expect([...fixture.handlers.keys()].sort()).toEqual(
      [
        closeUpdateRecoveryIpcChannel,
        createUpdateRecoverySupportBundleIpcChannel,
        openUpdateRecoveryLogsIpcChannel,
        selectUpdateRecoveryPackageIpcChannel,
      ].sort(),
    );
    controller.dispose();
  });
});

type Handler = (
  event: IpcMainInvokeEvent,
  ...values: unknown[]
) => Promise<unknown>;

const buildRevision = 'a'.repeat(40);
const recoveryInput: Readonly<UpdateRecoveryWindowInput> = Object.freeze({
  appVersion: '0.1.0-alpha.1',
  buildRevision,
  errorCode: 'UPDATE_RECOVERY_REQUIRED',
  rollbackPackageSelectionAllowed: true,
});

class FakeWebContents extends EventEmitter {
  readonly mainFrame = {};
  windowOpenHandler?: () => { action: 'deny' };

  setWindowOpenHandler(handler: () => { action: 'deny' }): void {
    this.windowOpenHandler = handler;
  }
}

class FakeWindow extends EventEmitter {
  destroyed = false;
  readonly loadedUrls: string[] = [];
  readonly webContents = new FakeWebContents();
  readonly focus = vi.fn();
  readonly removeMenu = vi.fn();
  readonly show = vi.fn();

  destroy(): void {
    this.destroyed = true;
  }

  emitWebContents(eventName: string, ...values: unknown[]): void {
    this.webContents.emit(eventName, ...values);
  }

  isDestroyed(): boolean {
    return this.destroyed;
  }

  loadURL = vi.fn(async (url: string) => {
    this.loadedUrls.push(url);
  });
}

function createFixture(overrides: {
  input?: Readonly<UpdateRecoveryWindowInput>;
} = {}) {
  const handlers = new Map<string, Handler>();
  const window = new FakeWindow();
  const createSupportBundle = vi.fn(async () => undefined);
  const openLogs = vi.fn(async () => undefined);
  const selectRollbackPackage = vi.fn(async () => undefined);

  return {
    createSupportBundle,
    handlers,
    openLogs,
    options: {
      closeApplication: vi.fn(),
      createSupportBundle,
      createWindow: vi.fn((_options: BrowserWindowConstructorOptions) =>
        window as unknown as BrowserWindow,
      ),
      input: overrides.input ?? recoveryInput,
      ipcMain: {
        handle(channel: string, handler: Handler) {
          handlers.set(channel, handler);
        },
        removeHandler(channel: string) {
          handlers.delete(channel);
        },
      },
      openLogs,
      preloadPath: 'C:\\Eky\\updateRecoveryPreload.cjs',
      selectRollbackPackage,
    },
    selectRollbackPackage,
    window,
  };
}

function trustedEvent(window: FakeWindow): IpcMainInvokeEvent {
  return {
    sender: window.webContents,
    senderFrame: window.webContents.mainFrame,
  } as unknown as IpcMainInvokeEvent;
}
