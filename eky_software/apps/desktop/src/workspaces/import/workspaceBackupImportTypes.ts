import type {
  WorkspaceId,
  WorkspaceLineageIdentityV1,
} from '../registry/workspaceRegistryTypes.js';

declare const workspaceBackupImportOperationIdBrand: unique symbol;

export type WorkspaceBackupImportOperationId = string & {
  readonly [workspaceBackupImportOperationIdBrand]:
    'WorkspaceBackupImportOperationId';
};

export type WorkspaceBackupImportJournalState =
  | 'prepared'
  | 'candidateRootCreated'
  | 'backupStaged'
  | 'candidateMigrated'
  | 'candidateValidated'
  | 'rootPublished'
  | 'registryPublished';

interface WorkspaceBackupImportJournalFields {
  readonly operationId: WorkspaceBackupImportOperationId;
  readonly workspaceId: WorkspaceId;
  readonly workspaceLabel: string;
  readonly previousActiveWorkspaceId: WorkspaceId | null;
  readonly state: WorkspaceBackupImportJournalState;
  readonly createdAt: string;
  readonly lineageIdentity: Readonly<WorkspaceLineageIdentityV1> | null;
}

export interface WorkspaceBackupImportJournalV1 extends WorkspaceBackupImportJournalFields {
  readonly formatVersion: 1;
}

export interface WorkspaceBackupImportJournalV2 extends WorkspaceBackupImportJournalFields {
  readonly formatVersion: 2;
}

export type WorkspaceBackupImportJournal =
  | WorkspaceBackupImportJournalV1
  | WorkspaceBackupImportJournalV2;

export interface WorkspaceBackupImportJournalStore {
  read(): Promise<Readonly<WorkspaceBackupImportJournal> | undefined>;
  write(value: unknown): Promise<void>;
  discardBeforePublication(
    operationId: WorkspaceBackupImportOperationId,
  ): Promise<void>;
  remove(operationId: WorkspaceBackupImportOperationId): Promise<void>;
}
