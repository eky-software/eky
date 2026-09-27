import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { EventEmitter } from 'node:events';

import { expect, test } from '@playwright/test';

import { OwnedWindowsBackendStartupFailure } from '../../src/environment/startOwnedWindowsBackend.js';
import { OwnedWindowsViteStartupFailure, startOwnedWindowsVite } from '../../src/environment/startOwnedWindowsVite.js';
import type { connectViteServiceControl } from '../../src/environment/windowsViteServiceControl.js';
import type { ViteServiceReply, ViteServiceRequestKind, ViteServiceState } from '../../src/environment/windowsViteServiceProtocol.js';

function fixture() {
  let now = 0;
  let nativeOrigin = 0;
  let sequence = 0;
  let closed = false;
  let cleanupStart: number | null = null;
  let connected!: Parameters<typeof connectViteServiceControl>[0];
  const requests: { kind: ViteServiceRequestKind; deadline?: number }[] = [];
  const owner = Object.assign(new EventEmitter(), {
    stdout: new EventEmitter(), stderr: new EventEmitter(),
    stdin: Object.assign(new EventEmitter(), { end: () => close(1) }), kill: () => { close(1); return true; },
  });
  function close(code: number) { if (!closed) { closed = true; owner.emit('close', code, null); } }
  let state: ViteServiceState = { created: false, started: false, creationCompleted: false, launchClosed: false,
    identity: null, workload: 'pending', exitCode: null, assignedBeforeResume: false, activeProcesses: 0,
    stdioSettled: false, firstFailure: null, cleanup: 'pending', cleanupFailure: null };
  const control = {
    async request(kind: ViteServiceRequestKind, _nonce?: string, deadline?: number): Promise<ViteServiceReply> {
      requests.push({ kind, ...(deadline === undefined ? {} : { deadline }) });
      if (kind === 'launch') state = { ...state, created: true, started: true, creationCompleted: true, launchClosed: true,
        identity: { pid: 42, creationTimeFileTimeHex: '0123456789abcdef' }, workload: 'running',
        assignedBeforeResume: true, activeProcesses: 1 };
      if (kind === 'stop') {
        cleanupStart ??= now - nativeOrigin;
        state = { ...state, creationCompleted: true, launchClosed: true,
          workload: state.created ? 'exited' : 'pending', exitCode: state.created ? 0 : null,
          activeProcesses: 0, stdioSettled: true, cleanup: 'processTreeAbsent' };
      }
      const value: ViteServiceReply = { protocol: 'eky.e2e.vite-service', schemaVersion: 1,
        generation: 'a'.repeat(64), sequence: ++sequence, replyTo: sequence,
        kind: kind === 'launch' ? 'started' : kind === 'stop' ? 'terminal' : kind,
        state, rssBytes: kind === 'rss' ? 4096 : null, elapsedMilliseconds: now - nativeOrigin,
        cleanupStartedElapsedMilliseconds: cleanupStart,
        remainingCleanupMilliseconds: cleanupStart === null ? null : Math.max(0, cleanupStart + 3_000 - (now - nativeOrigin)) };
      connected.onReply(value, now);
      return value;
    },
    async finish() { close(0); },
    destroy() {},
  };
  const input = { repositoryRoot: '/synthetic/repository', runRoot: '/synthetic/run', webPort: 45123,
    environmentRoot: '/synthetic/run/temp', backendOrigin: 'http://127.0.0.1:45124', sessionSecret: 's'.repeat(43),
    lifetime: { readRemainingWorkMilliseconds: () => 60_000 - now }, startupDeadline: 20_000, redactedValues: [] as string[] };
  const dependencies: NonNullable<Parameters<typeof startOwnedWindowsVite>[1]> = {
    prepare: () => ({ generation: 'a'.repeat(64), launchNonce: 'b'.repeat(64), configPath: 'synthetic.json',
      executable: 'inert-owner', repositoryRoot: input.repositoryRoot, workDeadline: 60_000, ownerEnvironment: {} }),
    spawnOwner: () => owner as unknown as ChildProcessWithoutNullStreams,
    connect: async connection => { connected = connection; return control; },
    now: () => now, schedule: () => () => {},
  };
  return { input, dependencies, owner, control, requests, start: () => startOwnedWindowsVite(input, dependencies),
    setNow: (value: number) => { now = value; }, setNativeOrigin: (value: number) => { nativeOrigin = value; },
    loseControl: () => { connected.onLost(); } };
}

