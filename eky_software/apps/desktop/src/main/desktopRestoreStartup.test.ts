import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ProfileSnapshotBrokerClient } from '../profileBackup/profileSnapshotBrokerClient.js';
import { createProfileSnapshotRuntimePaths } from '../profileBackup/profileSnapshotRuntimePaths.js';
import { RecoveryPointScheduler } from '../profileBackup/recoveryPoint/recoveryPointScheduler.js';
import { ProfileRestoreActivationJournalStore } from '../profileBackup/restore/profileRestoreActivationJournalStore.js';
import { ProfileRestoreActivationTransaction } from '../profileBackup/restore/profileRestoreActivationTransaction.js';
import { createDesktopProfilePaths } from '../runtime/desktopProfilePaths.js';
import { deriveWorkspaceRoot } from '../workspaces/registry/deriveWorkspaceRoot.js';
import { WORKSPACE_REGISTRY_FILE_NAME } from '../workspaces/registry/workspaceRegistryPaths.js';
import { WorkspaceRegistryStore } from '../workspaces/registry/workspaceRegistryStore.js';
import { validateWorkspaceId } from '../workspaces/registry/workspaceIdValidation.js';
import { deriveWorkspaceBackupReplacementRuntimePaths } from '../workspaces/replacement/workspaceBackupReplacementPaths.js';
import { WorkspaceSwitchJournalStore } from '../workspaces/switch/workspaceSwitchJournal.js';
import { startDesktopComposition } from './desktopComposition.js';

const electronBoundary = vi.hoisted(() => ({
  fetch: vi.fn(),
  createWindow: vi.fn(),
}));

vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events');
  class Port extends EventEmitter {
    start() {}
    postMessage() {}
    close() {
      this.emit('close');
    }
  }
  return {
    BrowserWindow: class {},
    MessageChannelMain: class {
      port1 = new Port();
      port2 = new Port();
    },
    dialog: {},
    ipcMain: {},
    net: { fetch: electronBoundary.fetch },
    safeStorage: {},
    session: { defaultSession: {} },
    shell: {},
    utilityProcess: {},
  };
});
vi.mock('./applicationProtocol.js', () => ({
  registerApplicationProtocol: vi.fn(),
}));
vi.mock('../security/electronPermissionPolicy.js', () => ({
  registerElectronPermissionPolicy: vi.fn(),
}));
vi.mock('./applicationWindow.js', () => ({
  createApplicationWindow: electronBoundary.createWindow,
  loadApplicationWindow: vi.fn(),
}));

const roots: string[] = [];
const clients: ProfileSnapshotBrokerClient[] = [];
const workspaceId = validateWorkspaceId('11111111-1111-4111-8111-111111111111');
const operationId = '22222222-2222-4222-8222-222222222222';
const originalProfileId = 'a'.repeat(64);
const foreignProfileId = 'b'.repeat(64);
const windowBoundary = 'DESKTOP_SMOKE_TEST_WINDOW_BOUNDARY';

beforeEach(() => {
  electronBoundary.fetch.mockReset().mockImplementation(async () =>
    new Response(JSON.stringify({ status: 'ok' })),
  );
  // Stop at the real business-window boundary; this is not an Electron UI test.
  electronBoundary.createWindow.mockReset().mockImplementation(() => {
    throw new Error(windowBoundary);
  });
  vi.spyOn(ProfileSnapshotBrokerClient.prototype, 'waitUntilReady')
    .mockImplementation(async function (this: ProfileSnapshotBrokerClient) {
      clients.push(this);
    });
  vi.spyOn(ProfileSnapshotBrokerClient.prototype, 'getStatus')
    .mockResolvedValue('normal');
  vi.spyOn(RecoveryPointScheduler.prototype, 'start').mockResolvedValue('clean');
  vi.spyOn(RecoveryPointScheduler.prototype, 'stopChecks').mockResolvedValue();
});

