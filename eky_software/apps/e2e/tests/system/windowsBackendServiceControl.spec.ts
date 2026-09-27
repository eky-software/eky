import { EventEmitter } from 'node:events';
import type { Socket } from 'node:net';

import { expect, test } from '@playwright/test';

import {
  attachBackendServiceControl, beforeBackendOwnerDeadline,
} from '../../src/environment/windowsBackendServiceControl.js';
import {
  backendServiceProtocol, type BackendServiceReply,
} from '../../src/environment/windowsBackendServiceProtocol.js';

const generation = 'a'.repeat(64);
const nonce = 'b'.repeat(64);
const state = () => ({
  created: true, started: true, creationCompleted: true, launchClosed: true,
  identity: { pid: 42, creationTimeFileTimeHex: '0123456789abcdef' },
  workload: 'running', exitCode: null, assignedBeforeResume: true, activeProcesses: 1,
  stdioSettled: false, firstFailure: null, cleanup: 'pending', cleanupFailure: null,
});
const reply = (sequence: number, replyTo: number | null, kind = 'status') => ({
  protocol: backendServiceProtocol, schemaVersion: 1, generation, sequence, replyTo, kind,
  state: state(), rssBytes: null, cleanupStartedElapsedMilliseconds: null, remainingCleanupMilliseconds: null,
  elapsedMilliseconds: 200,
});
const terminal = (sequence: number, replyTo: number | null) => ({
  ...reply(sequence, replyTo, 'terminal'), cleanupStartedElapsedMilliseconds: 100,
  remainingCleanupMilliseconds: 2_900,
  state: { ...state(), workload: 'exited', exitCode: 0, activeProcesses: 0, stdioSettled: true,
    cleanup: 'processTreeAbsent' },
});

class SyntheticSocket extends EventEmitter {
  requests: Record<string, unknown>[] = [];
  destroyed = false;
  onWrite: (request: Record<string, unknown>) => void = () => {};
  onEnd = () => { this.emit('end'); this.emit('close'); };
  write(frame: Buffer, callback: (error?: Error) => void) {
    const request = JSON.parse(frame.toString()) as Record<string, unknown>;
    this.requests.push(request);
    queueMicrotask(() => { callback(); this.onWrite(request); });
    return true;
  }
  end() { this.onEnd(); }
  destroy() { this.destroyed = true; this.emit('close'); }
  receive(value: unknown) { this.emit('data', Buffer.from(JSON.stringify(value) + '\n')); }
}

function fixture() {
  const socket = new SyntheticSocket();
  let now = 100;
  let deadline = 60_000;
  let losses = 0;
  const replies: BackendServiceReply[] = [];
  const requestTimes: (number | undefined)[] = [];
  const control = attachBackendServiceControl(socket as unknown as Socket, {
    generation, now: () => now, readDeadline: () => deadline,
    onReply: (value, sentAt) => { replies.push(value); requestTimes.push(sentAt); }, onLost: () => { losses++; },
  });
  return { socket, control, replies, requestTimes, losses: () => losses,
    setClock: (value: number) => { now = value; }, setDeadline: (value: number) => { deadline = value; } };
}

