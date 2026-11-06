import { randomUUID } from 'node:crypto';
import { isPromise } from 'node:util/types';

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
  createDesktopOnlySupportBundleArchive,
  type SupportBundleArchive,
} from './supportBundleArchive.js';
import { readSupportBundleBackendData } from './supportBundleBackendData.js';
import { readSupportBundleDesktopData, type SupportBundleDesktopData } from './supportBundleDesktopData.js';
import { writeSupportBundleAtomically } from './supportBundleFileStore.js';

interface SupportBundleExportOptions {
  confirmCreation(): Promise<boolean>;
  now?(): Date;
  operationalLogger: DesktopOperationalLogger;
  operationalIdentity: DesktopOperationalIdentity;
  // Synthetic tests can retain a first cause privately before the IPC projection.
  observeFailure?(error: unknown): void;
  runtimeRoot: string;
  selectTargetPath(defaultFileName: string): Promise<string | null>;
  showSafeError(): void;
  writeArchive?(input: {
    archive: Buffer;
    runtimeRoot: string;
    targetPath: string;
  }): void;
}

interface WindowSupportBundleOptions extends SupportBundleExportOptions {
  assertCurrent?(): void;
  ipcMain: Pick<IpcMain, 'handle' | 'removeHandler'>;
  mainWindow: BrowserWindow;
}

interface SupportBundleCapabilityOptions extends WindowSupportBundleOptions {
  appVersion: string;
  architecture: string;
  loadBackendData(): Promise<unknown>;
  platform: string;
}

interface DesktopOnlySupportBundleOptions extends SupportBundleExportOptions {
  assertCurrent(): void;
  loadDesktopData(): Readonly<SupportBundleDesktopData>;
}

export interface SupportBundleCapability {
  dispose(): void;
}

export interface NativeSupportBundleExport extends SupportBundleCapability {
  create(): Promise<SupportBundleCreationResult>;
}

interface ArchiveCreationContext {
  assertCurrent(): void;
  createdAt: Date;
  creationCorrelationId: string;
}

type CreateArchive = (context: ArchiveCreationContext) => SupportBundleArchive | Promise<SupportBundleArchive>;

export function createSupportBundleCapability(
  options: SupportBundleCapabilityOptions,
): SupportBundleCapability {
  return createWindowSupportBundleCapability(options, async context => {
    const backendValue = await options.loadBackendData();
    context.assertCurrent();
    return createSupportBundleArchive({
      appVersion: options.appVersion, architecture: options.architecture,
      backendData: readSupportBundleBackendData(backendValue), createdAt: context.createdAt,
      creationCorrelationId: context.creationCorrelationId, platform: options.platform,
    });
  });
}

export function createDesktopOnlySupportBundleCapability(
  options: DesktopOnlySupportBundleOptions & Pick<WindowSupportBundleOptions, 'ipcMain' | 'mainWindow'>,
): SupportBundleCapability {
  return createWindowSupportBundleCapability(options, desktopOnlyArchiveCreator(options));
}

// A main-owned, once-only entry. It never fabricates an IPC sender or a window.
export function createDesktopOnlySupportBundleExport(options: DesktopOnlySupportBundleOptions): NativeSupportBundleExport {
  let disposed = false;
  let consumed = false;
  const assertRuntimeCurrent = options.assertCurrent.bind(options);
  const createArchive = desktopOnlyArchiveCreator(options);
  return Object.freeze({
    async create() {
      if (disposed || consumed) throw new Error('SUPPORT_BUNDLE_FORBIDDEN');
      consumed = true;
      const observeFailure = firstFailureObserver(options);
      const assertCurrent = () => {
        try {
          if (disposed) throw new Error('SUPPORT_BUNDLE_FORBIDDEN');
          assertUpdateJournalAuthority(assertRuntimeCurrent);
          if (disposed) throw new Error('SUPPORT_BUNDLE_FORBIDDEN');
        } catch (cause) {
          observeFailure(cause);
          throw new Error('SUPPORT_BUNDLE_FORBIDDEN');
        }
      };
      assertCurrent();
      return runSupportBundleCreation(options, createArchive, assertCurrent, observeFailure);
    },
    dispose() { disposed = true; },
  });
}

