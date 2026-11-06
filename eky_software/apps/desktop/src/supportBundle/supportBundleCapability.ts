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
import { assertUpdateJournalAuthority } from '../update/updateJournalStore.js';
import {
  createSupportBundleArchive,
  createSupportBundleFileName,
} from './supportBundleArchive.js';
import { readSupportBundleBackendData } from './supportBundleBackendData.js';
import { writeSupportBundleAtomically } from './supportBundleFileStore.js';

interface SupportBundleCapabilityOptions {
  appVersion: string;
  architecture: string;
  assertCurrent?(): void;
  confirmCreation(): Promise<boolean>;
  ipcMain: Pick<IpcMain, 'handle' | 'removeHandler'>;
  loadBackendData(): Promise<unknown>;
  mainWindow: BrowserWindow;
  now?(): Date;
  operationalLogger: DesktopOperationalLogger;
  operationalIdentity: DesktopOperationalIdentity;
  // Synthetic tests can retain a first cause privately before the IPC projection.
  observeFailure?(error: unknown): void;
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
  let disposed = false;
  let documentEpoch = 0;
  const assertRuntimeCurrent = options.assertCurrent?.bind(options);
  const documentEvents = options.mainWindow.webContents;
  const invalidateDocument = () => { documentEpoch += 1; };
  const navigationStarted = (details: { isMainFrame: boolean }) => {
    if (details.isMainFrame) invalidateDocument();
  };
  documentEvents.on('did-start-navigation', navigationStarted);
  documentEvents.on('did-start-loading', invalidateDocument);
  documentEvents.on('render-process-gone', invalidateDocument);
  documentEvents.on('destroyed', invalidateDocument);
  options.mainWindow.on('close', invalidateDocument);

  options.ipcMain.removeHandler(createSupportBundleIpcChannel);
  options.ipcMain.handle(
    createSupportBundleIpcChannel,
    async (event, ...args: unknown[]): Promise<SupportBundleCreationResult> => {
      const epoch = documentEpoch;
      let failureObserved = false;
      const observeFailure = (cause: unknown) => {
        if (failureObserved) return;
        failureObserved = true;
        try {
          const result: unknown = options.observeFailure?.(cause);
          if (result !== undefined) void Promise.resolve(result).catch(() => undefined);
        } catch { /* Private evidence cannot change the IPC result. */ }
      };
      const assertRequestCurrent = () => {
        if (disposed || documentEpoch !== epoch || args.length !== 0 ||
            !isTrustedMainWindowRequest(event, options.mainWindow)) {
          throw new Error('SUPPORT_BUNDLE_FORBIDDEN');
        }
      };
      const assertCurrent = () => {
        try {
          assertRequestCurrent();
          if (assertRuntimeCurrent !== undefined) assertUpdateJournalAuthority(assertRuntimeCurrent);
          assertRequestCurrent();
        } catch (cause) {
          observeFailure(cause);
          throw new Error('SUPPORT_BUNDLE_FORBIDDEN');
        }
      };
      assertCurrent();
      if (creationInProgress) {
        throw new Error('SUPPORT_BUNDLE_CREATION_IN_PROGRESS');
      }
      creationInProgress = true;

      const creationCorrelationId = randomUUID();
      const startedAt = Date.now();

      try {
        const createdAt = options.now?.() ?? new Date();
        assertCurrent();
        const confirmed = await options.confirmCreation();
        assertCurrent();
        if (!confirmed) {
          return 'cancelled';
        }
        const targetPath = await options.selectTargetPath(
          createSupportBundleFileName(createdAt),
        );
        assertCurrent();
        if (targetPath === null) {
          return 'cancelled';
        }

        recordSafely(options, () =>
          createDesktopOperationalEvent(
            {
              correlationId: creationCorrelationId,
              eventName: 'supportBundle.creationStarted',
              stage: 'create',
            },
            options.operationalIdentity,
          ),
        );

        assertCurrent();
        const backendValue = await options.loadBackendData();
        assertCurrent();
        const backendData = readSupportBundleBackendData(backendValue);
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
        assertCurrent();
        writeArchive({
          archive: archive.compressed,
          runtimeRoot: options.runtimeRoot,
          targetPath,
        });

        recordSafely(options, () =>
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
      } catch (cause) {
        observeFailure(cause);
        recordSafely(options, () =>
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
        try { assertCurrent(); options.showSafeError(); } catch { /* No stale UI or replacement failure. */ }
        throw new Error('SUPPORT_BUNDLE_CREATION_FAILED');
      } finally {
        creationInProgress = false;
      }
    },
  );

  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      invalidateDocument();
      options.ipcMain.removeHandler(createSupportBundleIpcChannel);
      documentEvents.off('did-start-navigation', navigationStarted);
      documentEvents.off('did-start-loading', invalidateDocument);
      documentEvents.off('render-process-gone', invalidateDocument);
      documentEvents.off('destroyed', invalidateDocument);
      options.mainWindow.off('close', invalidateDocument);
    },
  };
}

function isTrustedMainWindowRequest(
  event: IpcMainInvokeEvent,
  mainWindow: BrowserWindow,
): boolean {
  return (
    !mainWindow.isDestroyed() &&
    !mainWindow.webContents.isDestroyed() &&
    event.sender === mainWindow.webContents &&
    event.senderFrame === mainWindow.webContents.mainFrame
  );
}

function recordSafely(
  options: SupportBundleCapabilityOptions,
  createEvent: () => Parameters<DesktopOperationalLogger['write']>[0],
): void {
  try { options.operationalLogger.write(createEvent()); } catch { /* Observability is non-authoritative. */ }
}
