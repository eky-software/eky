interface SmokePreparationContext {
  smokeToken: string;
  smokeRootDirectory: string;
}

interface SmokePreparation {
    prepare(context: SmokePreparationContext): Promise<void>;
    afterRestoreExit(context: SmokePreparationContext): Promise<void>;
    verifySourcePreserved(): Promise<void>;
}

export function runPackagedSmoke(options?: {
  releaseCandidateSmoke?: boolean;
  legacyPreparation?: SmokePreparation;
  workspaceRecoveryPreparation?: SmokePreparation;
}): Promise<void>;
