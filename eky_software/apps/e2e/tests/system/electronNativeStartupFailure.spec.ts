import fs from 'node:fs';
import { join } from 'node:path';
import { mock } from 'node:test';

import { expect, test } from '@playwright/test';

import { electronE2eBackendStartupStages, readElectronE2eBackendFailureCode } from '../../../desktop/e2e/electronE2eBackendStatus.js';
import { reportElectronE2eBackendFailure } from '../../../desktop/e2e/electronE2eBackendFailure.js';
import type { ElectronE2eConfig } from '../../../desktop/e2e/electronE2eConfig.js';
import { createElectronE2eNativeAdapters } from '../../../desktop/e2e/electronE2eNativeAdapters.js';
import { createE2eRunRoot } from '../../src/environment/createE2eRunRoot.js';
import { electronNativeObservationsPath } from '../../src/environment/electronNativeObservationsPath.js';
import { removeE2eRunRoot } from '../../src/environment/removeE2eRunRoot.js';
import { captureElectronNativeStartupFailure } from '../../src/fixtures/captureElectronNativeStartupFailure.js';
import { createElectronLaunchFailureCapture, readObservedElectronLaunchExitCode } from '../../src/fixtures/captureElectronLaunchFailure.js';
import { finishIsolatedElectronTest, reportElectronLifecycleEvidence } from '../../src/fixtures/isolatedElectronTest.js';

const currentId = '11111111-1111-4111-8111-111111111111';
const previousId = '22222222-2222-4222-8222-222222222222';

