import type {
  WorkspaceId,
  WorkspaceLineageIdentityV1,
} from '../registry/workspaceRegistryTypes.js';

declare const workspaceCreationOperationIdBrand: unique symbol;

export type WorkspaceCreationOperationId = string & {
  readonly [workspaceCreationOperationIdBrand]: 'WorkspaceCreationOperationId';
};

export type WorkspaceCreationJournalState =
  | 'prepared'
  | 'candidateRootCreated'
  | 'bootstrapCompleted'
  | 'candidateValidated'
  | 'rootPublished'
  | 'registryPublished';

interface WorkspaceCreationJournalFields {
  readonly operationId: WorkspaceCreationOperationId;
  readonly workspaceId: WorkspaceId;
  readonly workspaceLabel: string;
  readonly previousActiveWorkspaceId: WorkspaceId | null;
  readonly state: WorkspaceCreationJournalState;
  readonly createdAt: string;
  readonly lineageIdentity: Readonly<WorkspaceLineageIdentityV1> | null;
}

export interface WorkspaceCreationJournalV1 extends WorkspaceCreationJournalFields {
  readonly formatVersion: 1;
}

export interface WorkspaceCreationJournalV2 extends WorkspaceCreationJournalFields {
  readonly formatVersion: 2;
}

export type WorkspaceCreationJournal =
  | WorkspaceCreationJournalV1
  | WorkspaceCreationJournalV2;

export interface WorkspaceCreationJournalStore {
  read(): Promise<Readonly<WorkspaceCreationJournal> | undefined>;
  write(value: unknown): Promise<void>;
  discardBeforePublication(
    operationId: WorkspaceCreationOperationId,
  ): Promise<void>;
  remove(operationId: WorkspaceCreationOperationId): Promise<void>;
}
