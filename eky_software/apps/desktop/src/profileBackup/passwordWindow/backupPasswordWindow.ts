import { randomUUID } from 'node:crypto';

import type {
  BrowserWindow,
  BrowserWindowConstructorOptions,
  IpcMain,
  IpcMainInvokeEvent,
} from 'electron';

import { validateBackupPassword } from '../container/deriveBackupKey.js';
import {
  backupPasswordCancelIpcChannel,
  backupPasswordSubmitIpcChannel,
  parseBackupPasswordCancelMessage,
  parseBackupPasswordSubmitMessage,
} from './backupPasswordProtocol.js';
import { backupPasswordPageUrl } from './backupPasswordPage.js';
import type {
  BackupPasswordSubmissionResult,
  BackupPasswordWindowMode,
} from './backupPasswordTypes.js';

const defaultTimeoutMilliseconds = 5 * 60_000;

interface BackupPasswordWindowControllerOptions {
  createWindow(options: BrowserWindowConstructorOptions): BrowserWindow;
  ipcMain: Pick<IpcMain, 'handle' | 'removeHandler'>;
  parentWindow: BrowserWindow;
  preloadPath: string;
  timeoutMilliseconds?: number;
}

export interface BackupPasswordWindowController {
  dispose(): void;
  requestPassword(mode: BackupPasswordWindowMode): Promise<string | null>;
}

export function createBackupPasswordWindowOptions(input: {
  mode: BackupPasswordWindowMode;
  operationId: string;
  parentWindow: BrowserWindow;
  preloadPath: string;
}): BrowserWindowConstructorOptions {
  return {
    backgroundColor: '#eef4fb',
    height: input.mode === 'create' ? 510 : 420,
    maximizable: false,
    minimizable: false,
    modal: true,
    parent: input.parentWindow,
    resizable: false,
    show: false,
    title: 'Eky - varmuuskopion salasana',
    width: 560,
    webPreferences: {
      additionalArguments: [
        `--eky-backup-password-operation=${input.operationId}`,
        `--eky-backup-password-mode=${input.mode}`,
      ],
      allowRunningInsecureContent: false,
      contextIsolation: true,
      devTools: false,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      preload: input.preloadPath,
      sandbox: true,
      webSecurity: true,
      webviewTag: false,
    },
  };
}

