import type {
  BrowserWindow,
  BrowserWindowConstructorOptions,
  IpcMain,
  IpcMainInvokeEvent,
} from 'electron';

import {
  closeUpdateRecoveryIpcChannel,
  createUpdateRecoverySupportBundleIpcChannel,
  openUpdateRecoveryLogsIpcChannel,
  selectUpdateRecoveryPackageIpcChannel,
  updateRecoveryActionCompleted,
  updateRecoveryActionFailed,
  type UpdateRecoveryActionResult,
} from './updateRecoveryProtocol.js';
import { updateRecoveryPageUrl } from './updateRecoveryPage.js';

export interface UpdateRecoveryWindowInput {
  appVersion: string;
  buildRevision: string;
  errorCode: string;
  rollbackPackageSelectionAllowed: boolean;
}

interface UpdateRecoveryWindowControllerOptions {
  closeApplication(): void;
  createSupportBundle(): Promise<void>;
  createWindow(options: BrowserWindowConstructorOptions): BrowserWindow;
  input: Readonly<UpdateRecoveryWindowInput>;
  ipcMain: Pick<IpcMain, 'handle' | 'removeHandler'>;
  openLogs(): Promise<void>;
  preloadPath: string;
  selectRollbackPackage(): Promise<void>;
}

export interface UpdateRecoveryWindowController {
  applicationWindow: BrowserWindow;
  dispose(): void;
  focus(): void;
}

export function createUpdateRecoveryWindowOptions(input: {
  preloadPath: string;
  recovery: Readonly<UpdateRecoveryWindowInput>;
}): BrowserWindowConstructorOptions {
  return {
    backgroundColor: '#eef4fb',
    height: 620,
    minHeight: 540,
    minWidth: 720,
    show: false,
    title: 'Eky - palautustila',
    width: 820,
    webPreferences: {
      additionalArguments: [
        `--eky-update-recovery-error=${input.recovery.errorCode}`,
        `--eky-update-recovery-version=${input.recovery.appVersion}`,
        `--eky-update-recovery-build=${input.recovery.buildRevision}`,
        `--eky-update-recovery-rollback=${
          input.recovery.rollbackPackageSelectionAllowed ? 'yes' : 'no'
        }`,
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

export function createUpdateRecoveryWindowController(
  options: UpdateRecoveryWindowControllerOptions,
): UpdateRecoveryWindowController {
  const recoveryWindow = options.createWindow(
    createUpdateRecoveryWindowOptions({
      preloadPath: options.preloadPath,
      recovery: options.input,
    }),
  );
  let disposed = false;
  let operationActive = false;

  const registerAction = (
    channel: string,
    action: () => Promise<void>,
  ) => {
    options.ipcMain.removeHandler(channel);
    options.ipcMain.handle(
      channel,
      async (
        event: IpcMainInvokeEvent,
        ...values: unknown[]
      ): Promise<UpdateRecoveryActionResult> => {
        if (
          disposed ||
          operationActive ||
          values.length !== 0 ||
          !isTrustedRecoveryWindowRequest(event, recoveryWindow)
        ) {
          return updateRecoveryActionFailed;
        }
        operationActive = true;
        try {
          await action();
          return updateRecoveryActionCompleted;
        } catch {
          return updateRecoveryActionFailed;
        } finally {
          operationActive = false;
        }
      },
    );
  };

  registerAction(
    createUpdateRecoverySupportBundleIpcChannel,
    options.createSupportBundle,
  );
  registerAction(openUpdateRecoveryLogsIpcChannel, options.openLogs);
  registerAction(selectUpdateRecoveryPackageIpcChannel, async () => {
    if (!options.input.rollbackPackageSelectionAllowed) {
      throw new Error('UPDATE_RECOVERY_ROLLBACK_NOT_ALLOWED');
    }
    await options.selectRollbackPackage();
  });
  registerAction(closeUpdateRecoveryIpcChannel, async () => {
    options.closeApplication();
  });

  recoveryWindow.removeMenu();
  recoveryWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  recoveryWindow.webContents.on('will-attach-webview', (event) => {
    event.preventDefault();
  });
  recoveryWindow.webContents.on('will-navigate', (event, targetUrl) => {
    if (targetUrl !== updateRecoveryPageUrl) {
      event.preventDefault();
    }
  });
  recoveryWindow.once('ready-to-show', () => {
    if (!recoveryWindow.isDestroyed()) {
      recoveryWindow.show();
      recoveryWindow.focus();
    }
  });
  void recoveryWindow.loadURL(updateRecoveryPageUrl).catch(() => {
    options.closeApplication();
  });

  return {
    applicationWindow: recoveryWindow,
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      for (const channel of [
        createUpdateRecoverySupportBundleIpcChannel,
        openUpdateRecoveryLogsIpcChannel,
        selectUpdateRecoveryPackageIpcChannel,
        closeUpdateRecoveryIpcChannel,
      ]) {
        options.ipcMain.removeHandler(channel);
      }
      if (!recoveryWindow.isDestroyed()) {
        recoveryWindow.destroy();
      }
    },
    focus() {
      if (!recoveryWindow.isDestroyed()) {
        recoveryWindow.show();
        recoveryWindow.focus();
      }
    },
  };
}

function isTrustedRecoveryWindowRequest(
  event: IpcMainInvokeEvent,
  recoveryWindow: BrowserWindow,
): boolean {
  return (
    !recoveryWindow.isDestroyed() &&
    event.sender === recoveryWindow.webContents &&
    event.senderFrame === recoveryWindow.webContents.mainFrame
  );
}
