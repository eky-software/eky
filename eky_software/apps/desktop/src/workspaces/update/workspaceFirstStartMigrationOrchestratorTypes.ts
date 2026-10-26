import type { WorkspaceId } from '../registry/workspaceRegistryTypes.js';
import type { WorkspaceFirstStartBuildIdentity } from './workspaceFirstStartMigrationPlanTypes.js';

export type WorkspaceFirstStartRecoveryOutcome =
  | 'acceptedTarget'
  | 'noJournal'
  | 'preparedCancelled'
  | 'recoveredSource'
  | 'resumable';

export type WorkspaceFirstStartPreparationOutcome =
  | 'notRequired'
  | 'rollbackOnly'
  | 'prepared'
  | 'resumed';

export type WorkspaceFirstStartPreparationContext = Readonly<{
  activeWorkspaceId: WorkspaceId;
  workspaceState: 'legacyAdoptionPendingAcceptance' | 'publishedRegistry';
  rollbackOnly?: Readonly<{
    sourceBuild: Readonly<WorkspaceFirstStartBuildIdentity>;
    assertCurrent(): Promise<void>;
  }>;
}>;

export interface WorkspaceFirstStartMigrationOrchestration {
  recoverBeforeWorkspaceResolution(): Promise<WorkspaceFirstStartRecoveryOutcome>;
  prepareBeforeBackend(
    context: Readonly<WorkspaceFirstStartPreparationContext>,
  ): Promise<WorkspaceFirstStartPreparationOutcome>;
  transitionRegistryAfterActiveWorkspaceAcceptance(): Promise<void>;
  completeAfterTargetAcceptance(): Promise<void>;
  assertDeferredBusinessReady(phase: 'beforeMigrations' | 'beforeAcceptance'): Promise<void>;
  cancelBeforeSelectorReturn(authority: WorkspaceFirstStartSelectorReturnAuthority): Promise<void>;
}

export interface WorkspaceFirstStartSelectorReturnAuthority {
  assertCurrent(): void;
  assertTerminal(): Promise<void>;
}
