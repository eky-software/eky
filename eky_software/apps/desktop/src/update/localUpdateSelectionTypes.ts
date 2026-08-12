import type { LocalUpdatePackageSummary } from './localUpdatePackageCache.js';
import type { UpdateJournalState } from './updateJournal.js';

export const getLocalUpdateStatusIpcChannel = 'eky:update:get-status';
export const selectLocalUpdateIpcChannel = 'eky:update:select-local';
export const discardSelectedLocalUpdateIpcChannel =
  'eky:update:discard-selected';
export const confirmLocalUpdateIpcChannel = 'eky:update:confirm-local';
export const cancelLocalUpdateIpcChannel = 'eky:update:cancel-local';

export type LocalUpdatePhase = 'idle' | UpdateJournalState;
export type LocalUpdateRecoveryPointState =
  | 'notStarted'
  | 'pending'
  | 'ready'
  | 'recoveryRequired';

export interface LocalUpdateStatus {
  architecture: 'x64';
  candidate: Readonly<{
    appVersion: string;
    buildRevision: string;
    msiProductVersion: string;
    packageFingerprint: string;
    releaseChannel: 'pilot';
    role: 'candidate';
    signingStatus: 'unsigned-prototype';
  }> | null;
  current: Readonly<{
    appVersion: string;
    buildRevision: string;
    msiProductVersion: string;
    releaseChannel: 'pilot';
  }>;
  currentRollbackPackage: 'missing' | 'ready';
  phase: LocalUpdatePhase;
  recoveryPointState: LocalUpdateRecoveryPointState;
  signingStatus: 'unsigned-prototype';
}

export type LocalUpdateSelectionResult =
  | Readonly<{ status: 'cancelled' }>
  | Readonly<{
      package: Readonly<LocalUpdatePackageSummary>;
      status: 'candidateReady' | 'currentRegistered';
    }>;

export type LocalUpdateDiscardResult = Readonly<{
  status: LocalUpdateStatus;
}>;

export type LocalUpdateConfirmationResult =
  | Readonly<{ status: 'cancelled' }>
  | Readonly<{ status: 'handoffStarted' }>;

export type LocalUpdateCancellationResult = Readonly<{
  status: 'cancelled';
}>;