test.describe('SYS-ELECTRON-NATIVE-STARTUP-001 @critical @security', () => {
  let input: Parameters<typeof captureElectronNativeStartupFailure>[0];
  let path: string;
  test.beforeEach(() => {
    const runRoot = createE2eRunRoot();
    input = { runRoot, artifactsRoot: join(runRoot, 'worker', 'artifacts'), runtimeInstanceId: currentId };
    fs.mkdirSync(input.artifactsRoot, { recursive: true });
    path = electronNativeObservationsPath(input.artifactsRoot, currentId);
  });
  test.afterEach(async () => {
    mock.restoreAll();
    if (fs.existsSync(input.runRoot)) await removeE2eRunRoot(input.runRoot);
  });

  test('captures actual native writer codes and closed dialog reasons without private text', () => {
    const native = createElectronE2eNativeAdapters(config(input));
    native.recordStartupFailure('BACKEND_EXITED_BEFORE_READY');
    native.recordStartupFailure('WORKSPACE_REGISTRY_BUSY');
    native.recordStartupFailure('private-secret-path');
    native.recordStartupFailure('DESKTOP_SMOKE_PRIVATE_SECRET');
    native.showErrorBox('private-title', 'private-message');
    native.showErrorBox('Eky ei käynnistynyt', 'Paikallista testisovellusta ei voitu käynnistää turvallisesti.');
    const result = captureElectronNativeStartupFailure(input);
    expect(result).toEqual({ status: 'captured',
      startupFailureCodes: ['BACKEND_EXITED_BEFORE_READY', 'DESKTOP_START_FAILED', 'PACKAGED_SMOKE_FAILED', 'WORKSPACE_REGISTRY_BUSY'],
      errorBoxReasons: ['other', 'startupFailed'],
    });
    expect(Object.isFrozen(result)).toBe(true);
    if (result.status !== 'captured') throw new Error('Missing capture');
    expect(Object.isFrozen(result.startupFailureCodes)).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(/private|PRIVATE|11111111|22222222/);
    expect(JSON.stringify(result)).not.toContain(input.runRoot);
  });

  test('does not read earlier generations or a legacy shared file', () => {
    const old = { ...input, runtimeInstanceId: previousId };
    createElectronE2eNativeAdapters(config(old)).recordStartupFailure('BACKEND_EXITED_BEFORE_READY');
    fs.writeFileSync(join(input.artifactsRoot, 'electron-observations.jsonl'), '{"operation":"startupFailure","errorCode":"WORKSPACE_REGISTRY_BUSY"}\n');
    expect(captureElectronNativeStartupFailure(input)).toEqual({ status: 'missing' });
    createElectronE2eNativeAdapters(config(input)).recordStartupFailure('BACKEND_READINESS_TIMEOUT');
    expect(captureElectronNativeStartupFailure(input)).toEqual({ status: 'captured', startupFailureCodes: ['BACKEND_READINESS_TIMEOUT'], errorBoxReasons: [] });
  });

  test('redacts unknown and extended backend codes even when their prefix is known', () => {
    const native = createElectronE2eNativeAdapters(config(input));
    for (const stage of electronE2eBackendStartupStages) {
      native.recordStartupFailure(`${readElectronE2eBackendFailureCode(stage)}_PRIVATE`);
    }
    native.recordStartupFailure('DESKTOP_SMOKE_E2E_BACKEND_PRIVATE_FAILED');
    native.recordStartupFailure(readElectronE2eBackendFailureCode('backendStart').toLowerCase());
    native.recordStartupFailure(`${readElectronE2eBackendFailureCode('backendStart')} private-path`);
    expect(captureElectronNativeStartupFailure(input)).toEqual({
      status: 'captured',
      startupFailureCodes: ['DESKTOP_START_FAILED', 'PACKAGED_SMOKE_FAILED'],
      errorBoxReasons: [],
    });
  });

  test('preserves the first classified cause and separate broker cleanup through the real native writer and attachment', async ({}, testInfo) => {
    const native = createElectronE2eNativeAdapters(config(input));
    const original = Object.assign(new Error('private database path'), { code: 'SQLITE_CANTOPEN' });
    reportElectronE2eBackendFailure({
      error: original, stage: 'backendStart',
      brokers: { secretBroker: { close() { throw new Error('private cleanup'); } } },
      send(status) {
        native.recordStartupFailure(readElectronE2eBackendFailureCode(status.stage), {
          backendAttempt: 2, status,
        });
      },
    });
    const capture = createElectronLaunchFailureCapture();
    const observation = { phase: 'firstWindow', status: 'failed', reason: 'processExited' } as const;
    const runtime = { ...input, userDataPath: join(input.runRoot, 'user-data'), startupGeneration: 4 };
    capture.observe(observation, runtime, async () => { throw new Error('private closed channel'); }, 1);
    const sourceBytes = fs.readFileSync(path);
    await expect(finishIsolatedElectronTest({
      failure: { error: original }, testAlreadyFailed: false,
      async disposeApi() {}, async closeRuntime() {}, async releasePort() {},
      removeRoot: () => removeE2eRunRoot(input.runRoot),
      report: (cleanup) => reportElectronLifecycleEvidence(testInfo, {
        // A capped phase list must not erase the first failing generation.
        launch: [], observationsTruncated: true, cleanup, ...capture.finish(),
      }),
    })).rejects.toBe(original);
    capture.observe({ ...observation, reason: 'timeout' }, { ...runtime, startupGeneration: 5 }, async () => undefined, 0);
    const text = fs.readFileSync(testInfo.outputPath('electron-lifecycle.json'), 'utf8');
    const evidence = JSON.parse(text);
    expect(evidence.attempt).toBe(testInfo.retry);
    expect(evidence.firstLaunchFailure).toEqual({ startupGeneration: 4, phase: 'firstWindow', reason: 'processExited' });
    expect(evidence.nativeStartupFailure.backendFailure).toEqual({
      backendAttempt: 2,
      status: { type: 'failed', stage: 'backendStart', reason: 'SQLITE_CANTOPEN', brokerCleanupFailures: ['secretBroker'] },
    });
    expect(capture.finish().firstLaunchFailure).toEqual(evidence.firstLaunchFailure);
    expect(Object.isFrozen(capture.finish().firstLaunchFailure)).toBe(true);
    expect(evidence.startupCapture).toEqual({ status: 'unavailable' });
    expect(evidence.cleanup).toEqual({ api: 'completed', runtime: 'completed', port: 'released', runRoot: 'retained' });
    expect(fs.readFileSync(path)).toEqual(sourceBytes);
    expect(text).not.toMatch(/private|11111111|22222222|companyId|sessionSecret/);
    expect(text).not.toContain(input.runRoot);
  });

  test('reporting failure retains native first-failure bytes after verified resource cleanup', async () => {
    const native = createElectronE2eNativeAdapters(config(input));
    native.recordStartupFailure(readElectronE2eBackendFailureCode('backendStart'), {
      backendAttempt: 2,
      status: { type: 'failed', stage: 'backendStart', reason: 'SQLITE_CANTOPEN', brokerCleanupFailures: [] },
    });
    const sourceBytes = fs.readFileSync(path);
    const capture = createElectronLaunchFailureCapture();
    capture.observe({ phase: 'firstWindow', status: 'failed', reason: 'processExited' }, {
      ...input, userDataPath: join(input.runRoot, 'user-data'), startupGeneration: 4,
    }, async () => undefined, 1);
    const original = Object.freeze(new Error('private original launch failure'));
    const calls: string[] = [];
    const evidenceFailures: string[] = [];
    let cleanupEvidence: unknown;
    await expect(finishIsolatedElectronTest({
      failure: { error: original }, testAlreadyFailed: false,
      async disposeApi() { calls.push('api'); },
      async closeRuntime() { calls.push('runtime'); },
      async releasePort() { calls.push('port'); },
      async removeRoot() { calls.push('remove'); await removeE2eRunRoot(input.runRoot); },
      async report(cleanup) { calls.push('report'); cleanupEvidence = cleanup; throw new Error('private report failure'); },
      reportEvidenceFailure(kind) { evidenceFailures.push(kind); },
    })).rejects.toBe(original);
    expect(calls).toEqual(['api', 'runtime', 'port', 'report']);
    expect(cleanupEvidence).toEqual({ api: 'completed', runtime: 'completed', port: 'released', runRoot: 'retained' });
    expect(fs.readFileSync(path)).toEqual(sourceBytes);
    expect(captureElectronNativeStartupFailure(input)).toEqual(capture.finish().nativeStartupFailure);
    expect(capture.finish().firstLaunchFailure).toEqual({ startupGeneration: 4, phase: 'firstWindow', reason: 'processExited' });
    expect(evidenceFailures).toEqual(['reportFailed']);
  });

  test('rejects structured causes whose stage, identity or fields do not match the closed contract', () => {
    const status = { type: 'failed', stage: 'backendStart', reason: 'SQLITE_BUSY', brokerCleanupFailures: [] };
    for (const backendFailure of [
      { backendAttempt: 0, status },
      { backendAttempt: 1, status, companyId: 'private' },
      { backendAttempt: 1, status: { ...status, stage: 'moduleImport' } },
      { backendAttempt: 1, status: { ...status, reason: 'SQLITE_BUSY private' } },
      { backendAttempt: 1, status: { ...status, brokerCleanupFailures: ['private'] } },
    ]) {
      fs.writeFileSync(path, `${JSON.stringify({ operation: 'startupFailure',
        errorCode: readElectronE2eBackendFailureCode('backendStart'), backendFailure })}\n`);
      expect(captureElectronNativeStartupFailure(input)).toEqual({ status: 'invalid' });
    }
  });

  test('does not borrow the cause of a later failure when the first cause was unavailable', () => {
    const native = createElectronE2eNativeAdapters(config(input));
    native.recordStartupFailure('BACKEND_EXITED_BEFORE_READY');
    native.recordStartupFailure(readElectronE2eBackendFailureCode('backendStart'), {
      backendAttempt: 2,
      status: { type: 'failed', stage: 'backendStart', reason: 'SQLITE_BUSY', brokerCleanupFailures: [] },
    });
    const captured = captureElectronNativeStartupFailure(input);
    expect(captured.status).toBe('captured');
    expect(captured).not.toHaveProperty('backendFailure');
  });

  test('unavailable or invalid startup generation remains unknown without coercion', () => {
    for (const startupGeneration of [undefined, 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, 'private']) {
      const capture = createElectronLaunchFailureCapture();
      capture.observe({ phase: 'firstWindow', status: 'failed', reason: 'unknown' }, {
        ...input, userDataPath: join(input.runRoot, 'user-data'),
        ...(startupGeneration === undefined ? {} : { startupGeneration: startupGeneration as number }),
      }, async () => undefined);
      expect(capture.finish().firstLaunchFailure?.startupGeneration).toBeNull();
    }
  });

  for (const errorCode of [
    'BACKEND_EXITED_BEFORE_READY',
    ...electronE2eBackendStartupStages.map(readElectronE2eBackendFailureCode),
  ]) {
    test(`keeps ${errorCode} through native capture, cleanup and lifecycle attachment`, async ({}, testInfo) => {
      const native = createElectronE2eNativeAdapters(config(input));
      native.recordStartupFailure(errorCode);
      const capture = createElectronLaunchFailureCapture();
      const observation = { phase: 'firstWindow', status: 'failed', reason: 'processExited' } as const;
      const runtime = { ...input, userDataPath: join(input.runRoot, 'worker', 'user-data') };
      capture.observe(observation, runtime, async () => { throw new Error('private-closed-main'); }, -1073741819);
      const original = new Error('original-launch-failure');
      await expect(finishIsolatedElectronTest({
        failure: { error: original }, testAlreadyFailed: false,
        async disposeApi() {}, async releasePort() {},
        async closeRuntime() {
          native.recordStartupFailure('WORKSPACE_REGISTRY_BUSY');
          capture.observe(observation, { ...runtime, runtimeInstanceId: previousId }, async () => undefined, 0);
        },
        removeRoot: () => removeE2eRunRoot(input.runRoot),
        report: (cleanup) => reportElectronLifecycleEvidence(testInfo, {
          launch: [observation], observationsTruncated: false, cleanup, ...capture.finish(),
        }),
      })).rejects.toBe(original);
      const text = fs.readFileSync(testInfo.outputPath('electron-lifecycle.json'), 'utf8');
      const report = JSON.parse(text);
      expect(report.nativeStartupFailure).toEqual({ status: 'captured', startupFailureCodes: [errorCode], errorBoxReasons: [] });
      expect(report.cleanup).toEqual({ api: 'completed', runtime: 'completed', port: 'released', runRoot: 'retained' });
      expect(report.launchExitCode).toBe(-1073741819);
      expect(fs.existsSync(input.runRoot)).toBe(true);
      expect(text).not.toMatch(/private|WORKSPACE_REGISTRY_BUSY|11111111|22222222/);
      expect(testInfo.attachments.some((item) => item.name === 'electron-lifecycle')).toBe(true);
    });
  }

  for (const [name, contents] of [
    ['invalid JSON', '{private\n'],
    ['partial line', '{"operation":"startupFailure","errorCode":"DESKTOP_START_FAILED"}'],
    ['invalid code type', '{"operation":"startupFailure","errorCode":null}\n'],
    ['unknown dialog reason', '{"operation":"showErrorBox","reason":"private-secret"}\n'],
  ]) {
    test(`rejects ${name} without returning file contents`, () => {
      fs.writeFileSync(path, contents!);
      expect(captureElectronNativeStartupFailure(input)).toEqual({ status: 'invalid' });
    });
  }

  test('bounds bytes and records and does not treat missing or empty data as startup success', () => {
    expect(captureElectronNativeStartupFailure(input)).toEqual({ status: 'missing' });
    fs.writeFileSync(path, '');
    expect(captureElectronNativeStartupFailure(input)).toEqual({ status: 'captured', startupFailureCodes: [], errorBoxReasons: [] });
    fs.writeFileSync(path, 'x'.repeat(65537));
    expect(captureElectronNativeStartupFailure(input)).toEqual({ status: 'tooLarge' });
    fs.writeFileSync(path, '{}\n'.repeat(129));
    expect(captureElectronNativeStartupFailure(input)).toEqual({ status: 'tooLarge' });
  });

  test('rejects directories and hardlinked evidence files', () => {
    fs.mkdirSync(path);
    expect(captureElectronNativeStartupFailure(input)).toEqual({ status: 'invalid' });
    fs.rmdirSync(path);
    const source = join(input.runRoot, 'synthetic-link-source');
    fs.writeFileSync(source, '{}\n');
    fs.linkSync(source, path);
    expect(captureElectronNativeStartupFailure(input)).toEqual({ status: 'invalid' });
  });

  test('rejects a redirected parent before reading the file', () => {
    const target = join(input.runRoot, 'target');
    fs.renameSync(input.artifactsRoot, target);
    fs.symlinkSync(target, input.artifactsRoot, 'junction');
    try {
      expect(captureElectronNativeStartupFailure(input)).toEqual({ status: 'invalid' });
    } finally { fs.unlinkSync(input.artifactsRoot); }
  });

  test('rejects an outside or non-normalized root and an invalid generation identity', () => {
    expect(captureElectronNativeStartupFailure({ ...input, artifactsRoot: join(input.runRoot, '..', 'outside') })).toEqual({ status: 'invalid' });
    expect(captureElectronNativeStartupFailure({ ...input, runRoot: `${input.runRoot}/..` })).toEqual({ status: 'invalid' });
    expect(captureElectronNativeStartupFailure({ ...input, runtimeInstanceId: '../../private' }).status).not.toBe('captured');
  });

  test('discards the snapshot when the source changes during the read', () => {
    fs.writeFileSync(path, '{}\n');
    const originalRead = fs.readSync;
    mock.method(fs, 'readSync', (...args: Parameters<typeof fs.readSync>) => {
      const count = originalRead(...args);
      fs.appendFileSync(path, '{}\n');
      return count;
    });
    expect(captureElectronNativeStartupFailure(input)).toEqual({ status: 'sourceChanged' });
  });

  test('read errors never escape or include native error details', () => {
    fs.writeFileSync(path, '{}\n');
    mock.method(fs, 'openSync', () => { throw new Error('private-secret-path'); });
    expect(captureElectronNativeStartupFailure(input)).toEqual({ status: 'readFailed' });
  });

  test('does not coerce arbitrary exit values or accept codes first seen during cleanup', () => {
    for (const code of [undefined, null, NaN, Infinity, 0.1, -0x80000001, 0x80000000, 'private-secret']) {
      const capture = createElectronLaunchFailureCapture();
      const runtime = { ...input, userDataPath: join(input.runRoot, 'user-data') };
      const failure = { phase: 'firstWindow', status: 'failed', reason: 'unknown' } as const;
      capture.observe(failure, runtime, async () => undefined, code as number | null | undefined);
      capture.observe(failure, runtime, async () => undefined, 1);
      expect(capture.finish().launchExitCode).toBeNull();
    }
  });

  test('an autocleanup exit before first capture is not the original launch exit', () => {
    for (const state of ['unavailable', 'running', 'exited'] as const) {
      let codeReads = 0;
      const observed = readObservedElectronLaunchExitCode({
        readObservedWorkloadState: () => state,
        workload: { readExitCode() { codeReads++; return 1; } },
      });
      const capture = createElectronLaunchFailureCapture();
      capture.observe({ phase: 'firstWindow', status: 'failed', reason: 'unknown' }, {
        ...input, userDataPath: join(input.runRoot, 'user-data'),
      }, async () => undefined, observed);
      expect(capture.finish().launchExitCode).toBe(state === 'exited' ? 1 : null);
      expect(codeReads).toBe(state === 'exited' ? 1 : 0);
    }
    expect(readObservedElectronLaunchExitCode(undefined)).toBeNull();
  });
});

function config(input: Parameters<typeof captureElectronNativeStartupFailure>[0]): ElectronE2eConfig {
  return {
    backend: { configPath: join(input.runRoot, 'backend.json'), port: 12345, sessionSecret: 'synthetic-secret' },
    dialogMode: 'cancel', formatVersion: 2, marker: 'EKY_E2E',
    nativeOpenDialog: { mode: 'cancel', purpose: 'workspaceBackupImport' },
    paths: {
      applicationPath: join(input.runRoot, 'application'), resourcesPath: join(input.runRoot, 'resources'),
      userDataPath: join(input.runRoot, 'user-data'), workspaceBackupPath: null,
      invoicePdfArchiveDirectoryPath: join(input.runRoot, 'archive'), supportBundlePath: join(input.runRoot, 'support'),
      observationsPath: electronNativeObservationsPath(input.artifactsRoot, input.runtimeInstanceId),
    },
    relaunchMode: 'playwrightManaged', runtimeInstanceId: input.runtimeInstanceId,
    runtimeRoot: input.runRoot, scenarioId: 'SYS-ELECTRON-NATIVE-STARTUP-001', startupMode: 'normal',
  };
}
