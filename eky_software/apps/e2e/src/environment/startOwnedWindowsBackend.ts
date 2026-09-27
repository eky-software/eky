import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';

import { createBoundedProcessOutput, type ProcessOutput } from './boundedProcessOutput.js';
import type { E2eBackendWorkload } from './e2eBackendWorkload.js';
import type { E2eFixtureLifetime } from './e2eFixtureLifetime.js';
import type { E2eProcessStartupObservation, E2eProcessStartupState } from './e2eProcessStartupObservation.js';
import { prepareWindowsBackendService } from './windowsBackendServiceConfiguration.js';
import {
  connectBackendServiceControl, type BackendServiceControl,
} from './windowsBackendServiceControl.js';
import { backendServiceCleanupMilliseconds, type BackendServiceReply } from './windowsBackendServiceProtocol.js';

export interface OwnedWindowsBackend extends ProcessOutput {
  readonly startup: E2eProcessStartupObservation;
  readonly workload: E2eBackendWorkload;
  stop(): Promise<void>;
}

export type OwnedWindowsBackendStartupFailureCode =
  | 'preparationFailed' | 'ownerSpawnFailed' | 'startupDeadlineExceeded'
  | 'observationLost' | 'workloadExited' | 'launchFailed';

export interface OwnedWindowsBackendStartupFailureEvidence {
  readonly spawnObserved: boolean;
  readonly exitedBeforeCleanup: boolean;
  readonly processTree: 'stopped' | 'unverified';
  readonly startupFailure: OwnedWindowsBackendStartupFailureCode;
}

export class OwnedWindowsBackendStartupFailure extends Error implements ProcessOutput {
  readonly evidence: Readonly<OwnedWindowsBackendStartupFailureEvidence>;
  readonly readStdout: () => string;
  readonly readStderr: () => string;

  constructor(evidence: OwnedWindowsBackendStartupFailureEvidence, output: ProcessOutput) {
    super('E2E_BACKEND_OWNER_START_FAILED');
    this.evidence = Object.freeze({
      spawnObserved: evidence.spawnObserved, exitedBeforeCleanup: evidence.exitedBeforeCleanup,
      processTree: evidence.processTree, startupFailure: evidence.startupFailure,
    });
    this.readStdout = output.readStdout;
    this.readStderr = output.readStderr;
  }
}

interface OwnedWindowsBackendInput {
  readonly repositoryRoot: string;
  readonly runRoot: string;
  readonly runtimeConfigPath: string;
  readonly lifetime: E2eFixtureLifetime;
  readonly startupDeadline: number;
  readonly redactedValues: readonly string[];
}

interface OwnedWindowsBackendDependencies {
  prepare: typeof prepareWindowsBackendService;
  spawnOwner(config: ReturnType<typeof prepareWindowsBackendService>): ChildProcessWithoutNullStreams;
  connect: typeof connectBackendServiceControl;
  now(): number;
  schedule(callback: () => void, milliseconds: number): () => void;
}

const defaultDependencies: OwnedWindowsBackendDependencies = {
  prepare: prepareWindowsBackendService,
  spawnOwner: config => spawn(config.executable, ['--backend-owner', config.configPath], {
    cwd: config.repositoryRoot, env: config.ownerEnvironment, shell: false, windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  }),
  connect: connectBackendServiceControl,
  now: () => performance.now(),
  schedule: (callback, milliseconds) => {
    const timer = setTimeout(callback, Math.max(1, milliseconds));
    timer.unref();
    return () => clearTimeout(timer);
  },
};

