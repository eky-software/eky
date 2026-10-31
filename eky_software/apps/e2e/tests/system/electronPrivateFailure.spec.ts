import fs from 'node:fs';
import { dirname, join } from 'node:path';
import { mock } from 'node:test';
import { expect, test } from '@playwright/test';

import { createRunnerFailureSink } from '../../../../test-reporters/runnerFailureEvidence.mjs';
import { createElectronE2eStartupExceptionCapture, electronE2eStartupExceptionPath } from '../../../desktop/e2e/electronE2eStartupException.js';
import { runSafeDesktopStartup } from '../../../desktop/src/main/earlyStartup.js';
import { projectExceptionChain, STARTUP_EXCEPTION_LIMITS } from '../../../desktop/src/main/startupExceptionEvidence.js';
import { createE2eRunRoot } from '../../src/environment/createE2eRunRoot.js';
import { removeE2eRunRoot } from '../../src/environment/removeE2eRunRoot.js';
import { createE2eFixtureLifetime } from '../../src/environment/e2eFixtureLifetime.js';
import { closeOwnedWindowsElectronRuntime } from '../../src/fixtures/closeOwnedWindowsElectronRuntime.js';
import { captureElectronPrivateCloseFailure, readElectronStartupException, reportElectronCloseFailure,
  reportElectronStartupException, type ElectronPrivateCloseFailure } from '../../src/fixtures/reportElectronPrivateFailure.js';

const runtimeInstanceId = '11111111-1111-4111-8111-111111111111';
const otherRuntime = '22222222-2222-4222-8222-222222222222';
const secret = 's'.repeat(43);

