import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';

import { createBoundedProcessOutput, type ProcessOutput } from './boundedProcessOutput.js';
import type { E2eFixtureLifetime } from './e2eFixtureLifetime.js';
import type { E2eProcessStartupObservation, E2eProcessStartupState } from './e2eProcessStartupObservation.js';
import { windowsServiceProfiles, type WindowsServiceProfile } from './windowsServiceProfile.js';
import { createWindowsServiceControl, type WindowsServiceControl } from './windowsServiceControl.js';
import { windowsServiceCleanupMilliseconds, type WindowsServiceReply,
  type WindowsElectronBridgeCommand } from './windowsServiceProtocol.js';

export interface OwnedWindowsService extends ProcessOutput {
  readonly startup: E2eProcessStartupObservation;
  readonly workload: {
    readonly instanceId: string;
    readState(): Promise<'running' | 'exited' | 'unavailable'>;
    readRssBytes(): Promise<number>;
  };
  stop(): Promise<void>;
}
export interface ObservedWindowsService extends OwnedWindowsService {
  readonly workload: OwnedWindowsService['workload'] & { readExitCode(): number | null };
  readCombinedOutput(): string;
}

export type OwnedWindowsServiceStartupFailureCode =
  | 'preparationFailed' | 'ownerSpawnFailed' | 'startupDeadlineExceeded'
  | 'observationLost' | 'workloadExited' | 'launchFailed';

export interface OwnedWindowsServiceStartupFailureEvidence {
  readonly spawnObserved: boolean;
  readonly exitedBeforeCleanup: boolean;
  readonly processTree: 'stopped' | 'unverified';
  readonly startupFailure: OwnedWindowsServiceStartupFailureCode;
}

export class OwnedWindowsServiceStartupFailure extends Error implements ProcessOutput {
  readonly #privateFailure: Readonly<{ error: unknown }> | undefined;
  readonly evidence: Readonly<OwnedWindowsServiceStartupFailureEvidence>;
  readonly readStdout: () => string;
  readonly readStderr: () => string;

