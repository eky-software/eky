import { expect, test } from '@playwright/test';

import {
  backendServiceFrameBytes, backendServiceProtocol, createBackendServiceFrameReader,
  encodeBackendServiceRequest, validateBackendServiceReply,
} from '../../src/environment/windowsBackendServiceProtocol.js';

const generation = 'a'.repeat(64);
const error = 'E2E_BACKEND_OWNER_PROTOCOL_INVALID';
const snapshot = () => ({
  protocol: backendServiceProtocol, schemaVersion: 1, generation, sequence: 1, replyTo: 1,
  kind: 'started', rssBytes: null, elapsedMilliseconds: 200,
  cleanupStartedElapsedMilliseconds: null, remainingCleanupMilliseconds: null,
  state: {
    created: true, started: true, creationCompleted: true, launchClosed: true,
    identity: { pid: 42, creationTimeFileTimeHex: '0123456789abcdef' },
    workload: 'running', exitCode: null, assignedBeforeResume: true, activeProcesses: 1,
    stdioSettled: false, firstFailure: null, cleanup: 'pending', cleanupFailure: null,
  },
});
const terminal = () => ({
  ...snapshot(), kind: 'terminal', cleanupStartedElapsedMilliseconds: 100, remainingCleanupMilliseconds: 2_900,
  state: { ...snapshot().state, workload: 'exited', exitCode: 0, activeProcesses: 0,
    stdioSettled: true, cleanup: 'processTreeAbsent' },
});
const validate = (value: unknown) => validateBackendServiceReply(value, generation, 0);