test.describe('SYS-ELECTRON-PRIVATE-FAILURE-001 @critical @security', () => {
  let fixture: ReturnType<typeof prepare>;
  test.beforeEach(() => { fixture = prepare(); });
  test.afterEach(async () => { mock.restoreAll(); await removeE2eRunRoot(fixture.runRoot); });

  test('preserves the first exception before safe mapping and parent-owned sink delivery', async ({}, testInfo) => {
    const capture = createElectronE2eStartupExceptionCapture(fixture.configPath, fixture.env)!;
    expect(capture).toBeDefined();
    const original = new Error(`SYNTHETIC-ORIGINAL ${secret}`, { cause: new Error('SYNTHETIC-CAUSE') });
    let exitCode;
    let safeCode;
    await runSafeDesktopStartup({
      loadRuntime: async () => { capture(original, 'runtimeStartup'); throw new Error('DESKTOP_START_FAILED'); },
      startRuntime: async () => undefined, waitUntilReady: async () => undefined,
      observeStartupException: error => capture(error, 'earlyStartup'),
      onFailure: async code => { safeCode = code; expect(await capture.waitForDelivery()).toBe('recorded'); },
      exitApplication: code => { exitCode = code; },
    });
    expect(exitCode).toBe(1);
    expect(safeCode).toBe('DESKTOP_START_FAILED');
    const originalBytes = fs.readFileSync(fixture.path, 'utf8');
    expect(originalBytes).not.toContain(secret);
    const read = readElectronStartupException(fixture);
    expect(read.status).toBe('captured');
    if (read.status !== 'captured') throw new Error('Missing original');
    expect(read.evidence.stage).toBe('runtimeStartup');
    expect(read.evidence.exception.chain.map(part => part.message)).toEqual(['SYNTHETIC-ORIGINAL [redacted]', 'SYNTHETIC-CAUSE']);
    const sinkRoot = join(fixture.runRoot, 'sink');
    fs.mkdirSync(sinkRoot);
    const context = { ...testInfo, title: 'synthetic child startup', testId: 'parent-case', retry: 2, annotations: [] };
    await reportElectronStartupException({ ...fixture, testInfo: context, absentRuntimeInstanceId: runtimeInstanceId, secrets: [secret] },
      createRunnerFailureSink({ env: {}, tempRoot: sinkRoot }));
    expect(context.annotations).toEqual([{ type: 'electron-startup-exception', description: 'recorded' }]);
    const directory = join(sinkRoot, fs.readdirSync(sinkRoot)[0]!);
    const filename = fs.readdirSync(directory).find(name => !name.includes('summary'))!;
    const record = JSON.parse(fs.readFileSync(join(directory, filename), 'utf8'));
    expect(record.phase).toBe('electronStartup-runtimeStartup');
    expect(record.test).toMatchObject({ id: `parent-case:${runtimeInstanceId}`, attempt: 2 });
    expect(record.exception.chain).toEqual(read.evidence.exception.chain);
    expect(fs.readFileSync(fixture.path, 'utf8')).toBe(originalBytes);
  });

  test('success does not create evidence and disabled or invalid admission cannot activate capture', async () => {
    const capture = createElectronE2eStartupExceptionCapture(fixture.configPath, fixture.env)!;
    expect(await capture.waitForDelivery()).toBe('notObserved');
    expect(fs.existsSync(fixture.path)).toBe(false);
    expect(createElectronE2eStartupExceptionCapture(fixture.configPath, { ...fixture.env, EKY_E2E: undefined })).toBeUndefined();
    expect(createElectronE2eStartupExceptionCapture(fixture.configPath, { ...fixture.env, EKY_ELECTRON_E2E_RUN_ROOT: dirname(fixture.runRoot) })).toBeUndefined();
  });

  test('exclusive delivery cannot overwrite an earlier file or change the safe startup result', async () => {
    fs.writeFileSync(fixture.path, 'earlier evidence', { flag: 'wx' });
    const capture = createElectronE2eStartupExceptionCapture(fixture.configPath, fixture.env)!;
    let exitCode;
    await runSafeDesktopStartup({ loadRuntime: async () => { throw new Error('SYNTHETIC-FIRST'); },
      startRuntime: async () => undefined, waitUntilReady: async () => undefined,
      observeStartupException: error => capture(error, 'earlyStartup'),
      onFailure: async () => { expect(await capture.waitForDelivery()).toBe('failed'); },
      exitApplication: code => { exitCode = code; } });
    expect(exitCode).toBe(1);
    expect(fs.readFileSync(fixture.path, 'utf8')).toBe('earlier evidence');
  });

  test('rejects missing, wrong-generation, malformed, extra-field, partial and oversized sources', () => {
    expect(readElectronStartupException(fixture)).toEqual({ status: 'missing' });
    for (const text of [
      JSON.stringify(record(otherRuntime)) + '\n',
      '{broken\n', JSON.stringify({ ...record(), arbitrary: 'excluded' }) + '\n',
      JSON.stringify(record()), JSON.stringify({ ...record(), exception: { ...record().exception, extra: 'excluded' } }) + '\n',
    ]) {
      fs.writeFileSync(fixture.path, text);
      expect(readElectronStartupException(fixture)).toEqual({ status: 'invalid' });
    }
    fs.writeFileSync(fixture.path, 'x'.repeat(STARTUP_EXCEPTION_LIMITS.fileBytes + 1));
    expect(readElectronStartupException(fixture)).toEqual({ status: 'tooLarge' });
  });

  test('rejects links, external roots and bytes changed while reading, and closes its descriptor', () => {
    fs.writeFileSync(fixture.path, JSON.stringify(record()) + '\n');
    const alias = join(fixture.artifactsRoot, 'hardlink');
    fs.linkSync(fixture.path, alias);
    expect(readElectronStartupException(fixture)).toEqual({ status: 'invalid' });
    fs.unlinkSync(alias);
    expect(readElectronStartupException({ ...fixture, runRoot: dirname(fixture.runRoot) })).toEqual({ status: 'invalid' });
    const read = fs.readSync;
    let descriptor;
    mock.method(fs, 'readSync', ((fd, ...args: Parameters<typeof fs.readSync> extends [number, ...infer P] ? P : never) => {
      descriptor = fd;
      const bytes = Reflect.apply(read, fs, [fd, ...args]);
      fs.appendFileSync(fixture.path, 'changed');
      return bytes;
    }) as typeof fs.readSync);
    expect(readElectronStartupException(fixture)).toEqual({ status: 'sourceChanged' });
    expect(() => fs.fstatSync(descriptor!)).toThrow();
  });

  test('never reads before proven process absence and does not let optional delivery replace failure', async ({}, testInfo) => {
    const open = mock.method(fs, 'openSync', () => { throw new Error('UNEXPECTED_READ'); });
    const context = { ...testInfo, annotations: [] };
    const sink = { record() { throw new Error('UNEXPECTED_RECORD'); }, async flush() { throw new Error('UNEXPECTED_FLUSH'); } };
    await reportElectronStartupException({ ...fixture, absentRuntimeInstanceId: undefined, testInfo: context, secrets: [] }, sink);
    await reportElectronStartupException({ ...fixture, absentRuntimeInstanceId: otherRuntime, testInfo: context, secrets: [] }, sink);
    expect(open.mock.callCount()).toBe(0);
    expect(context.annotations).toEqual([
      { type: 'electron-startup-exception', description: 'unavailable' },
      { type: 'electron-startup-exception', description: 'unavailable' },
    ]);
    mock.restoreAll();
    fs.writeFileSync(fixture.path, JSON.stringify(record()) + '\n');
    await expect(reportElectronStartupException({ ...fixture, absentRuntimeInstanceId: runtimeInstanceId, testInfo: context, secrets: [] }, sink)).resolves.toBeUndefined();
    expect(context.annotations.at(-1)).toEqual({ type: 'electron-startup-exception', description: 'captureFailed' });
  });

  for (const reason of ['failed', 'timedOut'] as const) for (const ownerFails of [false, true]) {
    test(`freezes pre-stop close state for ${reason}, owner failure=${ownerFails}`, async ({}, testInfo) => {
      let workload: 'running' | 'exited' = 'running';
      let captured: ElectronPrivateCloseFailure | undefined;
      const original = new Error(`SYNTHETIC-CLOSE-ORIGINAL ${secret}`, { cause: new Error('SYNTHETIC-CLOSE-CAUSE') });
      const calls: string[] = [];
      await expect(closeOwnedWindowsElectronRuntime({
        application: { close: () => reason === 'failed' ? Promise.reject(original) : new Promise<void>(() => {}) },
        lifetime: createE2eFixtureLifetime(60_000, () => 0),
        observePublicCloseFailure(value, error) {
          calls.push('capture');
          captured = captureElectronPrivateCloseFailure({ runtimeInstanceId, startupGeneration: 2,
            reason: value, error, workload, bridge: 'pending', applicationClosed: false, secrets: [secret] });
        },
        owner: { async stop() {
          calls.push('stop');
          expect(captured).toBeDefined();
          workload = 'exited';
          if (ownerFails) throw new Error('SYNTHETIC-OWNER-FAILURE');
        } },
      }, { now: () => 0, schedule(callback) { if (reason === 'timedOut') queueMicrotask(callback); return () => {}; } })).rejects.toThrow();
      expect(calls).toEqual(['capture', 'stop']);
      expect(Object.isFrozen(captured!.projection.chain[0])).toBe(true);
      expect(captured!.projection.chain[0]!.message).toContain('workload=running');
      expect(JSON.stringify(captured)).not.toContain(secret);
      expect(JSON.stringify(captured)).not.toContain('SYNTHETIC-OWNER-FAILURE');
      if (reason === 'failed') expect(captured!.projection.chain[1]!.message).toBe('SYNTHETIC-CLOSE-ORIGINAL [redacted]');
      else expect(captured!.projection.chain).toHaveLength(1);
      let delivered;
      await reportElectronCloseFailure({ failure: captured!, testInfo, secrets: [secret] }, {
        record(value) { delivered = value; }, async flush() { return { status: 'recorded' }; },
      });
      expect(delivered).toMatchObject({ phase: 'electronPublicCloseObservation', testId: `${testInfo.testId}:${runtimeInstanceId}` });
    });
  }

  test('the actual entrypoint hooks both boundaries and the fixture keeps private capture outside owner-stop', () => {
    const entry = fs.readFileSync(new URL('../../../desktop/e2e/electronE2eEntrypoint.ts', import.meta.url), 'utf8');
    expect(entry).toContain("observeStartupException: (error) => startupException?.(error, 'earlyStartup')");
    expect(entry).toContain('observeStartupException: (error, stage, secrets) => startupException?.(error, stage, secrets)');
    expect(entry.indexOf('await startupException?.waitForDelivery()')).toBeLessThan(entry.indexOf('nativeAdapters.recordStartupFailure'));
    const source = fs.readFileSync(new URL('../../src/fixtures/isolatedElectronTest.ts', import.meta.url), 'utf8');
    expect(source).toContain('privateCloseFailure ??= captureElectronPrivateCloseFailure');
    expect(source).toContain('await reportElectronStartupException');
    expect(source).toContain('await reportElectronCloseFailure');
    const close = fs.readFileSync(new URL('../../src/fixtures/closeOwnedWindowsElectronRuntime.ts', import.meta.url), 'utf8');
    expect(close.indexOf('input.observePublicCloseFailure?.(reason, error)')).toBeLessThan(close.indexOf('await input.owner.stop()'));
  });
});

