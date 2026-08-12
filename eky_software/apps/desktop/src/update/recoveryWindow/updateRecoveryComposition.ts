import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import type {
  BrowserWindow,
  BrowserWindowConstructorOptions,
  IpcMain,
  OpenDialogOptions,
  OpenDialogReturnValue,
  SaveDialogOptions,
  SaveDialogReturnValue,
} from 'electron';

import type { DesktopLifecycleHandle } from '../../main/desktopComposition.js';
import type { UpdateBinaryRollbackCoordinator } from '../updateBinaryRollbackCoordinator.js';
import {
  createUpdateRecoverySupportBundle,
  createUpdateRecoverySupportBundleFilename,
} from './updateRecoverySupportBundle.js';
import {
  createUpdateRecoveryWindowController,
  type UpdateRecoveryWindowInput,
} from './updateRecoveryWindow.js';

interface UpdateRecoveryCompositionOptions {
  applicationPath: string;
  architecture: string;
  createWindow(options: BrowserWindowConstructorOptions): BrowserWindow;
  electronVersion: string;
  input: Readonly<UpdateRecoveryWindowInput>;
  ipcMain: Pick<IpcMain, 'handle' | 'removeHandler'>;
  logsRoot: string;
  openPath(path: string): Promise<string>;
  quitApplication(): void;
  rollbackCoordinator?: Pick<
    UpdateBinaryRollbackCoordinator,
    'registerAndStartManualRollback'
  >;
  showOpenDialog(
    owner: BrowserWindow,
    options: OpenDialogOptions,
  ): Promise<OpenDialogReturnValue>;
  showSaveDialog(
    owner: BrowserWindow,
    options: SaveDialogOptions,
  ): Promise<SaveDialogReturnValue>;
}

export function createUpdateRecoveryComposition(
  options: UpdateRecoveryCompositionOptions,
): DesktopLifecycleHandle {
  let recoveryWindow: BrowserWindow | undefined;
  let shutdownStarted = false;
  const controller = createUpdateRecoveryWindowController({
    closeApplication: options.quitApplication,
    async createSupportBundle() {
      if (recoveryWindow === undefined || recoveryWindow.isDestroyed()) {
        throw new Error('UPDATE_RECOVERY_WINDOW_UNAVAILABLE');
      }
      const result = await options.showSaveDialog(recoveryWindow, {
        defaultPath: createUpdateRecoverySupportBundleFilename(new Date()),
        filters: [
          {
            extensions: ['json.gz'],
            name: 'Eky-palautustukipaketti, GZip-pakattu JSON',
          },
        ],
        title: 'Tallenna Eky-palautustukipaketti',
      });
      if (result.canceled || result.filePath === '') {
        return;
      }
      await createUpdateRecoverySupportBundle({
        appVersion: options.input.appVersion,
        architecture: options.architecture,
        buildRevision: options.input.buildRevision,
        createdAt: new Date().toISOString(),
        electronVersion: options.electronVersion,
        errorCode: options.input.errorCode,
        platform: process.platform,
        targetPath: result.filePath,
      });
    },
    createWindow: options.createWindow,
    input: options.input,
    ipcMain: options.ipcMain,
    async openLogs() {
      await mkdir(options.logsRoot, { mode: 0o700, recursive: true });
      if ((await options.openPath(options.logsRoot)).length !== 0) {
        throw new Error('UPDATE_RECOVERY_LOG_FOLDER_FAILED');
      }
    },
    preloadPath: join(
      options.applicationPath,
      'dist',
      'update',
      'recoveryWindow',
      'updateRecoveryPreload.cjs',
    ),
    async selectRollbackPackage() {
      if (
        options.rollbackCoordinator === undefined ||
        recoveryWindow === undefined ||
        recoveryWindow.isDestroyed()
      ) {
        throw new Error('UPDATE_RECOVERY_ROLLBACK_UNAVAILABLE');
      }
      const result = await options.showOpenDialog(recoveryWindow, {
        filters: [
          {
            extensions: ['json'],
            name: 'Eky-palautuspaketin manifesti',
          },
        ],
        properties: ['openFile'],
        title: 'Valitse täsmälleen aiemman Eky-version palautuspaketti',
      });
      if (result.canceled || result.filePaths.length !== 1) {
        return;
      }
      const manifestPath = result.filePaths[0];
      if (manifestPath === undefined) {
        throw new Error('UPDATE_RECOVERY_ROLLBACK_SELECTION_INVALID');
      }
      await options.rollbackCoordinator.registerAndStartManualRollback(
        manifestPath,
      );
      options.quitApplication();
    },
  });
  recoveryWindow = controller.applicationWindow;

  return {
    applicationWindow: controller.applicationWindow,
    focusApplicationWindow() {
      controller.focus();
    },
    async shutdown() {
      if (shutdownStarted) {
        return;
      }
      shutdownStarted = true;
      controller.dispose();
    },
  };
}
