export type WorkspaceStartupRecoveryProofStage =
  | 'buildAdmission'
  | 'historicalFixture'
  | 'historicalRecovery'
  | 'historicalReadoption'
  | 'result';

export interface WorkspaceStartupRecoveryProofInput {
  readonly appVersion: string;
  readonly resourcesPath: string;
  readonly userDataRoot: string;
}

export interface WorkspaceStartupRecoveryProofResult {
  readonly admissionRejectedBeforeWorkspaceResolution: boolean;
  readonly admissionSideEffectsAbsent: boolean;
  readonly historicalCopyDiscarded: boolean;
  readonly historicalJournalCleared: boolean;
  readonly legacyArtifactsPreserved: boolean;
  readonly readoptionArtifactsMatch: boolean;
  readonly registryPublishedOnlyAfterAcceptance: boolean;
  readonly relaunchCount: number;
}