export function createBackupPasswordWindowController(
  options: BackupPasswordWindowControllerOptions,
): BackupPasswordWindowController {
  let active:
    | {
        mode: BackupPasswordWindowMode;
        operationId: string;
        reject(error: Error): void;
        resolve(password: string | null): void;
        timer: ReturnType<typeof setTimeout>;
        window: BrowserWindow;
      }
    | undefined;
  let disposed = false;

  const clearActive = () => {
    if (active === undefined) {
      return;
    }
    clearTimeout(active.timer);
    active = undefined;
  };

  options.ipcMain.removeHandler(backupPasswordSubmitIpcChannel);
  options.ipcMain.removeHandler(backupPasswordCancelIpcChannel);
  options.ipcMain.handle(
    backupPasswordSubmitIpcChannel,
    (
      event: IpcMainInvokeEvent,
      value: unknown,
    ): BackupPasswordSubmissionResult => {
      const current = active;
      if (
        current === undefined ||
        !isTrustedPasswordWindowRequest(event, current.window)
      ) {
        throw new Error('BACKUP_PASSWORD_WINDOW_FORBIDDEN');
      }

      const message = parseBackupPasswordSubmitMessage(
        value,
        current.mode,
      );
      if (
        message === undefined ||
        message.operationId !== current.operationId
      ) {
        throw new Error('BACKUP_PASSWORD_WINDOW_REQUEST_INVALID');
      }

      try {
        validateBackupPassword(message.password);
      } catch {
        return { accepted: false, errorCode: 'PASSWORD_INVALID' };
      }
      if (
        current.mode === 'create' &&
        message.confirmation !== message.password
      ) {
        return { accepted: false, errorCode: 'PASSWORD_MISMATCH' };
      }

      const password = message.password;
      clearActive();
      current.resolve(password);
      if (!current.window.isDestroyed()) {
        current.window.destroy();
      }
      return { accepted: true };
    },
  );
  options.ipcMain.handle(
    backupPasswordCancelIpcChannel,
    (event: IpcMainInvokeEvent, value: unknown): void => {
      const current = active;
      if (
        current === undefined ||
        !isTrustedPasswordWindowRequest(event, current.window)
      ) {
        throw new Error('BACKUP_PASSWORD_WINDOW_FORBIDDEN');
      }

      const message = parseBackupPasswordCancelMessage(value);
      if (
        message === undefined ||
        message.operationId !== current.operationId
      ) {
        throw new Error('BACKUP_PASSWORD_WINDOW_REQUEST_INVALID');
      }

      clearActive();
      current.resolve(null);
      if (!current.window.isDestroyed()) {
        current.window.destroy();
      }
    },
  );

  return {
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      options.ipcMain.removeHandler(backupPasswordSubmitIpcChannel);
      options.ipcMain.removeHandler(backupPasswordCancelIpcChannel);

      const current = active;
      clearActive();
      current?.reject(new Error('BACKUP_PASSWORD_WINDOW_DISPOSED'));
      if (current !== undefined && !current.window.isDestroyed()) {
        current.window.destroy();
      }
    },
    requestPassword(mode) {
      if (
        disposed ||
        active !== undefined ||
        options.parentWindow.isDestroyed()
      ) {
        return Promise.reject(new Error('BACKUP_PASSWORD_WINDOW_BUSY'));
      }

      const operationId = randomUUID();
      const passwordWindow = options.createWindow(
        createBackupPasswordWindowOptions({
          mode,
          operationId,
          parentWindow: options.parentWindow,
          preloadPath: options.preloadPath,
        }),
      );
      passwordWindow.removeMenu();
      passwordWindow.webContents.setWindowOpenHandler(() => ({
        action: 'deny',
      }));
      passwordWindow.webContents.on('will-attach-webview', (event) => {
        event.preventDefault();
      });
      passwordWindow.webContents.on(
        'will-navigate',
        (event, targetUrl) => {
          if (targetUrl !== backupPasswordPageUrl) {
            event.preventDefault();
          }
        },
      );

      return new Promise<string | null>((resolve, reject) => {
        const timer = setTimeout(() => {
          if (active?.operationId !== operationId) {
            return;
          }
          clearActive();
          if (!passwordWindow.isDestroyed()) {
            passwordWindow.destroy();
          }
          reject(new Error('BACKUP_PASSWORD_WINDOW_TIMEOUT'));
        }, options.timeoutMilliseconds ?? defaultTimeoutMilliseconds);
        active = {
          mode,
          operationId,
          reject,
          resolve,
          timer,
          window: passwordWindow,
        };

        passwordWindow.once('ready-to-show', () => {
          if (active?.operationId === operationId) {
            passwordWindow.show();
            passwordWindow.focus();
          }
        });
        passwordWindow.once('closed', () => {
          if (active?.operationId === operationId) {
            clearActive();
            resolve(null);
          }
        });
        void passwordWindow.loadURL(backupPasswordPageUrl).catch(() => {
          if (active?.operationId !== operationId) {
            return;
          }
          clearActive();
          if (!passwordWindow.isDestroyed()) {
            passwordWindow.destroy();
          }
          reject(new Error('BACKUP_PASSWORD_WINDOW_LOAD_FAILED'));
        });
      });
    },
  };
}

function isTrustedPasswordWindowRequest(
  event: IpcMainInvokeEvent,
  passwordWindow: BrowserWindow,
): boolean {
  return (
    !passwordWindow.isDestroyed() &&
    event.sender === passwordWindow.webContents &&
    event.senderFrame === passwordWindow.webContents.mainFrame
  );
}
