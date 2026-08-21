import type {
  DesktopBackendHandle,
  StartDesktopBackendOptions,
} from '../src/runtime/backendProcess.js';

export interface WorkspaceFirstStartMigrationProofInput {
  readonly applicationPath: string;
  readonly appVersion: string;
  readonly resourcesPath: string;
  readonly runtimeSessionSecret: string;
  readonly startBackend: (
    options: StartDesktopBackendOptions,
  ) => Promise<DesktopBackendHandle>;
  readonly userDataRoot: string;
}

export interface WorkspaceFirstStartMigrationProofResult {
  readonly activePointerPreserved: boolean;
  readonly allCurrentCompletedWithoutJournal: boolean;
  readonly allCurrentRegistryPreserved: boolean;
  readonly artifactRootsPreserved: boolean;
  readonly backendStartCount: number;
  readonly backendStoppedAfterProof: boolean;
  readonly candidateProcessesReleased: boolean;
  readonly directSetupRecoveryCleared: boolean;
  readonly exactAcceptedRestartSkippedInventory: boolean;
  readonly invalidPassiveWorkspaceQuarantined: boolean;
  readonly migrationJournalCleared: boolean;
  readonly mixedActiveWorkspaceMigrated: boolean;
  readonly passiveCompatibleWorkspacePreserved: boolean;
  readonly preparedBeforeBackend: boolean;
  readonly relaunchCount: number;
  readonly targetAcceptedAfterRegistryTransition: boolean;
}
