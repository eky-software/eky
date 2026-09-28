import type {
  E2eProcessStartupObservation,
} from './e2eProcessStartupObservation.js';
import { waitForObservedProcessHealth } from './waitForObservedProcessHealth.js';
import { encodeServiceProgress, isBackendStartupProgressKind } from './serviceProgressDiagnostic.mjs';

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
  const writeLine = input.writeLine ?? ((line: string) => console.log('\n' + line));
  const startedAt = now();
  let phaseStartedAt = startedAt;

  return (progress) => {
    if (!isBackendStartupProgressKind(progress)) {
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
      writeLine(encodeServiceProgress(safeProgress));
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
  const outcome = await waitForObservedProcessHealth(input);
  const kind = outcome.kind === 'healthFailed' && outcome.error instanceof Error &&
    outcome.error.message === 'E2E_BACKEND_WORKLOAD_OBSERVATION_LOST'
    ? 'observationLost' : outcome.kind;
  if (kind === 'healthy') {
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
  if (kind === 'observationLost') {
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