test.describe('Windows backend service wire', () => {
  test('binds the actual launch identity and freezes the accepted snapshot', () => {
    const accepted = validate(snapshot());
    expect(accepted.state.identity?.pid).toBe(42);
    expect(Object.isFrozen(accepted)).toBe(true);
    expect(Object.isFrozen(accepted.state)).toBe(true);
    expect(Object.isFrozen(accepted.state.identity)).toBe(true);
  });
  test('keeps failed launch and proven empty cleanup independent', () => {
    const value = terminal();
    const state = { ...value.state, created: false, started: false, identity: null,
      workload: 'pending', exitCode: null, assignedBeforeResume: false, firstFailure: 'processStartFailed' };
    expect(validate({ ...value, state }).state).toMatchObject({
      firstFailure: 'processStartFailed', cleanup: 'processTreeAbsent', created: false,
    });
  });
  test('keeps unknown cleanup observations unknown', () => {
    const value = terminal();
    expect(validate({ ...value, state: { ...value.state, workload: 'unavailable', exitCode: null,
      activeProcesses: null, cleanup: 'cleanupUnverified', cleanupFailure: 'observationLost' } }).state.activeProcesses)
      .toBeNull();
  });
  test('root exit can precede descendants and is not absence', () => {
    const value = snapshot();
    expect(validate({ ...value, replyTo: null, kind: 'rootExit',
      state: { ...value.state, workload: 'exited', exitCode: 29, activeProcesses: 2 } }).state.cleanup).toBe('pending');
  });
  test('accepts fresh RSS only for a running workload', () => {
    expect(validate({ ...snapshot(), kind: 'rss', rssBytes: 123_456 }).rssBytes).toBe(123_456);
    expect(validate({ ...snapshot(), kind: 'rss', rssBytes: null }).rssBytes).toBeNull();
    expect(() => validate({ ...snapshot(), kind: 'rss', rssBytes: 0 })).toThrow(error);
    expect(() => validate({ ...snapshot(), kind: 'rss', rssBytes: 123,
      state: { ...snapshot().state, workload: 'exited', exitCode: 0 } })).toThrow(error);
  });
  for (const [name, changes] of Object.entries({
    version: { schemaVersion: 2 }, protocol: { protocol: 'another' },
    generation: { generation: 'b'.repeat(64) }, skippedSequence: { sequence: 2 },
    staleSequence: { sequence: 0 }, unsolicitedStarted: { replyTo: null },
    extraField: { privatePath: 'PRIVATE_DETAIL' }, invalidKindType: { kind: ['started'] },
    invalidTiming: { remainingCleanupMilliseconds: 100 }, invalidRSS: { rssBytes: 12 },
    negativeElapsed: { elapsedMilliseconds: -1 }, unsafeElapsed: { elapsedMilliseconds: Number.MAX_SAFE_INTEGER },
  })) {
    test(`rejects ${name} without echoing the payload`, () => {
      expect(() => validate({ ...snapshot(), ...changes })).toThrow(error);
    });
  }
  test('rejects cleanup timing that invents time or precedes its own origin', () => {
    expect(() => validate({ ...terminal(), elapsedMilliseconds: 99 })).toThrow(error);
    expect(() => validate({ ...terminal(), elapsedMilliseconds: 201 })).toThrow(error);
  });
  for (const [name, changes] of Object.entries({
    liveRoot: { workload: 'running', exitCode: null }, descendants: { activeProcesses: 1 },
    unknownJob: { activeProcesses: null }, openLaunch: { launchClosed: false },
    unsettledCreation: { creationCompleted: false }, unsettledStdio: { stdioSettled: false },
    cleanupFailure: { cleanupFailure: 'observationLost' },
  })) {
    test(`rejects tree absence with ${name}`, () => {
      const value = terminal();
      expect(() => validate({ ...value, state: { ...value.state, ...changes } })).toThrow(error);
    });
  }
  test('does not accept an incomplete launch or missing identity as started', () => {
    for (const state of [
      { identity: null }, { assignedBeforeResume: false }, { created: false },
      { identity: { pid: 42, creationTimeFileTimeHex: '0000000000000000' } },
      { firstFailure: 'PRIVATE_DETAIL' }, { workload: ['running'] },
    ]) expect(() => validate({ ...snapshot(), state: { ...snapshot().state, ...state } })).toThrow(error);
  });
  test('launch alone accepts a bound nonce and deadline, not an arbitrary command', () => {
    expect(JSON.parse(encodeBackendServiceRequest(generation, 1, 'launch', 'b'.repeat(64), 49_000).toString()))
      .toEqual({ protocol: backendServiceProtocol, schemaVersion: 1, generation, sequence: 1,
        kind: 'launch', launchNonce: 'b'.repeat(64), workDeadlineElapsedMilliseconds: 49_000 });
    expect(() => encodeBackendServiceRequest(generation, 1, 'launch')).toThrow(error);
    expect(() => encodeBackendServiceRequest(generation, 1, 'status', 'b'.repeat(64))).toThrow(error);
    expect(() => encodeBackendServiceRequest(generation, 0, 'stop')).toThrow(error);
  });
  test('rejects missing, fractional, nonfinite and unsafe launch deadlines', () => {
    for (const deadline of [undefined, 0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => encodeBackendServiceRequest(generation, 1, 'launch', 'b'.repeat(64), deadline)).toThrow(error);
    }
    for (const kind of ['status', 'rss', 'stop'] as const) {
      expect(() => encodeBackendServiceRequest(generation, 1, kind, undefined, 49_000)).toThrow(error);
    }
  });
  test('reads fragmented and coalesced native frames', () => {
    const values: unknown[] = [];
    const reader = createBackendServiceFrameReader(value => values.push(value));
    const first = JSON.stringify(snapshot()) + '\n';
    reader.push(Buffer.from(first.slice(0, 7)));
    reader.push(Buffer.from(first.slice(7) + JSON.stringify(terminal()) + '\n'));
    reader.end();
    expect(values).toEqual([snapshot(), terminal()]);
  });
  test('accepts the exact frame bound, refuses another byte and latches failure', () => {
    const reader = createBackendServiceFrameReader(() => {});
    reader.push(Buffer.from('"' + 'x'.repeat(backendServiceFrameBytes - 3) + '"\n'));
    reader.end();
    expect(() => reader.push(Buffer.alloc(backendServiceFrameBytes, 120))).toThrow(error);
    expect(() => reader.push(Buffer.from('{}\n'))).toThrow(error);
    expect(() => reader.end()).toThrow(error);
  });
  for (const text of ['{"kind":"status","kind":"started"}\n', '{ "kind":"status"}\n', 'null\nPRIVATE', '{bad}\n']) {
    test(`rejects noncanonical, duplicate or truncated frame ${JSON.stringify(text)}`, () => {
      const reader = createBackendServiceFrameReader(() => {});
      expect(() => { reader.push(Buffer.from(text)); reader.end(); }).toThrow(error);
    });
  }
  test('rejects malformed UTF-8 and callback failures without raw messages', () => {
    expect(() => createBackendServiceFrameReader(() => {}).push(Buffer.from([34, 255, 34, 10]))).toThrow(error);
    expect(() => createBackendServiceFrameReader(() => { throw new Error('PRIVATE_DETAIL'); })
      .push(Buffer.from('{}\n'))).toThrow(error);
  });
});
