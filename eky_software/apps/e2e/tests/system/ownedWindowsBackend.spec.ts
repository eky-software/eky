import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { EventEmitter } from 'node:events';
import type { Socket } from 'node:net';

import { expect, test } from '@playwright/test';

import {
  OwnedWindowsBackendStartupFailure, startOwnedWindowsBackend,
} from '../../src/environment/startOwnedWindowsBackend.js';
import {
  attachBackendServiceControl, type BackendServiceControl,
} from '../../src/environment/windowsBackendServiceControl.js';
import {
  backendServiceCleanupMilliseconds, backendServiceProtocol, backendServiceSchemaVersion,
  type BackendServiceReply, type BackendServiceRequestKind, type BackendServiceState,
} from '../../src/environment/windowsBackendServiceProtocol.js';

const generation = 'a'.repeat(64);
const nonce = 'b'.repeat(64);
const secret = 'synthetic-session-secret';
const flush = () => new Promise<void>(resolve => { setImmediate(resolve); });

class Clock {
  value = 0;
  private nextId = 0;
  readonly timers = new Map<number, { at: number; callback: () => void }>();
  now = () => this.value;
  schedule = (callback: () => void, milliseconds: number) => {
    const id = ++this.nextId;
    this.timers.set(id, { at: this.value + milliseconds, callback });
    return () => { this.timers.delete(id); };
  };
  advanceTo(value: number) {
    this.value = value;
    for (;;) {
      const due = [...this.timers].filter(([, timer]) => timer.at <= value)
        .sort((left, right) => left[1].at - right[1].at)[0];
      if (due === undefined) return;
      this.timers.delete(due[0]);
      due[1].callback();
    }
  }
}

class SyntheticOwner extends EventEmitter {
  readonly stdout = new EventEmitter();
  readonly stderr = new EventEmitter();
  readonly stdin = Object.assign(new EventEmitter(), { end: () => { this.endCalls++; this.onEnd(); } });
  endCalls = 0;
  killCalls = 0;
  onEnd = () => { this.emit('close', 1, null); };
  kill() { this.killCalls++; return true; }
}

interface Request {
  kind: BackendServiceRequestKind;
  sequence: number;
  launchNonce?: string;
  workDeadlineElapsedMilliseconds?: number;
}

class SyntheticSocket extends EventEmitter {
  readonly requests: Request[] = [];
  destroyCalls = 0;
  endCalls = 0;
  onWrite: (request: Request) => void = () => {};
  onEnd = () => { this.emit('end'); this.emit('close'); };
  write(frame: Buffer, callback: (error?: Error) => void) {
    const request = JSON.parse(frame.toString()) as Request;
    this.requests.push(request);
    queueMicrotask(() => { callback(); this.onWrite(request); });
    return true;
  }
  end() { this.endCalls++; this.onEnd(); }
  destroy() { this.destroyCalls++; this.emit('close'); }
  receive(...replies: BackendServiceReply[]) {
    this.emit('data', Buffer.from(replies.map(reply => JSON.stringify(reply) + '\n').join('')));
  }
}

