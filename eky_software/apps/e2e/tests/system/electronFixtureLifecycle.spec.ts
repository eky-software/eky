import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { errors, expect, test, type ElectronApplication, type Page } from '@playwright/test';

import { createE2eRunRoot } from '../../src/environment/createE2eRunRoot.js';
import { removeE2eRunRoot } from '../../src/environment/removeE2eRunRoot.js';
import {
  finishIsolatedElectronTest,
  prepareElectronWorkspaceBackup,
  reportElectronLifecycleEvidence,
} from '../../src/fixtures/isolatedElectronTest.js';
import {
  E2eBackendStartupFailure,
  type E2eBackendStartupFailureEvidence,
} from '../../src/environment/startE2eBackendProcess.js';
import { captureElectronStartupObservation, launchElectronRuntime, type ElectronLaunchObservation } from '../../src/fixtures/launchElectronRuntime.js';
import {
  createElectronE2eStartupObservation,
  parseElectronE2eStartupObservation,
} from '../../../desktop/e2e/electronE2eStartupObservation.js';
import { ELECTRON_E2E_FIRST_WINDOW_TIMEOUT_MILLISECONDS } from '../../src/fixtures/electronLaunchBudgets.js';
import { stopOwnedElectronRuntime } from '../../src/fixtures/stopOwnedElectronRuntime.js';
import { createElectronLaunchFailureCapture } from '../../src/fixtures/captureElectronLaunchFailure.js';
import { createBackendOperationalEvent } from '../../../backend/src/observability/createOperationalEvent.js';
import { createBackendOperationalLogger } from '../../../backend/src/observability/infrastructure/createBackendOperationalLogger.js';

