import { AsyncLocalStorage } from 'node:async_hooks';
import { ChildProcess } from 'node:child_process';
import { channel } from 'node:diagnostics_channel';

import {
  matchesElectronSpawnObservation, validateElectronSpawnObservationBinding,
  type ElectronSpawnObservationBinding,
} from './electronSpawnObservationBinding.js';
import { assertElectronSpawnObservationVersions } from './electronSpawnObservationVersions.js';

export const electronSpawnStartChannel = 'tracing:child_process.spawn:start';
const launchScope = new AsyncLocalStorage<{ observe(message: unknown): void }>();
const source = channel(electronSpawnStartChannel);
let dispatchSubscribed = false;

// One passive dispatcher, no registry of launches. Async descendants retain
// their own context even after promise settlement/close. Unsubscribing on those
// events would hide a late spawn; ALS lets it reach the same poisoned observer.
function subscribeDispatcher() {
  if (dispatchSubscribed) return;
  source.subscribe(message => { launchScope.getStore()?.observe(message); });
  dispatchSubscribed = true;
}

export type ElectronSpawnObservationFailureCode =
  | 'inputInvalid' | 'versionUnverified' | 'launchReused' | 'subscriptionFailed'
  | 'missingObservation' | 'invalidObservation' | 'duplicateObservation' | 'lateObservation'
  | 'metadataMismatch' | 'callbackFailed' | 'spawnFailed' | 'processError'
  | 'deadlineExceeded' | 'closeDeadlineExceeded' | 'launchRejected' | 'stopped';

export class ElectronSpawnObservationFailure extends Error {
  constructor(readonly code: ElectronSpawnObservationFailureCode) {
    super(`E2E_ELECTRON_SPAWN_OBSERVATION_${code}`);
  }
}

export interface ElectronSpawnObservationState {
  readonly launch: 'notStarted' | 'pending' | 'fulfilled' | 'rejected';
  readonly failure: ElectronSpawnObservationFailureCode | null;
  readonly observed: number;
  readonly spawnObserved: boolean;
  readonly errorObserved: boolean;
  readonly exitObserved: boolean;
  readonly closeObserved: boolean;
  readonly goEligible: boolean;
  // Current retained listeners only, not proof that inherited async work ended.
  readonly released: boolean;
}

interface Dependencies {
  assertVersions(): void;
  now(): number;
  schedule(callback: () => void, milliseconds: number): () => void;
}
interface ProcessObservation {
  readonly child: ChildProcess;
  matches: boolean;
  spawned: boolean;
  pid: number | undefined;
  error: boolean;
  exited: boolean;
  closed: boolean;
}
const defaults: Dependencies = {
  assertVersions: assertElectronSpawnObservationVersions,
  now: () => performance.now(),
  schedule(callback, milliseconds) {
    const timer = setTimeout(callback, milliseconds);
    return () => clearTimeout(timer);
  },
};