function record(id = runtimeInstanceId) {
  return { schemaVersion: 1, runtimeInstanceId: id, stage: 'runtimeStartup',
    exception: projectExceptionChain(new Error('SYNTHETIC-ORIGINAL', { cause: new Error('SYNTHETIC-CAUSE') })) };
}

function prepare() {
  const runRoot = createE2eRunRoot();
  const runtimeRoot = join(runRoot, 'scenario');
  const artifactsRoot = join(runtimeRoot, 'artifacts');
  const configPath = join(runtimeRoot, 'electron-config.json');
  const backendPath = join(runtimeRoot, 'backend.json');
  const paths = { applicationPath: join(runtimeRoot, 'application'), resourcesPath: join(runtimeRoot, 'resources'),
    invoicePdfArchiveDirectoryPath: join(runtimeRoot, 'archive'), userDataPath: join(runtimeRoot, 'user-data'),
    observationsPath: join(artifactsRoot, 'observations.jsonl'), supportBundlePath: join(artifactsRoot, 'support.json.gz'), workspaceBackupPath: null };
  for (const path of [artifactsRoot, paths.applicationPath, paths.resourcesPath, paths.invoicePdfArchiveDirectoryPath, paths.userDataPath]) fs.mkdirSync(path, { recursive: true });
  fs.writeFileSync(backendPath, '{}');
  fs.writeFileSync(configPath, JSON.stringify({ formatVersion: 2, marker: 'EKY_E2E', backend: { configPath: backendPath, port: 43123, sessionSecret: secret },
    dialogMode: 'accept', nativeOpenDialog: { mode: 'accept', purpose: 'invoicePdfArchive' }, paths,
    relaunchMode: 'playwrightManaged', runtimeInstanceId, runtimeRoot, scenarioId: 'SYS-ELECTRON-PRIVATE-FAILURE-001', startupMode: 'normal' }));
  return { runRoot, artifactsRoot, runtimeInstanceId, configPath,
    env: { EKY_E2E: '1', EKY_ELECTRON_E2E_RUN_ROOT: runtimeRoot }, path: electronE2eStartupExceptionPath(artifactsRoot, runtimeInstanceId) };
}