export async function startOwnedWindowsBackend(
  input: OwnedWindowsBackendInput,
  overrides: Partial<OwnedWindowsBackendDependencies> = {},
): Promise<OwnedWindowsBackend> {
  const dependencies = { ...defaultDependencies, ...overrides };
  const stdout = createBoundedProcessOutput(undefined, input.redactedValues);
  const stderr = createBoundedProcessOutput(undefined, input.redactedValues);
  const output = { readStdout: stdout.read, readStderr: stderr.read };
  let config: ReturnType<typeof prepareWindowsBackendService>;
  try { config = dependencies.prepare(input); }
  catch {
    throw new OwnedWindowsBackendStartupFailure({ spawnObserved: false, exitedBeforeCleanup: false,
      processTree: 'stopped', startupFailure: 'preparationFailed' }, output);
  }
  const startupDeadline = Math.min(input.startupDeadline, config.workDeadline);
  let firstFailure: OwnedWindowsBackendStartupFailureCode | undefined;
  let operationalFailure: OwnedWindowsBackendStartupFailureCode | undefined;
  let startupCompleted = false;
  let rejectStartup!: (error: Error) => void;
  const startupFailed = new Promise<never>((_, reject) => { rejectStartup = reject; });
  void startupFailed.catch(() => {});
  const recordFailure = (failure: OwnedWindowsBackendStartupFailureCode) => {
    if (firstFailure === undefined) {
      firstFailure = failure;
      rejectStartup(new Error('E2E_BACKEND_OWNER_START_FAILED'));
    }
  };
  const recordOperationalFailure = (failure: OwnedWindowsBackendStartupFailureCode) => {
    operationalFailure ??= failure;
    recordFailure(failure);
  };
  let current: BackendServiceReply | undefined;
  let instanceId: string | undefined;
  let exitedBeforeCleanup = false;
  let startupState: E2eProcessStartupState = Object.freeze({ spawnObserved: false, terminal: undefined });
  const listeners = new Set<(state: E2eProcessStartupState) => void>();
  let control: BackendServiceControl | undefined;
  let controlLost = false;
  let stopping = false;
  let stopped = false;
  let closed = false;
  let cleanupDeadline: number | undefined;
  let stopResult: Promise<void> | undefined;
  let cleanupResult: Promise<void> | undefined;
  let cleanupFinished = false;
  let emergencyStarted = false;
  let killRequested = false;
  let cancelWorkTimer = () => {};
  let cancelCleanupTimer = () => {};
  let rejectCleanup!: (error: Error) => void;
  const cleanupExpired = new Promise<never>((_, reject) => { rejectCleanup = reject; });
  void cleanupExpired.catch(() => {});
  let queue: Promise<unknown> = Promise.resolve();
  const publish = (next: E2eProcessStartupState) => {
    if (startupState.terminal !== undefined) return;
    startupState = Object.freeze(next);
    try {
      for (const listener of [...listeners]) if (listeners.has(listener)) listener(startupState);
    } finally { if (startupState.terminal !== undefined) listeners.clear(); }
  };
  const loseObservation = () => {
    const firstLoss = !controlLost;
    if (!stopping && !emergencyStarted) recordOperationalFailure('observationLost');
    else if (!startupCompleted) recordFailure('observationLost');
    controlLost = true;
    publish({ ...startupState, terminal: 'observationLost' });
    void stop().catch(() => {});
    if (firstLoss) {
      try { control?.destroy(); } catch { /* The first loss remains authoritative. */ }
    }
  };
  const readDeadline = () => cleanupDeadline ?? config.workDeadline;
  const beginStop = (nativeDeadline?: number) => {
    stopping = true;
    cancelWorkTimer();
    const deadline = Math.min(cleanupDeadline ?? dependencies.now() + backendServiceCleanupMilliseconds,
      nativeDeadline ?? Infinity);
    if (!cleanupFinished && deadline !== cleanupDeadline) {
      cleanupDeadline = deadline;
      cancelCleanupTimer();
      cancelCleanupTimer = dependencies.schedule(() => {
        rejectCleanup(new Error('E2E_BACKEND_OWNER_CLEANUP_UNVERIFIED'));
        emergencyStop(true);
      }, Math.max(0, deadline - dependencies.now()));
    }
  };
  const serialize = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = queue.then(operation);
    queue = result.catch(() => {});
    return result;
  };

  // Correlated replies refine this lower bound without counting reply delivery
  // delay as native lifetime. An already latched cleanup deadline never grows.
  let generationAnchor = dependencies.now();
  let owner: ChildProcessWithoutNullStreams;
  if (!Number.isFinite(startupDeadline) || dependencies.now() >= startupDeadline) {
    throw new OwnedWindowsBackendStartupFailure({ spawnObserved: false, exitedBeforeCleanup: false,
      processTree: 'stopped', startupFailure: 'startupDeadlineExceeded' }, output);
  }
  try { owner = dependencies.spawnOwner(config); }
  catch {
    throw new OwnedWindowsBackendStartupFailure({ spawnObserved: false, exitedBeforeCleanup: false,
      processTree: 'stopped', startupFailure: 'ownerSpawnFailed' }, output);
  }
  owner.stdout.on('data', (chunk: Buffer) => stdout.append(chunk));
  owner.stderr.on('data', (chunk: Buffer) => stderr.append(chunk));
  let ownerSpawnObserved = false;
  owner.once('spawn', () => { ownerSpawnObserved = true; });
  owner.on('error', () => {
    if (!stopping) recordOperationalFailure(ownerSpawnObserved ? 'observationLost' : 'ownerSpawnFailed');
    loseObservation();
  });
  owner.stdin.on('error', loseObservation);
  const ownerClosed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(resolve => {
    owner.once('close', (code, signal) => {
      closed = true;
      if (!stopping || current?.kind !== 'terminal' || code !== 0 || signal !== null) loseObservation();
      resolve({ code, signal });
    });
  });
  cancelWorkTimer = dependencies.schedule(() => {
    recordOperationalFailure('startupDeadlineExceeded');
    publish({ ...startupState, terminal: 'observationLost' });
    void stop().catch(() => {});
  }, Math.max(0, config.workDeadline - dependencies.now()));

  function emergencyStop(kill: boolean): void {
    if (!emergencyStarted) {
      emergencyStarted = true;
      controlLost = true;
      publish({ ...startupState, terminal: 'observationLost' });
      try { control?.destroy(); } catch { /* Cleanup remains unverified. */ }
      try { owner.stdin.end(); } catch { /* The original deadline still applies. */ }
    }
    if (kill && !closed && !killRequested) {
      killRequested = true;
      try { owner.kill(); } catch { /* Handle kill is not an absence receipt. */ }
    }
  }

  async function beforeStartupDeadline<T>(operation: Promise<T>): Promise<T> {
    let cancel = () => {};
    try {
      const expired = new Promise<never>((_, reject) => {
        const expire = () => {
          recordFailure('startupDeadlineExceeded');
          reject(new Error('E2E_BACKEND_OWNER_DEADLINE_EXCEEDED'));
        };
        if (dependencies.now() >= startupDeadline) expire();
        else cancel = dependencies.schedule(expire, startupDeadline - dependencies.now());
      });
      const value = await Promise.race([operation, expired, startupFailed, cleanupExpired]);
      requireStartupOpen();
      return value;
    } finally { cancel(); }
  }

  function requireStartupOpen(): void {
    if (dependencies.now() >= startupDeadline) recordFailure('startupDeadlineExceeded');
    if (stopping || controlLost || closed || firstFailure !== undefined) {
      throw new Error('E2E_BACKEND_OWNER_START_FAILED');
    }
  }

  function requireCleanupOpen(): void {
    if (cleanupFinished || controlLost || cleanupDeadline === undefined || dependencies.now() >= cleanupDeadline) {
      throw new Error('E2E_BACKEND_OWNER_CLEANUP_UNVERIFIED');
    }
  }

  async function beforeCleanupDeadline<T>(operation: Promise<T>): Promise<T> {
    const value = await Promise.race([operation, cleanupExpired]);
    requireCleanupOpen();
    return value;
  }

  async function stopOwned(): Promise<void> {
    try {
      await beforeCleanupDeadline(serialize(async () => {
        requireCleanupOpen();
        if (control === undefined) throw new Error('E2E_BACKEND_OWNER_CLEANUP_UNVERIFIED');
        const terminal = current?.kind === 'terminal' ? current : await control.request('stop');
        requireCleanupOpen();
        if (terminal.kind !== 'terminal' || terminal.state.cleanup !== 'processTreeAbsent') {
          throw new Error('E2E_BACKEND_OWNER_CLEANUP_UNVERIFIED');
        }
        await beforeCleanupDeadline(control.finish());
        const exit = await beforeCleanupDeadline(ownerClosed);
        if (exit.code !== 0 || exit.signal !== null) {
          throw new Error('E2E_BACKEND_OWNER_CLEANUP_UNVERIFIED');
        }
      }));
      stopped = true;
    } catch {
      emergencyStop(false);
      if (!closed && dependencies.now() < readDeadline()) {
        try { await Promise.race([ownerClosed, cleanupExpired]); } catch { /* Failure retained. */ }
      }
      emergencyStop(true);
      throw new Error('E2E_BACKEND_OWNER_CLEANUP_UNVERIFIED');
    } finally { cleanupFinished = true; cancelWorkTimer(); cancelCleanupTimer(); }
  }
  function cleanup(): Promise<void> {
    if (cleanupResult === undefined) {
      beginStop();
      cleanupResult = Promise.resolve().then(stopOwned);
    }
    return cleanupResult;
  }
  function failureEvidence(): OwnedWindowsBackendStartupFailure {
    return new OwnedWindowsBackendStartupFailure({ spawnObserved: startupState.spawnObserved,
      exitedBeforeCleanup, processTree: stopped ? 'stopped' : 'unverified',
      startupFailure: firstFailure ?? 'observationLost' }, output);
  }
  function stop(): Promise<void> {
    stopResult ??= cleanup().then(() => {
      if (operationalFailure !== undefined) throw failureEvidence();
    }, () => {
      if (operationalFailure !== undefined) throw failureEvidence();
      throw new Error('E2E_BACKEND_OWNER_CLEANUP_UNVERIFIED');
    });
    return stopResult;
  }

  try {
    requireStartupOpen();
    const connection = dependencies.connect({
      generation: config.generation, deadline: startupDeadline, readDeadline,
      onLost: loseObservation,
      onReply(reply, requestSentAt) {
        if (cleanupFinished) return;
        if (requestSentAt !== undefined) {
          // Native elapsed time is truncated to milliseconds; reserve that fraction.
          generationAnchor = Math.max(generationAnchor, requestSentAt - reply.elapsedMilliseconds - 1);
        }
        current = reply;
        if (!stopping && reply.cleanupStartedElapsedMilliseconds === null && reply.state.workload === 'exited') {
          exitedBeforeCleanup = true;
        }
        if (reply.state.firstFailure !== null) {
          recordOperationalFailure(reply.state.firstFailure === 'workDeadlineExceeded' ? 'startupDeadlineExceeded'
            : reply.state.firstFailure === 'stdioFailed' || reply.state.firstFailure === 'observationLost'
              ? 'observationLost' : 'launchFailed');
        }
        if (!startupCompleted && reply.state.workload === 'exited') recordFailure('workloadExited');
        if (reply.state.workload === 'unavailable') recordOperationalFailure('observationLost');
        if (reply.state.started && reply.state.identity !== null) instanceId ??= randomUUID();
        if (reply.cleanupStartedElapsedMilliseconds !== null) {
          const nativeDeadline = generationAnchor + reply.cleanupStartedElapsedMilliseconds + backendServiceCleanupMilliseconds;
          beginStop(nativeDeadline);
          void stop().catch(() => {});
        }
        publish({ spawnObserved: startupState.spawnObserved || reply.state.started,
          terminal: reply.state.firstFailure !== null && reply.state.started ? 'observationLost'
            : reply.state.workload === 'exited' ? 'exited'
            : reply.state.workload === 'unavailable' ? 'observationLost'
              : reply.state.firstFailure !== null && !reply.state.started ? 'spawnFailed' : undefined });
        if (reply.kind === 'terminal') queueMicrotask(() => { void stop().catch(() => {}); });
      },
    }).then(connected => {
      if (stopping || cleanupFinished || controlLost) {
        connected.destroy();
        throw new Error('E2E_BACKEND_OWNER_START_FAILED');
      }
      control = connected;
      return connected;
    });
    await beforeStartupDeadline(connection);
    const clockSample = await beforeStartupDeadline(serialize(() => {
      requireStartupOpen();
      return control!.request('status');
    }));
    if (clockSample.kind !== 'status' || clockSample.state.created || clockSample.state.started ||
      clockSample.state.creationCompleted || clockSample.state.launchClosed || clockSample.state.workload !== 'pending') {
      recordFailure('launchFailed');
      throw new Error('E2E_BACKEND_OWNER_START_FAILED');
    }
    await beforeStartupDeadline(serialize(() => {
      requireStartupOpen();
      const remaining = Math.floor(config.workDeadline - dependencies.now());
      if (!Number.isSafeInteger(remaining) || remaining < 1) {
        recordFailure('startupDeadlineExceeded');
        throw new Error('E2E_BACKEND_OWNER_DEADLINE_EXCEEDED');
      }
      // The sample predates this remaining-budget read. Delivery and native
      // startup delay can only shorten the owner's deadline, never renew it.
      return control!.request('launch', config.launchNonce, clockSample.elapsedMilliseconds + remaining);
    }));
    if (!startupState.spawnObserved || instanceId === undefined) {
      recordFailure('launchFailed');
      throw new Error('E2E_BACKEND_OWNER_START_FAILED');
    }
    startupCompleted = true;
  } catch {
    recordFailure('observationLost');
    try { await cleanup(); } catch { /* Missing stop proof retains the fixture root. */ }
    throw failureEvidence();
  }

  const canReadWorkload = () => !stopping && !controlLost && operationalFailure === undefined &&
    dependencies.now() < config.workDeadline;

  return {
    ...output,
    startup: Object.freeze({
      readState: () => startupState,
      subscribe(listener: (state: E2eProcessStartupState) => void) {
        if (startupState.terminal === undefined) listeners.add(listener);
        return () => { listeners.delete(listener); };
      },
    }),
    workload: Object.freeze({
      get instanceId() {
        if (instanceId === undefined) throw new Error('E2E_BACKEND_WORKLOAD_UNAVAILABLE');
        return instanceId;
      },
      async readState() {
        if (stopped && current?.state.workload === 'exited') return 'exited';
        if (!canReadWorkload()) return 'unavailable';
        try {
          await serialize(() => {
            if (!canReadWorkload()) throw new Error('E2E_BACKEND_WORKLOAD_UNAVAILABLE');
            return control!.request('status');
          });
          if (stopped && current?.state.workload === 'exited') return 'exited';
          if (!canReadWorkload()) return 'unavailable';
          return current?.state.workload === 'running' || current?.state.workload === 'exited'
            ? current.state.workload : 'unavailable';
        } catch { return 'unavailable'; }
      },
      async readRssBytes() {
        try {
          if (!canReadWorkload()) throw new Error('E2E_BACKEND_RSS_UNAVAILABLE');
          const reply = await serialize(() => {
            if (!canReadWorkload()) throw new Error('E2E_BACKEND_RSS_UNAVAILABLE');
            return control!.request('rss');
          });
          if (!canReadWorkload() || current?.state.workload !== 'running' || reply.kind !== 'rss' ||
            reply.rssBytes === null || reply.state.workload !== 'running') {
            throw new Error('E2E_BACKEND_RSS_UNAVAILABLE');
          }
          return reply.rssBytes;
        } catch { throw new Error('E2E_BACKEND_RSS_UNAVAILABLE'); }
      },
    }),
    stop,
  };
}
