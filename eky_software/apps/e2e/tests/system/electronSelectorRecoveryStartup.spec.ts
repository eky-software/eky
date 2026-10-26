import { expect, test, type ElectronApplication } from '@playwright/test';

import { readSelectorTestRelease, selectorCreateScenarioId, selectorRecoveryScenarioId } from '../../../desktop/e2e/electronSelectorTestRelease.js';
import { observeSelectorTestBackend } from '../../../desktop/e2e/electronSelectorTestBackend.js';
import type { DesktopBackendHandle, StartDesktopBackendOptions } from '../../../desktop/src/runtime/backendProcess.js';
import type { ElectronE2eRuntime } from '../../src/environment/createElectronE2eRuntime.js';
import { DirectElectronRunFailure } from '../../src/environment/runOwnedWindowsElectron.js';
import { runElectronSelectorRecoveryStartup } from '../../src/fixtures/runElectronSelectorRecoveryStartup.js';
import { ELECTRON_E2E_PROCESS_CONNECT_TIMEOUT_MILLISECONDS } from '../../src/fixtures/electronLaunchBudgets.js';
import { readSelectorTestBackendPort } from '../../src/electron/readElectronMainState.js';

test('SYS-SELECTOR-RECOVERY-RUN-001 @security limits synthetic release admission to the named scenarios', () => {
  expect(readSelectorTestRelease('DESK-SELECTOR-READY-001')).toBeUndefined();
  for (const scenarioId of [selectorRecoveryScenarioId, selectorCreateScenarioId]) {
    expect(readSelectorTestRelease(`${scenarioId}-OTHER`)).toBeUndefined();
    expect(readSelectorTestRelease(scenarioId)).toMatchObject({
      appVersion: '0.2.0', buildRevision: 'a'.repeat(40), releaseChannel: 'pilot',
    });
  }
});

test('SYS-SELECTOR-RECOVERY-RUN-002 @security requires one expected relaunch and settled native cleanup, without retry', async () => {
  for (const result of ['success', 'noRelaunch', 'twoRelaunches', 'ownerFailure'] as const) {
    let count = 0;
    let calls = 0;
    let release!: () => void;
    const original = new DirectElectronRunFailure('unexpectedExitCode', 'unverified', 1);
    const input = {
      scenarioId: selectorRecoveryScenarioId, runtime: {} as ElectronE2eRuntime,
      runRoot: 'synthetic', lifetime: { readRemainingWorkMilliseconds: () => 1000 },
      readRelaunchCount: () => count,
      captureOutput: () => {},
    };
    let completed = false;
    const outcome = runElectronSelectorRecoveryStartup(input, async request => {
      calls++;
      expect(request.expectedExitCode).toBe(0);
      expect(request.timeoutMilliseconds).toBe(ELECTRON_E2E_PROCESS_CONNECT_TIMEOUT_MILLISECONDS);
      expect(request.lifetime).toBe(input.lifetime);
      expect(request.captureOutput).toBe(input.captureOutput);
      await new Promise<void>(resolve => { release = resolve; });
      if (result === 'ownerFailure') throw original;
      count = result === 'noRelaunch' ? 0 : result === 'twoRelaunches' ? 2 : 1;
      return { exitCode: 0, output: '' };
    }).then(() => { completed = true; }, error => error);
    expect(completed).toBe(false);
    release();
    const error = await outcome;
    expect(calls).toBe(1);
    if (result === 'success') expect(completed).toBe(true);
    else if (result === 'ownerFailure') expect(error).toBe(original);
    else expect(String(error)).toContain('RECOVERY_RELAUNCH_MISSING');
  }
});

test('SYS-SELECTOR-RECOVERY-RUN-003 @security refuses stale observations or another scenario before launch', async () => {
  for (const scenarioId of [selectorRecoveryScenarioId, selectorCreateScenarioId, 'DESK-OTHER-001']) {
    let calls = 0;
    await expect(runElectronSelectorRecoveryStartup({
      scenarioId, runtime: {} as ElectronE2eRuntime, runRoot: 'synthetic',
      lifetime: { readRemainingWorkMilliseconds: () => 1000 },
      readRelaunchCount: () => scenarioId === selectorRecoveryScenarioId ? 1 : 0,
    }, async () => { calls++; return { exitCode: 0, output: '' }; })).rejects.toThrow('STARTUP_INVALID');
    expect(calls).toBe(0);
  }
});

