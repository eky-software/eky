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

export interface WorkspaceReplacementRuntimeReadiness {
  readonly artifactRootHealth: 'ready';
  readonly backendOwnerCount: 1;
  readonly databaseHealth: 'healthy';
  readonly foreignKeyHealth: 'healthy';
  readonly migrationChainIdentity: string;
  readonly profileId: string;
  readonly runtimeSessionState: 'rotated';
  readonly sqliteOwnerCount: 1;
  readonly workspaceId: WorkspaceId;
}

export interface WorkspaceReplacementRuntimeReadinessPort {
  assertReady(input: {
    readonly expectedMigrationChainIdentity?: string;
    readonly expectedProfileId: string;
    readonly workspaceId: WorkspaceId;
  }): Promise<Readonly<WorkspaceReplacementRuntimeReadiness>>;
}

export interface WorkspaceReplacementActivationAuthority {
  readonly journalStore: Pick<
    ProfileRestoreActivationJournalStore,
    'read'
  >;
  readonly transaction: Pick<
    ProfileRestoreActivationTransaction,
    | 'accept'
    | 'advanceToValidation'
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
  ): Promise<void>;
  removeImportStaging(
    paths: Readonly<WorkspaceBackupReplacementPaths>,
  ): Promise<void>;
  inspectCandidate(
    paths: Readonly<WorkspaceBackupReplacementPaths>,
  ): Promise<void>;
  discardBeforeActivation(
    paths: Readonly<WorkspaceBackupReplacementPaths>,
  ): Promise<void>;
}
