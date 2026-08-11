import type {
  BrowserWindow,
  IpcMain,
  IpcMainInvokeEvent,
} from 'electron';

import type {
  LocalUpdatePackageCache,
  LocalUpdatePackageSummary,
} from './localUpdatePackageCache.js';
import {
  selectLocalUpdateIpcChannel,
  type LocalUpdateSelectionResult,
} from './localUpdateSelectionTypes.js';

const forbiddenErrorCode = 'LOCAL_UPDATE_SELECTION_FORBIDDEN';
const failedErrorCode = 'LOCAL_UPDATE_SELECTION_FAILED';

interface LocalUpdateSelectionCapabilityOptions {
  cache: Pick<
    LocalUpdatePackageCache,
    'getCurrentRegistrationState' | 'stageSelectedPackage'
  >;
  ipcMain: Pick<IpcMain, 'handle' | 'removeHandler'>;
  mainWindow: BrowserWindow;
  selectManifestPath(): Promise<string | null>;
  showSafeError(): void;
}

export interface LocalUpdateSelectionCapability {
  dispose(): void;
}

export function createLocalUpdateSelectionCapability(
  options: LocalUpdateSelectionCapabilityOptions,
): LocalUpdateSelectionCapability {
  let selectionActive = false;

  options.ipcMain.removeHandler(selectLocalUpdateIpcChannel);
  options.ipcMain.handle(
    selectLocalUpdateIpcChannel,
    async (event, ...args: unknown[]): Promise<LocalUpdateSelectionResult> => {
      if (
        !isTrustedMainWindowRequest(event, options.mainWindow) ||
        args.length !== 0 ||
        selectionActive
      ) {
        throw new Error(forbiddenErrorCode);
      }

      selectionActive = true;
      try {
        const role =
          (await options.cache.getCurrentRegistrationState()) === 'missing'
            ? 'current'
            : 'candidate';
        const manifestPath = await options.selectManifestPath();
        if (manifestPath === null) {
          return Object.freeze({ status: 'cancelled' });
        }
        const summary = await options.cache.stageSelectedPackage({
          manifestPath,
          role,
        });
        return Object.freeze({
          package: toSafePackageSummary(summary),
          status:
            role === 'current' ? 'currentRegistered' : 'candidateReady',
        });
      } catch {
        try {
          options.showSafeError();
        } catch {
          // The fixed capability error remains authoritative.
        }
        throw new Error(failedErrorCode);
      } finally {
        selectionActive = false;
      }
    },
  );

  return {
    dispose() {
      options.ipcMain.removeHandler(selectLocalUpdateIpcChannel);
    },
  };
}

function toSafePackageSummary(
  summary: Readonly<LocalUpdatePackageSummary>,
): Readonly<LocalUpdatePackageSummary> {
  return Object.freeze({
    appVersion: summary.appVersion,
    buildRevision: summary.buildRevision,
    msiProductVersion: summary.msiProductVersion,
    releaseChannel: summary.releaseChannel,
    role: summary.role,
    signingStatus: summary.signingStatus,
  });
}

function isTrustedMainWindowRequest(
  event: IpcMainInvokeEvent,
  mainWindow: BrowserWindow,
): boolean {
  return (
    !mainWindow.isDestroyed() &&
    event.sender === mainWindow.webContents &&
    event.senderFrame === mainWindow.webContents.mainFrame
  );
}
