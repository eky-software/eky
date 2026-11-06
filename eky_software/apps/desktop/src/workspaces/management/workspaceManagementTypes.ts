import type { WorkspaceId } from '../registry/workspaceRegistryTypes.js';
import type { WorkspaceCandidateFailureCause } from '../../runtime/workspaceCandidateMessages.js';
import type { WorkspaceDeletionFailureStage } from '../../observability/workspaceManagementFailureContext.js';

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
  readonly duplicateWorkspaceLabelIds?: readonly WorkspaceId[];
}

export type WorkspaceManagementOperationKind =
  | 'status'
  | 'create'
  | 'import'
  | 'replace'
  | 'switch'
  | 'rename'
  | 'delete'
  | 'deleteResume';

export interface WorkspaceDeletionPreparationLifetime {
  assertCurrent(): void;
  closeAdmissionForOwnStop(): void;
}

// Main-only preparation, never a renderer's completed deletion result.
export type WorkspaceDeletionPreparationOutcome =
  | 'prepared'
  | 'cancelled'
  | 'returnRequested';

export interface WorkspaceManagementOperationEvent {
  readonly correlationId: string;
  readonly durationMs: number;
  readonly errorCode?: string;
  readonly inspectionCauseCode?: WorkspaceCandidateFailureCause;
  readonly cleanupCauseCode?: WorkspaceCandidateFailureCause;
  readonly operationKind: WorkspaceManagementOperationKind;
  readonly outcome: 'succeeded' | 'failed';
  readonly retryable?: boolean;
  readonly sideEffectState?: 'none' | 'completed' | 'unknown';
  readonly stage: 'operation' | 'lineageCheck' | 'status' | WorkspaceDeletionFailureStage;
}

export interface WorkspaceManagementObserver {
  operationStarted?(operation: Readonly<WorkspaceManagementOperationIdentity>): void;
  operationSettled?(operation: Readonly<WorkspaceManagementOperationIdentity>): void;
  record(event: Readonly<WorkspaceManagementOperationEvent>): void;
}

export interface WorkspaceManagementOperationIdentity {
  readonly correlationId: string;
  readonly operationKind: Exclude<WorkspaceManagementOperationKind, 'status'>;
}

// Main-only observation freshness, never workspace mutation or restart authority.
export interface WorkspaceManagementOperationContext {
  readonly operation: Readonly<WorkspaceManagementOperationIdentity> | null;
  assertCurrent(): void;
}
