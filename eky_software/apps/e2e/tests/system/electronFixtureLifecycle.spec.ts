import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { errors, expect, test, type ElectronApplication, type Page } from '@playwright/test';

import { createE2eRunRoot } from '../../src/environment/createE2eRunRoot.js';
import { removeE2eRunRoot } from '../../src/environment/removeE2eRunRoot.js';
import {
  finishIsolatedElectronTest,
  reportElectronLifecycleEvidence,
} from '../../src/fixtures/isolatedElectronTest.js';
import { launchElectronRuntime, type ElectronLaunchObservation } from '../../src/fixtures/launchElectronRuntime.js';
import { ELECTRON_E2E_FIRST_WINDOW_TIMEOUT_MILLISECONDS } from '../../src/fixtures/electronLaunchBudgets.js';
import { stopOwnedElectronRuntime } from '../../src/fixtures/stopOwnedElectronRuntime.js';

test.describe('SYS-ELECTRON-LIFECYCLE-001 @critical @security', () => {
  test('connects, transfers ownership, gets a window and waits for DOM in order', async () => {
    const fixture = launchFixture();
    await expect(fixture.run()).resolves.toEqual({ electronApp: fixture.application, page: fixture.page });
    expect(fixture.calls).toEqual(['connect', 'owned', 'window', 'domcontentloaded']);
    expect(fixture.observations).toEqual([
      { phase: 'playwrightConnect', status: 'started', reason: 'none' },
      { phase: 'playwrightConnect', status: 'completed', reason: 'none' },
      { phase: 'firstWindow', status: 'started', reason: 'none' },
      { phase: 'firstWindow', status: 'completed', reason: 'none' },
      { phase: 'domContentLoaded', status: 'started', reason: 'none' },
      { phase: 'domContentLoaded', status: 'completed', reason: 'none' },
    ]);
  });

  test('connection timeout is not claimed to be a process exit', async () => {
    const fixture = launchFixture({ connect: new errors.TimeoutError('private connection detail') });
    await expect(fixture.run()).rejects.toThrow('phase=playwrightConnect reason=timeout');
    expect(fixture.calls).toEqual(['connect']);
    expect(fixture.observations).toHaveLength(2);
  });

  test('missing window retains the connected runtime and never waits for DOM', async () => {
    const fixture = launchFixture({ window: new errors.TimeoutError('private window detail') });
    await expect(fixture.run()).rejects.toThrow('phase=firstWindow reason=timeout');
    expect(fixture.calls).toEqual(['connect', 'owned', 'window']);
    expect(fixture.owned()).toBe(fixture.application);
    expect(fixture.observations.at(-1)).toEqual({ phase: 'firstWindow', status: 'failed', reason: 'timeout' });
  });

  test('window returned but DOM timeout is reported as a different failure', async () => {
    const fixture = launchFixture({ dom: new errors.TimeoutError('private load detail') });
    await expect(fixture.run()).rejects.toThrow('phase=domContentLoaded reason=timeout');
    expect(fixture.calls).toEqual(['connect', 'owned', 'window', 'domcontentloaded']);
    expect(fixture.observations).toContainEqual({ phase: 'firstWindow', status: 'completed', reason: 'none' });
    expect(fixture.observations.at(-1)).toEqual({ phase: 'domContentLoaded', status: 'failed', reason: 'timeout' });
  });

  test('observed process exit and page closure remain distinct from unknown failures', async () => {
    for (const [mode, reason] of [['process', 'processExited'], ['page', 'pageClosed'], ['unknown', 'unknown']] as const) {
      const fixture = launchFixture({ dom: new Error('private URL session environment'), terminal: mode });
      await expect(fixture.run()).rejects.toThrow(`phase=domContentLoaded reason=${reason}`);
      expect(fixture.observations.at(-1)?.reason).toBe(reason);
      expect(JSON.stringify(fixture.observations)).not.toMatch(/private|URL|session|environment/);
      expect(Object.keys(fixture.observations.at(-1) ?? {}).sort()).toEqual(['phase', 'reason', 'status']);
    }
  });

  test('an observer failure neither masks startup failure nor changes success', async () => {
    await expect(launchFixture({ observerFails: true }).run()).resolves.toHaveProperty('page');
    await expect(launchFixture({ observerFails: true, window: new errors.TimeoutError('private') }).run())
      .rejects.toThrow('phase=firstWindow reason=timeout');
  });

  test('keeps the original process handle after Playwright releases its application channel', async () => {
    const fixture = launchFixture({ terminal: 'process' });
    await expect(fixture.run()).resolves.toHaveProperty('page');
    expect(fixture.application.process()).toBeUndefined();
    const ownedProcess = fixture.ownedProcess();
    expect(ownedProcess).toBeDefined();
    expect(ownedProcess?.exitCode).toBe(1);
    let stoppedProcess: unknown;
    await expect(stopOwnedElectronRuntime(
      { async close() { throw new Error('synthetic released channel'); } },
      ownedProcess!,
      async (child) => { stoppedProcess = child; },
    )).resolves.toBeUndefined();
    expect(stoppedProcess).toBe(ownedProcess);
  });

  test('removes the real test root only after all cleanup boundaries complete', async () => {
    const fixture = cleanupFixture();
    try {
      await expect(fixture.finish()).resolves.toBeUndefined();
      expect(fixture.calls).toEqual(['api', 'runtime', 'port', 'remove', 'report']);
      expect(existsSync(fixture.root)).toBe(false);
      expect(fixture.results).toEqual([{ api: 'completed', runtime: 'completed', port: 'released', runRoot: 'removed' }]);
    } finally { await removeE2eRunRootIfPresent(fixture.root); }
  });

  test('runtime or port uncertainty retains actual evidence and fails the call', async () => {
    for (const fail of ['api', 'runtime', 'port'] as const) {
      const fixture = cleanupFixture(fail);
      try {
        await expect(fixture.finish()).rejects.toThrow('E2E_ELECTRON_CLEANUP_FAILED');
        expect(fixture.calls).toEqual(['api', 'runtime', 'port', 'report']);
        expect(existsSync(join(fixture.root, 'synthetic-evidence.json'))).toBe(true);
        expect(fixture.results.at(-1)).toHaveProperty('runRoot', 'retained');
      } finally { await removeE2eRunRootIfPresent(fixture.root); }
    }
  });

  test('preserves the exact original exception even when cleanup or reporting fails', async () => {
    const original = new Error('original test failure');
    for (const fail of ['runtime', 'port', 'remove', 'report', undefined] as const) {
      const fixture = cleanupFixture(fail);
      try {
        await expect(fixture.finish({ error: original })).rejects.toBe(original);
        expect(fixture.results).toHaveLength(1);
        if (fail === 'runtime' || fail === 'port' || fail === 'remove') expect(existsSync(fixture.root)).toBe(true);
      } finally { await removeE2eRunRootIfPresent(fixture.root); }
    }
  });

  test('Playwright-recorded body failure keeps its outcome and separate cleanup evidence', async () => {
    const fixture = cleanupFixture('runtime');
    try {
      // The fixture must not throw a replacement error during body-failure teardown.
      await expect(fixture.finish(undefined, true)).resolves.toBeUndefined();
      expect(fixture.results).toEqual([{ api: 'completed', runtime: 'unverified', port: 'released', runRoot: 'retained' }]);
      expect(existsSync(fixture.root)).toBe(true);
    } finally { await removeE2eRunRootIfPresent(fixture.root); }
  });

  test('first failed startup keeps safe per-attempt evidence before any retry', async ({}, testInfo) => {
    const fixture = launchFixture({ dom: new errors.TimeoutError('private URL session environment') });
    const root = createE2eRunRoot();
    let failure: { error: unknown } | undefined;
    try {
      try { await fixture.run(); } catch (error) { failure = { error }; }
      expect(failure).toBeDefined();
      let stoppedApplication: ElectronApplication | undefined;
      await expect(finishIsolatedElectronTest({
        failure, testAlreadyFailed: false,
        async disposeApi() {},
        async closeRuntime() { stoppedApplication = fixture.owned(); },
        async releasePort() {},
        removeRoot: () => removeE2eRunRoot(root),
        report: (cleanup) => reportElectronLifecycleEvidence(testInfo, {
          launch: fixture.observations,
          observationsTruncated: false,
          cleanup,
        }),
      })).rejects.toBe(failure?.error);
      expect(stoppedApplication).toBe(fixture.application);
      expect(existsSync(root)).toBe(false);
      const attachment = testInfo.attachments.find((item) => item.name === 'electron-lifecycle');
      expect(attachment).toBeDefined();
      const bytes = attachment?.body ?? readFileSync(attachment!.path!);
      const evidence = JSON.parse(bytes.toString('utf8'));
      expect(readFileSync(testInfo.outputPath('electron-lifecycle.json'))).toEqual(bytes);
      expect(Object.keys(evidence).sort()).toEqual(['attempt', 'cleanup', 'launch', 'observationsTruncated', 'schemaVersion']);
      expect(evidence.attempt).toBe(0);
      expect(evidence.launch.at(-1)).toEqual({ phase: 'domContentLoaded', status: 'failed', reason: 'timeout' });
      expect(evidence.cleanup.runRoot).toBe('removed');
      expect(bytes.toString('utf8')).not.toMatch(/private|URL|session|environment/);
    } finally { await removeE2eRunRootIfPresent(root); }
  });

  test('a failed removal or evidence attachment cannot silently pass a clean test', async () => {
    for (const fail of ['remove', 'report'] as const) {
      const fixture = cleanupFixture(fail);
      try {
        await expect(fixture.finish()).rejects.toThrow(fail === 'remove' ? 'E2E_ELECTRON_CLEANUP_FAILED' : 'E2E_ELECTRON_EVIDENCE_FAILED');
      } finally { await removeE2eRunRootIfPresent(fixture.root); }
    }
  });
});

