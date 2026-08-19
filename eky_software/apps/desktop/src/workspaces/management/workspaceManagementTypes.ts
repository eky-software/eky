import type { WorkspaceId } from '../registry/workspaceRegistryTypes.js';

export type WorkspaceManagementAvailability =
  | 'ready'
  | 'recoveryRequired';

export type WorkspaceManagementOperationState =
  | 'idle'
  | 'busy'
  | 'recoveryRequired';

export interface WorkspaceManagementEntryV1 {
  readonly availability: WorkspaceManagementAvailability;
  readonly isActive: boolean;
  readonly workspaceId: WorkspaceId;
  readonly workspaceLabel: string;
}

export interface WorkspaceManagementStatusV1 {
  readonly activeWorkspaceId: WorkspaceId | null;
  readonly formatVersion: 1;
  readonly operationState: WorkspaceManagementOperationState;
  readonly workspaces: readonly Readonly<WorkspaceManagementEntryV1>[];
}

export type WorkspaceManagementOperationKind =
  | 'status'
  | 'create'
  | 'import'
  | 'replace'
  | 'switch'
  | 'rename';

export interface WorkspaceManagementOperationEvent {
  readonly correlationId: string;
  readonly durationMs: number;
  readonly errorCode?: string;
  readonly operationKind: WorkspaceManagementOperationKind;
  readonly outcome: 'succeeded' | 'failed';
  readonly retryable?: boolean;
  readonly sideEffectState?: 'none' | 'completed' | 'unknown';
  readonly stage: 'admission' | 'operation' | 'status';
}

export interface WorkspaceManagementObserver {
  record(event: Readonly<WorkspaceManagementOperationEvent>): void;
}
