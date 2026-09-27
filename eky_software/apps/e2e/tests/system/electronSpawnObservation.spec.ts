import { AsyncResource } from 'node:async_hooks';
import { ChildProcess } from 'node:child_process';
import { channel } from 'node:diagnostics_channel';
import { EventEmitter } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test } from '@playwright/test';

import {
  createElectronSpawnObservation, electronSpawnStartChannel, ElectronSpawnObservationFailure,
} from '../../src/environment/electronSpawnObservation.js';
import type { ElectronSpawnObservationBinding } from '../../src/environment/electronSpawnObservationBinding.js';
import {
  assertElectronSpawnObservationVersions, readElectronSpawnObservationVersions,
  verifiedElectronSpawnNodeVersion, verifiedElectronSpawnPlaywrightVersion,
} from '../../src/environment/electronSpawnObservationVersions.js';

const binding: ElectronSpawnObservationBinding = {
  executable: join(tmpdir(), 'eky-unexecuted-bridge.exe'), cwd: join(tmpdir(), 'eky-uncreated-observation'),
  generation: 'a'.repeat(64), launchNonce: 'b'.repeat(64),
  generationEnvironmentKey: 'EKY_SYNTHETIC_GENERATION', nonceEnvironmentKey: 'EKY_SYNTHETIC_NONCE',
};
const source = channel(electronSpawnStartChannel);
const events = ['spawn', 'error', 'exit', 'close'] as const;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

// An actual ChildProcess prototype with inert EventEmitter state, never an OS
// process or a call to the ChildProcess constructor/spawn implementation.
function childProcess(expected = binding): ChildProcess {
  const child = Object.assign(new EventEmitter(), {
    spawnfile: expected.executable, pid: undefined as number | undefined,
    exitCode: null, signalCode: null,
    kill() { throw new Error('PROCESS_KILL_FORBIDDEN'); },
    spawn() { throw new Error('PROCESS_SPAWN_FORBIDDEN'); },
  });
  Object.setPrototypeOf(child, ChildProcess.prototype);
  return child as unknown as ChildProcess;
}

function metadata(expected = binding) {
  return Object.freeze({
    file: expected.executable, cwd: expected.cwd,
    args: Object.freeze([expected.executable, 'synthetic-private-argument']),
    envPairs: Object.freeze([
      `${expected.generationEnvironmentKey}=${expected.generation}`,
      `${expected.nonceEnvironmentKey}=${expected.launchNonce}`,
    ]),
  });
}

function harness(expected = binding, overrides: Parameters<typeof createElectronSpawnObservation>[1] = {}) {
  let now = 10;
  const timers = new Set<{ callback: () => void; milliseconds: number }>();
  const observation = createElectronSpawnObservation({ ...expected, workDeadline: 100 }, {
    assertVersions() {}, now: () => now,
    schedule(callback, milliseconds) {
      const timer = { callback, milliseconds };
      timers.add(timer);
      return () => { timers.delete(timer); };
    },
    ...overrides,
  });
  const child = childProcess(expected);
  const publish = (options: unknown = metadata(expected), target = child) =>
    source.publish(Object.freeze({ process: target, options }));
  const spawn = (target = child) => { Object.assign(target, { pid: 123 }); target.emit('spawn'); };
  const close = (target = child) => { target.emit('exit', 0, null); target.emit('close', 0, null); };
  return { observation, child, publish, spawn, close, timers,
    setNow(value: number) { now = value; },
    fireTimers() {
      for (const timer of [...timers]) { timers.delete(timer); timer.callback(); }
    },
  };
}