function fixture() {
  const clock = new Clock();
  const owner = new SyntheticOwner();
  const socket = new SyntheticSocket();
  let sequence = 0;
  let nativeCleanupStart: number | undefined;
  let nativeOrigin = 0;
  let state: BackendServiceState = {
    created: false, started: false, creationCompleted: false, launchClosed: false,
    identity: null, workload: 'pending', exitCode: null, assignedBeforeResume: false,
    activeProcesses: 0, stdioSettled: false, firstFailure: null, cleanup: 'pending', cleanupFailure: null,
  };
  function reply(kind: BackendServiceReply['kind'], request: Request | null,
    changes: Partial<BackendServiceState> = {}, extra: Partial<BackendServiceReply> = {}): BackendServiceReply {
    state = { ...state, ...changes };
    const elapsedMilliseconds = Math.floor(clock.now() - nativeOrigin);
    return {
      protocol: backendServiceProtocol, schemaVersion: backendServiceSchemaVersion,
      generation, sequence: ++sequence, replyTo: request?.sequence ?? null, kind, state,
      rssBytes: kind === 'rss' ? 4096 : null,
      elapsedMilliseconds,
      cleanupStartedElapsedMilliseconds: nativeCleanupStart ?? null,
      remainingCleanupMilliseconds: nativeCleanupStart === undefined ? null
        : Math.max(0, nativeCleanupStart + backendServiceCleanupMilliseconds - elapsedMilliseconds),
      ...extra,
    };
  }
  const started = (request: Request) => reply('started', request, {
    created: true, started: true, creationCompleted: true, launchClosed: true,
    identity: { pid: 42, creationTimeFileTimeHex: '0123456789abcdef' },
    workload: 'running', assignedBeforeResume: true, activeProcesses: 1,
  });
  const exited = () => reply('rootExit', null, { workload: 'exited', exitCode: 0 });
  const terminal = (request: Request | null, changes: Partial<BackendServiceState> = {}) => {
    nativeCleanupStart ??= Math.floor(clock.now() - nativeOrigin);
    return reply('terminal', request, {
      creationCompleted: true, launchClosed: true,
      workload: state.created ? 'exited' : 'pending', exitCode: state.created ? 0 : null,
      activeProcesses: 0, stdioSettled: true, cleanup: 'processTreeAbsent', ...changes,
    });
  };
  const respond = (request: Request) => {
    socket.receive(request.kind === 'launch' ? started(request)
      : request.kind === 'stop' ? terminal(request) : reply(request.kind, request));
  };
  socket.onWrite = respond;
  socket.onEnd = () => { socket.emit('end'); socket.emit('close'); owner.emit('close', 0, null); };
  let spawnCalls = 0;
  let connection: BackendServiceControl | undefined;
  const dependencies = {
    prepare: () => ({
      generation, launchNonce: nonce, configPath: '/synthetic/owner.json', executable: '/synthetic/owner.exe',
      repositoryRoot: '/synthetic/repository', workDeadline: 60_000,
      ownerEnvironment: { EKY_E2E: '1', EKY_E2E_OS_TEMP_ROOT: '/synthetic/temp', NODE_ENV: 'test', SystemRoot: '/synthetic/windows',
        WINDIR: '/synthetic/windows', TEMP: '/synthetic/temp', TMP: '/synthetic/temp',
        USERPROFILE: '/synthetic/profile', APPDATA: '/synthetic/profile', LOCALAPPDATA: '/synthetic/profile' },
    }),
    spawnOwner: () => { spawnCalls++; return owner as unknown as ChildProcessWithoutNullStreams; },
    connect: async (input: Parameters<typeof attachBackendServiceControl>[1]) => {
      connection = attachBackendServiceControl(socket as unknown as Socket, { ...input, now: clock.now });
      return connection;
    },
    now: clock.now, schedule: clock.schedule,
  };
  const input = { repositoryRoot: '/synthetic/repository', runRoot: '/synthetic/run',
    runtimeConfigPath: '/synthetic/run/backend.json', startupDeadline: 500,
    lifetime: { readRemainingWorkMilliseconds: () => 60_000 - clock.now() }, redactedValues: [secret] };
  return { clock, owner, socket, input, dependencies, reply, started, exited, terminal, respond,
    start: () => startOwnedWindowsBackend(input, dependencies), spawnCalls: () => spawnCalls,
    connection: () => connection!, setNativeCleanupStart: (value: number) => { nativeCleanupStart = value; },
    setNativeOrigin: (value: number) => { nativeOrigin = value; } };
}

async function startupFailure(operation: ReturnType<typeof startOwnedWindowsBackend>) {
  try { await operation; } catch (error) {
    expect(error).toBeInstanceOf(OwnedWindowsBackendStartupFailure);
    return error as OwnedWindowsBackendStartupFailure;
  }
  throw new Error('Expected a bounded startup failure.');
}

