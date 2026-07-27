import { randomUUID } from 'node:crypto';

import type {
  BrowserWindow,
  IpcMain,
  IpcMainInvokeEvent,
} from 'electron';

import {
  createSupportBundleIpcChannel,
  type SupportBundleCreationResult,
} from '../diagnostics/desktopDiagnosticsTypes.js';
import { createDesktopOperationalEvent } from '../observability/createDesktopOperationalEvent.js';
import type { DesktopOperationalIdentity } from '../observability/desktopOperationalEvent.js';
import type { DesktopOperationalLogger } from '../observability/desktopOperationalLogger.js';
import {
  createSupportBundleArchive,
  createSupportBundleFileName,
} from './supportBundleArchive.js';
import { readSupportBundleBackendData } from './supportBundleBackendData.js';
import { writeSupportBundleAtomically } from './supportBundleFileStore.js';

interface SupportBundleCapabilityOptions {
  appVersion: string;
  architecture: string;
  confirmCreation(): Promise<boolean>;
  ipcMain: Pick<IpcMain, 'handle' | 'removeHandler'>;
  loadBackendData(): Promise<unknown>;
  mainWindow: BrowserWindow;
  now?(): Date;
  operationalLogger: DesktopOperationalLogger;
  operationalIdentity: DesktopOperationalIdentity;
  platform: string;
  runtimeRoot: string;
  selectTargetPath(defaultFileName: string): Promise<string | null>;
  showSafeError(): void;
  writeArchive?(input: {
    archive: Buffer;
    runtimeRoot: string;
    targetPath: string;
  }): void;
}

export interface SupportBundleCapability {
  dispose(): void;
}

export function createSupportBundleCapability(
  options: SupportBundleCapabilityOptions,
): SupportBundleCapability {
  let creationInProgress = false;

  options.ipcMain.removeHandler(createSupportBundleIpcChannel);
  options.ipcMain.handle(
    createSupportBundleIpcChannel,
    async (event, ...args: unknown[]): Promise<SupportBundleCreationResult> => {
      if (
        !isTrustedMainWindowRequest(event, options.mainWindow) ||
        args.length !== 0
      ) {
        throw new Error('SUPPORT_BUNDLE_FORBIDDEN');
      }
      if (creationInProgress) {
        throw new Error('SUPPORT_BUNDLE_CREATION_IN_PROGRESS');
      }
      creationInProgress = true;

      const createdAt = options.now?.() ?? new Date();
      const creationCorrelationId = randomUUID();
      const startedAt = Date.now();

      try {
        if (!(await options.confirmCreation())) {
          return 'cancelled';
        }
        const targetPath = await options.selectTargetPath(
          createSupportBundleFileName(createdAt),
        );
        if (targetPath === null) {
          return 'cancelled';
        }

        options.operationalLogger.write(
          createDesktopOperationalEvent(
            {
              correlationId: creationCorrelationId,
              eventName: 'supportBundle.creationStarted',
              stage: 'create',
            },
            options.operationalIdentity,
          ),
        );

        const backendData = readSupportBundleBackendData(
          await options.loadBackendData(),
        );
        const archive = createSupportBundleArchive({
          appVersion: options.appVersion,
          architecture: options.architecture,
          backendData,
          createdAt,
          creationCorrelationId,
          platform: options.platform,
        });
        const writeArchive =
          options.writeArchive ?? writeSupportBundleAtomically;
        writeArchive({
          archive: archive.compressed,
          runtimeRoot: options.runtimeRoot,
          targetPath,
        });

        options.operationalLogger.write(
          createDesktopOperationalEvent(
            {
              correlationId: creationCorrelationId,
              durationMs: Date.now() - startedAt,
              eventName: 'supportBundle.creationCompleted',
              stage: 'create',
            },
            options.operationalIdentity,
          ),
        );
        return 'created';
      } catch {
        options.operationalLogger.write(
          createDesktopOperationalEvent(
            {
              correlationId: creationCorrelationId,
              durationMs: Date.now() - startedAt,
              errorCode: 'SUPPORT_BUNDLE_CREATION_FAILED',
              eventName: 'supportBundle.creationFailed',
              retryable: true,
              sideEffectState: 'unknown',
              stage: 'create',
            },
            options.operationalIdentity,
          ),
        );
        options.showSafeError();
        throw new Error('SUPPORT_BUNDLE_CREATION_FAILED');
      } finally {
        creationInProgress = false;
      }
    },
  );

  return {
    dispose() {
      options.ipcMain.removeHandler(createSupportBundleIpcChannel);
    },
  };
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
