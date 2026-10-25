import type { VersionedAcceptedBuildMetadata } from '../../update/acceptedBuildMetadata.js';
import type { ReadOnlyJournalSlotRecord } from '../persistence/readOnlyJournalSlots.js';
import type { WorkspaceId } from '../registry/workspaceRegistryTypes.js';
import type { WorkspaceFirstStartBuildIdentity } from './workspaceFirstStartMigrationPlanTypes.js';

export type WorkspaceFirstStartMigrationJournalState =
  | 'prepared'
  | 'registryTransitioned';

export interface WorkspaceFirstStartMigrationJournalV1 {
  readonly formatVersion: 1;
  readonly operationId: string;
  readonly state: WorkspaceFirstStartMigrationJournalState;
  readonly sourceBuild: Readonly<WorkspaceFirstStartBuildIdentity>;
  readonly targetBuild: Readonly<WorkspaceFirstStartBuildIdentity>;
  readonly activeWorkspaceId: WorkspaceId;
  readonly passiveRecoveryWorkspaceIds: readonly WorkspaceId[];
  readonly sourceRegistrySha256: string;
  readonly transitionedRegistrySha256: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface WorkspaceFirstStartMigrationJournalPort {
  read(): Promise<Readonly<WorkspaceFirstStartMigrationJournalV1> | undefined>;
  inspect(): Promise<ReadOnlyJournalSlotRecord<WorkspaceFirstStartMigrationJournalV1> | undefined>;
  write(value: unknown): Promise<void>;
  discardPrepared(operationId: string, selection?: WorkspaceFirstStartPreparedCancellation): Promise<void>;
  removeTransitioned(operationId: string): Promise<void>;
}

export interface WorkspaceFirstStartPreparedCancellation {
  readonly selected: ReadOnlyJournalSlotRecord<WorkspaceFirstStartMigrationJournalV1>;
  assertCurrent(): void;
  assertExternalSelection(): Promise<void>;
}

export interface WorkspaceFirstStartAcceptedBuildReader {
  read(): Promise<VersionedAcceptedBuildMetadata | undefined>;
}

export type WorkspaceFirstStartMigrationRecoveryResult = Readonly<
  | { kind: 'noJournal' }
  | { kind: 'resumable'; operationId: string }
  | { kind: 'recoveredSource'; operationId: string }
  | { kind: 'acceptedTarget'; operationId: string }
  | { kind: 'recoveryRequired'; operationId: string }
>;
