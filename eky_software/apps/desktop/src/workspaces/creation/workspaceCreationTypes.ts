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

export interface WorkspaceCreationJournalV1 {
  readonly formatVersion: 1;
  readonly operationId: WorkspaceCreationOperationId;
  readonly workspaceId: WorkspaceId;
  readonly workspaceLabel: string;
  readonly previousActiveWorkspaceId: WorkspaceId | null;
  readonly state: WorkspaceCreationJournalState;
  readonly createdAt: string;
  readonly lineageIdentity: Readonly<WorkspaceLineageIdentityV1> | null;
}

export interface WorkspaceCreationJournalStore {
  read(): Promise<Readonly<WorkspaceCreationJournalV1> | undefined>;
  write(value: unknown): Promise<void>;
  remove(operationId: WorkspaceCreationOperationId): Promise<void>;
}
