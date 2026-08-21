import type { AcceptedBuildMetadata } from '../../update/acceptedBuildMetadata.js';
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
  write(value: unknown): Promise<void>;
  discardPrepared(operationId: string): Promise<void>;
  removeTransitioned(operationId: string): Promise<void>;
}

export interface WorkspaceFirstStartAcceptedBuildReader {
  read(): Promise<Readonly<AcceptedBuildMetadata> | undefined>;
}

export type WorkspaceFirstStartMigrationRecoveryResult = Readonly<
  | { kind: 'noJournal' }
  | { kind: 'resumable'; operationId: string }
  | { kind: 'recoveredSource'; operationId: string }
  | { kind: 'acceptedTarget'; operationId: string }
  | { kind: 'recoveryRequired'; operationId: string }
>;
