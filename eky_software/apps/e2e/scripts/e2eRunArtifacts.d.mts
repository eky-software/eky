export const E2E_RUN_ARTIFACTS_ENV: 'EKY_E2E_RUN_ARTIFACTS';

export interface E2eRunArtifacts {
  readonly runId: string;
  readonly outputDir: string;
  readonly htmlOutputFolder: string;
}

/** Select once at config time; returns relative defaults without filesystem I/O. */
export function getE2eRunArtifacts(): E2eRunArtifacts;