test('SYS-SELECTOR-BACKEND-001 @security delegates startup unchanged and never accepts failed shutdown', async () => {
  for (const operation of ['stop', 'stopForUpdate', 'stopForRestore'] as const) {
    let resolveStart!: (handle: DesktopBackendHandle) => void;
    let failClose = true;
    let observedId: string | undefined;
    let observedOptions: StartDesktopBackendOptions | undefined;
    const original = new Error('synthetic shutdown failure');
    const close = async (id?: string) => {
      observedId = id;
      if (failClose) throw original;
    };
    const raw: DesktopBackendHandle = {
      port: 12345, onUnexpectedExit() {},
      async stop() { await close(); return 'forced'; }, stopForUpdate: close, stopForRestore: close,
    };
    const options = {} as StartDesktopBackendOptions;
    const observed = observeSelectorTestBackend(input => {
      observedOptions = input;
      return new Promise(resolve => { resolveStart = resolve; });
    });
    const pending = observed.startBackend(options);
    expect(observedOptions === options).toBe(true);
    expect(observed.snapshot()).toEqual({ starts: 1, running: false, port: undefined });
    resolveStart(raw);
    const handle = await pending;
    expect(observed.snapshot()).toEqual({ starts: 1, running: true, port: raw.port });
    const stop = () => operation === 'stop' ? handle.stop() : handle[operation]('synthetic-operation');
    await expect(stop()).rejects.toBe(original);
    expect(observed.snapshot().running).toBe(true);
    failClose = false;
    expect(await stop()).toBe(operation === 'stop' ? 'forced' : undefined);
    expect(observedId).toBe(operation === 'stop' ? undefined : 'synthetic-operation');
    expect(observed.snapshot()).toEqual({ starts: 1, running: false, port: undefined });
  }
});

test('SYS-SELECTOR-BACKEND-002 @security preserves startup failure and unexpected-exit callbacks', async () => {
  const original = new Error('synthetic startup failure');
  const failed = observeSelectorTestBackend(async () => { throw original; });
  await expect(failed.startBackend({} as StartDesktopBackendOptions)).rejects.toBe(original);
  expect(failed.snapshot()).toEqual({ starts: 1, running: false, port: undefined });
  let onExit!: () => void;
  let notified = false;
  const observed = observeSelectorTestBackend(async () => ({
    port: 12345, onUnexpectedExit(callback) { onExit = callback; },
    async stop() { return 'exited'; }, async stopForUpdate() {}, async stopForRestore() {},
  }));
  const handle = await observed.startBackend({} as StartDesktopBackendOptions);
  handle.onUnexpectedExit(() => { notified = true; });
  onExit();
  expect(notified).toBe(true);
  expect(observed.snapshot()).toEqual({ starts: 1, running: false, port: undefined });
});

test('SYS-SELECTOR-BACKEND-003 @security accepts only a bound real port or a backendless selector observation', async () => {
  const selector = { scenarioId: selectorCreateScenarioId, starts: 0, running: false, port: undefined };
  const business = { ...selector, starts: 1, running: true, port: 12345 };
  const application = (observation: unknown) => ({ evaluate: async () => observation }) as unknown as ElectronApplication;
  expect(await readSelectorTestBackendPort(application(selector))).toBeUndefined();
  expect(await readSelectorTestBackendPort(application(business))).toBe(12345);
  for (const observation of [
    { ...selector, port: 12345 }, { ...business, running: false }, { ...business, starts: 2 },
    { ...business, scenarioId: selectorRecoveryScenarioId },
    ...[undefined, 0, -1, 1.5, 65536, '12345'].map(port => ({ ...business, port })),
  ]) {
    await expect(readSelectorTestBackendPort(application(observation))).rejects.toThrow('PORT_UNVERIFIED');
  }
  const original = new Error('synthetic observation failure');
  await expect(readSelectorTestBackendPort({ evaluate: async () => { throw original; } } as unknown as ElectronApplication))
    .rejects.toBe(original);
});