  constructor(profile: WindowsServiceProfile, evidence: OwnedWindowsServiceStartupFailureEvidence, output: ProcessOutput,
    privateFailure?: Readonly<{ error: unknown }>) {
    super(windowsServiceProfiles[profile].errorPrefix + '_OWNER_START_FAILED');
    this.evidence = Object.freeze({
      spawnObserved: evidence.spawnObserved, exitedBeforeCleanup: evidence.exitedBeforeCleanup,
      processTree: evidence.processTree, startupFailure: evidence.startupFailure,
    });
    this.readStdout = output.readStdout;
    this.readStderr = output.readStderr;
    this.#privateFailure = privateFailure;
  }
  readPrivateFailure() { return this.#privateFailure; }
}


export class OwnedWindowsBackendStartupFailure extends OwnedWindowsServiceStartupFailure {
  constructor(evidence: OwnedWindowsServiceStartupFailureEvidence, output: ProcessOutput, failure?: Readonly<{ error: unknown }>) {
    super('backend', evidence, output, failure);
  }
}
export class OwnedWindowsViteStartupFailure extends OwnedWindowsServiceStartupFailure {
  constructor(evidence: OwnedWindowsServiceStartupFailureEvidence, output: ProcessOutput, failure?: Readonly<{ error: unknown }>) {
    super('vite', evidence, output, failure);
  }
}
export class OwnedWindowsElectronStartupFailure extends OwnedWindowsServiceStartupFailure {
  constructor(evidence: OwnedWindowsServiceStartupFailureEvidence, output: ProcessOutput, failure?: Readonly<{ error: unknown }>) {
    super('electron', evidence, output, failure);
  }
}
export class OwnedWindowsElectronBridgeStartupFailure extends OwnedWindowsServiceStartupFailure {
  constructor(evidence: OwnedWindowsServiceStartupFailureEvidence, output: ProcessOutput, failure?: Readonly<{ error: unknown }>) {
    super('electronBridge', evidence, output, failure);
  }
}
export interface OwnedWindowsServiceInput {
  readonly lifetime: E2eFixtureLifetime;
  readonly startupDeadline: number;
  readonly redactedValues: readonly string[];
}
export interface PreparedWindowsService {
  readonly generation: string;
  readonly launchNonce: string;
  readonly configPath: string;
  readonly executable: string;
  readonly repositoryRoot: string;
  readonly workDeadline: number;
  readonly ownerEnvironment: Record<string, string>;
  readonly bridge?: Readonly<{ cwd: string; entrypoint: string }>;
}
export interface WindowsOwnerCleanupEvidence {
  readonly status: 'pending' | 'processTreeAbsent' | 'cleanupUnverified';
  readonly firstFailure: OwnedWindowsServiceStartupFailureCode | null;
}
export interface WindowsOwnerSession<P extends WindowsServiceProfile> {
  readonly config: PreparedWindowsService;
  readonly ready: Promise<WindowsServiceReply<P>>;
  readonly service: ObservedWindowsService;
  request(command: WindowsElectronBridgeCommand | Readonly<{ kind: 'status' }>, beforeSend?: () => void): Promise<WindowsServiceReply<P>>;
  startDirect(): Promise<ObservedWindowsService>;
  requireStartupOpen(): void;
  beforeStartupDeadline<T>(operation: Promise<T>): Promise<T>;
  stop(): Promise<void>;
  readCleanupDeadline(): number | undefined;
  subscribeCleanupDeadline(listener: (deadline: number) => void): () => void;
  readCleanupEvidence(): Readonly<WindowsOwnerCleanupEvidence>;
  readPrivateFailure(): Readonly<{ error: unknown }> | undefined;
}
export interface OwnedWindowsServiceDependencies<P extends WindowsServiceProfile, Input extends OwnedWindowsServiceInput> {
  prepare(input: Input): PreparedWindowsService;
  spawnOwner(config: PreparedWindowsService): ChildProcessWithoutNullStreams;
  connect: ReturnType<typeof createWindowsServiceControl<P>>['connectWindowsServiceControl'];
  now(): number;
  schedule(callback: () => void, milliseconds: number): () => void;
}

export function windowsServiceDependencies<P extends WindowsServiceProfile, Input extends OwnedWindowsServiceInput>(
  profile: P, prepare: (input: Input) => PreparedWindowsService,
): OwnedWindowsServiceDependencies<P, Input> {
  return {
    prepare,
    spawnOwner: config => spawn(config.executable, [windowsServiceProfiles[profile].mode, config.configPath], {
      cwd: config.repositoryRoot, env: config.ownerEnvironment, shell: false, windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    }),
    connect: createWindowsServiceControl(profile).connectWindowsServiceControl,
    now: () => performance.now(),
    schedule: (callback, milliseconds) => {
      const timer = setTimeout(callback, Math.max(1, milliseconds));
      timer.unref();
      return () => clearTimeout(timer);
    },
  };
}

export async function startOwnedWindowsService<P extends WindowsServiceProfile, Input extends OwnedWindowsServiceInput>(
  profile: P, input: Input, dependencies: OwnedWindowsServiceDependencies<P, Input>,
): Promise<ObservedWindowsService> {
  return createWindowsOwnerSession(profile, input, dependencies).startDirect();
}

export function createWindowsOwnerSession<P extends WindowsServiceProfile, Input extends OwnedWindowsServiceInput>(
  profile: P, input: Input, dependencies: OwnedWindowsServiceDependencies<P, Input>,
): WindowsOwnerSession<P> {
  const prefix = windowsServiceProfiles[profile].errorPrefix;
  const Failure = profile === 'backend' ? OwnedWindowsBackendStartupFailure
    : profile === 'vite' ? OwnedWindowsViteStartupFailure
      : profile === 'electronBridge' ? OwnedWindowsElectronBridgeStartupFailure : OwnedWindowsElectronStartupFailure;
  const stdout = createBoundedProcessOutput(undefined, input.redactedValues);
  const stderr = createBoundedProcessOutput(undefined, input.redactedValues);
  const combined = profile === 'electron' ? createBoundedProcessOutput(64 * 1024, input.redactedValues) : undefined;
  const output = { readStdout: stdout.read, readStderr: stderr.read };
  let config: PreparedWindowsService;
  try { config = dependencies.prepare(input); }
  catch (error) {
    throw new Failure({ spawnObserved: false, exitedBeforeCleanup: false,
      processTree: 'stopped', startupFailure: 'preparationFailed' }, output, Object.freeze({ error }));
  }
  const startupDeadline = Math.min(input.startupDeadline, config.workDeadline);
  let firstFailure: OwnedWindowsServiceStartupFailureCode | undefined;
  let privateFailure: Readonly<{ error: unknown }> | undefined;
  let operationalFailure: OwnedWindowsServiceStartupFailureCode | undefined;
  let startupCompleted = false;
  let rejectStartup!: (error: Error) => void;
  const startupFailed = new Promise<never>((_, reject) => { rejectStartup = reject; });
  void startupFailed.catch(() => {});
  const recordFailure = (failure: OwnedWindowsServiceStartupFailureCode) => {
    if (firstFailure === undefined) {
      firstFailure = failure;
      rejectStartup(new Error(prefix + '_OWNER_START_FAILED'));
    }
  };
  const recordOperationalFailure = (failure: OwnedWindowsServiceStartupFailureCode) => {
    operationalFailure ??= failure;
    recordFailure(failure);
  };
  let current: WindowsServiceReply<P> | undefined;
  let instanceId: string | undefined;
  let exitedBeforeCleanup = false;
  let startupState: E2eProcessStartupState = Object.freeze({ spawnObserved: false, terminal: undefined });
  const listeners = new Set<(state: E2eProcessStartupState) => void>();
  let control: WindowsServiceControl<P> | undefined;
  let controlLost = false;
  let stopping = false;
  let stopped = false;
  let closed = false;
  let cleanupDeadline: number | undefined;
  const cleanupDeadlineListeners = new Set<(deadline: number) => void>();
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
  const connectionCancellation = new AbortController();
  let connection: Promise<WindowsServiceControl<P>>;
  let rejectStopped!: (error: Error) => void;
  const admissionStopped = new Promise<never>((_, reject) => { rejectStopped = reject; });
  void admissionStopped.catch(() => {});
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
    rejectStopped(new Error(prefix + '_OWNER_START_FAILED'));
    cancelWorkTimer();
    const deadline = Math.min(cleanupDeadline ?? dependencies.now() + windowsServiceCleanupMilliseconds,
      nativeDeadline ?? Infinity);
    if (!cleanupFinished && deadline !== cleanupDeadline) {
      cleanupDeadline = deadline;
      cancelCleanupTimer();
      cancelCleanupTimer = dependencies.schedule(() => {
        rejectCleanup(new Error(prefix + '_OWNER_CLEANUP_UNVERIFIED'));
        emergencyStop(true);
      }, Math.max(0, deadline - dependencies.now()));
      for (const listener of cleanupDeadlineListeners) {
        try { listener(deadline); } catch { recordOperationalFailure('observationLost'); }
      }
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
    throw new Failure({ spawnObserved: false, exitedBeforeCleanup: false,
      processTree: 'stopped', startupFailure: 'startupDeadlineExceeded' }, output);
  }
  try { owner = dependencies.spawnOwner(config); }
  catch (error) {
    throw new Failure({ spawnObserved: false, exitedBeforeCleanup: false,
      processTree: 'stopped', startupFailure: 'ownerSpawnFailed' }, output, Object.freeze({ error }));
  }
  owner.stdout.on('data', (chunk: Buffer) => { stdout.append(chunk); combined?.append(chunk); });
  owner.stderr.on('data', (chunk: Buffer) => { stderr.append(chunk); combined?.append(chunk); });
  let ownerSpawnObserved = false;
  owner.once('spawn', () => { ownerSpawnObserved = true; });
  owner.on('error', error => {
    privateFailure ??= Object.freeze({ error });
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
      connectionCancellation.abort();
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
    void operation.catch(() => {});
    let cancel = () => {};
    try {
      const expired = new Promise<never>((_, reject) => {
        const expire = () => {
          recordFailure('startupDeadlineExceeded');
          reject(new Error(prefix + '_OWNER_DEADLINE_EXCEEDED'));
        };
        if (dependencies.now() >= startupDeadline) expire();
        else cancel = dependencies.schedule(expire, startupDeadline - dependencies.now());
      });
      const value = await Promise.race([operation, expired, startupFailed, admissionStopped, cleanupExpired]);
      requireStartupOpen();
      return value;
    } finally { cancel(); }
  }

  function requireStartupOpen(): void {
    if (dependencies.now() >= startupDeadline) recordFailure('startupDeadlineExceeded');
    if (stopping || controlLost || closed || firstFailure !== undefined) {
      throw new Error(prefix + '_OWNER_START_FAILED');
    }
  }

  function requireCleanupOpen(): void {
    if (cleanupFinished || controlLost || cleanupDeadline === undefined || dependencies.now() >= cleanupDeadline) {
      throw new Error(prefix + '_OWNER_CLEANUP_UNVERIFIED');
    }
  }

  async function beforeCleanupDeadline<T>(operation: Promise<T>): Promise<T> {
    const value = await Promise.race([operation, cleanupExpired]);
    requireCleanupOpen();
    return value;
  }

  async function stopOwned(): Promise<void> {
    try {
      // Only an early staged stop may await admission; failed startup stays fail closed.
      if (control === undefined && profile === 'electronBridge' && firstFailure === undefined && !controlLost) {
        await beforeCleanupDeadline(connection);
      }
      await beforeCleanupDeadline(serialize(async () => {
        requireCleanupOpen();
        if (control === undefined) throw new Error(prefix + '_OWNER_CLEANUP_UNVERIFIED');
        const terminal = current?.kind === 'terminal' ? current : await control.request('stop');
        requireCleanupOpen();
        if (terminal.kind !== 'terminal' || terminal.state.cleanup !== 'processTreeAbsent') {
          throw new Error(prefix + '_OWNER_CLEANUP_UNVERIFIED');
        }
        await beforeCleanupDeadline(control.finish());
        const exit = await beforeCleanupDeadline(ownerClosed);
        if (exit.code !== 0 || exit.signal !== null) {
          throw new Error(prefix + '_OWNER_CLEANUP_UNVERIFIED');
        }
      }));
      stopped = true;
    } catch {
      emergencyStop(false);
      if (!closed && dependencies.now() < readDeadline()) {
        try { await Promise.race([ownerClosed, cleanupExpired]); } catch { /* Failure retained. */ }
      }
      emergencyStop(true);
      throw new Error(prefix + '_OWNER_CLEANUP_UNVERIFIED');
    } finally {
      cleanupFinished = true; connectionCancellation.abort(); cancelWorkTimer(); cancelCleanupTimer();
    }
  }
  function cleanup(): Promise<void> {
    if (cleanupResult === undefined) {
      beginStop();
      cleanupResult = Promise.resolve().then(stopOwned);
    }
    return cleanupResult;
  }
  function failureEvidence(): OwnedWindowsServiceStartupFailure {
    return new Failure({ spawnObserved: startupState.spawnObserved,
      exitedBeforeCleanup, processTree: stopped ? 'stopped' : 'unverified',
      startupFailure: firstFailure ?? 'observationLost' }, output, privateFailure);
  }
  function stop(): Promise<void> {
    stopResult ??= cleanup().then(() => {
      if (operationalFailure !== undefined) throw failureEvidence();
    }, () => {
      if (operationalFailure !== undefined) throw failureEvidence();
      throw new Error(prefix + '_OWNER_CLEANUP_UNVERIFIED');
    });
    return stopResult;
  }

  // Start connecting only after the stop handle and all owner listeners exist.
  connection = Promise.resolve().then(() => dependencies.connect({
      generation: config.generation, deadline: startupDeadline, readDeadline,
      signal: connectionCancellation.signal,
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
        // Direct Electron consumers deliberately observe short-lived successful
        // or expected-failure launches. Long-lived services still reject this.
        if (profile !== 'electron' && !startupCompleted && reply.state.workload === 'exited') recordFailure('workloadExited');
        if (reply.state.workload === 'unavailable') recordOperationalFailure('observationLost');
        if (reply.state.started && reply.state.identity !== null) instanceId ??= randomUUID();
        if (reply.cleanupStartedElapsedMilliseconds !== null) {
          const nativeDeadline = generationAnchor + reply.cleanupStartedElapsedMilliseconds + windowsServiceCleanupMilliseconds;
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
    })).then(connected => {
      if (cleanupFinished || controlLost || closed ||
        (stopping && (profile !== 'electronBridge' || firstFailure !== undefined))) {
        connected.destroy();
        throw new Error(prefix + '_OWNER_START_FAILED');
      }
      control = connected;
      return connected;
    });
  void connection.catch(error => { privateFailure ??= Object.freeze({ error }); });
  const ready = (async () => {
    await beforeStartupDeadline(connection);
    const clockSample = await beforeStartupDeadline(serialize(() => {
      requireStartupOpen();
      return control!.request('status');
    }));
    if (clockSample.kind !== 'status' || clockSample.state.created || clockSample.state.started ||
      clockSample.state.creationCompleted || clockSample.state.launchClosed || clockSample.state.workload !== 'pending') {
      recordFailure('launchFailed');
      throw new Error(prefix + '_OWNER_START_FAILED');
    }
    return clockSample;
  })();
  void ready.catch(() => { void cleanup().catch(() => {}); });

  let directStarted = false;
  async function startDirect(): Promise<ObservedWindowsService> {
    try {
      if (profile === 'electronBridge' || directStarted) throw new Error(prefix + '_OWNER_START_FAILED');
      directStarted = true;
      const clockSample = await ready;
      await beforeStartupDeadline(serialize(() => {
        requireStartupOpen();
        const remaining = Math.floor(config.workDeadline - dependencies.now());
        if (!Number.isSafeInteger(remaining) || remaining < 1) {
          recordFailure('startupDeadlineExceeded');
          throw new Error(prefix + '_OWNER_DEADLINE_EXCEEDED');
        }
        // The sample predates this remaining-budget read. Delivery and native
        // startup delay can only shorten the owner's deadline, never renew it.
        return control!.request('launch', config.launchNonce, clockSample.elapsedMilliseconds + remaining);
      }));
      if (!startupState.spawnObserved || instanceId === undefined) {
        recordFailure('launchFailed');
        throw new Error(prefix + '_OWNER_START_FAILED');
      }
      startupCompleted = true;
      return service;
    } catch (error) {
      privateFailure ??= Object.freeze({ error });
      recordFailure('observationLost');
      try { await cleanup(); } catch { /* Missing stop proof retains the fixture root. */ }
      throw failureEvidence();
    }
  }

  const canReadWorkload = () => !stopping && !controlLost && operationalFailure === undefined &&
    dependencies.now() < config.workDeadline;

  const service: ObservedWindowsService = {
    ...output,
    readCombinedOutput() {
      if (combined === undefined) throw new Error(prefix + '_COMBINED_OUTPUT_UNAVAILABLE');
      return combined.read();
    },
    startup: Object.freeze({
      readState: () => startupState,
      subscribe(listener: (state: E2eProcessStartupState) => void) {
        if (startupState.terminal === undefined) listeners.add(listener);
        return () => { listeners.delete(listener); };
      },
    }),
    workload: Object.freeze({
      readExitCode() {
        return (stopped || canReadWorkload()) && current?.state.workload === 'exited'
          ? current.state.exitCode : null;
      },
      get instanceId() {
        if (instanceId === undefined) throw new Error(prefix + '_WORKLOAD_UNAVAILABLE');
        return instanceId;
      },
      async readState() {
        if (stopped && current?.state.workload === 'exited') return 'exited';
        if (!canReadWorkload()) return 'unavailable';
        try {
          await serialize(() => {
            if (!canReadWorkload()) throw new Error(prefix + '_WORKLOAD_UNAVAILABLE');
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
          if (!canReadWorkload()) throw new Error(prefix + '_RSS_UNAVAILABLE');
          const reply = await serialize(() => {
            if (!canReadWorkload()) throw new Error(prefix + '_RSS_UNAVAILABLE');
            return control!.request('rss');
          });
          if (!canReadWorkload() || current?.state.workload !== 'running' || reply.kind !== 'rss' ||
            reply.rssBytes === null || reply.state.workload !== 'running') {
            throw new Error(prefix + '_RSS_UNAVAILABLE');
          }
          return reply.rssBytes;
        } catch { throw new Error(prefix + '_RSS_UNAVAILABLE'); }
      },
    }),
    stop,
  };
  let armed = false;
  let registered = false;
  let goSent = false;
  return {
    config, ready, service, startDirect, stop, requireStartupOpen, beforeStartupDeadline,
    readPrivateFailure: () => privateFailure,
    readCleanupDeadline: () => cleanupDeadline,
    subscribeCleanupDeadline(listener) {
      cleanupDeadlineListeners.add(listener);
      return () => { cleanupDeadlineListeners.delete(listener); };
    },
    readCleanupEvidence: () => Object.freeze({ status: stopped ? 'processTreeAbsent'
      : cleanupFinished ? 'cleanupUnverified' : 'pending', firstFailure: firstFailure ?? null }),
    async request(command, beforeSend) {
      try {
        await beforeStartupDeadline(ready);
        return await beforeStartupDeadline(serialize(async () => {
          requireStartupOpen();
          if (profile !== 'electronBridge') throw new Error(prefix + '_OWNER_START_FAILED');
          if (command.kind === 'arm') {
            if (armed || registered || goSent) throw new Error(prefix + '_OWNER_START_FAILED');
            armed = true;
          } else if (command.kind === 'register') {
            if (!armed || registered || goSent) throw new Error(prefix + '_OWNER_START_FAILED');
            registered = true;
          } else if (command.kind === 'go') {
            if (!registered || goSent) throw new Error(prefix + '_OWNER_START_FAILED');
            goSent = true;
          }
          beforeSend?.();
          requireStartupOpen();
          const reply = command.kind === 'status' ? await control!.request('status')
            : await control!.requestBridge!(command);
          requireStartupOpen();
          if (command.kind === 'go') {
            if (reply.kind !== 'started' || !startupState.spawnObserved || instanceId === undefined) {
              throw new Error(prefix + '_OWNER_START_FAILED');
            }
            startupCompleted = true;
          }
          return reply;
        }));
      } catch (error) {
        privateFailure ??= Object.freeze({ error });
        if (!stopping) recordFailure('launchFailed');
        void cleanup().catch(() => {});
        throw failureEvidence();
      }
    },
  };
}
