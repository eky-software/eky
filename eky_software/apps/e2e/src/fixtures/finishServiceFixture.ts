type CleanupStatus = 'notStarted' | 'completed' | 'failed';

export interface ServiceFixtureCleanup {
  api: CleanupStatus;
  web: CleanupStatus;
  backend: CleanupStatus;
  webPort: CleanupStatus;
  backendPort: CleanupStatus;
  artifacts: CleanupStatus;
  priorCleanup: 'verified' | 'unverified';
  runRoot: 'retained' | 'removed' | 'removalFailed';
}

// The existing service stop functions retain process ownership. This boundary
// only settles their results and decides whether the fixture root may be removed.
export async function finishServiceFixture(input: {
  failure: { error: unknown } | undefined;
  testAlreadyFailed: boolean;
  priorCleanupUnverified: boolean;
  disposeApi(): Promise<void>;
  stopWeb?: () => Promise<void>;
  stopBackend?: () => Promise<void>;
  releaseWebPort?: () => Promise<void>;
  releaseBackendPort?: () => Promise<void>;
  collectArtifacts(): Promise<void>;
  removeRoot(): Promise<void>;
  report(result: Readonly<ServiceFixtureCleanup>): Promise<void>;
}): Promise<void> {
  const result: ServiceFixtureCleanup = {
    api: 'notStarted', web: 'notStarted', backend: 'notStarted',
    webPort: 'notStarted', backendPort: 'notStarted', artifacts: 'notStarted',
    priorCleanup: input.priorCleanupUnverified ? 'unverified' : 'verified',
    runRoot: 'retained',
  };
  const steps = [
    ['api', input.disposeApi],
    ['web', input.stopWeb],
    ['backend', input.stopBackend],
    ['webPort', input.releaseWebPort],
    ['backendPort', input.releaseBackendPort],
    ['artifacts', input.collectArtifacts],
  ] as const;
  for (const [key, action] of steps) {
    if (action === undefined) continue;
    try {
      await action();
      result[key] = 'completed';
    } catch {
      result[key] = 'failed';
    }
  }
  if (!input.priorCleanupUnverified && steps.every(([key]) => result[key] !== 'failed')) {
    try {
      await input.removeRoot();
      result.runRoot = 'removed';
    } catch {
      result.runRoot = 'removalFailed';
    }
  }
  let reportFailed = false;
  try {
    await input.report(Object.freeze(result));
  } catch {
    reportFailed = true;
  }
  if (input.failure !== undefined) throw input.failure.error;
  // Playwright has already recorded a body failure before teardown begins.
  if (input.testAlreadyFailed) return;
  if (result.runRoot !== 'removed') throw new Error('E2E_SERVICE_FIXTURE_CLEANUP_FAILED');
  if (reportFailed) throw new Error('E2E_SERVICE_FIXTURE_EVIDENCE_FAILED');
}