// Test-harness observation only: the retained ChildProcess is not a native
// creation handle, a workload owner or permission to remove the test root.
export function createElectronSpawnObservation(input: ElectronSpawnObservationBinding & {
  readonly workDeadline: number;
}, overrides: Partial<Dependencies> = {}) {
  const dependencies = { ...defaults, ...overrides };
  const expected = Object.freeze({ ...input });
  try {
    validateElectronSpawnObservationBinding(expected);
    if (!Number.isFinite(expected.workDeadline)) throw new Error();
  } catch { throw new ElectronSpawnObservationFailure('inputInvalid'); }

  const context = Object.freeze({ observe: onStart });
  const records = new Map<ChildProcess, ProcessObservation>();
  const changed = new Set<() => void>();
  let launch: ElectronSpawnObservationState['launch'] = 'notStarted';
  let failure: ElectronSpawnObservationFailureCode | null = null;
  let privateLaunchFailure: Readonly<{ error: unknown }> | undefined;
  let gateClosed = false;
  let unknownProcess = false;
  let released = false;
  let closeDeadline: number | undefined;

  function poison(code: ElectronSpawnObservationFailureCode) {
    failure ??= code;
    gateClosed = true;
  }
  function guard(callback: () => void) {
    try { callback(); } catch { poison('callbackFailed'); }
  }
  function notify() {
    for (const listener of [...changed]) guard(listener);
  }
  function checkWorkDeadline() {
    if (gateClosed) return;
    guard(() => {
      const now = dependencies.now();
      if (!Number.isFinite(now) || now >= expected.workDeadline) poison('deadlineExceeded');
    });
  }
  function allClosed() {
    return !unknownProcess && records.size > 0 && [...records.values()].every(record => record.closed);
  }
  function releaseIfClosed() {
    if (launch !== 'pending' && allClosed()) {
      released = true;
    }
  }
  function readState(): ElectronSpawnObservationState {
    checkWorkDeadline();
    const record = records.values().next().value;
    return Object.freeze({
      launch, failure, observed: records.size, released,
      spawnObserved: record?.spawned ?? false,
      errorObserved: [...records.values()].some(value => value.error),
      exitObserved: record?.exited ?? false,
      closeObserved: allClosed(),
      goEligible: !gateClosed && records.size === 1 && record?.matches === true &&
        record.spawned && record.pid !== undefined && !record.error && !record.exited && !record.closed,
    });
  }
  function retain(child: ChildProcess): ProcessObservation {
    const record: ProcessObservation = {
      child, matches: false, spawned: false, pid: undefined, error: false, exited: false, closed: false,
    };
    records.set(child, record);
    const observe = (callback: () => void) => () => {
      guard(callback);
      guard(releaseIfClosed);
      notify();
    };
    const onError = observe(() => {
      record.error = true;
      poison(record.spawned ? 'processError' : 'spawnFailed');
    });
    const onExit = observe(() => { record.exited = true; gateClosed = true; });
    const onSpawn = observe(() => {
      if (record.spawned || record.error || record.exited || record.closed) poison('invalidObservation');
      record.spawned = true;
      const pid = child.pid;
      if (!Number.isSafeInteger(pid) || pid === undefined || pid < 1 || pid > 0xffffffff) {
        poison('invalidObservation');
      } else record.pid = pid;
      checkWorkDeadline();
    });
    const onClose = observe(() => {
      record.closed = true;
      gateClosed = true;
      if (!record.error && !record.exited) poison('invalidObservation');
      for (const [event, listener] of listeners) guard(() => child.removeListener(event, listener));
    });
    const listeners = [['error', onError], ['exit', onExit], ['close', onClose], ['spawn', onSpawn]] as const;
    // Attach every lifecycle listener before reading any spawn metadata. A bad
    // listener hook must not stop the remaining listeners from being attempted.
    for (const [event, listener] of listeners) guard(() => child.on(event, listener));
    return record;
  }
  function onStart(message: unknown) {
    guard(() => {
      const payload = message as { process?: unknown; options?: unknown } | null;
      let child: unknown;
      try { child = payload?.process; }
      catch { unknownProcess = true; poison('callbackFailed'); return; }
      if (!(child instanceof ChildProcess)) {
        unknownProcess = true;
        poison('invalidObservation');
        return;
      }
      if (records.has(child)) { poison('duplicateObservation'); return; }
      const record = retain(child);
      released = false;
      if (launch !== 'pending' || gateClosed) poison('lateObservation');
      if (records.size !== 1) poison('duplicateObservation');
      checkWorkDeadline();
      if (child.pid !== undefined || child.exitCode !== null || child.signalCode !== null) poison('lateObservation');
      record.matches = matchesElectronSpawnObservation(child, payload?.options, expected);
      if (!record.matches) poison('metadataMismatch');
    });
    notify();
  }
  function settled(error?: Readonly<{ error: unknown }>) {
    launch = error === undefined ? 'fulfilled' : 'rejected';
    if (error !== undefined) { privateLaunchFailure = error; poison('launchRejected'); }
    if (records.size === 0) poison('missingObservation');
    guard(releaseIfClosed);
    notify();
  }

  // Only absolute deadlines from the caller's original budget are accepted.
  // Timeout ends this wait, never the listeners or the underlying launch.
  async function waitFor(kind: 'spawn' | 'close', deadline: number): Promise<void> {
    let cancel = () => {};
    let inspect = () => {};
    let finished = false;
    try {
      await new Promise<void>((resolve, reject) => {
        const fail = (code: ElectronSpawnObservationFailureCode) => {
          poison(code);
          finished = true;
          reject(new ElectronSpawnObservationFailure(code));
        };
        inspect = () => {
          if (finished) return;
          try {
            const bound = kind === 'close' ? Math.min(deadline, closeDeadline ?? deadline) : deadline;
            const remaining = bound - dependencies.now();
            if (!Number.isFinite(remaining) || remaining <= 0) {
              fail(kind === 'close' ? 'closeDeadlineExceeded'
                : records.size === 0 ? 'missingObservation' : 'deadlineExceeded');
              return;
            }
            if (kind === 'close') {
              if (allClosed() && launch !== 'pending') { finished = true; resolve(); }
            } else {
              const state = readState();
              if (state.failure !== null) fail(state.failure);
              else if (state.goEligible) { finished = true; resolve(); }
              else if (gateClosed) fail('invalidObservation');
            }
            if (!finished) {
              if (remaining > 2_147_483_647) { fail('inputInvalid'); return; }
              cancel();
              cancel = dependencies.schedule(inspect, Math.ceil(remaining));
            }
          } catch { fail('callbackFailed'); }
        };
        changed.add(inspect);
        inspect();
      });
    } catch (error) {
      if (error instanceof ElectronSpawnObservationFailure) throw error;
      poison('callbackFailed');
      throw new ElectronSpawnObservationFailure('callbackFailed');
    } finally {
      finished = true;
      changed.delete(inspect);
      guard(cancel);
    }
  }

  return Object.freeze({
    readState,
    // These accessors are private integration data, never report/artifact fields.
    readRetainedProcesses: (): readonly ChildProcess[] => Object.freeze([...records.keys()]),
    readPrivateLaunchFailure: () => privateLaunchFailure,
    requireGoCandidate() {
      const state = readState();
      const record = records.values().next().value;
      if (!state.goEligible || record?.pid === undefined) {
        poison(state.failure ?? 'missingObservation');
        notify();
        throw new ElectronSpawnObservationFailure(failure!);
      }
      return Object.freeze({ child: record.child, pid: record.pid,
        generation: expected.generation, launchNonce: expected.launchNonce });
    },
    stop() { poison('stopped'); notify(); },
    waitForSpawn: () => waitFor('spawn', expected.workDeadline),
    waitForClose(originalCloseDeadline: number) {
      // A repeated call may shorten the original bound, never restart it.
      // Resolution covers currently retained children and launch settlement,
      // not absence of future inherited async work or the native owner's tree.
      // Integration still needs its own terminal receipt and sealed GO gate.
      closeDeadline = Math.min(closeDeadline ?? originalCloseDeadline, originalCloseDeadline);
      notify();
      return waitFor('close', closeDeadline);
    },
    run<T>(start: () => Promise<T>): Promise<T> {
      if (launch !== 'notStarted' || gateClosed) {
        poison('launchReused');
        notify();
        throw new ElectronSpawnObservationFailure(failure!);
      }
      try { dependencies.assertVersions(); }
      catch { poison('versionUnverified'); throw new ElectronSpawnObservationFailure('versionUnverified'); }
      checkWorkDeadline();
      if (failure !== null) throw new ElectronSpawnObservationFailure(failure);
      try { subscribeDispatcher(); }
      catch { poison('subscriptionFailed'); throw new ElectronSpawnObservationFailure('subscriptionFailed'); }
      launch = 'pending';
      try {
        const promise = launchScope.run(context, start);
        // Observe without wrapping or replacing the original launch rejection.
        void promise.then(() => settled(), error => settled(Object.freeze({ error })));
        return promise;
      } catch (error) {
        settled(Object.freeze({ error }));
        throw error;
      }
    },
  });
}
