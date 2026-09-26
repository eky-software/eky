import type { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';

import { expect, test } from '@playwright/test';

import {
  observeChildProcessStartup,
  type E2eProcessStartupState,
} from '../../src/environment/e2eProcessStartupObservation.js';

const sourceEvents = ['spawn', 'exit', 'error', 'close'] as const;
const exitCases = [
  { name: 'zero exit code', exitCode: 0, signalCode: null },
  { name: 'nonzero exit code', exitCode: 7, signalCode: null },
  { name: 'signal', exitCode: null, signalCode: 'SIGTERM' },
] as const;

test.describe('native E2E process startup observation contract', () => {
  test('publishes frozen snapshots without mutating earlier observations', () => {
    const child = createFakeChild();
    const observation = observeChildProcessStartup(child);
    const initial = observation.readState();
    const states: E2eProcessStartupState[] = [];
    observation.subscribe((state) => states.push(state));

    expect(states).toEqual([]);
    expect(initial).toEqual({ spawnObserved: false, terminal: undefined });
    child.emit('spawn');
    const spawned = observation.readState();
    child.emit('exit', 0, null);
    const exited = observation.readState();

    expect(states).toEqual([
      { spawnObserved: true, terminal: undefined },
      { spawnObserved: true, terminal: 'exited' },
    ]);
    expect(states[0]).toBe(spawned);
    expect(states[1]).toBe(exited);
    expect(initial).toEqual({ spawnObserved: false, terminal: undefined });
    expect(spawned).toEqual({ spawnObserved: true, terminal: undefined });
    for (const snapshot of [initial, spawned, exited]) {
      expect(Object.isFrozen(snapshot)).toBe(true);
      expect(Reflect.set(snapshot, 'spawnObserved', !snapshot.spawnObserved)).toBe(false);
      expect(Reflect.set(snapshot, 'terminal', 'spawnFailed')).toBe(false);
      expect(Object.keys(snapshot).sort()).toEqual(['spawnObserved', 'terminal']);
    }
    child.emit('close', 0, null);
    expect(observation.readState()).toBe(exited);
    expectNoSourceListeners(child);
  });

  test('registers without an inline callback and reads an already observed spawn', () => {
    const child = createFakeChild();
    const observation = observeChildProcessStartup(child);
    child.emit('spawn');
    const states: E2eProcessStartupState[] = [];
    const unsubscribe = observation.subscribe((state) => states.push(state));

    expect(states).toEqual([]);
    expect(observation.readState()).toEqual({ spawnObserved: true, terminal: undefined });
    child.emit('exit', 0, null);
    expect(states).toEqual([{ spawnObserved: true, terminal: 'exited' }]);
    unsubscribe();
    child.emit('close', 0, null);
    expectNoSourceListeners(child);
  });

  test('keeps terminal state readable for subscriptions before and after close', () => {
    const child = createFakeChild();
    const observation = observeChildProcessStartup(child);
    child.emit('spawn');
    child.emit('error', new Error('synthetic transport failure'));
    const terminal = observation.readState();
    const states: E2eProcessStartupState[] = [];
    const unsubscribeBeforeClose = observation.subscribe((state) => states.push(state));

    expect(states).toEqual([]);
    expect(terminal).toEqual({ spawnObserved: true, terminal: 'observationLost' });
    child.emit('close', 0, null);
    const unsubscribeAfterClose = observation.subscribe((state) => states.push(state));
    expect(states).toEqual([]);
    expect(observation.readState()).toBe(terminal);
    unsubscribeBeforeClose();
    unsubscribeBeforeClose();
    unsubscribeAfterClose();
    unsubscribeAfterClose();
    expectNoSourceListeners(child);
  });

  for (const pid of [123, undefined]) {
    test(`uses the spawn event rather than a ${pid === undefined ? 'missing' : 'present'} PID`, () => {
      const child = createFakeChild({ pid });
      const observation = observeChildProcessStartup(child);

      expect(observation.readState()).toEqual({ spawnObserved: false, terminal: undefined });
      child.emit('spawn');
      expect(observation.readState()).toEqual({ spawnObserved: true, terminal: undefined });
      child.emit('exit', 0, null);
      child.emit('close', 0, null);
      expectNoSourceListeners(child);
    });
  }

  test('never reads the PID when attaching or observing events', () => {
    const child = createFakeChild();
    Object.defineProperty(child, 'pid', {
      get() { throw new Error('startup observation must not inspect a PID'); },
    });
    const observation = observeChildProcessStartup(child);

    child.emit('spawn');
    child.emit('error', new Error('synthetic transport failure'));
    child.emit('exit', 1, null);
    child.emit('close', 1, null);
    expect(observation.readState()).toEqual({ spawnObserved: true, terminal: 'observationLost' });
    expectNoSourceListeners(child);
  });

  for (const { name, exitCode, signalCode } of exitCases) {
    test(`reads an already terminal child with ${name} without inferring a spawn`, () => {
      const child = createFakeChild({ exitCode, signalCode, pid: 123 });
      const observation = observeChildProcessStartup(child);
      const states: E2eProcessStartupState[] = [];
      observation.subscribe((state) => states.push(state));

      expect(observation.readState()).toEqual({ spawnObserved: false, terminal: 'exited' });
      expect(states).toEqual([]);
      expect(() => child.emit('error', new Error('synthetic late error'))).not.toThrow();
      child.emit('close', exitCode, signalCode);
      expect(observation.readState()).toEqual({ spawnObserved: false, terminal: 'exited' });
      expect(states).toEqual([]);
      expectNoSourceListeners(child);
    });
  }

  test('latches a pre-spawn error through repeated errors, late spawn, exit and close', () => {
    const child = createFakeChild({ pid: 123 });
    const observation = observeChildProcessStartup(child);
    const states: E2eProcessStartupState[] = [];
    observation.subscribe((state) => states.push(state));

    child.emit('error', new Error('synthetic spawn failure'));
    const terminal = observation.readState();
    expect(terminal).toEqual({ spawnObserved: false, terminal: 'spawnFailed' });
    expect(child.listenerCount('error')).toBe(1);
    expect(() => child.emit('error', new Error('synthetic repeated error'))).not.toThrow();
    child.emit('spawn');
    child.emit('exit', 1, null);
    child.emit('close', 1, null);

    expect(observation.readState()).toBe(terminal);
    expect(states).toEqual([{ spawnObserved: false, terminal: 'spawnFailed' }]);
    expectNoSourceListeners(child);
  });

  test('latches post-spawn observation loss without claiming a later exit', () => {
    const child = createFakeChild();
    const observation = observeChildProcessStartup(child);
    child.emit('spawn');
    const states: E2eProcessStartupState[] = [];
    observation.subscribe((state) => states.push(state));

    child.emit('error', new Error('synthetic transport failure'));
    const terminal = observation.readState();
    expect(terminal).toEqual({ spawnObserved: true, terminal: 'observationLost' });
    expect(child.listenerCount('error')).toBe(1);
    expect(() => child.emit('error', new Error('synthetic repeated error'))).not.toThrow();
    child.emit('exit', 0, null);
    child.emit('close', 0, null);

    expect(observation.readState()).toBe(terminal);
    expect(states).toEqual([{ spawnObserved: true, terminal: 'observationLost' }]);
    expectNoSourceListeners(child);
  });

  for (const { name, exitCode, signalCode } of exitCases) {
    test(`retains the first exit with ${name} and handles errors until close`, () => {
      const child = createFakeChild();
      const observation = observeChildProcessStartup(child);
      child.emit('spawn');
      const states: E2eProcessStartupState[] = [];
      observation.subscribe((state) => states.push(state));
      child.emit('exit', exitCode, signalCode);
      const terminal = observation.readState();

      expect(terminal).toEqual({ spawnObserved: true, terminal: 'exited' });
      expect(child.listenerCount('error')).toBe(1);
      expect(child.listenerCount('close')).toBe(1);
      expect(() => child.emit('error', new Error('synthetic late error'))).not.toThrow();
      expect(() => child.emit('error', new Error('synthetic repeated error'))).not.toThrow();
      child.emit('close', exitCode, signalCode);

      expect(observation.readState()).toBe(terminal);
      expect(states).toEqual([{ spawnObserved: true, terminal: 'exited' }]);
      expectNoSourceListeners(child);
    });
  }

  for (const spawnObserved of [false, true]) {
    test(`treats close without exit or error as observation loss with spawn=${spawnObserved}`, () => {
      const child = createFakeChild();
      const observation = observeChildProcessStartup(child);
      if (spawnObserved) child.emit('spawn');
      const states: E2eProcessStartupState[] = [];
      observation.subscribe((state) => states.push(state));

      child.emit('close', 0, null);

      expect(observation.readState()).toEqual({ spawnObserved, terminal: 'observationLost' });
      expect(states).toEqual([{ spawnObserved, terminal: 'observationLost' }]);
      expectNoSourceListeners(child);
    });
  }

  test('unsubscribes idempotently without removing the bounded native observers', () => {
    const child = createFakeChild();
    const observation = observeChildProcessStartup(child);
    const removedStates: E2eProcessStartupState[] = [];
    for (let index = 0; index < 20; index += 1) {
      const unsubscribe = observation.subscribe((state) => removedStates.push(state));
      unsubscribe();
      unsubscribe();
    }
    for (const event of sourceEvents) expect(child.listenerCount(event)).toBe(1);

    const activeStates: E2eProcessStartupState[] = [];
    const unsubscribe = observation.subscribe((state) => activeStates.push(state));
    child.emit('spawn');
    expect(removedStates).toEqual([]);
    expect(activeStates).toEqual([{ spawnObserved: true, terminal: undefined }]);
    unsubscribe();
    expect(child.listenerCount('error')).toBe(1);
    expect(() => child.emit('error', new Error('synthetic post-handoff error'))).not.toThrow();
    expect(observation.readState()).toEqual({ spawnObserved: true, terminal: 'observationLost' });
    expect(activeStates).toHaveLength(1);
    child.emit('close', null, null);
    expectNoSourceListeners(child);
  });

  test('allows a subscriber to unsubscribe itself during notification', () => {
    const child = createFakeChild();
    const observation = observeChildProcessStartup(child);
    const removedStates: E2eProcessStartupState[] = [];
    const activeStates: E2eProcessStartupState[] = [];
    const unsubscribe = observation.subscribe((state) => {
      removedStates.push(state);
      unsubscribe();
    });
    observation.subscribe((state) => activeStates.push(state));

    child.emit('spawn');
    child.emit('exit', 0, null);
    child.emit('close', 0, null);

    expect(removedStates).toEqual([{ spawnObserved: true, terminal: undefined }]);
    expect(activeStates).toEqual([
      { spawnObserved: true, terminal: undefined },
      { spawnObserved: true, terminal: 'exited' },
    ]);
    expectNoSourceListeners(child);
  });

  test('removes only its own native listeners on close', () => {
    const child = createFakeChild();
    const otherListener = () => undefined;
    for (const event of sourceEvents) child.on(event, otherListener);
    const observation = observeChildProcessStartup(child);
    for (const event of sourceEvents) expect(child.listenerCount(event)).toBe(2);

    child.emit('spawn');
    child.emit('exit', 0, null);
    child.emit('close', 0, null);

    expect(observation.readState()).toEqual({ spawnObserved: true, terminal: 'exited' });
    for (const event of sourceEvents) {
      expect(child.listeners(event)).toEqual([otherListener]);
      child.removeListener(event, otherListener);
    }
    expectNoSourceListeners(child);
  });

  test('latches close-only loss and releases native listeners even when notification throws', () => {
    const child = createFakeChild();
    const observation = observeChildProcessStartup(child);
    const notificationFailure = new Error('synthetic subscriber failure');
    const unsubscribe = observation.subscribe(() => { throw notificationFailure; });

    try {
      child.emit('close', 0, null);
    } catch (error) {
      // Exception propagation is separate from the mandatory close cleanup.
      expect(error).toBe(notificationFailure);
    }

    expect(observation.readState()).toEqual({ spawnObserved: false, terminal: 'observationLost' });
    expect(Object.isFrozen(observation.readState())).toBe(true);
    unsubscribe();
    unsubscribe();
    expectNoSourceListeners(child);
  });
});

function createFakeChild(input: {
  readonly exitCode?: number | null;
  readonly signalCode?: NodeJS.Signals | null;
  readonly pid?: number | undefined;
} = {}): ChildProcess {
  return Object.assign(new EventEmitter(), {
    exitCode: input.exitCode ?? null,
    signalCode: input.signalCode ?? null,
    pid: input.pid,
  }) as ChildProcess;
}

function expectNoSourceListeners(child: ChildProcess): void {
  for (const event of sourceEvents) {
    expect(child.listenerCount(event), event).toBe(0);
  }
}