test.describe('bounded early Electron spawn observation @security', () => {
  test('retains the exact child and all listeners before interpreting metadata without mutation', async () => {
    const h = harness();
    const options = metadata();
    const sentinel = () => {};
    for (const event of events) h.child.on(event, sentinel);
    const launch = h.observation.run(() => {
      source.publish(Object.freeze({ process: h.child, get options() {
        expect(h.observation.readRetainedProcesses()).toEqual([h.child]);
        for (const event of events) expect(h.child.listenerCount(event)).toBe(2);
        return options;
      } }));
      return Promise.resolve('launched');
    });
    expect(h.observation.readState().goEligible).toBe(false);
    h.spawn();
    await h.observation.waitForSpawn();
    expect(h.observation.requireGoCandidate()).toEqual({ child: h.child, pid: 123,
      generation: binding.generation, launchNonce: binding.launchNonce });
    expect(await launch).toBe('launched');
    expect(options).toEqual(metadata());
    h.child.emit('exit', 0, null);
    expect(h.observation.readState()).toMatchObject({ exitObserved: true, closeObserved: false, goEligible: false });
    for (const event of events) expect(h.child.listenerCount(event)).toBe(2);
    const closed = h.observation.waitForClose(120);
    h.child.emit('close', 0, null);
    await closed;
    expect(h.observation.readState()).toMatchObject({ closeObserved: true, released: true });
    for (const event of events) expect(h.child.listeners(event)).toEqual([sentinel]);
    expect(h.timers.size).toBe(0);
  });

  test('isolates concurrent ALS launches and ignores an unscoped sibling with identical metadata', async () => {
    const first = harness();
    const second = harness({ ...binding, generation: 'c'.repeat(64), launchNonce: 'd'.repeat(64) });
    const firstReady = deferred<void>();
    const secondReady = deferred<void>();
    const a = first.observation.run(async () => { await firstReady.promise; first.publish(); return 'a'; });
    const b = second.observation.run(async () => { await secondReady.promise; second.publish(); return 'b'; });
    const sibling = childProcess();
    source.publish({ process: sibling, options: metadata() });
    for (const event of events) expect(sibling.listenerCount(event)).toBe(0);
    secondReady.resolve();
    await b;
    firstReady.resolve();
    await a;
    expect(first.observation.readRetainedProcesses()).toEqual([first.child]);
    expect(second.observation.readRetainedProcesses()).toEqual([second.child]);
    first.spawn(); second.spawn();
    expect(first.observation.requireGoCandidate().generation).toBe(binding.generation);
    expect(second.observation.requireGoCandidate().generation).toBe('c'.repeat(64));
    first.close(); second.close();
    await first.observation.waitForClose(120);
    await second.observation.waitForClose(120);
  });

  test('keeps the original failed-launch error separate from before-OS failure and close', async () => {
    const h = harness();
    const primary = new Error('synthetic private launch path/args/env');
    const pending = deferred<void>();
    const returned = h.observation.run(() => { h.publish(); return pending.promise; });
    expect(returned).toBe(pending.promise);
    const failed = expect(returned).rejects.toBe(primary);
    h.child.emit('error', Object.assign(new Error('private spawn failure'), { code: 'ENOENT' }));
    pending.reject(primary);
    await failed;
    expect(h.observation.readPrivateLaunchFailure()?.error).toBe(primary);
    expect(h.observation.readState()).toMatchObject({ launch: 'rejected', failure: 'spawnFailed',
      spawnObserved: false, errorObserved: true, exitObserved: false, closeObserved: false });
    const closed = h.observation.waitForClose(120);
    expect(() => h.child.emit('error', primary)).not.toThrow();
    expect(h.observation.readState().closeObserved).toBe(false);
    h.child.emit('close', -2, null);
    await closed;
    expect(h.observation.readState()).toMatchObject({ closeObserved: true, spawnObserved: false, exitObserved: false });
    expect(JSON.stringify(h.observation.readState())).not.toContain('private');
    for (const event of events) expect(h.child.listenerCount(event)).toBe(0);
  });

  test('does not infer closure from a pending, fulfilled or rejected launch promise', async () => {
    for (const outcome of ['pending', 'fulfilled', 'rejected'] as const) {
      const h = harness();
      const pending = deferred<void>();
      const launched = h.observation.run(() => { h.publish(); return pending.promise; });
      const handled = launched.catch(() => undefined);
      if (outcome === 'fulfilled') pending.resolve();
      if (outcome === 'rejected') pending.reject(new Error('synthetic'));
      if (outcome !== 'pending') await handled;
      const wait = h.observation.waitForClose(120);
      const failed = expect(wait).rejects.toMatchObject({ code: 'closeDeadlineExceeded' });
      h.setNow(120); h.fireTimers();
      await failed;
      expect(h.observation.readState().closeObserved).toBe(false);
      for (const event of events) expect(h.child.listenerCount(event)).toBe(1);
      h.close();
      pending.resolve();
      await handled;
      expect(h.observation.readState().released).toBe(true);
    }
  });

  test('retains the subscription while a closed child still has a pending launch', async () => {
    const h = harness();
    const pending = deferred<void>();
    const launched = h.observation.run(() => { h.publish(); return pending.promise; });
    h.close();
    expect(h.observation.readState()).toMatchObject({ closeObserved: true, released: false });
    const closed = h.observation.waitForClose(120);
    pending.resolve();
    await launched; await closed;
    expect(h.observation.readState().released).toBe(true);
  });

  for (const mutation of ['file', 'cwd', 'generation', 'nonce', 'duplicate-key', 'case-key', 'child-file'] as const) {
    test(`retains but rejects mismatched ${mutation} metadata`, async () => {
      const h = harness();
      const options = { ...metadata(), envPairs: [...metadata().envPairs] };
      if (mutation === 'file') options.file = 'relative.exe';
      if (mutation === 'cwd') options.cwd += '-other';
      if (mutation === 'generation') options.envPairs[0] = `${binding.generationEnvironmentKey}=${'f'.repeat(64)}`;
      if (mutation === 'nonce') options.envPairs[1] = `${binding.nonceEnvironmentKey}=${'f'.repeat(64)}`;
      if (mutation === 'duplicate-key') options.envPairs.push(options.envPairs[0]!);
      if (mutation === 'case-key') options.envPairs[0] = options.envPairs[0]!.toLowerCase();
      if (mutation === 'child-file') Object.assign(h.child, { spawnfile: h.child.spawnfile + '-other' });
      await h.observation.run(() => { h.publish(options); return Promise.resolve(); });
      h.spawn();
      expect(h.observation.readRetainedProcesses()).toEqual([h.child]);
      expect(h.observation.readState()).toMatchObject({ failure: 'metadataMismatch', goEligible: false });
      expect(() => h.observation.requireGoCandidate()).toThrow(ElectronSpawnObservationFailure);
      h.close(); await h.observation.waitForClose(120);
    });
  }

  for (const duplicateChild of [false, true]) {
    test(`poisons duplicate start with ${duplicateChild ? 'another' : 'the same'} child and waits for every close`, async () => {
      const h = harness();
      const second = duplicateChild ? childProcess() : h.child;
      await h.observation.run(() => {
        h.publish(); h.publish(metadata(), second);
        return Promise.resolve();
      });
      expect(h.observation.readState().failure).toBe('duplicateObservation');
      for (const event of events) expect(h.child.listenerCount(event)).toBe(1);
      h.spawn(); h.close();
      if (duplicateChild) {
        expect(h.observation.readState().closeObserved).toBe(false);
        h.close(second);
      }
      await h.observation.waitForClose(120);
      expect(h.observation.readState().goEligible).toBe(false);
    });
  }

  test('missing observation expires at the original deadline and a late child cannot repair it', async () => {
    const h = harness();
    const ready = deferred<void>();
    const launched = h.observation.run(async () => { await ready.promise; h.publish(); });
    const waiting = h.observation.waitForSpawn();
    expect([...h.timers][0]?.milliseconds).toBe(90);
    const failed = expect(waiting).rejects.toMatchObject({ code: 'missingObservation' });
    h.setNow(100); h.fireTimers(); await failed;
    ready.resolve(); await launched;
    h.spawn();
    expect(h.observation.readState()).toMatchObject({ failure: 'missingObservation', goEligible: false });
    h.close(); await h.observation.waitForClose(120);
  });

  test('a start after launch settlement is retained but never eligible', async () => {
    const h = harness();
    let late!: () => void;
    await h.observation.run(() => {
      h.publish();
      late = AsyncResource.bind(() => h.publish(metadata(), second));
      return Promise.resolve();
    });
    const second = childProcess();
    late();
    expect(h.observation.readState().goEligible).toBe(false);
    h.close(); h.close(second);
    await h.observation.waitForClose(120);
  });

  test('still retains an asynchronously inherited late spawn after launch settlement and the first close', async () => {
    const h = harness();
    const later = deferred<void>();
    const second = childProcess();
    let late!: Promise<void>;
    await h.observation.run(() => {
      h.publish();
      late = later.promise.then(() => h.publish(metadata(), second));
      return Promise.resolve();
    });
    h.spawn(); h.close();
    await h.observation.waitForClose(120);
    expect(h.observation.readState()).toMatchObject({ released: true, closeObserved: true });
    later.resolve(); await late;
    expect(h.observation.readRetainedProcesses()).toEqual([h.child, second]);
    expect(h.observation.readState()).toMatchObject({ released: false, closeObserved: false,
      failure: 'lateObservation', goEligible: false });
    for (const event of events) expect(second.listenerCount(event)).toBe(1);
    h.spawn(second); h.close(second);
    await h.observation.waitForClose(120);
    expect(h.observation.readState()).toMatchObject({ released: true, closeObserved: true, goEligible: false });
  });

  test('a throwing metadata accessor cannot lose the retained child or throw from the channel', async () => {
    const h = harness();
    const raw = new Error('synthetic private callback path/args/env');
    await h.observation.run(() => {
      expect(() => source.publish({ process: h.child, get options() { throw raw; } })).not.toThrow();
      return Promise.resolve();
    });
    expect(h.observation.readRetainedProcesses()).toEqual([h.child]);
    expect(h.observation.readState()).toMatchObject({ failure: 'callbackFailed', goEligible: false });
    expect(() => h.child.emit('error', raw)).not.toThrow();
    h.close(); await h.observation.waitForClose(120);
  });

  test('a throwing spawn callback poisons observation without replacing the original launch error', async () => {
    const h = harness();
    const pending = deferred<void>();
    const primary = new Error('synthetic original error');
    const launched = h.observation.run(() => { h.publish(); return pending.promise; });
    Object.defineProperty(h.child, 'pid', { get() { throw new Error('synthetic private PID accessor'); } });
    expect(() => h.child.emit('spawn')).not.toThrow();
    const rejected = expect(launched).rejects.toBe(primary);
    pending.reject(primary); await rejected;
    expect(h.observation.readPrivateLaunchFailure()?.error).toBe(primary);
    expect(h.observation.readState().failure).toBe('callbackFailed');
    h.close(); await h.observation.waitForClose(120);
  });

  test('a process getter failure is safe and cannot certify closure of an unknown child', async () => {
    const h = harness();
    await h.observation.run(() => {
      h.publish();
      expect(() => source.publish({ get process() { throw new Error('synthetic private process'); } })).not.toThrow();
      return Promise.resolve();
    });
    h.close();
    expect(h.observation.readState()).toMatchObject({ failure: 'callbackFailed', closeObserved: false, released: false });
    const waiting = h.observation.waitForClose(120);
    const failed = expect(waiting).rejects.toMatchObject({ code: 'closeDeadlineExceeded' });
    h.setNow(120); h.fireTimers(); await failed;
  });

  test('an invalid process payload poisons observation even alongside a valid closed child', async () => {
    for (const invalid of [undefined, null, {}, new EventEmitter()]) {
      const h = harness();
      await h.observation.run(() => {
        h.publish();
        expect(() => source.publish({ process: invalid, options: metadata() })).not.toThrow();
        return Promise.resolve();
      });
      h.spawn(); h.close();
      expect(h.observation.readRetainedProcesses()).toEqual([h.child]);
      expect(h.observation.readState()).toMatchObject({ failure: 'invalidObservation',
        closeObserved: false, released: false, goEligible: false });
      const waiting = h.observation.waitForClose(120);
      const failed = expect(waiting).rejects.toMatchObject({ code: 'closeDeadlineExceeded' });
      h.setNow(120); h.fireTimers(); await failed;
    }
  });

  test('a listener attachment fault still attempts error, exit and close listeners', async () => {
    const h = harness();
    h.child.on('newListener', event => {
      if (event === 'spawn') throw new Error('synthetic listener attachment failure');
    });
    await h.observation.run(() => {
      expect(() => h.publish()).not.toThrow();
      return Promise.resolve();
    });
    for (const event of ['error', 'exit', 'close']) expect(h.child.listenerCount(event)).toBe(1);
    expect(h.observation.readState()).toMatchObject({ failure: 'callbackFailed', goEligible: false });
    h.close(); await h.observation.waitForClose(120);
  });

  test('a partial lifecycle-listener hook throw retains the child and still installs the later close listener', async () => {
    const h = harness();
    h.child.on('newListener', event => {
      if (event === 'exit') throw new Error('synthetic mid-attachment failure');
    });
    await h.observation.run(() => {
      expect(() => h.publish()).not.toThrow();
      return Promise.resolve();
    });
    expect(h.observation.readRetainedProcesses()).toEqual([h.child]);
    expect(h.child.listenerCount('error')).toBe(1);
    expect(h.child.listenerCount('exit')).toBe(0);
    expect(h.child.listenerCount('close')).toBe(1);
    expect(h.child.listenerCount('spawn')).toBe(1);
    expect(h.observation.readState()).toMatchObject({ failure: 'callbackFailed', goEligible: false });
    expect(() => h.child.emit('error', new Error('synthetic before-OS error'))).not.toThrow();
    h.child.emit('close', -2, null);
    await h.observation.waitForClose(120);
    expect(h.observation.readState()).toMatchObject({ errorObserved: true, exitObserved: false, closeObserved: true });
    for (const event of events) expect(h.child.listenerCount(event)).toBe(0);
  });

  test('a listener removal callback fault never escapes close or permits GO', async () => {
    const h = harness();
    await h.observation.run(() => { h.publish(); return Promise.resolve(); });
    h.child.on('removeListener', () => { throw new Error('synthetic private callback'); });
    expect(() => h.close()).not.toThrow();
    expect(h.observation.readState()).toMatchObject({ failure: 'callbackFailed', closeObserved: true, goEligible: false });
    for (const event of events) expect(h.child.listenerCount(event)).toBe(0);
    await h.observation.waitForClose(120);
  });

  test('an already started child is retained but its observation is late', async () => {
    const h = harness();
    Object.assign(h.child, { pid: 123 });
    await h.observation.run(() => { h.publish(); return Promise.resolve(); });
    h.spawn();
    expect(h.observation.readState()).toMatchObject({ failure: 'lateObservation', goEligible: false });
    h.close(); await h.observation.waitForClose(120);
  });

  for (const event of ['spawn', 'error', 'close'] as const) {
    test(`invalid or terminal ${event} cannot reopen successful spawn eligibility`, async () => {
      const h = harness();
      await h.observation.run(() => { h.publish(); return Promise.resolve(); });
      h.spawn();
      expect(h.observation.readState().goEligible).toBe(true);
      if (event === 'error') h.child.emit(event, new Error('synthetic private process error'));
      else h.child.emit(event);
      expect(h.observation.readState().goEligible).toBe(false);
      if (event !== 'close') h.close();
      await h.observation.waitForClose(120);
    });
  }

  test('timer callback failure rejects safely without dropping process listeners', async () => {
    let failClock = false;
    const h = harness(binding, { now() { if (failClock) throw new Error('synthetic private clock'); return 10; } });
    await h.observation.run(() => { h.publish(); return Promise.resolve(); });
    const waiting = h.observation.waitForSpawn();
    const failed = expect(waiting).rejects.toMatchObject({ code: 'callbackFailed' });
    failClock = true;
    expect(() => h.fireTimers()).not.toThrow();
    await failed;
    for (const event of events) expect(h.child.listenerCount(event)).toBe(1);
    failClock = false;
    h.close(); await h.observation.waitForClose(120);
  });

  test('stop is permanent before and after successful spawn', async () => {
    const h = harness();
    await h.observation.run(() => { h.publish(); return Promise.resolve(); });
    h.observation.stop(); h.spawn();
    expect(() => h.observation.requireGoCandidate()).toThrow(/stopped/);
    h.close(); await h.observation.waitForClose(120);
    const stopped = harness();
    stopped.observation.stop();
    expect(() => stopped.observation.run(() => { throw new Error('must not launch'); })).toThrow(/stopped/);
  });

  test('one launch context cannot be reused', async () => {
    const h = harness();
    await h.observation.run(() => { h.publish(); return Promise.resolve(); });
    expect(() => h.observation.run(() => { throw new Error('must not launch twice'); })).toThrow(/launchReused/);
    h.close(); await h.observation.waitForClose(120);
  });

  test('a synchronous launch exception remains identical and missing observation is not closure', () => {
    const h = harness();
    const primary = new Error('synthetic original exception');
    expect(() => h.observation.run(() => { throw primary; })).toThrow(primary);
    expect(h.observation.readPrivateLaunchFailure()?.error).toBe(primary);
    expect(h.observation.readState()).toMatchObject({ launch: 'rejected', closeObserved: false, goEligible: false });
  });

  test('the remaining absolute wait shrinks and an early timer cannot create a new budget', async () => {
    const h = harness();
    const ready = deferred<void>();
    const launched = h.observation.run(async () => { await ready.promise; h.publish(); });
    h.setNow(80);
    const waiting = h.observation.waitForSpawn();
    expect([...h.timers][0]?.milliseconds).toBe(20);
    h.setNow(99); h.fireTimers();
    expect([...h.timers][0]?.milliseconds).toBe(1);
    const failed = expect(waiting).rejects.toMatchObject({ code: 'missingObservation' });
    h.setNow(100); h.fireTimers(); await failed;
    expect(h.timers.size).toBe(0);
    ready.resolve(); await launched;
    h.close(); await h.observation.waitForClose(120);
  });

  test('close waits share a shortening bound and cannot accept a later replacement deadline', async () => {
    const h = harness();
    await h.observation.run(() => { h.publish(); return Promise.resolve(); });
    const first = h.observation.waitForClose(200);
    const second = h.observation.waitForClose(120);
    expect([...h.timers].map(timer => timer.milliseconds)).toEqual([110, 110]);
    const firstFailed = expect(first).rejects.toMatchObject({ code: 'closeDeadlineExceeded' });
    const secondFailed = expect(second).rejects.toMatchObject({ code: 'closeDeadlineExceeded' });
    h.setNow(120); h.fireTimers(); await firstFailed; await secondFailed;
    h.close();
    await expect(h.observation.waitForClose(1_000)).rejects.toMatchObject({ code: 'closeDeadlineExceeded' });
    expect(h.timers.size).toBe(0);
    expect(h.observation.readState()).toMatchObject({ failure: 'closeDeadlineExceeded', closeObserved: true });
  });

  test('a later close deadline cannot extend an already pending close wait', async () => {
    const h = harness();
    await h.observation.run(() => { h.publish(); return Promise.resolve(); });
    const first = h.observation.waitForClose(120);
    h.setNow(40);
    const later = h.observation.waitForClose(200);
    expect([...h.timers].map(timer => timer.milliseconds)).toEqual([80, 80]);
    const firstFailed = expect(first).rejects.toMatchObject({ code: 'closeDeadlineExceeded' });
    const laterFailed = expect(later).rejects.toMatchObject({ code: 'closeDeadlineExceeded' });
    h.setNow(120); h.fireTimers(); await firstFailed; await laterFailed;
    h.close();
    expect(h.observation.readState()).toMatchObject({ failure: 'closeDeadlineExceeded', closeObserved: true });
    expect(h.timers.size).toBe(0);
  });

  test('work deadline and version failures refuse to call launch', () => {
    const expired = harness();
    expired.setNow(100);
    expect(() => expired.observation.run(() => { throw new Error('must not launch'); })).toThrow(/deadlineExceeded/);
    const mismatch = harness(binding, { assertVersions() { throw new Error('private installed path'); } });
    expect(() => mismatch.observation.run(() => { throw new Error('must not launch'); })).toThrow(/versionUnverified/);
    expect(mismatch.observation.readState()).toMatchObject({ launch: 'notStarted', failure: 'versionUnverified' });
  });

  test('validates pins and installations against the explicit verified contract baseline', () => {
    const evidence = readElectronSpawnObservationVersions();
    expect(evidence.nodePin).toBe(verifiedElectronSpawnNodeVersion);
    expect(evidence.playwrightPin).toBe(verifiedElectronSpawnPlaywrightVersion);
    expect(() => assertElectronSpawnObservationVersions()).not.toThrow();
    for (const changed of [
      { ...evidence, nodeVersion: '0.0.0' },
      { ...evidence, nodePin: '^' + evidence.nodePin },
      { ...evidence, playwrightPin: '^' + evidence.playwrightPin },
      { ...evidence, nodePin: '99.0.0', nodeVersion: '99.0.0' },
      { ...evidence, playwrightPin: '99.0.0', playwrightVersions: ['99.0.0', '99.0.0', '99.0.0'] },
      ...evidence.playwrightVersions.map((_, index) => ({ ...evidence,
        playwrightVersions: evidence.playwrightVersions.map((value, slot) => slot === index ? '0.0.0' : value) })),
    ]) {
      expect(() => assertElectronSpawnObservationVersions(() => changed)).toThrow('E2E_ELECTRON_OBSERVATION_VERSION_UNVERIFIED');
    }
    expect(() => assertElectronSpawnObservationVersions(() => { throw new Error('private path'); }))
      .toThrow('E2E_ELECTRON_OBSERVATION_VERSION_UNVERIFIED');
  });

  test('invalid binding and invalid deadlines fail with safe codes', () => {
    for (const change of [
      { executable: 'relative.exe' }, { cwd: 'relative' }, { generation: 'invalid' }, { launchNonce: 'invalid' },
      { generationEnvironmentKey: binding.nonceEnvironmentKey }, { workDeadline: NaN },
    ]) {
      expect(() => createElectronSpawnObservation({ ...binding, workDeadline: 100, ...change }))
        .toThrow('E2E_ELECTRON_SPAWN_OBSERVATION_inputInvalid');
    }
  });
});
