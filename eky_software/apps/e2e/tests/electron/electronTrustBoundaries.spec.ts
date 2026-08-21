import { join } from 'node:path';

import { readElectronOperationalEvents } from '../../src/assertions/readElectronOperationalEvents.js';
import { readElectronMainState } from '../../src/electron/readElectronMainState.js';
import { test, expect } from '../../src/fixtures/isolatedElectronTest.js';

test('DESK-BRIDGE-001 @critical @security isolates the renderer bridge', async ({
  e2eElectron,
}) => {
  const boundary = await e2eElectron.page.evaluate(() => {
    const windowValue = window as typeof window & {
      ekyDesktop?: Record<string, unknown>;
      process?: unknown;
      require?: unknown;
    };
    return {
      desktopKeys: Object.keys(windowValue.ekyDesktop ?? {}).sort(),
      hasFilesystemBridge:
        'fs' in (windowValue.ekyDesktop ?? {}) ||
        'readFile' in (windowValue.ekyDesktop ?? {}),
      hasRawIpc:
        'invoke' in (windowValue.ekyDesktop ?? {}) ||
        'send' in (windowValue.ekyDesktop ?? {}),
      processType: typeof windowValue.process,
      requireType: typeof windowValue.require,
      webviewHasLoadUrl: 'loadURL' in document.createElement('webview'),
    };
  });

  expect(boundary).toEqual({
    desktopKeys: [
      'activatePreparedProfileRestore',
      'cancelLocalUpdate',
      'chooseInvoicePdfArchiveDirectory',
      'confirmLocalUpdate',
      'createEmptyWorkspace',
      'createEncryptedProfileBackup',
      'createManualRecoveryPoint',
      'createSupportBundle',
      'disableInvoicePdfArchive',
      'discardSelectedLocalUpdate',
      'getInvoicePdfArchiveStatus',
      'getLocalUpdateStatus',
      'getProfileBackupStatus',
      'getWorkspaceManagementStatus',
      'importWorkspaceBackupAsNew',
      'inspectEncryptedProfileBackup',
      'openInvoicePdf',
      'openInvoicePdfArchiveDirectory',
      'openOperationalLogFolder',
      'prepareEncryptedProfileRestore',
      'renameWorkspace',
      'replaceActiveWorkspaceFromBackup',
      'retryPendingInvoicePdfArchiveTasks',
      'selectLocalUpdate',
      'switchWorkspace',
    ],
    hasFilesystemBridge: false,
    hasRawIpc: false,
    processType: 'undefined',
    requireType: 'undefined',
    webviewHasLoadUrl: false,
  });
});

test('DESK-NAV-001 @security blocks external navigation and popups safely', async ({
  e2eElectron,
}) => {
  const privateMarker = 'must-not-reach-electron-log';
  const initialUrl = e2eElectron.page.url();
  const popupResult = await e2eElectron.page.evaluate((marker) => {
    const popup = window.open(
      `https://example.invalid/private?query=${marker}#${marker}`,
    );
    return popup === null;
  }, privateMarker);
  expect(popupResult).toBe(true);

  for (const targetUrl of [
    `https://example.invalid/private?query=${privateMarker}#${privateMarker}`,
    `http://example.invalid/private?query=${privateMarker}`,
    `file:///C:/private/${privateMarker}.txt`,
    `javascript:globalThis.__blockedMarker=${JSON.stringify(privateMarker)}`,
  ]) {
    await e2eElectron.page.evaluate((url) => {
      try {
        window.location.assign(url);
      } catch {
        // A synchronous browser rejection is also a secure outcome.
      }
    }, targetUrl);
    await expect.poll(() => e2eElectron.page.url()).toBe(initialUrl);
  }

  const logsRoot = join(
    e2eElectron.runtime.userDataPath,
    'runtime',
    'logs',
    'security',
  );
  await expect
    .poll(() =>
      readElectronOperationalEvents(logsRoot).map((event) => event.eventName),
    )
    .toEqual(
      expect.arrayContaining([
        'applicationWindow.navigationBlocked',
        'applicationWindow.newWindowBlocked',
      ]),
    );

  const serializedEvents = JSON.stringify(
    readElectronOperationalEvents(logsRoot),
  );
  expect(serializedEvents).not.toContain(privateMarker);
  expect(serializedEvents).not.toContain('example.invalid');
  expect(serializedEvents).not.toContain('file:///');
});

test('DESK-PERMISSION-001 @security denies and deduplicates permissions', async ({
  e2eElectron,
}) => {
  const logsRoot = join(
    e2eElectron.runtime.userDataPath,
    'runtime',
    'logs',
    'security',
  );
  const countPermissionEvents = () =>
    readElectronOperationalEvents(logsRoot).filter(
      (event) => event.eventName === 'electron.permissionRequestBlocked',
    ).length;

  const permissionCheckState = await e2eElectron.page.evaluate(async () =>
    (await navigator.permissions.query({ name: 'geolocation' })).state,
  );
  expect(permissionCheckState).toBe('denied');
  expect(countPermissionEvents()).toBe(0);

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const notificationPermission = await e2eElectron.page.evaluate(() =>
      Notification.requestPermission(),
    );
    expect(notificationPermission).toBe('denied');
  }

  await expect.poll(countPermissionEvents).toBe(1);
  const events = readElectronOperationalEvents(logsRoot);
  const permissionEvent = events.find(
    (event) => event.eventName === 'electron.permissionRequestBlocked',
  );
  expect(permissionEvent).toMatchObject({
    frameClass: 'mainFrame',
    originClass: 'eky',
    permissionType: 'notifications',
    stage: 'request',
  });
  expect(JSON.stringify(permissionEvent)).not.toContain(e2eElectron.page.url());
});

test('DESK-SINGLE-INSTANCE-001 keeps one backend and one main window', async ({
  e2eElectron,
}) => {
  await e2eElectron.launchSecondInstance();

  await expect
    .poll(async () =>
      readElectronMainState(e2eElectron.electronApp).then(
        (state) => state.secondInstanceCount,
      ),
    )
    .toBe(1);
  await e2eElectron.page.bringToFront();
  await expect
    .poll(() => e2eElectron.page.evaluate(() => document.hasFocus()))
    .toBe(true);

  const state = await readElectronMainState(e2eElectron.electronApp);
  expect(state.backendIsRunning).toBe(true);
  expect(state.backendStartCount).toBe(1);
  expect(state.windowCount).toBe(1);
});
