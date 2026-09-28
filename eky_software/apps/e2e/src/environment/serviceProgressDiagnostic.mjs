const backendPhases = new Set(['processSpawnRequested', 'processSpawned', 'healthWaitStarted',
  'childExitedBeforeHealth', 'workloadObservationLost', 'healthReady', 'healthTimedOut',
  'cleanupStarted', 'processTreeStopped', 'portReleaseStarted', 'portReleased', 'cleanupCompleted']);
const statuses = new Set(['started', 'completed', 'failed']);
const backendErrors = new Set(['E2E_BACKEND_PROCESS_SPAWN_FAILED',
  'E2E_BACKEND_CHILD_EXITED_BEFORE_HEALTH', 'E2E_BACKEND_WORKLOAD_OBSERVATION_LOST',
  'E2E_BACKEND_HEALTH_TIMEOUT', 'E2E_BACKEND_LOOPBACK_ADDRESS_IN_USE',
  'E2E_BACKEND_PROCESS_TREE_CLEANUP_FAILED', 'E2E_BACKEND_PORT_RELEASE_FAILED']);
const chromiumPhases = new Set(['ownerPreparation', 'ownerLaunch', 'browserReady', 'browserConnect', 'workerTeardown']);
const ownerFailures = new Set([null, 'preparationFailed', 'ownerSpawnFailed',
  'startupDeadlineExceeded', 'observationLost', 'workloadExited', 'launchFailed']);
const milliseconds = value => Number.isSafeInteger(value) && value >= 0;
const keysAre = (value, keys) => Object.keys(value).sort().join(',') === keys;

export function isBackendStartupProgressKind(value) {
  return Boolean(value && backendPhases.has(value.phase) && statuses.has(value.status) &&
    (value.errorCode === undefined || (backendErrors.has(value.errorCode) && value.status === 'failed')));
}

// These are test-runtime observations, never a verdict on test success.
export function encodeServiceProgress(value) {
  if (value?.scenario === 'e2eBackendStartup' && isBackendStartupProgressKind(value) &&
    milliseconds(value.durationMs) && milliseconds(value.elapsedMs) && keysAre(value,
      value.errorCode === undefined ? 'durationMs,elapsedMs,phase,scenario,status'
        : 'durationMs,elapsedMs,errorCode,phase,scenario,status')) {
    return JSON.stringify({ durationMs: value.durationMs, elapsedMs: value.elapsedMs,
      ...(value.errorCode === undefined ? {} : { errorCode: value.errorCode }),
      phase: value.phase, scenario: value.scenario, status: value.status });
  }
  if (value?.operation === 'chromiumWorker' && value.schemaVersion === 1 &&
    keysAre(value, 'cleanup,operation,ownerFailure,phase,schemaVersion,workerRoot') &&
    chromiumPhases.has(value.phase) && ownerFailures.has(value.ownerFailure) &&
    ['verified', 'unverified'].includes(value.cleanup) &&
    ['removed', 'notCreated', 'retained'].includes(value.workerRoot)) {
    return JSON.stringify({ schemaVersion: 1, operation: value.operation, phase: value.phase,
      ownerFailure: value.ownerFailure, cleanup: value.cleanup, workerRoot: value.workerRoot });
  }
  throw new Error('E2E_SERVICE_PROGRESS_INVALID');
}

export function writeServiceProgress(value) {
  process.stdout.write('\n' + encodeServiceProgress(value) + '\n');
}