afterEach(async () => {
  for (const client of clients.splice(0)) client.close();
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

describe('desktop restore startup composition', () => {
  it('rejects foreign restored lineage, restores original bytes and validates them on restart', async () => {
    const fixture = await createFixture(foreignProfileId);

    await expect(fixture.start()).resolves.toBeUndefined();

    expect(fixture.relaunch).toHaveBeenCalledTimes(1);
    expect(electronBoundary.createWindow).not.toHaveBeenCalled();
    expect(fixture.events).toEqual(['backendStarted', 'backendStopped', 'rollback']);
    await fixture.assertOriginalRestored();

    await expect(fixture.start()).rejects.toThrow(windowBoundary);
    expect(electronBoundary.createWindow).toHaveBeenCalledTimes(1);
    await expect(fixture.journal.read()).resolves.toBeUndefined();
    await fixture.assertRegistryUnchanged();
  });

  it('rolls back if health fails after deferred restore validation but before acceptance', async () => {
    const fixture = await createFixture(originalProfileId);
    electronBoundary.fetch
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'ok' })))
      .mockResolvedValueOnce(new Response(null, { status: 503 }));

    await expect(fixture.start()).resolves.toBeUndefined();

    expect(electronBoundary.fetch).toHaveBeenCalledTimes(2);
    expect(electronBoundary.createWindow).not.toHaveBeenCalled();
    expect(fixture.relaunch).toHaveBeenCalledTimes(1);
    expect(fixture.events).toEqual(['backendStarted', 'backendStopped', 'rollback']);
    await fixture.assertOriginalRestored();
  });

  it('does not swap files or relaunch when backend shutdown is unverified', async () => {
    const fixture = await createFixture(foreignProfileId);
    fixture.stop.mockRejectedValueOnce(new Error('SYNTHETIC_STOP_FAILED'));

    await expect(fixture.start()).rejects.toThrow('WORKSPACE_SWITCH_INVALID');

    expect(fixture.events).toEqual(['backendStarted']);
    expect(fixture.relaunch).not.toHaveBeenCalled();
    expect(electronBoundary.createWindow).not.toHaveBeenCalled();
    await fixture.assertPendingRestoreRetained();
  });

  it('keeps the journal and rollback bytes when rollback itself fails', async () => {
    const fixture = await createFixture(foreignProfileId);
    vi.spyOn(ProfileRestoreActivationTransaction.prototype, 'rollback')
      .mockRejectedValueOnce(new Error('SYNTHETIC_ROLLBACK_FAILED'));

    await expect(fixture.start()).rejects.toThrow('WORKSPACE_SWITCH_RECOVERY_REQUIRED');

    expect(fixture.relaunch).not.toHaveBeenCalled();
    expect(electronBoundary.createWindow).not.toHaveBeenCalled();
    await fixture.assertPendingRestoreRetained();
  });

  it.each([false, true])(
    'retains recovery evidence when validation and shutdown fail (replacement: %s)',
    async (replacementTarget) => {
      const fixture = await createFixture(originalProfileId, { replacementTarget });
      electronBoundary.fetch.mockResolvedValueOnce(new Response(null, { status: 503 }));
      fixture.stop.mockRejectedValue(new Error('SYNTHETIC_STOP_FAILED'));

      await expect(fixture.start()).rejects.toThrow('PROFILE_RESTORE_RECOVERY_REQUIRED');

      expect(fixture.events).toEqual(['backendStarted']);
      expect(fixture.relaunch).not.toHaveBeenCalled();
      expect(electronBoundary.createWindow).not.toHaveBeenCalled();
      await fixture.assertPendingRestoreRetained();
    },
  );

  it('accepts same-lineage restored bytes only after validation and reaches the window boundary', async () => {
    const fixture = await createFixture(originalProfileId);

    await expect(fixture.start()).rejects.toThrow(windowBoundary);

    expect(electronBoundary.fetch).toHaveBeenCalledTimes(2);
    expect(electronBoundary.createWindow).toHaveBeenCalledTimes(1);
    expect(fixture.relaunch).not.toHaveBeenCalled();
    expect(fixture.events).toEqual(['backendStarted', 'accept']);
    await expect(fixture.journal.read()).resolves.toBeUndefined();
    await expect(readFile(fixture.databasePath, 'utf8')).resolves.toBe(fixture.restoredBytes);
    await expect(readFile(fixture.pdfPath, 'utf8')).resolves.toBe('restored pdf');
    await fixture.assertRegistryUnchanged();
  });
});