test.describe('Owned Windows Vite facade without native launch', () => {
  test('returns live workload observations, redacts session automatically and memoizes full stop', async () => {
    const f = fixture();
    const vite = await f.start();
    f.owner.stdout.emit('data', Buffer.from('prefix ' + f.input.sessionSecret));
    f.owner.stderr.emit('data', Buffer.from(f.input.sessionSecret));
    expect(vite.readStdout()).not.toContain(f.input.sessionSecret);
    expect(vite.readStderr()).not.toContain(f.input.sessionSecret);
    expect(vite.startup.readState().spawnObserved).toBe(true);
    expect(vite.workload.instanceId).not.toBe('42');
    expect(await vite.workload.readState()).toBe('running');
    expect(await vite.workload.readRssBytes()).toBe(4096);
    const stop = vite.stop();
    expect(vite.stop()).toBe(stop);
    await stop;
    expect(await vite.workload.readState()).toBe('exited');
    await expect(vite.workload.readRssBytes()).rejects.toThrow('E2E_VITE_RSS_UNAVAILABLE');
    expect(f.requests.filter(request => request.kind === 'stop')).toHaveLength(1);
  });
  test('deducts native startup delay from the existing fixture deadline', async () => {
    const f = fixture();
    const connect = f.dependencies.connect!;
    f.dependencies.connect = input => { f.setNow(11_000); f.setNativeOrigin(11_000); return connect(input); };
    const vite = await f.start();
    expect(f.requests.find(request => request.kind === 'launch')?.deadline).toBe(49_000);
    await vite.stop();
  });
  for (const phase of ['prepare', 'spawnOwner'] as const) {
    test(`preserves typed ${phase} failure with proven no-child cleanup and no raw detail`, async () => {
      const f = fixture();
      f.dependencies[phase] = () => { throw new Error(f.input.sessionSecret); };
      let failure: unknown;
      try { await f.start(); } catch (error) { failure = error; }
      expect(failure).toBeInstanceOf(OwnedWindowsViteStartupFailure);
      expect(failure).not.toBeInstanceOf(OwnedWindowsBackendStartupFailure);
      const value = failure as OwnedWindowsViteStartupFailure;
      expect(value.evidence).toEqual({ spawnObserved: false, exitedBeforeCleanup: false,
        processTree: 'stopped', startupFailure: phase === 'prepare' ? 'preparationFailed' : 'ownerSpawnFailed' });
      expect(Object.isFrozen(value.evidence)).toBe(true);
      expect(String(value)).not.toContain(f.input.sessionSecret);
      expect(value.readStdout()).toBe('');
    });
  }
  test('latches control loss and never returns the cached running state', async () => {
    const f = fixture();
    const vite = await f.start();
    expect(await vite.workload.readState()).toBe('running');
    f.loseControl();
    expect(await vite.workload.readState()).toBe('unavailable');
    await expect(vite.stop()).rejects.toMatchObject({ evidence: { startupFailure: 'observationLost', processTree: 'unverified' } });
    await expect(vite.workload.readRssBytes()).rejects.toThrow('E2E_VITE_RSS_UNAVAILABLE');
  });
  test('rejects late owner closure without renewing the first-stop cleanup budget', async () => {
    const f = fixture();
    const vite = await f.start();
    const finish = f.control.finish;
    f.control.finish = () => { f.setNow(3_001); return finish(); };
    const stop = vite.stop();
    await expect(stop).rejects.toThrow('E2E_VITE_OWNER_CLEANUP_UNVERIFIED');
    expect(vite.stop()).toBe(stop);
  });
});