function launchFixture(fault: {
  connect?: Error; window?: Error; dom?: Error;
  terminal?: 'process' | 'page' | 'unknown'; observerFails?: boolean;
} = {}) {
  const calls: string[] = [];
  const observations: ElectronLaunchObservation[] = [];
  let owned: ElectronApplication | undefined;
  let ownedProcess: ReturnType<ElectronApplication['process']> | undefined;
  const child = { exitCode: null as number | null, signalCode: null };
  let closed = false;
  const page = {
    isClosed: () => closed,
    async waitForLoadState(state: string) {
      calls.push(state);
      if (fault.terminal === 'process') child.exitCode = 1;
      if (fault.terminal === 'page') closed = true;
      if (fault.dom) throw fault.dom;
    },
  } as Page;
  const application = {
    process: () => child.exitCode === null ? child : undefined,
    async firstWindow(options: { timeout: number }) {
      expect(options.timeout).toBe(ELECTRON_E2E_FIRST_WINDOW_TIMEOUT_MILLISECONDS);
      calls.push('window');
      if (fault.window) throw fault.window;
      return page;
    },
  } as ElectronApplication;
  return { calls, observations, application, page, owned: () => owned, ownedProcess: () => ownedProcess,
    run: () => launchElectronRuntime({
      async launch() { calls.push('connect'); if (fault.connect) throw fault.connect; return application; },
      connected(value, childProcess) { owned = value; ownedProcess = childProcess; calls.push('owned'); },
      observe(value) { if (fault.observerFails) throw new Error('private observer detail'); observations.push(value); },
    }),
  };
}

function cleanupFixture(fail?: 'api' | 'runtime' | 'port' | 'remove' | 'report') {
  const root = createE2eRunRoot();
  writeFileSync(join(root, 'synthetic-evidence.json'), '{}', { flag: 'wx' });
  const calls: string[] = [];
  const results: unknown[] = [];
  const step = async (name: string) => { calls.push(name); if (name === fail) throw new Error('private cleanup error'); };
  return { root, calls, results,
    finish: (failure?: { error: unknown }, testAlreadyFailed = false) => finishIsolatedElectronTest({
      failure, testAlreadyFailed,
      disposeApi: () => step('api'), closeRuntime: () => step('runtime'), releasePort: () => step('port'),
      async removeRoot() { await step('remove'); await removeE2eRunRoot(root); },
      async report(result) { results.push(result); await step('report'); },
    }),
  };
}

async function removeE2eRunRootIfPresent(root: string) {
  if (existsSync(root)) await removeE2eRunRoot(root);
}
