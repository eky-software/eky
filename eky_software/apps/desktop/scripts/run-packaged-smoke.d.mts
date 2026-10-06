interface SmokePreparationContext {
  smokeToken: string;
  smokeRootDirectory: string;
}

export function runPackagedSmoke(options?: {
  releaseCandidateSmoke?: boolean;
  legacyPreparation?: {
    prepare(context: SmokePreparationContext): Promise<void>;
    afterRestoreExit(context: SmokePreparationContext): Promise<void>;
    verifySourcePreserved(): Promise<void>;
  };
}): Promise<void>;
