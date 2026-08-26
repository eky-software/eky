import type { ManagedChildProcess } from './startManagedProcess.js';

const startupPhases = new Set([
  'processSpawnRequested',
  'processSpawned',
  'healthWaitStarted',
  'childExitedBeforeHealth',
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
  readonly child: ManagedChildProcess;
  readonly observe: E2eBackendStartupObserver;
  readonly waitForHealth: () => Promise<void>;
}): Promise<void> {
  input.observe(newProgress('healthWaitStarted', 'started'));
  const exit = createChildTerminalSignal(input.child);
  const health = input.waitForHealth().then(
    () => ({ kind: 'healthy' as const }),
    () => ({ kind: 'healthFailed' as const }),
  );

  try {
    const outcome = await Promise.race([health, exit.promise]);
    if (outcome.kind === 'healthy') {
      input.observe(newProgress('healthReady', 'completed'));
      return;
    }
    if (outcome.kind === 'spawnFailed') {
      input.observe(
        newProgress(
          'processSpawned',
          'failed',
          'E2E_BACKEND_PROCESS_SPAWN_FAILED',
        ),
      );
      throw new Error('E2E_BACKEND_PROCESS_SPAWN_FAILED');
    }
    if (outcome.kind === 'exited' || hasExited(input.child)) {
      input.observe(
        newProgress(
          'childExitedBeforeHealth',
          'failed',
          'E2E_BACKEND_CHILD_EXITED_BEFORE_HEALTH',
        ),
      );
      throw new Error('E2E_BACKEND_CHILD_EXITED_BEFORE_HEALTH');
    }
    input.observe(
      newProgress(
        'healthTimedOut',
        'failed',
        'E2E_BACKEND_HEALTH_TIMEOUT',
      ),
    );
    throw new Error('E2E_BACKEND_HEALTH_TIMEOUT');
  } finally {
    exit.dispose();
  }
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

function createChildTerminalSignal(child: ManagedChildProcess): {
  readonly dispose: () => void;
  readonly promise: Promise<
    { readonly kind: 'exited' } | { readonly kind: 'spawnFailed' }
  >;
} {
  let dispose = () => undefined;
  const promise = new Promise<
    { readonly kind: 'exited' } | { readonly kind: 'spawnFailed' }
  >((resolveTerminal) => {
    if (hasExited(child)) {
      resolveTerminal({ kind: 'exited' });
      return;
    }
    const onExit = () => resolveTerminal({ kind: 'exited' });
    const onError = () => resolveTerminal({ kind: 'spawnFailed' });
    child.once('exit', onExit);
    child.once('error', onError);
    dispose = () => {
      child.removeListener('exit', onExit);
      child.removeListener('error', onError);
    };
  });
  return { dispose, promise };
}

function hasExited(child: ManagedChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}