async function createFixture(
  restoredProfileId: string,
  options: { replacementTarget?: boolean } = {},
) {
  const root = await mkdtemp(join(tmpdir(), 'eky-desktop-restore-startup-'));
  roots.push(root);
  const { workspaceRoot } = deriveWorkspaceRoot(root, workspaceId, 1);
  const paths = createDesktopProfilePaths(workspaceRoot);
  const backupPaths = createProfileSnapshotRuntimePaths(paths.runtimeRoot);
  if (options.replacementTarget) {
    const replacement = deriveWorkspaceBackupReplacementRuntimePaths(root, workspaceId);
    backupPaths.restoreActivationJournalPath = replacement.activationJournalPath;
    backupPaths.restoreFailedRoot = replacement.activationFailedRoot;
    backupPaths.restoreRollbackRoot = replacement.activationRollbackRoot;
    backupPaths.stagingRoot = replacement.activationStagingRoot;
  }
  const registryPath = join(root, WORKSPACE_REGISTRY_FILE_NAME);
  const registry = new WorkspaceRegistryStore({ installationRoot: root, filePath: registryPath });
  const originalBytes = JSON.stringify({ profileId: originalProfileId, value: 'original' });
  const restoredBytes = JSON.stringify({ profileId: restoredProfileId, value: 'restored' });
  const pdfPath = join(paths.invoiceDocumentStorageRoot, 'company-1', 'invoice-1', 'approved-invoice.pdf');
  const staging = join(backupPaths.stagingRoot, operationId);
  const stagedPdf = join(
    staging, 'activation', 'storage', 'invoices',
    'company-1', 'invoice-1', 'approved-invoice.pdf',
  );
  for (const [file, bytes] of [
    [paths.databaseFilePath, originalBytes],
    [pdfPath, 'original pdf'],
    [join(staging, 'profile.sqlite'), restoredBytes],
    [stagedPdf, 'restored pdf'],
  ] as const) {
    await mkdir(dirname(file), { recursive: true, mode: 0o700 });
    await writeFile(file, bytes, { mode: 0o600 });
  }
  await registry.write({
    formatVersion: 1,
    activeWorkspaceId: workspaceId,
    workspaces: [{
      workspaceId,
      workspaceLabel: 'Synthetic restore test',
      lineageIdentity: { formatVersion: 1, profileId: originalProfileId },
      layoutVersion: 1,
      lifecycleState: 'ready',
      createdAt: '2026-08-18T10:00:00.000Z',
    }],
  });
  const switchJournal = new WorkspaceSwitchJournalStore(root);
  if (options.replacementTarget) {
    const sourceId = validateWorkspaceId('44444444-4444-4444-8444-444444444444');
    const current = (await registry.read())!;
    await mkdir(deriveWorkspaceRoot(root, sourceId, 1).workspaceRoot, { recursive: true });
    await registry.write({
      ...current,
      workspaces: [...current.workspaces, {
        ...current.workspaces[0]!,
        workspaceId: sourceId,
        workspaceLabel: 'Synthetic previous workspace',
        lineageIdentity: { formatVersion: 1, profileId: foreignProfileId },
      }],
    });
    const switching = {
      formatVersion: 1,
      operationId,
      sourceWorkspaceId: sourceId,
      targetWorkspaceId: workspaceId,
      createdAt: '2026-08-18T10:00:00.000Z',
    };
    await switchJournal.write({ ...switching, state: 'prepared' });
    await switchJournal.write({ ...switching, state: 'targetSelected' });
  }
  const pendingSwitch = await switchJournal.read();
  const registryBytes = await readFile(registryPath);
  const journal = new ProfileRestoreActivationJournalStore(backupPaths.restoreActivationJournalPath);
  const transaction = new ProfileRestoreActivationTransaction({
    journalStore: journal,
    paths: {
      activeDatabasePath: paths.databaseFilePath,
      activeDocumentsRoot: paths.invoiceDocumentStorageRoot,
      failedRoot: backupPaths.restoreFailedRoot,
      rollbackRoot: backupPaths.restoreRollbackRoot,
      stagingRoot: backupPaths.stagingRoot,
    },
  });
  await transaction.prepare(operationId);
  await transaction.advanceToValidation();
  const pendingJournal = await journal.read();
  const events: string[] = [];
  const realRollback = ProfileRestoreActivationTransaction.prototype.rollback;
  vi.spyOn(ProfileRestoreActivationTransaction.prototype, 'rollback')
    .mockImplementation(async function (this: ProfileRestoreActivationTransaction) {
      events.push('rollback');
      return realRollback.call(this);
    });
  const realAccept = ProfileRestoreActivationTransaction.prototype.accept;
  vi.spyOn(ProfileRestoreActivationTransaction.prototype, 'accept')
    .mockImplementation(async function (this: ProfileRestoreActivationTransaction) {
      events.push('accept');
      return realAccept.call(this);
    });
  vi.spyOn(ProfileSnapshotBrokerClient.prototype, 'validateActiveProfile')
    .mockImplementation(async () => ({
      type: 'activeProfileValidation',
      artifactCount: 1,
      artifactTotalByteSize: 12,
      databaseHealth: 'healthy',
      migrationChainIdentity: 'c'.repeat(64),
      profileId: (JSON.parse(await readFile(paths.databaseFilePath, 'utf8')) as { profileId: string }).profileId,
    }));
  const stop = vi.fn(async () => {
    events.push('backendStopped');
  });
  const relaunch = vi.fn();
  const assertRegistryUnchanged = async () => {
    await expect(readFile(registryPath)).resolves.toEqual(registryBytes);
  };
  return {
    databasePath: paths.databaseFilePath,
    events,
    journal,
    pdfPath,
    relaunch,
    restoredBytes,
    stop,
    assertRegistryUnchanged,
    async assertOriginalRestored() {
      await expect(readFile(paths.databaseFilePath, 'utf8')).resolves.toBe(originalBytes);
      await expect(readFile(pdfPath, 'utf8')).resolves.toBe('original pdf');
      await expect(journal.read()).resolves.toMatchObject({ phase: 'rolledBack' });
      await assertRegistryUnchanged();
    },
    async assertPendingRestoreRetained() {
      await expect(switchJournal.read()).resolves.toEqual(pendingSwitch);
      await expect(journal.read()).resolves.toEqual(pendingJournal);
      await expect(readFile(paths.databaseFilePath, 'utf8')).resolves.toBe(restoredBytes);
      const rollbackRoot = join(backupPaths.restoreRollbackRoot, operationId);
      await expect(readFile(join(rollbackRoot, 'data', 'eky.sqlite'), 'utf8'))
        .resolves.toBe(originalBytes);
      await expect(readFile(join(
        rollbackRoot, 'storage', 'invoices', 'company-1', 'invoice-1',
        'approved-invoice.pdf',
      ), 'utf8')).resolves.toBe('original pdf');
      await assertRegistryUnchanged();
    },
    start: () => startDesktopComposition({
      appVersion: '0.2.8',
      applicationPath: join(root, 'app'),
      buildInfo: {
        appVersion: '0.2.8',
        buildCreatedAt: '2026-08-18T10:00:00.000Z',
        buildDirty: false,
        buildRevision: 'a'.repeat(12),
        schemaVersion: 1,
      },
      releaseInfo: undefined,
      dependencies: {
        createRuntimeSession: () => 'd'.repeat(64),
        async startBackend() {
          events.push('backendStarted');
          return { port: 12345, stop, onUnexpectedExit: vi.fn(), stopForUpdate: vi.fn() };
        },
      },
      quitApplication: vi.fn(),
      relaunchApplication: relaunch,
      resourcesPath: join(root, 'resources'),
      runtimeInstanceId: '33333333-3333-4333-8333-333333333333',
      reportSmokeStage: async () => undefined,
      smokeConfiguration: {
        enabled: false,
        phase: 'initial',
        root: undefined,
        userDataPath: undefined,
      },
      userDataPath: root,
    }),
  };
}
