import { randomUUID } from 'node:crypto';

import type {
  BrowserWindow,
  IpcMain,
  IpcMainInvokeEvent,
} from 'electron';

import type { DesktopReleaseInfo } from '../release/desktopReleaseInfo.js';
import type { LocalUpdateHandoffCoordinator } from './localUpdateHandoffCoordinator.js';
import type {
  LocalUpdatePackageCache,
  LocalUpdatePackageSummary,
} from './localUpdatePackageCache.js';
import {
  cancelLocalUpdateIpcChannel,
  confirmLocalUpdateIpcChannel,
  discardSelectedLocalUpdateIpcChannel,
  getLocalUpdateStatusIpcChannel,
  selectLocalUpdateIpcChannel,
  type LocalUpdateCancellationResult,
  type LocalUpdateConfirmationResult,
  type LocalUpdateDiscardResult,
  type LocalUpdateRecoveryPointState,
  type LocalUpdateSelectionResult,
  type LocalUpdateStatus,
} from './localUpdateSelectionTypes.js';
import {
  noOpUpdateOperationalObserver,
  type UpdateOperationalObserver,
} from './updateOperationalObserver.js';
import type { UpdateJournal } from './updateJournal.js';
import type { UpdateJournalStore } from './updateJournalStore.js';

const forbiddenErrorCode = 'LOCAL_UPDATE_OPERATION_FORBIDDEN';
const failedErrorCode = 'LOCAL_UPDATE_OPERATION_FAILED';

interface LocalUpdateSelectionCapabilityOptions {
  cache: Pick<
    LocalUpdatePackageCache,
    'discardCandidate' | 'getPackageStatus' | 'stageSelectedPackage'
  >;
  confirmUpdate(status: Readonly<LocalUpdateStatus>): Promise<boolean>;
  handoffCoordinator: Pick<
    LocalUpdateHandoffCoordinator,
    'handoffPreparedUpdate' | 'prepareConfirmedUpdate'
  >;
  ipcMain: Pick<IpcMain, 'handle' | 'removeHandler'>;
  journalStore: Pick<UpdateJournalStore, 'read'>;
  mainWindow: BrowserWindow;
  observer?: UpdateOperationalObserver;
  operationIdFactory?(): string;
  releaseInfo: Readonly<DesktopReleaseInfo>;
  selectManifestPath(): Promise<string | null>;
  showSafeError(): void;
}

export interface LocalUpdateSelectionCapability {
  dispose(): void;
}

export function createLocalUpdateSelectionCapability(
  options: LocalUpdateSelectionCapabilityOptions,
): LocalUpdateSelectionCapability {
  let operationActive = false;

  registerHandler(getLocalUpdateStatusIpcChannel, async () =>
    readSafeStatus(options),
  );
  registerHandler(selectLocalUpdateIpcChannel, async () => {
    const current = await options.cache.getPackageStatus('current');
    const role = current === undefined ? 'current' : 'candidate';
    const manifestPath = await options.selectManifestPath();
    if (manifestPath === null) {
      return Object.freeze({ status: 'cancelled' });
    }
    const summary = await runObservedStages(
      options,
      role === 'current'
        ? [
            'packageInspection',
            'packageStaging',
            'currentPackageRegistration',
          ]
        : ['packageInspection', 'packageStaging'],
      () => options.cache.stageSelectedPackage({ manifestPath, role }),
    );
    return Object.freeze({
      package: toSafePackageSummary(summary),
      status: role === 'current' ? 'currentRegistered' : 'candidateReady',
    });
  });
  registerHandler(
    discardSelectedLocalUpdateIpcChannel,
    async (): Promise<LocalUpdateDiscardResult> => {
      const status = await readSafeStatus(options);
      assertCandidateCanBeChanged(status);
      await runObservedStages(options, ['candidateDiscard'], () =>
        options.cache.discardCandidate(),
      );
      return Object.freeze({ status: await readSafeStatus(options) });
    },
  );
  registerHandler(
    confirmLocalUpdateIpcChannel,
    async (): Promise<LocalUpdateConfirmationResult> => {
      const status = await readSafeStatus(options);
      assertCandidateCanBeChanged(status);
      if (
        status.currentRollbackPackage !== 'ready' ||
        status.candidate === null
      ) {
        throw new Error(failedErrorCode);
      }
      const confirmed = await runObservedStages(
        options,
        ['confirmation'],
        () => options.confirmUpdate(status),
      );
      if (!confirmed) {
        return Object.freeze({ status: 'cancelled' });
      }
      await options.handoffCoordinator.prepareConfirmedUpdate();
      await options.handoffCoordinator.handoffPreparedUpdate();
      return Object.freeze({ status: 'handoffStarted' });
    },
  );
  registerHandler(
    cancelLocalUpdateIpcChannel,
    async (): Promise<LocalUpdateCancellationResult> =>
      Object.freeze({ status: 'cancelled' }),
  );

  function registerHandler(
    channel: string,
    operation: () => Promise<unknown>,
  ): void {
    options.ipcMain.removeHandler(channel);
    options.ipcMain.handle(
      channel,
      async (event, ...args: unknown[]): Promise<unknown> => {
        if (
          !isTrustedMainWindowRequest(event, options.mainWindow) ||
          args.length !== 0 ||
          operationActive
        ) {
          throw new Error(forbiddenErrorCode);
        }

        operationActive = true;
        try {
          return await operation();
        } catch (error) {
          if (
            error instanceof Error &&
            (error.message === forbiddenErrorCode ||
              error.message === failedErrorCode)
          ) {
            throw error;
          }
          try {
            options.showSafeError();
          } catch {
            // The fixed capability error remains authoritative.
          }
          throw new Error(failedErrorCode);
        } finally {
          operationActive = false;
        }
      },
    );
  }

  return {
    dispose() {
      for (const channel of localUpdateIpcChannels) {
        options.ipcMain.removeHandler(channel);
      }
    },
  };
}

