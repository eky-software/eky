interface SmokePreparationContext {
  readonly smokeToken: string;
  readonly smokeRootDirectory: string;
}

interface SmokePreparation {
    prepare(context: SmokePreparationContext): Promise<void>;
    afterRestoreExit(context: SmokePreparationContext): Promise<void>;
    verifySourcePreserved(): Promise<void>;
}

export function runPackagedSmoke(options?: {
  releaseCandidateSmoke?: boolean;
  seriesManifestSha256?: string;
  legacyPreparation?: SmokePreparation;
  workspaceRecoveryPreparation?: SmokePreparation;
  workspaceDeletionPreparation?: {
    prepareAfterRestoredExit(context: SmokePreparationContext): Promise<void>;
    verifyAfterRecoveryExit(context: SmokePreparationContext): Promise<void>;
    verifyAfterRestartExit(context: SmokePreparationContext): Promise<void>;
  };
  workspaceDeletionExecution?: Readonly<{
    smokeToken: string;
    runPhase(command: Readonly<{
      phase: 'initial' | 'restoredProfile' | 'selectorRecovery' | 'selectorRestart';
      environment: Readonly<NodeJS.ProcessEnv>;
      startupException: boolean;
    }>): Promise<import('./packagedSmokeJob.mjs').PackagedSmokePhaseOutput>;
  }>;
}): Promise<void>;
