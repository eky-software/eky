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

export interface WorkspaceBackupImportJournalV1 {
  readonly formatVersion: 1;
  readonly operationId: WorkspaceBackupImportOperationId;
  readonly workspaceId: WorkspaceId;
  readonly workspaceLabel: string;
  readonly previousActiveWorkspaceId: WorkspaceId | null;
  readonly state: WorkspaceBackupImportJournalState;
  readonly createdAt: string;
  readonly lineageIdentity: Readonly<WorkspaceLineageIdentityV1> | null;
}

export interface WorkspaceBackupImportJournalStore {
  read(): Promise<Readonly<WorkspaceBackupImportJournalV1> | undefined>;
  write(value: unknown): Promise<void>;
  discardBeforePublication(
    operationId: WorkspaceBackupImportOperationId,
  ): Promise<void>;
  remove(operationId: WorkspaceBackupImportOperationId): Promise<void>;
}
