import type { WorkspaceId } from '../registry/workspaceRegistryTypes.js';
import type { WorkspaceMaintenanceState } from '../maintenance/workspaceMaintenanceLease.js';
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

// A safe projection, not proof of runtime absence or deletion authority.
export type WorkspaceRecoveryManagementStatusV2 = Readonly<{
  readonly formatVersion: 2;
  readonly mode: 'recoveryManagement';
  readonly runtimeState: 'absent';
}> & (
  | Readonly<{
      readonly maintenanceState: 'idle';
      readonly operationState: 'idle';
      readonly persistedActiveWorkspaceId: WorkspaceId | null;
      readonly target: Readonly<{ workspaceId: WorkspaceId; workspaceLabel: string }>;
    }>
  | Readonly<{
      readonly maintenanceState: WorkspaceMaintenanceState;
      readonly operationState: 'busy' | 'recoveryRequired';
    }>
);

// Main-only status phase; no mutation, lease or restart authority.
export interface WorkspaceManagementStatusReadContext {
  readonly operationState: 'idle' | 'busy';
  assertCurrent(): void;
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