test.describe('SYS-ELECTRON-LIFECYCLE-001 @critical @security', () => {
  test('backup preparation failure retains the root and writes safe evidence on the first attempt', async ({}, testInfo) => {
    const root = createE2eRunRoot();
    const marker = join(root, 'synthetic-evidence.json');
    writeFileSync(marker, '{}', { flag: 'wx' });
    const original = new E2eBackendStartupFailure({
      errorCode: 'E2E_BACKEND_HEALTH_TIMEOUT',
      spawnObserved: true,
      exitedBeforeCleanup: false,
      listeningNotice: 'notObserved',
      cleanup: { processTree: 'unverified', port: 'released' },
      privateDetail: 'private process output',
    } as E2eBackendStartupFailureEvidence);
    Object.assign(original, { privateDetail: 'private path and session' });
    try {
      await expect(prepareElectronWorkspaceBackup({
        async prepare() { throw original; },
        report: (preparation) => reportElectronLifecycleEvidence(testInfo, {
          launch: [], observationsTruncated: false,
          cleanup: { api: 'notStarted', runtime: 'notStarted', port: 'notStarted', runRoot: 'retained' },
          preparation,
        }),
      })).rejects.toBe(original);
      expect(existsSync(marker)).toBe(true);
      const text = readFileSync(testInfo.outputPath('electron-lifecycle.json'), 'utf8');
      const evidence = JSON.parse(text);
      expect(evidence.attempt).toBe(0);
      expect(evidence.launch).toEqual([]);
      expect(evidence.cleanup.runRoot).toBe('retained');
      expect(evidence.preparation).toEqual({ stage: 'workspaceBackup', backend: original.evidence });
      expect(evidence.preparation.backend.cleanup.processTree).toBe('unverified');
      expect(Object.isFrozen(original.evidence)).toBe(true);
      expect(Object.isFrozen(original.evidence.cleanup)).toBe(true);
      expect(Object.keys(evidence.preparation.backend).sort()).toEqual([
        'cleanup', 'errorCode', 'exitedBeforeCleanup', 'listeningNotice', 'spawnObserved',
      ]);
      expect(text).not.toMatch(/private|session|path|http/);
      expect(testInfo.attachments.some((item) => item.name === 'electron-lifecycle')).toBe(true);
    } finally { await removeE2eRunRootIfPresent(root); }
  });

  test('preparation reporting cannot replace an unknown failure or turn it into success', async () => {
    const original = new Error('private unknown preparation failure');
    let reported: unknown;
    await expect(prepareElectronWorkspaceBackup({
      async prepare() { throw original; },
      async report(value) { reported = value; throw new Error('private report failure'); },
    })).rejects.toBe(original);
    expect(reported).toEqual({ stage: 'workspaceBackup', backend: null });
    await expect(prepareElectronWorkspaceBackup({
      async prepare() { return undefined; },
      async report() { throw new Error('must not report successful preparation'); },
    })).resolves.toBeUndefined();
  });

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

  test('successful launch does not request backend logs or main-process diagnostics', async () => {
    const capture = createElectronLaunchFailureCapture();
    const root = createE2eRunRoot();
    let mainReads = 0;
    try {
      const fixture = launchFixture({}, (observation) => capture.observe(observation, {
        runRoot: root,
        userDataPath: join(root, 'missing-user-data'),
        runtimeInstanceId: '11111111-1111-4111-8111-111111111111',
      }, async () => { mainReads += 1; return undefined; }));
      await expect(fixture.run()).resolves.toHaveProperty('page');
      expect(mainReads).toBe(0);
      expect(capture.finish()).toEqual({
        startupCapture: { status: 'notRequested' },
        backendStartupLogs: { status: 'notRequested' },
      });
    } finally { await removeE2eRunRootIfPresent(root); }
  });

  test('first launch failure snapshots real backend logs before cleanup and retains only that generation in the attachment', async ({}, testInfo) => {
    const root = createE2eRunRoot();
    const userDataPath = join(root, 'worker', 'desktop-user-data');
    mkdirSync(userDataPath, { recursive: true, mode: 0o700 });
    const runtime = {
      runRoot: root,
      userDataPath,
      runtimeInstanceId: '11111111-1111-4111-8111-111111111111',
    };
    const identity = {
      appVersion: '0.0.0-e2e', buildRevision: 'development',
      runtimeInstanceId: runtime.runtimeInstanceId,
    };
    const logger = createBackendOperationalLogger(join(userDataPath, 'runtime', 'logs'), identity);
    const write = (eventName: 'backend.starting' | 'database.opening' | 'backend.started' | 'backend.shutdownStarted') =>
      logger.write(createBackendOperationalEvent({ eventName }, identity));
    const capture = createElectronLaunchFailureCapture();
    let mainReads = 0;
    const fixture = launchFixture({ window: new errors.TimeoutError('private window detail') }, (observation) => {
      capture.observe(observation, runtime, async () => {
        mainReads += 1;
        throw new Error('private main-channel failure');
      });
    });
    let failure: { error: unknown } | undefined;
    try {
      write('backend.starting');
      write('database.opening');
      logger.write(createBackendOperationalEvent({ eventName: 'backend.started' }, {
        ...identity, runtimeInstanceId: '22222222-2222-4222-8222-222222222222',
      }));
      try { await fixture.run(); } catch (error) { failure = { error }; }
      expect(failure?.error).toBeInstanceOf(Error);
      const beforeCleanup = capture.finish();
      const beforeText = JSON.stringify(beforeCleanup.backendStartupLogs);
      expect(beforeText).toContain('backend.starting');
      expect(beforeText).toContain('database.opening');
      expect(beforeText).not.toContain('backend.started');
      expect(mainReads).toBe(1);
      await expect(finishIsolatedElectronTest({
        failure, testAlreadyFailed: false,
        async disposeApi() {},
        async closeRuntime() {
          write('backend.started');
          write('backend.shutdownStarted');
          capture.observe({ phase: 'firstWindow', status: 'failed', reason: 'unknown' }, {
            ...runtime, runtimeInstanceId: '22222222-2222-4222-8222-222222222222',
          }, async () => { mainReads += 1; return undefined; });
        },
        async releasePort() {},
        removeRoot: () => removeE2eRunRoot(root),
        report: (cleanup) => reportElectronLifecycleEvidence(testInfo, {
          launch: fixture.observations, observationsTruncated: false, cleanup,
          ...capture.finish(),
        }),
      })).rejects.toBe(failure?.error);
      expect(capture.finish()).toEqual(beforeCleanup);
      expect(mainReads).toBe(1);
      expect(existsSync(root)).toBe(false);
      const text = readFileSync(testInfo.outputPath('electron-lifecycle.json'), 'utf8');
      const report = JSON.parse(text);
      expect(report.backendStartupLogs).toEqual(beforeCleanup.backendStartupLogs);
      expect(report.startupCapture).toEqual({ status: 'unavailable' });
      expect(report.launch.at(-1)).toEqual({ phase: 'firstWindow', status: 'failed', reason: 'timeout' });
      expect(report.cleanup.runRoot).toBe('removed');
      expect(text).not.toMatch(/backend\.started|backend\.shutdownStarted|private|11111111|22222222|desktop-user-data/);
      expect(testInfo.attachments.some((item) => item.name === 'electron-lifecycle')).toBe(true);
    } finally { await removeE2eRunRootIfPresent(root); }
  });

  test('startup memory keeps only bounded immutable checkpoint observations', () => {
    let elapsed = 0;
    const observation = createElectronE2eStartupObservation(() => elapsed);
    observation.record('waitingForAppReady');
    elapsed = 25;
    observation.record('appReady');
    const snapshot = observation.snapshot();
    expect(snapshot.schemaVersion).toBe(2);
    expect(snapshot.backendStartup).toEqual({ status: 'unobserved' });
    expect(snapshot.checkpoints).toEqual([
      { checkpoint: 'waitingForAppReady', elapsedMs: 0 },
      { checkpoint: 'appReady', elapsedMs: 25 },
    ]);
    expect(parseElectronE2eStartupObservation(snapshot)).toEqual(snapshot);
    for (let i = 0; i < 20; i += 1) observation.record('backendStartRequested');
    expect(observation.snapshot().checkpoints).toHaveLength(16);
    expect(observation.snapshot().truncated).toBe(true);
    expect(snapshot.checkpoints).toHaveLength(2);
    expect(Object.isFrozen(snapshot.checkpoints)).toBe(true);
    for (const unsafe of [
      { ...snapshot, session: 'private' },
      { ...snapshot, checkpoints: [{ checkpoint: 'private', elapsedMs: 0 }] },
      { ...snapshot, checkpoints: [{ checkpoint: 'appReady', elapsedMs: 0, path: 'private' }] },
      { ...snapshot, checkpoints: [{ checkpoint: 'appReady', elapsedMs: Number.NaN }] },
      { ...snapshot, checkpoints: new Array(17).fill(snapshot.checkpoints[0]) },
      { ...snapshot, schemaVersion: 1 },
      { ...snapshot, backendStartup: undefined },
      { ...snapshot, backendStartup: { status: 'unobserved', stage: 'moduleImport' } },
    ]) expect(parseElectronE2eStartupObservation(unsafe)).toBeUndefined();
  });

  test('backend progress keeps one immutable stage observed on the main clock, independently of checkpoints', () => {
    let now = 1_000;
    const observation = createElectronE2eStartupObservation(() => now);
    for (let i = 0; i < 20; i += 1) observation.record('backendStartRequested');
    now = 1_125;
    observation.recordBackendStartupStage('moduleImport');
    const importing = observation.snapshot();
    expect(importing.backendStartup).toEqual({
      status: 'observed', stage: 'moduleImport', elapsedMs: 125,
    });
    expect(Object.isFrozen(importing.backendStartup)).toBe(true);
    now = 1_250;
    observation.recordBackendStartupStage('backendStart');
    const starting = observation.snapshot();
    expect(starting.backendStartup).toEqual({
      status: 'observed', stage: 'backendStart', elapsedMs: 250,
    });
    expect(importing.backendStartup).toEqual({
      status: 'observed', stage: 'moduleImport', elapsedMs: 125,
    });
    expect(starting.checkpoints).toHaveLength(16);
    expect(starting.truncated).toBe(true);
    expect(parseElectronE2eStartupObservation(starting)).toEqual(starting);
    for (const backendStartup of [
      { status: 'observed', stage: 'unknown', elapsedMs: 125 },
      { status: 'observed', stage: 'moduleImport' },
      { status: 'observed', stage: 'moduleImport', elapsedMs: -1 },
      { status: 'observed', stage: 'moduleImport', elapsedMs: Number.NaN },
      { status: 'observed', stage: 'moduleImport', elapsedMs: Number.POSITIVE_INFINITY },
      { status: 'observed', stage: 'moduleImport', elapsedMs: 125, path: 'private' },
      { status: 'complete', stage: 'moduleImport', elapsedMs: 125 },
      ['moduleImport'], null,
    ]) expect(parseElectronE2eStartupObservation({ ...starting, backendStartup })).toBeUndefined();
  });

  test('captured backend progress survives the failure cleanup and cannot leak a later update', async () => {
    const observation = createElectronE2eStartupObservation(() => 0);
    observation.recordBackendStartupStage('moduleImport');
    const finishCapture = captureElectronStartupObservation(async () => observation.snapshot());
    await Promise.resolve();
    const fixture = cleanupFixture();
    try {
      const original = new Error('synthetic startup failure');
      await expect(fixture.finish({ error: original })).rejects.toBe(original);
      const captured = finishCapture();
      expect(captured).toEqual({ status: 'captured', observation: observation.snapshot() });
      observation.recordBackendStartupStage('backendStart');
      expect(finishCapture()).toEqual(captured);
      expect(existsSync(fixture.root)).toBe(false);
    } finally { await removeE2eRunRootIfPresent(fixture.root); }
  });

  test('an unavailable or late startup read cannot delay cleanup or replace the original failure', async () => {
    const original = new Error('original window timeout');
    let resolveRead!: (value: unknown) => void;
    const read = new Promise<unknown>((resolve) => { resolveRead = resolve; });
    const finishCapture = captureElectronStartupObservation(() => read);
    const fixture = cleanupFixture();
    try {
      await expect(fixture.finish({ error: original })).rejects.toBe(original);
      expect(existsSync(fixture.root)).toBe(false);
      expect(finishCapture()).toEqual({ status: 'unavailable' });
      resolveRead(createElectronE2eStartupObservation().snapshot());
      await read;
      expect(finishCapture()).toEqual({ status: 'unavailable' });
      for (const readFailure of [
        () => { throw new Error('private read failure'); },
        () => Promise.reject(new Error('private read failure')),
        () => Promise.resolve({ session: 'private' }),
      ]) {
        const finish = captureElectronStartupObservation(readFailure);
        await Promise.resolve();
        expect(finish()).toEqual({ status: 'unavailable' });
      }
    } finally { resolveRead(undefined); await removeE2eRunRootIfPresent(fixture.root); }
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
    const startup = createElectronE2eStartupObservation();
    startup.record('backendReady');
    startup.recordBackendStartupStage('readyNotification');
    const finishCapture = captureElectronStartupObservation(async () => startup.snapshot());
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
          startupCapture: finishCapture(),
        }),
      })).rejects.toBe(failure?.error);
      expect(stoppedApplication).toBe(fixture.application);
      expect(existsSync(root)).toBe(false);
      const attachment = testInfo.attachments.find((item) => item.name === 'electron-lifecycle');
      expect(attachment).toBeDefined();
      const bytes = attachment?.body ?? readFileSync(attachment!.path!);
      const evidence = JSON.parse(bytes.toString('utf8'));
      expect(readFileSync(testInfo.outputPath('electron-lifecycle.json'))).toEqual(bytes);
      expect(Object.keys(evidence).sort()).toEqual(['attempt', 'cleanup', 'launch', 'observationsTruncated', 'schemaVersion', 'startupCapture']);
      expect(evidence.startupCapture).toEqual({ status: 'captured', observation: startup.snapshot() });
      expect(evidence.startupCapture.observation.backendStartup.stage).toBe('readyNotification');
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
} = {}, observe?: (observation: ElectronLaunchObservation) => void) {
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
      observe(value) { if (fault.observerFails) throw new Error('private observer detail'); observe?.(value); observations.push(value); },
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
