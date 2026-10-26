import { expect, test } from '@playwright/test';

import { readSelectorRecoveryRelease, selectorRecoveryScenarioId } from '../../../desktop/e2e/electronSelectorRecoveryRelease.js';
import type { ElectronE2eRuntime } from '../../src/environment/createElectronE2eRuntime.js';
import { DirectElectronRunFailure } from '../../src/environment/runOwnedWindowsElectron.js';
import { runElectronSelectorRecoveryStartup } from '../../src/fixtures/runElectronSelectorRecoveryStartup.js';
import { ELECTRON_E2E_PROCESS_CONNECT_TIMEOUT_MILLISECONDS } from '../../src/fixtures/electronLaunchBudgets.js';

test('SYS-SELECTOR-RECOVERY-RUN-001 @security limits synthetic release admission to the named scenario', () => {
  expect(readSelectorRecoveryRelease('DESK-SELECTOR-READY-001')).toBeUndefined();
  expect(readSelectorRecoveryRelease(`${selectorRecoveryScenarioId}-OTHER`)).toBeUndefined();
  expect(readSelectorRecoveryRelease(selectorRecoveryScenarioId)).toMatchObject({
    appVersion: '0.2.0', buildRevision: 'a'.repeat(40), releaseChannel: 'pilot',
  });
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
  for (const scenarioId of [selectorRecoveryScenarioId, 'DESK-OTHER-001']) {
    let calls = 0;
    await expect(runElectronSelectorRecoveryStartup({
      scenarioId, runtime: {} as ElectronE2eRuntime, runRoot: 'synthetic',
      lifetime: { readRemainingWorkMilliseconds: () => 1000 },
      readRelaunchCount: () => scenarioId === selectorRecoveryScenarioId ? 1 : 0,
    }, async () => { calls++; return { exitCode: 0, output: '' }; })).rejects.toThrow('STARTUP_INVALID');
    expect(calls).toBe(0);
  }
});
