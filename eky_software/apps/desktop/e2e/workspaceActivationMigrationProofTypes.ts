import type {
  DesktopBackendHandle,
  StartDesktopBackendOptions,
} from '../src/runtime/backendProcess.js';

export interface WorkspaceActivationMigrationProofInput {
  readonly applicationPath: string;
  readonly appVersion: string;
  readonly resourcesPath: string;
  readonly runtimeSessionSecret: string;
  readonly startBackend: (
    options: StartDesktopBackendOptions,
  ) => Promise<DesktopBackendHandle>;
  readonly userDataRoot: string;
}

export interface WorkspaceActivationMigrationProofResult {
  readonly activationJournalsCleared: boolean;
  readonly artifactRootsPreserved: boolean;
  readonly backendStartCount: number;
  readonly backendStoppedAfterProof: boolean;
  readonly businessDataPreserved: boolean;
  readonly candidateProcessesReleased: boolean;
  readonly compatibleTargetMigratedOnlyOnActivation: boolean;
  readonly currentTargetPreserved: boolean;
  readonly faultTargetPreserved: boolean;
  readonly invalidTargetQuarantined: boolean;
  readonly invalidTargetRejectedBeforeBackend: boolean;
  readonly migrationRecoveryPointCreated: boolean;
  readonly registryRecoveredAfterFault: boolean;
  readonly relaunchCount: number;
  readonly secondTargetStartupIdempotent: boolean;
  readonly switchJournalsCleared: boolean;
  readonly targetAcceptedAfterValidation: boolean;
  readonly targetLifecycleWithheldUntilReady: boolean;
}
