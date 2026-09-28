import { expect, test } from '@playwright/test';

import type { ElectronE2eRuntime } from '../../src/environment/createElectronE2eRuntime.js';
import { runOwnedWindowsElectron, DirectElectronRunFailure } from '../../src/environment/runOwnedWindowsElectron.js';
import { OwnedWindowsElectronStartupFailure } from '../../src/environment/startOwnedWindowsElectron.js';
import type { ObservedWindowsService } from '../../src/environment/startOwnedWindowsService.js';
import type { E2eProcessStartupState } from '../../src/environment/e2eProcessStartupObservation.js';

function fixture() {
  let now = 0; let stops = 0; let unsubscribed = false; let cancelled = false;
  let timer = () => {}; let subscriber: ((state: E2eProcessStartupState) => void) | undefined;
  let state: E2eProcessStartupState = { spawnObserved: true, terminal: 'exited' };
  const runtime = { configPath: '/synthetic/config.json', runtimeRoot: '/synthetic/runtime', sessionSecret: 'synthetic-session',
    profile: { root: '/synthetic/profile', appDataLocal: '/synthetic/local', appDataRoaming: '/synthetic/roaming', temp: '/synthetic/temp' } } as ElectronE2eRuntime;
  const owned: ObservedWindowsService = {
    readStdout: () => 'stdout', readStderr: () => 'stderr', readCombinedOutput: () => 'stdoutstderr',
    startup: { readState: () => state, subscribe: fn => { subscriber = fn; return () => { unsubscribed = true; }; } },
    workload: { instanceId: 'synthetic', readState: async () => 'exited', readExitCode: () => 0, readRssBytes: async () => 0 },
    stop: async () => { stops++; },
  };
  const input = { runtime, runRoot: '/synthetic/run', lifetime: { readRemainingWorkMilliseconds: () => 45_000 - now },
    timeoutMilliseconds: 15_000, expectedExitCode: 0 as 0 | 1 };
  const dependencies = { now: () => now, start: async (_input: Parameters<typeof import('../../src/environment/startOwnedWindowsElectron.js').startOwnedWindowsElectron>[0]) => owned,
    schedule: (callback: () => void, _milliseconds: number) => { timer = callback; return () => { cancelled = true; }; } };
  return { input, dependencies, owned, run: () => runOwnedWindowsElectron(input, dependencies),
    setNow: (value: number) => { now = value; }, expire: () => timer(),
    publish: (next: E2eProcessStartupState) => { state = next; subscriber?.(next); },
    read: () => ({ stops, unsubscribed, cancelled }) };
}

test.describe('Direct Windows Electron result and cleanup boundary', () => {
  for (const code of [0, 1]) {
    test(`preserves early actual exit ${code} without confusing it with cleanup`, async () => {
      const f = fixture(); f.owned.workload.readExitCode = () => code; f.input.expectedExitCode = code as 0 | 1;
      expect(await f.run()).toEqual({ exitCode: code, output: 'stdoutstderr' });
      expect(f.read()).toEqual({ stops: 1, unsubscribed: true, cancelled: true });
    });
  }
  test('waits for complete cleanup before returning a root exit', async () => {
    const f = fixture(); let release!: () => void; let returned = false;
    f.owned.stop = () => new Promise<void>(resolve => { release = resolve; });
    const run = f.run().then(value => { returned = true; return value; });
    await expect.poll(() => typeof release).toBe('function');
    expect(returned).toBe(false); release(); expect((await run).exitCode).toBe(0);
  });
  test('never deletes proof obligations when cleanup rejects after expected exit', async () => {
    const f = fixture(); f.owned.workload.readExitCode = () => 1; f.input.expectedExitCode = 1;
    f.owned.stop = async () => { throw new Error('private cleanup detail'); };
    await expect(f.run()).rejects.toMatchObject({ failure: 'cleanupFailed', processTree: 'unverified' });
  });
  test('retains unexpected root exit as the first failure even when cleanup also fails', async () => {
    const f = fixture(); f.owned.workload.readExitCode = () => 2;
    f.owned.stop = async () => { throw new Error('private cleanup detail'); };
    await expect(f.run()).rejects.toMatchObject({ failure: 'unexpectedExitCode', exitCode: 2, processTree: 'unverified' });
  });
  test('retains first timeout separately from cleanup failure', async () => {
    const f = fixture(); f.publish({ spawnObserved: true, terminal: undefined });
    f.owned.stop = async () => { throw new Error('private cleanup detail'); };
    const run = f.run(); const outcome = run.catch(error => error);
    await Promise.resolve(); await Promise.resolve(); f.expire();
    expect(await outcome).toMatchObject({ failure: 'exitDeadlineExceeded', processTree: 'unverified' });
  });
  test('observation loss cannot become a passing cached exit code', async () => {
    const f = fixture(); f.publish({ spawnObserved: true, terminal: 'observationLost' });
    await expect(f.run()).rejects.toMatchObject({ failure: 'observationLost', processTree: 'stopped' });
  });
  test('refuses a missing exit code even after proven cleanup', async () => {
    const f = fixture(); f.owned.workload.readExitCode = () => null;
    await expect(f.run()).rejects.toMatchObject({ failure: 'exitCodeUnavailable', processTree: 'stopped' });
  });
  test('does not renew direct-call or fixture deadlines during startup', async () => {
    const f = fixture();
    f.dependencies.start = async input => {
      expect(input.startupDeadline).toBe(15_000); f.setNow(2_000);
      expect(input.lifetime.readRemainingWorkMilliseconds()).toBe(13_000);
      f.input.lifetime.readRemainingWorkMilliseconds = () => 500;
      expect(input.lifetime.readRemainingWorkMilliseconds()).toBe(500);
      return f.owned;
    };
    await f.run();
  });
  for (const processTree of ['stopped', 'unverified'] as const) {
    test(`retains typed startup cleanup evidence ${processTree} without raw detail`, async () => {
      const f = fixture(); f.dependencies.start = async () => { throw new OwnedWindowsElectronStartupFailure({
        spawnObserved: false, exitedBeforeCleanup: false, processTree, startupFailure: 'launchFailed',
      }, { readStdout: () => 'private', readStderr: () => 'private' }); };
      const error = await f.run().catch(value => value);
      expect(error).toBeInstanceOf(DirectElectronRunFailure);
      expect(error).toMatchObject({ failure: 'startupFailed', processTree });
      expect(String(error)).not.toContain('private'); expect(f.read().stops).toBe(0);
    });
  }
  test('uses the ordered output reader and does not turn an unknown startup throw into cleanup proof', async () => {
    const f = fixture(); f.owned.readCombinedOutput = () => 'stderr then stdout';
    expect((await f.run()).output).toBe('stderr then stdout');
    f.dependencies.start = async () => { throw new Error('unknown'); };
    await expect(f.run()).rejects.toMatchObject({ failure: 'startupFailed', processTree: 'unverified' });
  });
});
