import type {
  E2eProcessStartupObservation,
  E2eProcessStartupTerminal,
} from './e2eProcessStartupObservation.js';

const startupPhases = new Set([
  'processSpawnRequested',
  'processSpawned',
  'healthWaitStarted',
  'childExitedBeforeHealth',
  'workloadObservationLost',
  'healthReady',
  'healthTimedOut',
  'cleanupStarted',
  'processTreeStopped',
  'portReleaseStarted',
  'portReleased',
  'cleanupCompleted',
] as const);
const startupStatuses = new Set(['started', 'completed', 'failed'] as const);
const startupErrorCodes = new Set([
  'E2E_BACKEND_PROCESS_SPAWN_FAILED',
  'E2E_BACKEND_CHILD_EXITED_BEFORE_HEALTH',
  'E2E_BACKEND_WORKLOAD_OBSERVATION_LOST',
  'E2E_BACKEND_HEALTH_TIMEOUT',
  'E2E_BACKEND_LOOPBACK_ADDRESS_IN_USE',
  'E2E_BACKEND_PROCESS_TREE_CLEANUP_FAILED',
  'E2E_BACKEND_PORT_RELEASE_FAILED',
] as const);

export type E2eBackendStartupPhase =
  | 'processSpawnRequested'
  | 'processSpawned'
  | 'healthWaitStarted'
  | 'childExitedBeforeHealth'
  | 'workloadObservationLost'
  | 'healthReady'
  | 'healthTimedOut'
  | 'cleanupStarted'
  | 'processTreeStopped'
  | 'portReleaseStarted'
  | 'portReleased'
  | 'cleanupCompleted';
export type E2eBackendStartupStatus = 'started' | 'completed' | 'failed';
export type E2eBackendStartupErrorCode =
  | 'E2E_BACKEND_PROCESS_SPAWN_FAILED'
  | 'E2E_BACKEND_CHILD_EXITED_BEFORE_HEALTH'
  | 'E2E_BACKEND_WORKLOAD_OBSERVATION_LOST'
  | 'E2E_BACKEND_HEALTH_TIMEOUT'
  | 'E2E_BACKEND_LOOPBACK_ADDRESS_IN_USE'
  | 'E2E_BACKEND_PROCESS_TREE_CLEANUP_FAILED'
  | 'E2E_BACKEND_PORT_RELEASE_FAILED';

export interface E2eBackendStartupProgress {
  readonly durationMs: number;
  readonly elapsedMs: number;
  readonly errorCode?: E2eBackendStartupErrorCode;
  readonly phase: E2eBackendStartupPhase;
  readonly scenario: 'e2eBackendStartup';
  readonly status: E2eBackendStartupStatus;
}

export type E2eBackendStartupObserver = (
  progress: E2eBackendStartupProgress,
) => void;

export function createE2eBackendStartupReporter(input: {
  readonly now?: () => number;
  readonly writeLine?: (line: string) => void;
} = {}): E2eBackendStartupObserver {
  const now = input.now ?? Date.now;
  const writeLine = input.writeLine ?? ((line: string) => console.log(line));
  const startedAt = now();
  let phaseStartedAt = startedAt;

  return (progress) => {
    if (
      !startupPhases.has(progress.phase) ||
      !startupStatuses.has(progress.status) ||
      (progress.errorCode !== undefined &&
        (!startupErrorCodes.has(progress.errorCode) ||
          progress.status !== 'failed'))
    ) {
      return;
    }
    const observedAt = now();
    if (progress.status === 'started') {
      phaseStartedAt = observedAt;
    }
    const safeProgress: E2eBackendStartupProgress = Object.freeze({
      durationMs: Math.max(0, observedAt - phaseStartedAt),
      elapsedMs: Math.max(0, observedAt - startedAt),
      ...(progress.errorCode === undefined
        ? {}
        : { errorCode: progress.errorCode }),
      phase: progress.phase,
      scenario: 'e2eBackendStartup',
      status: progress.status,
    });
    try {
      writeLine(JSON.stringify(safeProgress));
    } catch {
      // Test observability must not alter the startup result.
    }
  };
}

export async function waitForManagedBackendHealth(input: {
  readonly startup: E2eProcessStartupObservation;
  readonly observe: E2eBackendStartupObserver;
  readonly waitForHealth: (signal: AbortSignal) => Promise<void>;
}): Promise<void> {
  input.observe(newProgress('healthWaitStarted', 'started'));
  let unsubscribe = () => {};
  const terminal = new Promise<{ readonly kind: E2eProcessStartupTerminal }>((resolve) => {
    const readTerminal = () => {
      const state = input.startup.readState();
      if (state.terminal !== undefined) resolve({ kind: state.terminal });
    };
    unsubscribe = input.startup.subscribe(readTerminal);
    readTerminal();
  });
  const healthAbort = new AbortController();
  const health = Promise.resolve()
    .then(() => input.waitForHealth(healthAbort.signal))
    .then(
      () => ({ kind: 'healthy' as const }),
      (error: unknown) => ({ kind: error instanceof Error &&
        error.message === 'E2E_BACKEND_WORKLOAD_OBSERVATION_LOST'
        ? 'observationLost' as const : 'healthFailed' as const }),
    );

  let outcome;
  try {
    outcome = await Promise.race([health, terminal]);
  } finally {
    healthAbort.abort();
    await health;
    unsubscribe();
  }
  const state = input.startup.readState();
  // A queued health response cannot overrule an already observed workload failure.
  const kind = state.terminal ?? outcome.kind;
  if (kind === 'healthy' && state.spawnObserved) {
    input.observe(newProgress('healthReady', 'completed'));
    return;
  }
  if (kind === 'spawnFailed') {
    input.observe(
      newProgress(
        'processSpawned',
        'failed',
        'E2E_BACKEND_PROCESS_SPAWN_FAILED',
      ),
    );
    throw new Error('E2E_BACKEND_PROCESS_SPAWN_FAILED');
  }
  if (kind === 'exited') {
    input.observe(
      newProgress(
        'childExitedBeforeHealth',
        'failed',
        'E2E_BACKEND_CHILD_EXITED_BEFORE_HEALTH',
      ),
    );
    throw new Error('E2E_BACKEND_CHILD_EXITED_BEFORE_HEALTH');
  }
  if (kind === 'observationLost' || kind === 'healthy') {
    input.observe(newProgress(
      'workloadObservationLost', 'failed', 'E2E_BACKEND_WORKLOAD_OBSERVATION_LOST',
    ));
    throw new Error('E2E_BACKEND_WORKLOAD_OBSERVATION_LOST');
  }
  input.observe(newProgress('healthTimedOut', 'failed', 'E2E_BACKEND_HEALTH_TIMEOUT'));
  throw new Error('E2E_BACKEND_HEALTH_TIMEOUT');
}

export function newProgress(
  phase: E2eBackendStartupPhase,
  status: E2eBackendStartupStatus,
  errorCode?: E2eBackendStartupErrorCode,
): E2eBackendStartupProgress {
  return Object.freeze({
    durationMs: 0,
    elapsedMs: 0,
    ...(errorCode === undefined ? {} : { errorCode }),
    phase,
    scenario: 'e2eBackendStartup',
    status,
  });
}
