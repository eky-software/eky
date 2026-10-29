import type { ProfileRestoreActivationJournalStore } from '../../profileBackup/restore/profileRestoreActivationJournalStore.js';
import type { ProfileRestoreActivationTransaction } from '../../profileBackup/restore/profileRestoreActivationTransaction.js';
import type { WorkspaceId } from '../registry/workspaceRegistryTypes.js';
import type { WorkspaceBackupReplacementOperationId } from './workspaceBackupReplacementOperationId.js';
import type { WorkspaceBackupReplacementPaths } from './workspaceBackupReplacementPaths.js';

export interface WorkspaceReplacementOperationGuardPort {
  assertNoUnresolvedOperations(): Promise<void>;
}

export interface WorkspacePreRestoreRecoveryPointPort {
  createPreRestore(input: {
    readonly operationId: WorkspaceBackupReplacementOperationId;
    readonly workspaceId: WorkspaceId;
  }): Promise<void>;
}

export interface WorkspaceReplacementRuntimeHandoffPort {
  requestRelaunch(): void;
}

export interface WorkspaceReplacementActivationAuthority {
  readonly journalStore: Pick<
    ProfileRestoreActivationJournalStore,
    'read' | 'peek'
  >;
  readonly transaction: Pick<
    ProfileRestoreActivationTransaction,
    | 'accept'
    | 'commitAcceptance'
    | 'clearAccepted'
    | 'advanceToValidation'
    | 'assertForwardRecoveryState'
    | 'readForwardRecoverySources'
    | 'clearRolledBack'
    | 'prepare'
    | 'rollback'
  >;
}

export interface WorkspaceReplacementActivationAuthorityFactory {
  create(
    paths: Readonly<WorkspaceBackupReplacementPaths>,
  ): Readonly<WorkspaceReplacementActivationAuthority>;
}

export interface WorkspaceBackupReplacementRootStore {
  prepareCandidate(
    paths: Readonly<WorkspaceBackupReplacementPaths>,
    authority?: Readonly<WorkspaceReplacementMutationAuthority>,
  ): Promise<void>;
  removeImportStaging(
    paths: Readonly<WorkspaceBackupReplacementPaths>,
    authority?: Readonly<WorkspaceReplacementMutationAuthority>,
  ): Promise<void>;
  inspectCandidate(
    paths: Readonly<WorkspaceBackupReplacementPaths>,
  ): Promise<void>;
  discardBeforeActivation(
    paths: Readonly<WorkspaceBackupReplacementPaths>,
    authority?: Readonly<WorkspaceReplacementMutationAuthority>,
  ): Promise<void>;
}

export interface WorkspaceReplacementMutationAuthority {
  assertCurrent(): Promise<void>;
  assertMutationCurrent(): void;
}
