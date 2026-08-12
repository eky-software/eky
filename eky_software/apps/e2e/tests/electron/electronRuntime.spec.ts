import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';

import { readElectronMainState } from '../../src/electron/readElectronMainState.js';
import { test, expect } from '../../src/fixtures/isolatedElectronTest.js';

test('DESK-RUNTIME-001 starts an isolated Electron runtime', async ({
  e2eElectron,
}) => {
  await expect(e2eElectron.page.getByRole('heading', { name: 'Asiakkaat' }))
    .toBeVisible();
  expect(e2eElectron.page.url()).toBe('eky://app/index.html');

  const health = await e2eElectron.api.get('/health');
  expect(health.ok()).toBe(true);
  await expect(health.json()).resolves.toEqual({ status: 'ok' });

  const state = await readElectronMainState(e2eElectron.electronApp);

  expect(state).toEqual({
    backendIsRunning: true,
    backendStartCount: 1,
    runtimeInstanceId: e2eElectron.runtime.runtimeInstanceId,
    scenarioId: 'DESK-RUNTIME-001',
    secondInstanceCount: 0,
    userDataPath: e2eElectron.runtime.userDataPath,
    windowCount: 1,
  });
  expect(state.userDataPath.startsWith(e2eElectron.runRoot)).toBe(true);

  const allowedRoot = resolve(tmpdir(), 'eky-e2e');
  expect(isDescendant(e2eElectron.runRoot, allowedRoot)).toBe(true);
  for (const path of [
    state.userDataPath,
    e2eElectron.paths.workerRoot,
    e2eElectron.paths.artifactsRoot,
    e2eElectron.paths.supportBundlesRoot,
  ]) {
    expect(isDescendant(path, e2eElectron.runRoot)).toBe(true);
  }
  for (const path of [
    join(state.userDataPath, 'runtime', 'data', 'eky.sqlite'),
    join(state.userDataPath, 'runtime', 'logs'),
    join(state.userDataPath, 'runtime', 'storage', 'invoices'),
  ]) {
    expect(existsSync(path)).toBe(true);
  }

  const rendererBoundary = await e2eElectron.page.evaluate(() => ({
    e2eConfigVisible:
      'EKY_ELECTRON_E2E_CONFIG' in
      (globalThis as typeof globalThis & Record<string, unknown>),
    exposedDesktopKeys: Object.keys(
      (
        globalThis as typeof globalThis & {
          ekyDesktop?: Record<string, unknown>;
        }
      ).ekyDesktop ?? {},
    ).sort(),
  }));
  expect(rendererBoundary).toEqual({
    e2eConfigVisible: false,
    exposedDesktopKeys: [
      'activatePreparedProfileRestore',
      'cancelLocalUpdate',
      'chooseInvoicePdfArchiveDirectory',
      'confirmLocalUpdate',
      'createEncryptedProfileBackup',
      'createManualRecoveryPoint',
      'createSupportBundle',
      'disableInvoicePdfArchive',
      'discardSelectedLocalUpdate',
      'getInvoicePdfArchiveStatus',
      'getLocalUpdateStatus',
      'getProfileBackupStatus',
      'inspectEncryptedProfileBackup',
      'openInvoicePdf',
      'openInvoicePdfArchiveDirectory',
      'openOperationalLogFolder',
      'prepareEncryptedProfileRestore',
      'retryPendingInvoicePdfArchiveTasks',
      'selectLocalUpdate',
    ],
  });
});

test('DESK-RUNTIME-002 @critical identifies the approved Electron 43 runtime', async ({
  e2eElectron,
}) => {
  const runtimeVersions = await e2eElectron.electronApp.evaluate(() => ({
    chrome: process.versions.chrome,
    electron: process.versions.electron,
    napi: process.versions.napi,
    node: process.versions.node,
    v8: process.versions.v8,
  }));

  expect(runtimeVersions).toEqual({
    chrome: '150.0.7871.129',
    electron: '43.2.0',
    napi: '10',
    node: '24.18.0',
    v8: '15.0.1240245-electron.0',
  });

  const diagnosticsResponse = await e2eElectron.api.get(
    '/diagnostics/summary',
  );
  expect(diagnosticsResponse.status()).toBe(200);
  await expect(diagnosticsResponse.json()).resolves.toEqual(
    expect.objectContaining({
      appliedMigrationCount: 38,
      databaseHealth: 'ok',
      electronVersion: null,
      nodeVersion: 'v24.18.0',
    }),
  );
});

function isDescendant(candidate: string, root: string): boolean {
  const relativePath = relative(root, candidate);
  return (
    relativePath !== '' &&
    relativePath !== '..' &&
    !relativePath.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)
  );
}