function desktopOnlyArchiveCreator(options: DesktopOnlySupportBundleOptions): CreateArchive {
  const loadDesktopData = options.loadDesktopData.bind(options);
  return context => {
    context.assertCurrent();
    const value: unknown = loadDesktopData();
    if (isPromise(value)) {
      // Never await an accidental async provider or leak its later rejection.
      void Promise.prototype.then.call(value, undefined, () => undefined);
      throw new Error('SUPPORT_BUNDLE_DESKTOP_DATA_INVALID');
    }
    const data = readSupportBundleDesktopData(value);
    context.assertCurrent();
    if (data.system.appVersion !== options.operationalIdentity.appVersion ||
        data.system.buildRevision !== options.operationalIdentity.buildRevision) {
      throw new Error('SUPPORT_BUNDLE_DESKTOP_DATA_INVALID');
    }
    return createDesktopOnlySupportBundleArchive({ desktopData: data,
      createdAt: context.createdAt, creationCorrelationId: context.creationCorrelationId });
  };
}

function createWindowSupportBundleCapability(options: WindowSupportBundleOptions, createArchive: CreateArchive): SupportBundleCapability {
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
      const observeFailure = firstFailureObserver(options);
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

      try {
        return await runSupportBundleCreation(options, createArchive, assertCurrent, observeFailure);
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

async function runSupportBundleCreation(options: SupportBundleExportOptions, createArchive: CreateArchive,
  assertCurrent: () => void, observeFailure: (cause: unknown) => void): Promise<SupportBundleCreationResult> {
  const creationCorrelationId = randomUUID();
  const startedAt = Date.now();
  try {
    const createdAt = options.now?.() ?? new Date();
    assertCurrent();
    const confirmed = await options.confirmCreation();
    assertCurrent();
    if (!confirmed) return 'cancelled';
    const targetPath = await options.selectTargetPath(createSupportBundleFileName(createdAt));
    assertCurrent();
    if (targetPath === null) return 'cancelled';
    recordSafely(options, () => createDesktopOperationalEvent({ correlationId: creationCorrelationId,
      eventName: 'supportBundle.creationStarted', stage: 'create' }, options.operationalIdentity));
    assertCurrent();
    const archive = await createArchive({ assertCurrent, createdAt, creationCorrelationId });
    const writeArchive = options.writeArchive ?? writeSupportBundleAtomically;
    assertCurrent();
    writeArchive({ archive: archive.compressed, runtimeRoot: options.runtimeRoot, targetPath });
    recordSafely(options, () => createDesktopOperationalEvent({ correlationId: creationCorrelationId,
      durationMs: Date.now() - startedAt, eventName: 'supportBundle.creationCompleted', stage: 'create' }, options.operationalIdentity));
    return 'created';
  } catch (cause) {
    observeFailure(cause);
    recordSafely(options, () => createDesktopOperationalEvent({ correlationId: creationCorrelationId,
      durationMs: Date.now() - startedAt, errorCode: 'SUPPORT_BUNDLE_CREATION_FAILED',
      eventName: 'supportBundle.creationFailed', retryable: true, sideEffectState: 'unknown', stage: 'create' }, options.operationalIdentity));
    try { assertCurrent(); options.showSafeError(); } catch { /* No stale UI or replacement failure. */ }
    throw new Error('SUPPORT_BUNDLE_CREATION_FAILED');
  }
}

function firstFailureObserver(options: SupportBundleExportOptions): (cause: unknown) => void {
  let observed = false;
  return cause => {
    if (observed) return;
    observed = true;
    try {
      const result: unknown = options.observeFailure?.(cause);
      if (result !== undefined) void Promise.resolve(result).catch(() => undefined);
    } catch { /* Private evidence cannot change the result. */ }
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
  options: SupportBundleExportOptions,
  createEvent: () => Parameters<DesktopOperationalLogger['write']>[0],
): void {
  try { options.operationalLogger.write(createEvent()); } catch { /* Observability is non-authoritative. */ }
}
