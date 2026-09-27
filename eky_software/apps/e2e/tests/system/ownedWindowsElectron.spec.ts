import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { expect, test } from '@playwright/test';

import { OwnedWindowsElectronStartupFailure, startOwnedWindowsElectron } from '../../src/environment/startOwnedWindowsElectron.js';
import type { WindowsServiceReply, WindowsServiceRequestKind, WindowsServiceState } from '../../src/environment/windowsServiceProtocol.js';
import { createWindowsServiceControl } from '../../src/environment/windowsServiceControl.js';
import { createWindowsServiceProtocol } from '../../src/environment/windowsServiceProtocol.js';

function fixture(exitCode: number | null = null) {
  let now = 0; let sequence = 0; let closed = false; let cleanupStart: number | null = null;
  let connection!: Parameters<ReturnType<typeof createWindowsServiceControl<'electron'>>['connectWindowsServiceControl']>[0];
  const requests: WindowsServiceRequestKind[] = [];
  const replies: WindowsServiceReply<'electron'>[] = [];
  const owner = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter(),
    stdin: Object.assign(new EventEmitter(), { end: () => close(1) }), kill: () => { close(1); return true; } });
  const close = (code: number) => { if (!closed) { closed = true; owner.emit('close', code, null); } };
  let state: WindowsServiceState = { created: false, started: false, creationCompleted: false, launchClosed: false,
    identity: null, workload: 'pending', exitCode: null, assignedBeforeResume: false, activeProcesses: 0,
    stdioSettled: false, firstFailure: null, cleanup: 'pending', cleanupFailure: null };
  const control = {
    async request(kind: WindowsServiceRequestKind): Promise<WindowsServiceReply<'electron'>> {
      requests.push(kind);
      if (kind === 'launch') state = { ...state, created: true, started: true, creationCompleted: true, launchClosed: true,
        identity: { pid: 42, creationTimeFileTimeHex: '0123456789abcdef' }, workload: exitCode === null ? 'running' : 'exited',
        exitCode, assignedBeforeResume: true, activeProcesses: 2 };
      if (kind === 'stop') {
        cleanupStart ??= now;
        state = { ...state, creationCompleted: true, launchClosed: true, workload: state.created ? 'exited' : 'pending',
          exitCode: state.created ? exitCode ?? 0 : null, activeProcesses: 0, stdioSettled: true, cleanup: 'processTreeAbsent' };
      }
      const value: WindowsServiceReply<'electron'> = { protocol: 'eky.e2e.electron-service', schemaVersion: 1,
        generation: 'a'.repeat(64), sequence: ++sequence, replyTo: sequence,
        kind: kind === 'launch' ? 'started' : kind === 'stop' ? 'terminal' : kind,
        state, rssBytes: kind === 'rss' ? 4096 : null, elapsedMilliseconds: now,
        cleanupStartedElapsedMilliseconds: cleanupStart,
        remainingCleanupMilliseconds: cleanupStart === null ? null : Math.max(0, cleanupStart + 3_000 - now) };
      replies.push(value); connection.onReply(value, now); return value;
    },
    async finish() { close(0); }, destroy() {},
  };
  const input = { repositoryRoot: '/synthetic/repository', runRoot: '/synthetic/run',
    runtimeRoot: '/synthetic/run/runtime', runtimeConfigPath: '/synthetic/run/runtime/electron-config.json', environment: {},
    lifetime: { readRemainingWorkMilliseconds: () => 15_000 - now }, startupDeadline: 15_000, redactedValues: [] as string[] };
  const dependencies: NonNullable<Parameters<typeof startOwnedWindowsElectron>[1]> = {
    prepare: () => ({ generation: 'a'.repeat(64), launchNonce: 'b'.repeat(64), configPath: 'synthetic.json',
      executable: 'inert-owner', repositoryRoot: input.repositoryRoot, workDeadline: 15_000, ownerEnvironment: {} }),
    spawnOwner: () => owner as unknown as ChildProcessWithoutNullStreams,
    connect: async value => { connection = value; return control; }, now: () => now, schedule: () => () => {},
  };
  return { start: () => startOwnedWindowsElectron(input, dependencies), dependencies, owner, control, requests, replies,
    lose: () => connection.onLost(), setNow: (value: number) => { now = value; } };
}

test.describe('Owned Windows direct Electron facade', () => {
  test('preserves late stdout after a full stderr buffer in the bounded receiving order', async () => {
    const f = fixture(1); const electron = await f.start();
    f.owner.stderr.emit('data', Buffer.from('e'.repeat(64 * 1024)));
    f.owner.stdout.emit('data', Buffer.from(' at forbidden-stack'));
    expect(electron.readCombinedOutput()).toHaveLength(64 * 1024);
    expect(electron.readCombinedOutput()).toContain(' at forbidden-stack');
    f.owner.stderr.emit('data', Buffer.from(' last-stderr'));
    expect(electron.readCombinedOutput().endsWith(' at forbidden-stack last-stderr')).toBe(true);
    await electron.stop();
  });
  for (const code of [0, 1]) {
    test(`actual exit ${code} before started reply remains distinct from descendant cleanup and owner exit zero`, async () => {
      const f = fixture(code); const electron = await f.start();
      expect(electron.startup.readState()).toEqual({ spawnObserved: true, terminal: 'exited' });
      expect(electron.workload.readExitCode()).toBe(code); expect(await electron.workload.readState()).toBe('exited');
      expect(f.requests).not.toContain('stop');
      const stop = electron.stop(); expect(electron.stop()).toBe(stop); await stop;
      expect(electron.workload.readExitCode()).toBe(code); expect(f.requests.filter(kind => kind === 'stop')).toHaveLength(1);
    });
  }
  test('does not manufacture an exit code while running or after observation loss', async () => {
    const f = fixture(); const electron = await f.start();
    expect(electron.workload.readExitCode()).toBeNull(); f.lose();
    expect(electron.workload.readExitCode()).toBeNull();
    await expect(electron.stop()).rejects.toMatchObject({ evidence: { processTree: 'unverified' } });
  });
  test('returns typed preparation failure without raw details or an invented child', async () => {
    const f = fixture(); f.dependencies.prepare = () => { throw new Error('private-detail'); };
    const failure = await f.start().catch(error => error);
    expect(failure).toBeInstanceOf(OwnedWindowsElectronStartupFailure);
    expect(failure.evidence).toEqual({ spawnObserved: false, exitedBeforeCleanup: false,
      processTree: 'stopped', startupFailure: 'preparationFailed' });
    expect(String(failure)).not.toContain('private-detail');
  });
  test('refuses late cleanup even when the main already exited successfully', async () => {
    const f = fixture(0); const electron = await f.start();
    const finish = f.control.finish; f.control.finish = () => { f.setNow(3_001); return finish(); };
    await expect(electron.stop()).rejects.toThrow('E2E_ELECTRON_OWNER_CLEANUP_UNVERIFIED');
  });
  test('isolates the Electron protocol from backend and Vite replies', async () => {
    const f = fixture(1); const electron = await f.start(); const value = f.replies.at(-1)!;
    const validate = createWindowsServiceProtocol('electron').validateWindowsServiceReply;
    expect(validate(value, 'a'.repeat(64), value.sequence - 1).state.exitCode).toBe(1);
    for (const protocol of ['eky.e2e.backend-service', 'eky.e2e.vite-service']) {
      expect(() => validate({ ...value, protocol }, 'a'.repeat(64), value.sequence - 1)).toThrow('E2E_ELECTRON_OWNER_PROTOCOL_INVALID');
    }
    await electron.stop();
  });
});