async function runObservedStages<T>(
  options: Pick<
    LocalUpdateSelectionCapabilityOptions,
    'observer' | 'operationIdFactory'
  >,
  stages: readonly (
    | 'candidateDiscard'
    | 'confirmation'
    | 'currentPackageRegistration'
    | 'packageInspection'
    | 'packageStaging'
  )[],
  operation: () => Promise<T>,
): Promise<T> {
  const correlationId = (options.operationIdFactory ?? randomUUID)();
  const startedAt = Date.now();
  for (const stage of stages) {
    notifyObserver(options.observer, (observer) =>
      observer.operationStarted({ correlationId, stage }),
    );
  }
  try {
    const result = await operation();
    const durationMs = Math.max(0, Date.now() - startedAt);
    for (const stage of stages) {
      notifyObserver(options.observer, (observer) =>
        observer.operationCompleted({ correlationId, durationMs, stage }),
      );
    }
    return result;
  } catch (error) {
    const durationMs = Math.max(0, Date.now() - startedAt);
    for (const stage of stages) {
      notifyObserver(options.observer, (observer) =>
        observer.operationFailed({
          correlationId,
          durationMs,
          errorCode: 'LOCAL_UPDATE_OPERATION_FAILED',
          retryable: false,
          sideEffectState: 'unknown',
          stage,
        }),
      );
    }
    throw error;
  }
}

function notifyObserver(
  observer: UpdateOperationalObserver | undefined,
  notification: (observer: UpdateOperationalObserver) => void,
): void {
  try {
    notification(observer ?? noOpUpdateOperationalObserver);
  } catch {
    // Diagnostics never controls the update operation.
  }
}

const localUpdateIpcChannels = Object.freeze([
  getLocalUpdateStatusIpcChannel,
  selectLocalUpdateIpcChannel,
  discardSelectedLocalUpdateIpcChannel,
  confirmLocalUpdateIpcChannel,
  cancelLocalUpdateIpcChannel,
]);

async function readSafeStatus(
  options: Pick<
    LocalUpdateSelectionCapabilityOptions,
    'cache' | 'journalStore' | 'releaseInfo'
  >,
): Promise<Readonly<LocalUpdateStatus>> {
  const currentPackage = await options.cache.getPackageStatus('current');
  const candidate = await options.cache.getPackageStatus('candidate');
  const journal = await options.journalStore.read();
  return Object.freeze({
    architecture: options.releaseInfo.architecture,
    candidate: candidate === undefined
      ? null
      : Object.freeze({
          appVersion: candidate.appVersion,
          buildRevision: candidate.buildRevision,
          msiProductVersion: candidate.msiProductVersion,
          packageFingerprint: candidate.packageFingerprint,
          releaseChannel: candidate.releaseChannel,
          role: 'candidate' as const,
          signingStatus: candidate.signingStatus,
        }),
    current: Object.freeze({
      appVersion: options.releaseInfo.appVersion,
      buildRevision: options.releaseInfo.buildRevision,
      msiProductVersion: options.releaseInfo.msiProductVersion,
      releaseChannel: options.releaseInfo.releaseChannel,
    }),
    currentRollbackPackage: currentPackage === undefined ? 'missing' : 'ready',
    phase: journal?.state ?? 'idle',
    recoveryPointState: toRecoveryPointState(journal),
    signingStatus: 'unsigned-prototype',
  });
}

function assertCandidateCanBeChanged(status: Readonly<LocalUpdateStatus>): void {
  if (
    status.phase !== 'idle' &&
    status.phase !== 'accepted' &&
    status.phase !== 'failed' &&
    status.phase !== 'installerNotApplied' &&
    status.phase !== 'rolledBack'
  ) {
    throw new Error(failedErrorCode);
  }
}

function toRecoveryPointState(
  journal: Readonly<UpdateJournal> | undefined,
): LocalUpdateRecoveryPointState {
  if (journal === undefined) {
    return 'notStarted';
  }
  if (
    journal.state === 'failedSafe' ||
    journal.state === 'recoveryRequired' ||
    journal.state === 'rollbackPackageRequired'
  ) {
    return 'recoveryRequired';
  }
  if (journal.state === 'prepared') {
    return 'pending';
  }
  return journal.recoveryPointReference === undefined ? 'notStarted' : 'ready';
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
