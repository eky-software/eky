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

export interface WorkspaceFirstStartMigrationOrchestration {
  recoverBeforeWorkspaceResolution(): Promise<WorkspaceFirstStartRecoveryOutcome>;
  prepareBeforeBackend(): Promise<WorkspaceFirstStartPreparationOutcome>;
  transitionRegistryAfterActiveWorkspaceAcceptance(): Promise<void>;
  completeAfterTargetAcceptance(): Promise<void>;
}