test.describe('Owned Windows backend lifecycle contract without native launch', () => {
  test('deducts native startup delay from the independent owner work deadline', async () => {
    const f = fixture();
    f.input.startupDeadline = 20_000;
    const connect = f.dependencies.connect;
    f.dependencies.connect = async input => {
      f.clock.value = 11_000;
      f.setNativeOrigin(11_000);
      return connect(input);
    };
    const backend = await f.start();
    const launch = f.socket.requests.find(request => request.kind === 'launch')!;
    expect(launch.workDeadlineElapsedMilliseconds).toBe(49_000);
    // The independent deadline is reached at the original fixture deadline,
    // even when the caller event-loop timers have not run.
    f.clock.value = 60_000;
    expect(launch.workDeadlineElapsedMilliseconds! - (f.clock.now() - 11_000)).toBe(0);
    await backend.stop();
  });

  test('does not add status delivery or launch queue delay to the work budget', async () => {
    const f = fixture();
    f.input.startupDeadline = 20_000;
    f.socket.onWrite = request => {
      if (request.kind === 'status') {
        f.clock.value = 100;
        const sample = f.reply('status', request);
        f.clock.value = 200;
        f.socket.receive(sample);
        queueMicrotask(() => { f.clock.value = 350.5; });
      } else f.respond(request);
    };
    const backend = await f.start();
    expect(f.socket.requests.find(request => request.kind === 'launch')?.workDeadlineElapsedMilliseconds).toBe(59_749);
    await backend.stop();
  });

  test('does not launch after a delayed clock sample crosses the original startup deadline', async () => {
    const f = fixture();
    f.socket.onWrite = request => {
      if (request.kind === 'status') {
        const sample = f.reply('status', request);
        f.clock.value = 500;
        f.socket.receive(sample);
      } else f.respond(request);
    };
    const error = await startupFailure(f.start());
    expect(error.evidence).toMatchObject({ spawnObserved: false, processTree: 'stopped',
      startupFailure: 'startupDeadlineExceeded' });
    expect(f.socket.requests.map(request => request.kind)).toEqual(['status', 'stop']);
  });

  test('rejects a clock sample from an owner that already closed launch admission', async () => {
    const f = fixture();
    f.socket.onWrite = request => {
      if (request.kind === 'status') f.socket.receive(f.reply('status', request, { launchClosed: true }));
      else f.respond(request);
    };
    const error = await startupFailure(f.start());
    expect(error.evidence).toMatchObject({ spawnObserved: false, processTree: 'stopped', startupFailure: 'launchFailed' });
    expect(f.socket.requests.map(request => request.kind)).toEqual(['status', 'stop']);
  });

  test('aligns a delayed native mode origin without extending the original local stop deadline', async () => {
    const f = fixture();
    f.input.startupDeadline = 20_000;
    const connect = f.dependencies.connect;
    f.dependencies.connect = async input => {
      f.clock.advanceTo(11_000);
      f.setNativeOrigin(11_000);
      return connect(input);
    };
    const backend = await f.start();
    f.clock.advanceTo(12_000);
    expect(await backend.workload.readState()).toBe('running');
    await expect(backend.stop()).resolves.toBeUndefined();
    expect(await backend.workload.readState()).toBe('exited');
  });

  test('late terminal delivery cannot renew cleanup after delayed native startup', async () => {
    const f = fixture();
    f.input.startupDeadline = 20_000;
    const connect = f.dependencies.connect;
    f.dependencies.connect = async input => {
      f.clock.advanceTo(11_000); f.setNativeOrigin(11_000);
      return connect(input);
    };
    const backend = await f.start();
    f.socket.onWrite = request => {
      const terminal = f.terminal(request);
      f.clock.value = 14_001;
      f.socket.receive(terminal);
    };
    await expect(backend.stop()).rejects.toThrow('E2E_BACKEND_OWNER_CLEANUP_UNVERIFIED');
  });

  test('binds an opaque instance to actual startup, queries work and memoizes complete stop', async () => {
    const f = fixture();
    const backend = await f.start();
    expect(backend.startup.readState()).toEqual({ spawnObserved: true, terminal: undefined });
    expect(Object.isFrozen(backend.startup.readState())).toBe(true);
    expect(backend.workload.instanceId).toMatch(/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/);
    expect(backend.workload.instanceId).not.toContain('0123456789abcdef');
    expect(backend.workload.instanceId).not.toBe(generation);
    const identity = backend.workload.instanceId;
    expect(await backend.workload.readState()).toBe('running');
    expect(await backend.workload.readRssBytes()).toBe(4096);
    const stop = backend.stop();
    expect(backend.stop()).toBe(stop);
    await stop;
    expect(await backend.workload.readState()).toBe('exited');
    await expect(backend.workload.readRssBytes()).rejects.toThrow('E2E_BACKEND_RSS_UNAVAILABLE');
    expect(backend.workload.instanceId).toBe(identity);
    expect(f.socket.requests.map(request => request.kind)).toEqual(['status', 'launch', 'status', 'rss', 'stop']);
    expect(f.socket.requests[1]).toMatchObject({ launchNonce: nonce, workDeadlineElapsedMilliseconds: 60_000 });
    expect(f.owner.killCalls).toBe(0);
    expect(f.clock.timers.size).toBe(0);
  });

  test('does not reuse the public identity when native PID and creation identity are repeated', async () => {
    const first = await fixture().start();
    const second = await fixture().start();
    expect(first.workload.instanceId).not.toBe(second.workload.instanceId);
    await first.stop();
    await second.stop();
  });

  for (const phase of ['prepare', 'spawnOwner'] as const) {
    test(`projects ${phase} failure without raw error or a false created-process claim`, async () => {
      const f = fixture();
      f.dependencies[phase] = () => { throw new Error(secret); };
      const error = await startupFailure(f.start());
      expect(error.evidence).toEqual({ spawnObserved: false, exitedBeforeCleanup: false, processTree: 'stopped',
        startupFailure: phase === 'prepare' ? 'preparationFailed' : 'ownerSpawnFailed' });
      expect(Object.isFrozen(error.evidence)).toBe(true);
      expect(error.message).toBe('E2E_BACKEND_OWNER_START_FAILED');
      expect(error).not.toHaveProperty('cause');
      expect(JSON.stringify(error)).not.toContain(secret);
      expect(error.readStdout()).toBe('');
      expect(error.readStderr()).toBe('');
      expect(f.socket.requests).toEqual([]);
      expect(f.clock.timers.size).toBe(0);
    });
  }

  test('does not spawn an owner after the original startup deadline', async () => {
    const f = fixture();
    f.clock.value = f.input.startupDeadline;
    const error = await startupFailure(f.start());
    expect(error.evidence.startupFailure).toBe('startupDeadlineExceeded');
    expect(error.evidence.processTree).toBe('stopped');
    expect(f.spawnCalls()).toBe(0);
  });

  test('rechecks the deadline inside the queued launch before writing any launch frame', async () => {
    const f = fixture();
    let startupTimers = 0;
    f.dependencies.schedule = (callback, milliseconds) => {
      if (milliseconds === f.input.startupDeadline && ++startupTimers === 2) {
        f.clock.value = f.input.startupDeadline;
      }
      return f.clock.schedule(callback, milliseconds);
    };
    const error = await startupFailure(f.start());
    expect(error.evidence).toEqual({ spawnObserved: false, exitedBeforeCleanup: false,
      processTree: 'stopped', startupFailure: 'startupDeadlineExceeded' });
    expect(f.socket.requests.map(request => request.kind)).toEqual(['stop']);
    expect(f.clock.timers.size).toBe(0);
  });

  test('destroys a late connection and never hands it a launch after startup failed', async () => {
    const f = fixture();
    let deliver!: (control: BackendServiceControl) => void;
    const connect = f.dependencies.connect;
    f.dependencies.connect = async input => {
      await connect(input);
      return new Promise<BackendServiceControl>(resolve => { deliver = resolve; });
    };
    const result = startupFailure(f.start());
    await flush();
    f.clock.advanceTo(500);
    const error = await result;
    expect(error.evidence.processTree).toBe('unverified');
    deliver(f.connection());
    await flush();
    expect(f.socket.destroyCalls).toBeGreaterThan(0);
    expect(f.socket.requests).toEqual([]);
    expect(error.evidence.startupFailure).toBe('startupDeadlineExceeded');
  });

  test('retains startup timeout separately from a subsequently proven cleanup', async () => {
    const f = fixture();
    let launch!: Request;
    f.socket.onWrite = request => { if (request.kind === 'launch') launch = request; else f.respond(request); };
    const result = startupFailure(f.start());
    await flush();
    f.clock.advanceTo(500);
    await flush();
    f.socket.receive(f.started(launch));
    const error = await result;
    expect(error.evidence).toEqual({ spawnObserved: true, exitedBeforeCleanup: false,
      processTree: 'stopped', startupFailure: 'startupDeadlineExceeded' });
    expect(f.clock.timers.size).toBe(0);
  });

  test('bounds pending launch cleanup independently and cannot accept a late continuation', async () => {
    const f = fixture();
    f.owner.onEnd = () => {};
    let launch!: Request;
    f.socket.onWrite = request => { if (request.kind === 'launch') launch = request; else f.respond(request); };
    const result = startupFailure(f.start());
    await flush();
    f.clock.advanceTo(500);
    await flush();
    f.clock.advanceTo(3_499);
    expect(f.owner.killCalls).toBe(0);
    f.clock.advanceTo(3_500);
    const error = await result;
    expect(error.evidence).toEqual({ spawnObserved: false, exitedBeforeCleanup: false,
      processTree: 'unverified', startupFailure: 'startupDeadlineExceeded' });
    f.socket.receive(f.started(launch));
    await flush();
    expect(f.socket.requests.map(request => request.kind)).toEqual(['status', 'launch']);
    expect(f.owner.killCalls).toBe(1);
    expect(f.owner.endCalls).toBe(1);
    f.owner.emit('error', new Error(secret));
    f.owner.emit('close', 0, null);
    f.clock.advanceTo(60_000);
    expect(error.evidence.processTree).toBe('unverified');
    expect(f.owner.killCalls).toBe(1);
    expect(f.clock.timers.size).toBe(0);
  });

  for (const cleanup of ['processTreeAbsent', 'cleanupUnverified'] as const) {
    test(`keeps launch rejection separate from ${cleanup} and redacts bounded readers`, async () => {
      const f = fixture();
      f.socket.onWrite = request => {
        if (request.kind === 'status') { f.respond(request); return; }
        f.owner.stdout.emit('data', Buffer.from('x'.repeat(300_000) + secret));
        f.owner.stderr.emit('data', Buffer.from(secret));
        f.socket.receive(f.terminal(request, { firstFailure: 'processStartFailed', cleanup,
          cleanupFailure: cleanup === 'cleanupUnverified' ? 'ownerFailed' : null }));
      };
      const error = await startupFailure(f.start());
      expect(error.evidence).toEqual({ spawnObserved: false, exitedBeforeCleanup: false,
        processTree: cleanup === 'processTreeAbsent' ? 'stopped' : 'unverified', startupFailure: 'launchFailed' });
      expect(error.readStdout().length).toBeLessThanOrEqual(256 * 1024);
      expect(error.readStdout()).not.toContain(secret);
      expect(error.readStderr()).toBe('[REDACTED]');
      expect(JSON.stringify(error)).not.toContain(secret);
      expect(f.clock.timers.size).toBe(0);
    });
  }

  test('records actual exit before cleanup without confusing it with cleanup-induced exit', async () => {
    const f = fixture();
    f.socket.onWrite = request => {
      if (request.kind === 'launch') f.socket.receive(f.started(request), f.exited());
      else f.respond(request);
    };
    const error = await startupFailure(f.start());
    expect(error.evidence).toEqual({ spawnObserved: true, exitedBeforeCleanup: true,
      processTree: 'stopped', startupFailure: 'workloadExited' });
  });

  test('does not infer actual workload startup from the owner process alone', async () => {
    const f = fixture();
    f.socket.onWrite = () => {};
    const result = startupFailure(f.start());
    await flush();
    f.owner.emit('spawn');
    f.owner.emit('close', 0, null);
    const error = await result;
    expect(error.evidence).toEqual({ spawnObserved: false, exitedBeforeCleanup: false,
      processTree: 'unverified', startupFailure: 'observationLost' });
  });

  for (const spawned of [false, true]) {
    test(`retains the first owner error with spawn event ${String(spawned)} and no actual startup inference`, async () => {
      const f = fixture();
      f.socket.onWrite = () => {};
      const result = startupFailure(f.start());
      await flush();
      if (spawned) f.owner.emit('spawn');
      f.owner.emit('error', new Error(secret));
      f.owner.emit('error', new Error('another synthetic error'));
      const error = await result;
      expect(error.evidence).toEqual({ spawnObserved: false, exitedBeforeCleanup: false,
        processTree: 'unverified', startupFailure: spawned ? 'observationLost' : 'ownerSpawnFailed' });
      expect(JSON.stringify(error)).not.toContain(secret);
      expect(f.owner.endCalls).toBe(1);
      expect(f.clock.timers.size).toBe(0);
    });
  }

  test('fails closed on control loss instead of retaining the last running state', async () => {
    const f = fixture();
    const backend = await f.start();
    f.socket.emit('error', new Error(secret));
    expect(await backend.workload.readState()).toBe('unavailable');
    await expect(backend.workload.readRssBytes()).rejects.toThrow('E2E_BACKEND_RSS_UNAVAILABLE');
    const error = await backend.stop().catch(error => error as unknown);
    expect(error).toBeInstanceOf(OwnedWindowsBackendStartupFailure);
    expect((error as OwnedWindowsBackendStartupFailure).evidence.processTree).toBe('unverified');
    expect(f.socket.requests.map(request => request.kind)).toEqual(['status', 'launch']);
    expect(f.clock.timers.size).toBe(0);
  });

  test('prefers same-buffer root exit to an earlier running status reply', async () => {
    const f = fixture();
    const backend = await f.start();
    f.socket.onWrite = request => {
      if (request.kind === 'status') f.socket.receive(f.reply('status', request), f.exited());
      else f.respond(request);
    };
    expect(await backend.workload.readState()).toBe('exited');
    await backend.stop();
  });

  test('rejects same-buffer RSS when a newer root exit has already been observed', async () => {
    const f = fixture();
    const backend = await f.start();
    f.socket.onWrite = request => {
      if (request.kind === 'rss') f.socket.receive(f.reply('rss', request), f.exited());
      else f.respond(request);
    };
    await expect(backend.workload.readRssBytes()).rejects.toThrow('E2E_BACKEND_RSS_UNAVAILABLE');
    await backend.stop();
  });

  for (const kind of ['status', 'rss'] as const) {
    test(`does not send a queued ${kind} after stop begins`, async () => {
      const f = fixture();
      const backend = await f.start();
      const reading = kind === 'status' ? backend.workload.readState() : backend.workload.readRssBytes();
      const assertion = kind === 'status' ? expect(reading).resolves.toBe('unavailable')
        : expect(reading).rejects.toThrow('E2E_BACKEND_RSS_UNAVAILABLE');
      await backend.stop();
      await assertion;
      expect(f.socket.requests.map(request => request.kind)).toEqual(['status', 'launch', 'stop']);
    });

    test(`rejects ${kind} success when stop begins before its continuation`, async () => {
      const f = fixture();
      const backend = await f.start();
      f.socket.onWrite = request => {
        f.respond(request);
        if (request.kind === kind) void backend.stop().catch(() => {});
      };
      if (kind === 'status') expect(await backend.workload.readState()).not.toBe('running');
      else await expect(backend.workload.readRssBytes()).rejects.toThrow('E2E_BACKEND_RSS_UNAVAILABLE');
      await backend.stop();
    });

    test(`rejects ${kind} success past the work deadline even before the timer fires`, async () => {
      const f = fixture();
      const backend = await f.start();
      f.socket.onWrite = request => {
        f.respond(request);
        if (request.kind === kind) f.clock.value = 60_000;
      };
      if (kind === 'status') expect(await backend.workload.readState()).toBe('unavailable');
      else await expect(backend.workload.readRssBytes()).rejects.toThrow('E2E_BACKEND_RSS_UNAVAILABLE');
      await expect(backend.stop()).rejects.toThrow('E2E_BACKEND_OWNER_START_FAILED');
    });

    test(`bounds stop behind a pending ${kind} without resetting the cleanup deadline`, async () => {
      const f = fixture();
      f.owner.onEnd = () => {};
      const backend = await f.start();
      f.socket.onWrite = () => {};
      const reading = kind === 'status' ? backend.workload.readState() : backend.workload.readRssBytes();
      const readResult = reading.catch(() => 'unavailable');
      await flush();
      const stop = backend.stop();
      const rejection = expect(stop).rejects.toThrow('E2E_BACKEND_OWNER_CLEANUP_UNVERIFIED');
      f.clock.advanceTo(2_999);
      expect(backend.stop()).toBe(stop);
      expect(f.owner.killCalls).toBe(0);
      f.clock.advanceTo(3_000);
      await rejection;
      await readResult;
      expect(f.owner.killCalls).toBe(1);
      expect(f.owner.endCalls).toBe(1);
      expect(f.socket.requests.map(request => request.kind)).toEqual(['status', 'launch', kind]);
      expect(f.clock.timers.size).toBe(0);
    });
  }

  test('shortens the active cleanup timer when an earlier native stop is observed', async () => {
    const f = fixture();
    f.owner.onEnd = () => {};
    const backend = await f.start();
    f.socket.onWrite = () => {};
    const reading = backend.workload.readState();
    await flush();
    f.clock.value = 2_000;
    const stop = backend.stop();
    const rejection = expect(stop).rejects.toThrow('E2E_BACKEND_OWNER_CLEANUP_UNVERIFIED');
    f.setNativeCleanupStart(500);
    f.socket.receive(f.exited());
    f.clock.advanceTo(3_499);
    expect(f.owner.killCalls).toBe(0);
    f.clock.advanceTo(3_500);
    await rejection;
    await reading;
    expect(f.owner.killCalls).toBe(1);
    expect(f.clock.timers.size).toBe(0);
  });

  for (const missing of ['channel', 'owner'] as const) {
    test(`does not accept terminal evidence without ${missing} closure before the same deadline`, async () => {
      const f = fixture();
      f.owner.onEnd = () => {};
      const backend = await f.start();
      f.socket.onEnd = () => {
        if (missing === 'owner') { f.socket.emit('end'); f.socket.emit('close'); }
      };
      const stop = backend.stop();
      const rejection = expect(stop).rejects.toThrow('E2E_BACKEND_OWNER_CLEANUP_UNVERIFIED');
      await flush();
      expect(f.socket.endCalls).toBe(1);
      f.clock.advanceTo(3_000);
      await rejection;
      expect(f.owner.killCalls).toBe(1);
      f.owner.emit('close', 0, null);
      await expect(backend.stop()).rejects.toThrow('E2E_BACKEND_OWNER_CLEANUP_UNVERIFIED');
      expect(await backend.workload.readState()).toBe('unavailable');
      expect(f.clock.timers.size).toBe(0);
    });
  }

  test('rejects a late owner close even if the cleanup timer has not fired', async () => {
    const f = fixture();
    const backend = await f.start();
    f.socket.onEnd = () => {
      f.socket.emit('end'); f.socket.emit('close');
      f.clock.value = 3_000;
      f.owner.emit('close', 0, null);
    };
    await expect(backend.stop()).rejects.toThrow('E2E_BACKEND_OWNER_CLEANUP_UNVERIFIED');
    expect(await backend.workload.readState()).toBe('unavailable');
    expect(f.clock.timers.size).toBe(0);
  });

  test('proves cleanup after work expiry but does not turn the expired workload into success', async () => {
    const f = fixture();
    const backend = await f.start();
    f.clock.advanceTo(60_000);
    const error = await backend.stop().catch(error => error as unknown);
    expect(error).toBeInstanceOf(OwnedWindowsBackendStartupFailure);
    expect((error as OwnedWindowsBackendStartupFailure).evidence).toEqual({
      spawnObserved: true, exitedBeforeCleanup: false, processTree: 'stopped', startupFailure: 'startupDeadlineExceeded',
    });
    expect(await backend.workload.readState()).toBe('exited');
    expect(f.socket.requests.map(request => request.kind)).toEqual(['status', 'launch', 'stop']);
    expect(f.owner.killCalls).toBe(0);
    expect(f.clock.timers.size).toBe(0);
  });

  for (const [nativeFailure, failureCode] of [
    ['stdioFailed', 'observationLost'],
    ['workDeadlineExceeded', 'startupDeadlineExceeded'],
    ['observationLost', 'observationLost'],
    ['ownerFailed', 'launchFailed'],
  ] as const) {
    test(`does not hide native ${nativeFailure} behind successful terminal cleanup and owner exit zero`, async () => {
      const f = fixture();
      const backend = await f.start();
      f.socket.onWrite = request => {
        f.socket.receive(f.terminal(request, { firstFailure: nativeFailure }));
      };
      const stop = backend.stop();
      const error = await stop.catch(error => error as unknown);
      expect(error).toBeInstanceOf(OwnedWindowsBackendStartupFailure);
      expect((error as OwnedWindowsBackendStartupFailure).evidence).toEqual({
        spawnObserved: true, exitedBeforeCleanup: false, processTree: 'stopped', startupFailure: failureCode,
      });
      expect(backend.stop()).toBe(stop);
      expect(f.owner.killCalls).toBe(0);
      expect(f.clock.timers.size).toBe(0);
    });
  }

  test('does not replace the first operational failure when cleanup later loses observation', async () => {
    const f = fixture();
    const backend = await f.start();
    f.socket.onWrite = request => {
      f.socket.receive(f.terminal(request, { firstFailure: 'workDeadlineExceeded' }));
    };
    f.socket.onEnd = () => { f.socket.emit('error', new Error(secret)); };
    const error = await backend.stop().catch(error => error as unknown);
    expect(error).toBeInstanceOf(OwnedWindowsBackendStartupFailure);
    expect((error as OwnedWindowsBackendStartupFailure).evidence).toEqual({
      spawnObserved: true, exitedBeforeCleanup: false, processTree: 'unverified', startupFailure: 'startupDeadlineExceeded',
    });
    expect(JSON.stringify(error)).not.toContain(secret);
    expect(f.clock.timers.size).toBe(0);
  });

  test('keeps startup subscription register-only, frozen and removable', async () => {
    const f = fixture();
    const backend = await f.start();
    const before = backend.startup.readState();
    let calls = 0;
    const unsubscribe = backend.startup.subscribe(() => { calls++; });
    expect(calls).toBe(0);
    unsubscribe();
    unsubscribe();
    f.socket.receive(f.exited());
    expect(calls).toBe(0);
    expect(before).toEqual({ spawnObserved: true, terminal: undefined });
    expect(backend.startup.readState()).toEqual({ spawnObserved: true, terminal: 'exited' });
    await backend.stop();
  });
});
