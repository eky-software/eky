import type { WorkspaceId } from '../registry/workspaceRegistryTypes.js';

export type WorkspaceFirstStartRecoveryOutcome =
  | 'acceptedTarget'
  | 'noJournal'
  | 'preparedCancelled'
  | 'recoveredSource'
  | 'resumable';

export type WorkspaceFirstStartPreparationOutcome =
  | 'notRequired'
  | 'prepared'
  | 'resumed';

export type WorkspaceFirstStartPreparationContext = Readonly<{
  activeWorkspaceId: WorkspaceId;
  workspaceState: 'legacyAdoptionPendingAcceptance' | 'publishedRegistry';
}>;

export interface WorkspaceFirstStartMigrationOrchestration {
  recoverBeforeWorkspaceResolution(): Promise<WorkspaceFirstStartRecoveryOutcome>;
  prepareBeforeBackend(
    context: Readonly<WorkspaceFirstStartPreparationContext>,
  ): Promise<WorkspaceFirstStartPreparationOutcome>;
  transitionRegistryAfterActiveWorkspaceAcceptance(): Promise<void>;
  completeAfterTargetAcceptance(): Promise<void>;
}
