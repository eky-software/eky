import { EventEmitter } from 'node:events';

import type {
  BrowserWindow,
  BrowserWindowConstructorOptions,
  IpcMainInvokeEvent,
} from 'electron';
import { describe, expect, it, vi } from 'vitest';

import {
  backupPasswordCancelIpcChannel,
  backupPasswordSubmitIpcChannel,
} from './backupPasswordProtocol.js';
import {
  createBackupPasswordWindowController,
  createBackupPasswordWindowOptions,
} from './backupPasswordWindow.js';

describe('backup password window', () => {
  it('uses a modal sandboxed window without application privileges', () => {
    const parent = {} as BrowserWindow;
    const options = createBackupPasswordWindowOptions({
      mode: 'create',
      operationId: '11111111-1111-4111-8111-111111111111',
      parentWindow: parent,
      preloadPath: 'C:\\Eky\\backupPasswordPreload.cjs',
    });

    expect(options.modal).toBe(true);
    expect(options.parent).toBe(parent);
    expect(options.show).toBe(false);
    expect(options.webPreferences).toMatchObject({
      contextIsolation: true,
      devTools: false,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      sandbox: true,
      webSecurity: true,
      webviewTag: false,
    });
  });

  it('returns a valid confirmed password once and destroys the window', async () => {
    const fixture = createFixture();
    const controller = createBackupPasswordWindowController(fixture.options);
    const passwordPromise = controller.requestPassword('create');
    const passwordWindow = fixture.createdWindow();
    const operationId = readOperationId(fixture.createdOptions());
    const handler = fixture.handlers.get(backupPasswordSubmitIpcChannel)!;

    const result = await handler(
      trustedEvent(passwordWindow),
      {
        confirmation: 'Synthetic backup password 2026!',
        operationId,
        password: 'Synthetic backup password 2026!',
      },
    );

    expect(result).toEqual({ accepted: true });
    await expect(passwordPromise).resolves.toBe(
      'Synthetic backup password 2026!',
    );
    expect(passwordWindow.destroyed).toBe(true);
    controller.dispose();
  });

  it('keeps the window open for invalid or mismatched passwords', async () => {
    const fixture = createFixture();
    const controller = createBackupPasswordWindowController(fixture.options);
    const passwordPromise = controller.requestPassword('create');
    const passwordWindow = fixture.createdWindow();
    const operationId = readOperationId(fixture.createdOptions());
    const handler = fixture.handlers.get(backupPasswordSubmitIpcChannel)!;

    expect(
      handler(trustedEvent(passwordWindow), {
        confirmation: 'short',
        operationId,
        password: 'short',
      }),
    ).toEqual({
      accepted: false,
      errorCode: 'PASSWORD_INVALID',
    });
    expect(
      handler(trustedEvent(passwordWindow), {
        confirmation: 'A different valid backup password!',
        operationId,
        password: 'Synthetic backup password 2026!',
      }),
    ).toEqual({
      accepted: false,
      errorCode: 'PASSWORD_MISMATCH',
    });
    expect(passwordWindow.destroyed).toBe(false);

    const cancel = fixture.handlers.get(backupPasswordCancelIpcChannel)!;
    await cancel(trustedEvent(passwordWindow), { operationId });
    await expect(passwordPromise).resolves.toBeNull();
    controller.dispose();
  });

  it('rejects requests from another renderer and prevents parallel prompts', async () => {
    const fixture = createFixture();
    const controller = createBackupPasswordWindowController(fixture.options);
    const passwordPromise = controller.requestPassword('enter');
    const passwordWindow = fixture.createdWindow();
    const operationId = readOperationId(fixture.createdOptions());
    const handler = fixture.handlers.get(backupPasswordSubmitIpcChannel)!;

    await expect(controller.requestPassword('enter')).rejects.toThrow(
      'BACKUP_PASSWORD_WINDOW_BUSY',
    );
    expect(() =>
      handler(
        {
          sender: {},
          senderFrame: {},
        } as IpcMainInvokeEvent,
        {
          operationId,
          password: 'Synthetic backup password 2026!',
        },
      ),
    ).toThrow('BACKUP_PASSWORD_WINDOW_FORBIDDEN');

    const cancel = fixture.handlers.get(backupPasswordCancelIpcChannel)!;
    await cancel(trustedEvent(passwordWindow), { operationId });
    await passwordPromise;
    controller.dispose();
  });
});

type Handler = (
  event: IpcMainInvokeEvent,
  value: unknown,
) => Promise<unknown> | unknown;

class FakeWebContents extends EventEmitter {
  readonly mainFrame = {};

  setWindowOpenHandler = vi.fn();
}

class FakeWindow extends EventEmitter {
  destroyed = false;
  readonly webContents = new FakeWebContents();

  destroy(): void {
    this.destroyed = true;
    this.emit('closed');
  }

  focus = vi.fn();
  isDestroyed(): boolean {
    return this.destroyed;
  }

  loadURL = vi.fn(async () => undefined);
  removeMenu = vi.fn();
  show = vi.fn();
}

function createFixture() {
  const handlers = new Map<string, Handler>();
  const createdOptions: BrowserWindowConstructorOptions[] = [];
  const createdWindows: FakeWindow[] = [];
  const parentWindow = {
    isDestroyed: () => false,
  } as BrowserWindow;

  return {
    createdOptions: () => createdOptions[0]!,
    createdWindow: () => createdWindows[0]!,
    handlers,
    options: {
      createWindow(options: BrowserWindowConstructorOptions) {
        const window = new FakeWindow();
        createdOptions.push(options);
        createdWindows.push(window);
        return window as unknown as BrowserWindow;
      },
      ipcMain: {
        handle(channel: string, handler: Handler) {
          handlers.set(channel, handler);
        },
        removeHandler(channel: string) {
          handlers.delete(channel);
        },
      },
      parentWindow,
      preloadPath: 'C:\\Eky\\backupPasswordPreload.cjs',
    },
  };
}

function readOperationId(options: BrowserWindowConstructorOptions): string {
  const argument = options.webPreferences?.additionalArguments?.find(
    (value) => value.startsWith('--eky-backup-password-operation='),
  );
  return argument!.split('=')[1]!;
}

function trustedEvent(window: FakeWindow): IpcMainInvokeEvent {
  return {
    sender: window.webContents,
    senderFrame: window.webContents.mainFrame,
  } as unknown as IpcMainInvokeEvent;
}