test.describe('Windows backend service control', () => {
  test('correlates commands independently from unsolicited actual-root exit', async () => {
    const f = fixture();
    f.socket.onWrite = request => {
      if (request.kind === 'launch') f.socket.receive(reply(1, 1, 'started'));
      else {
        const exited = { ...state(), workload: 'exited', exitCode: 29, activeProcesses: 2 };
        f.socket.receive({ ...reply(2, null, 'rootExit'), state: exited });
        f.socket.receive({ ...reply(3, 2), state: exited });
      }
    };
    expect((await f.control.request('launch', nonce, 59_000)).state.started).toBe(true);
    expect(f.socket.requests[0]).toMatchObject({ launchNonce: nonce, workDeadlineElapsedMilliseconds: 59_000 });
    expect((await f.control.request('status')).state.workload).toBe('exited');
    expect(f.replies.map(value => value.kind)).toEqual(['started', 'rootExit', 'status']);
    expect(f.requestTimes).toEqual([100, undefined, 100]);
    expect(f.losses()).toBe(0);
    f.control.destroy();
  });
  test('correlates send time rather than reply receipt time and rejects clock regression', async () => {
    const f = fixture();
    f.socket.onWrite = () => { f.setClock(400); f.socket.receive(reply(1, 1)); };
    await f.control.request('status');
    expect(f.requestTimes).toEqual([100]);
    f.socket.onWrite = () => f.socket.receive({ ...reply(2, 2), elapsedMilliseconds: 199 });
    await expect(f.control.request('status')).rejects.toThrow('E2E_BACKEND_OWNER_PROTOCOL_INVALID');
  });
  test('requires terminal then orderly channel closure', async () => {
    const f = fixture();
    f.socket.onWrite = () => f.socket.receive(terminal(1, 1));
    await f.control.request('stop');
    await expect(f.control.finish()).resolves.toBeUndefined();
    expect(f.losses()).toBe(0);
  });
  test('does not accept a terminal receipt when the channel closure is too late', async () => {
    const f = fixture();
    f.socket.onWrite = () => f.socket.receive(terminal(1, 1));
    await f.control.request('stop');
    f.socket.onEnd = () => { f.setClock(60_001); f.socket.emit('end'); f.socket.emit('close'); };
    await expect(f.control.finish()).rejects.toThrow('E2E_BACKEND_OWNER_CONNECTION_LOST');
    expect(f.losses()).toBe(1);
  });
  test('rejects late success even if the timer callback has not run', async () => {
    const f = fixture();
    f.socket.onWrite = () => { f.setClock(60_001); f.socket.receive(terminal(1, 1)); };
    await expect(f.control.request('stop')).rejects.toThrow('E2E_BACKEND_OWNER_PROTOCOL_INVALID');
    expect(f.socket.destroyed).toBe(true);
  });
  test('observes an unsolicited terminal without turning it into a successful RSS response', async () => {
    const f = fixture();
    f.socket.onWrite = () => f.socket.receive(terminal(1, null));
    expect((await f.control.request('rss')).kind).toBe('terminal');
    await f.control.finish();
  });
  for (const [name, mutate] of [
    ['wrong correlation', (value: ReturnType<typeof reply>) => ({ ...value, replyTo: 2 })],
    ['wrong kind', (value: ReturnType<typeof reply>) => ({ ...value, kind: 'started' })],
    ['unsolicited status', (value: ReturnType<typeof reply>) => ({ ...value, replyTo: null })],
    ['wrong generation', (value: ReturnType<typeof reply>) => ({ ...value, generation: nonce })],
  ] as const) {
    test(`latches ${name} and refuses later requests`, async () => {
      const f = fixture();
      f.socket.onWrite = () => f.socket.receive(mutate(reply(1, 1)));
      await expect(f.control.request('status')).rejects.toThrow('E2E_BACKEND_OWNER_PROTOCOL_INVALID');
      await expect(f.control.request('stop')).rejects.toThrow('E2E_BACKEND_OWNER_PROTOCOL_INVALID');
      expect(f.losses()).toBe(1);
    });
  }
  for (const [name, changes] of Object.entries({
    identity: { identity: { pid: 43, creationTimeFileTimeHex: '0123456789abcdef' } },
    creationIdentity: { identity: { pid: 42, creationTimeFileTimeHex: '0123456789abcdee' } },
    launchReopened: { started: false, launchClosed: false, workload: 'pending' },
  })) {
    test(`rejects a later ${name} change`, async () => {
      const f = fixture();
      f.socket.onWrite = () => f.socket.receive(reply(1, 1));
      await f.control.request('status');
      f.socket.onWrite = () => f.socket.receive({ ...reply(2, 2), state: { ...state(), ...changes } });
      await expect(f.control.request('status')).rejects.toThrow('E2E_BACKEND_OWNER_PROTOCOL_INVALID');
    });
  }
  test('cannot renew a latched cleanup deadline with a repeated stop', async () => {
    const f = fixture();
    f.socket.onWrite = () => f.socket.receive(terminal(1, 1));
    await f.control.request('stop');
    f.socket.onWrite = () => f.socket.receive({ ...terminal(2, 2), cleanupStartedElapsedMilliseconds: 101 });
    await expect(f.control.request('stop')).rejects.toThrow('E2E_BACKEND_OWNER_PROTOCOL_INVALID');
  });
  test('control loss rejects the pending operation and latches unavailable', async () => {
    const f = fixture();
    f.socket.onWrite = () => f.socket.emit('error', new Error('PRIVATE_PATH'));
    await expect(f.control.request('status')).rejects.toThrow('E2E_BACKEND_OWNER_CONNECTION_LOST');
    expect(f.losses()).toBe(1);
    await expect(f.control.finish()).rejects.toThrow('E2E_BACKEND_OWNER_CONNECTION_LOST');
  });
  test('rejects overlapping commands without miscorrelating the original request', async () => {
    const f = fixture();
    const active = f.control.request('status');
    await expect(f.control.request('rss')).rejects.toThrow('E2E_BACKEND_OWNER_CONNECTION_LOST');
    f.socket.receive(reply(1, 1));
    await expect(active).resolves.toMatchObject({ kind: 'status' });
    f.control.destroy();
  });
  test('requires tree evidence before asking for channel closure', async () => {
    const f = fixture();
    await expect(f.control.finish()).rejects.toThrow('E2E_BACKEND_OWNER_PROTOCOL_INVALID');
    f.control.destroy();
  });
  test('deadline wrapper rejects late completion and observes expired rejections', async () => {
    let now = 0;
    await expect(beforeBackendOwnerDeadline(Promise.resolve().then(() => { now = 11; }), 10, () => now))
      .rejects.toThrow('E2E_BACKEND_OWNER_DEADLINE_EXCEEDED');
    await expect(beforeBackendOwnerDeadline(Promise.reject(new Error('PRIVATE')), 10, () => now))
      .rejects.toThrow('E2E_BACKEND_OWNER_DEADLINE_EXCEEDED');
  });
});
