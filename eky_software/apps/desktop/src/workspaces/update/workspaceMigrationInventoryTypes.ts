import type { WorkspaceId } from '../registry/workspaceRegistryTypes.js';

export type WorkspaceMigrationInventoryStatus =
  | 'compatiblePending'
  | 'current'
  | 'invalidHistory';

export interface WorkspaceMigrationInventoryEntry {
  readonly appliedMigrationCount: number;
  readonly isActive: boolean;
  readonly pendingMigrationCount: number;
  readonly status: WorkspaceMigrationInventoryStatus;
  readonly workspaceId: WorkspaceId;
}

export interface WorkspaceMigrationInventory {
  readonly activeWorkspaceId: WorkspaceId | null;
  readonly entries: readonly Readonly<WorkspaceMigrationInventoryEntry>[];
}

export interface WorkspaceMigrationInspectionInput {
  readonly databaseFilePath: string;
  readonly expectedProfileId: string;
  readonly operationId: string;
  readonly publishedRoot: string;
  readonly signal?: AbortSignal;
}

export interface WorkspaceMigrationInspectionResult {
  readonly appliedMigrationCount: number;
  readonly pendingMigrationCount: number;
  readonly status: WorkspaceMigrationInventoryStatus;
}

export interface PrivateWorkspaceMigrationInspectionRuntime {
  inspectStoppedMigrationInspection(): Promise<
    Readonly<WorkspaceMigrationInspectionResult>
  >;
  stopAndProveHandlesClosed(): Promise<boolean>;
}

export interface PrivateWorkspaceMigrationInspectionRuntimeFactory {
  startMigrationInspection(
    input: Readonly<WorkspaceMigrationInspectionInput>,
  ): Promise<PrivateWorkspaceMigrationInspectionRuntime>;
}

export interface WorkspaceMigrationInventoryEvent {
  readonly compatiblePendingCount: number;
  readonly currentCount: number;
  readonly durationMs: number;
  readonly inspectedWorkspaceCount: number;
  readonly invalidHistoryCount: number;
  readonly outcome: 'failed' | 'succeeded';
}

export interface WorkspaceMigrationInventoryObserver {
  record(event: Readonly<WorkspaceMigrationInventoryEvent>): void;
}
