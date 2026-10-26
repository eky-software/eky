import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import type { BrowserWindow } from 'electron';
import { afterEach, beforeEach, describe, expect, it, vi, type TestContext } from 'vitest';

import { ProfileSnapshotBrokerClient } from '../profileBackup/profileSnapshotBrokerClient.js';
import { ProfileSnapshotInspectionClient } from '../profileBackup/profileSnapshotInspectionClient.js';
import * as snapshotInspection from '../profileBackup/runProfileSnapshotInspection.js';
import * as profileBackupComposition from '../profileBackup/profileBackupComposition.js';
import { createProfileBackupIpcChannel } from '../profileBackup/portableProfileBackupTypes.js';
import * as secretBrokerMain from '../secrets/secretBrokerMain.js';
import { createProfileSnapshotRuntimePaths } from '../profileBackup/profileSnapshotRuntimePaths.js';
import { RecoveryPointScheduler } from '../profileBackup/recoveryPoint/recoveryPointScheduler.js';
import { RecoveryPointCleanShutdownMarker } from '../profileBackup/recoveryPoint/recoveryPointCleanShutdownMarker.js';
import { BackendShutdownExitError, type BackendShutdownOutcome } from '../runtime/backendShutdown.js';
import { startDesktopBackend, type StartDesktopBackendOptions } from '../runtime/backendProcess.js';
import { DesktopBackendStartupError, DesktopBackendStartupStoppedError } from '../runtime/backendStartupFailure.js';
import {
  createWorkspaceCandidateCompletedStatus,
  createWorkspaceCandidateFailedStatus,
  createWorkspaceCandidateReadyStatus,
  createWorkspaceCandidateReservationReadyStatus,
  parseWorkspaceCandidateProcessCommand,
} from '../runtime/workspaceCandidateMessages.js';
import { AcceptedBuildMetadataStore } from '../update/acceptedBuildMetadataStore.js';
import { createBusinessAcceptedBuildMetadata, createSelectorAcceptedBuildMetadata, type AcceptedBuildMetadata } from '../update/acceptedBuildMetadata.js';
import { createDirectSetupMigrationRecovery } from '../update/directSetupMigrationRecovery.js';
import { createLocalUpdateRuntimePaths } from '../update/localUpdateRuntimePaths.js';
import { LocalUpdatePackageCache } from '../update/localUpdatePackageCache.js';
import * as updateFoundation from '../update/localUpdateFoundationComposition.js';
import * as profileProtection from '../update/profileProtectionComposition.js';
import * as updateObservation from '../update/updateOperationalObserver.js';
import { launchWindowsInstallerForUpdate } from '../update/windowsInstallerHandoff.js';
import { UpdateJournalStore } from '../update/updateJournalStore.js';
import { UpdateBinaryRollbackCoordinator } from '../update/updateBinaryRollbackCoordinator.js';
import { FirstStartUpdateCoordinator } from '../update/firstStartUpdateCoordinator.js';
import * as deferredPreparation from '../update/deferredBusinessLocalUpdateState.js';
import { ProfileRestoreActivationJournalStore } from '../profileBackup/restore/profileRestoreActivationJournalStore.js';
import { ProfileRestoreActivationTransaction } from '../profileBackup/restore/profileRestoreActivationTransaction.js';
import { ProfileRestoreActivationService } from '../profileBackup/restore/profileRestoreActivationService.js';
import { RecoveryPointRestoreStagingService } from '../profileBackup/restore/recoveryPointRestoreStagingService.js';
import * as coldInspection from '../profileBackup/restore/runProfileRestoreColdInspection.js';
import * as originalInspection from '../profileBackup/restore/runProfileRestoreOriginalInspection.js';
import { profileInspectionProtocolVersion } from '../runtime/profileInspectionMessages.js';
import { ProfileInspectionProcessError } from '../runtime/profileInspectionProcess.js';
import { encodeProfileInspectionDocumentBindings } from '../runtime/profileInspectionDocumentBindings.js';
import { createProfileSnapshotArtifactIdentity } from '../runtime/profileInspectionArtifactIdentity.js';
import { createDesktopProfilePaths } from '../runtime/desktopProfilePaths.js';
import { createTestJournal } from '../workspaces/creation/emptyWorkspaceCreationTestSupport.js';
import { createWorkspaceLegacyAdoptionJournalPaths, WorkspaceLegacyAdoptionJournalStore } from '../workspaces/adoption/workspaceLegacyAdoptionJournal.js';
import { hasWorkspaceLabelConflict } from '../workspaces/registry/workspaceLabelComparison.js';
import { createWorkspaceCreationJournalPaths, WORKSPACE_CREATION_JOURNAL_FILE_NAME } from '../workspaces/creation/workspaceCreationJournalPaths.js';
import { WorkspaceCreationJournalStore } from '../workspaces/creation/workspaceCreationJournalStore.js';
import { deriveWorkspaceCreationPaths } from '../workspaces/creation/workspaceCreationPaths.js';
import { createWorkspaceBackupImportJournalPaths, WORKSPACE_BACKUP_IMPORT_JOURNAL_FILE_NAME } from '../workspaces/import/workspaceBackupImportJournalPaths.js';
import { WorkspaceBackupImportJournalStore } from '../workspaces/import/workspaceBackupImportJournalStore.js';
import { deriveWorkspaceBackupImportPaths } from '../workspaces/import/workspaceBackupImportPaths.js';
import { createTestImportJournal } from '../workspaces/import/workspaceBackupImportTestSupport.js';
import { WorkspaceBackupPlaintextQuarantine } from '../workspaces/import/workspaceBackupPlaintextQuarantine.js';
import { deriveWorkspaceRoot } from '../workspaces/registry/deriveWorkspaceRoot.js';
import { WORKSPACE_REGISTRY_FILE_NAME } from '../workspaces/registry/workspaceRegistryPaths.js';
import { WorkspaceRegistryStore } from '../workspaces/registry/workspaceRegistryStore.js';
import { validateWorkspaceId } from '../workspaces/registry/workspaceIdValidation.js';
import { deriveWorkspaceBackupReplacementRuntimePaths } from '../workspaces/replacement/workspaceBackupReplacementPaths.js';
import { WorkspaceSwitchJournalStore } from '../workspaces/switch/workspaceSwitchJournal.js';
import { ActiveWorkspaceStartupRelaunchRequiredError, resolveActiveWorkspaceStartup } from '../workspaces/runtime/resolveActiveWorkspaceStartup.js';
import { WorkspaceFirstStartMigrationOrchestrator } from '../workspaces/update/workspaceFirstStartMigrationOrchestrator.js';
import * as activationComposition from '../workspaces/update/workspaceActivationMigrationComposition.js';
import type { WorkspaceActivationMigrationRecoveryReceipt } from '../workspaces/update/workspaceActivationMigrationCoordinator.js';
import { WorkspaceMigrationInventoryCoordinator } from '../workspaces/update/workspaceMigrationInventoryCoordinator.js';
import { WorkspaceFirstStartMigrationJournalStore } from '../workspaces/update/workspaceFirstStartMigrationJournalStore.js';
import { createWorkspaceFirstStartMigrationJournalPaths } from '../workspaces/update/workspaceFirstStartMigrationJournalPaths.js';
import { InMemoryWorkspaceMaintenanceLease } from '../workspaces/maintenance/workspaceMaintenanceLease.js';
import { startDesktopComposition, type StartDesktopCompositionOptions } from './desktopComposition.js';
import { BackendRequestQuiescence } from './backendRequestQuiescence.js';
import { createDesktopBeforeQuitHandler } from './desktopBeforeQuit.js';
import { createRestoreStartupTestLifetime, releaseRestoreStartupTestResources } from './desktopRestoreStartupTestSupport.js';

const electronBoundary = vi.hoisted(() => ({
  fetch: vi.fn(),
  createWindow: vi.fn(),
  loadWindow: vi.fn(async () => undefined),
  handle: vi.fn(),
  fork: vi.fn(),
  removeHandler: vi.fn(),
  portClosed: vi.fn(),
  reservationReleased: vi.fn(),
  reservationAcquired: vi.fn(),
  reservationIdentityRead: vi.fn(),
  loseReservation: undefined as (() => void) | undefined,
}));

const logMaintenanceIo = vi.hoisted(() => ({ deniedDirectory: '', observed: false }));
vi.mock('node:fs', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    readdirSync: (...args: Parameters<typeof actual.readdirSync>) => {
      if (String(args[0]) === logMaintenanceIo.deniedDirectory) {
        logMaintenanceIo.observed = true;
        throw Object.assign(new Error('Synthetic log directory failure.'), { code: 'EACCES' });
      }
      return actual.readdirSync(...args);
    },
  };
});

vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events');
  class Port extends EventEmitter {
    start() {}
    postMessage() {}
    close() {
      electronBoundary.portClosed();
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
    ipcMain: { handle: electronBoundary.handle, removeHandler: electronBoundary.removeHandler },
    net: { fetch: electronBoundary.fetch },
    safeStorage: {},
    session: { defaultSession: {} },
    shell: {},
    utilityProcess: { fork: electronBoundary.fork },
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
  loadApplicationWindow: electronBoundary.loadWindow,
}));
vi.mock('../update/windowsInstallerHandoff.js', () => ({
  launchWindowsInstallerForUpdate: vi.fn(async () => undefined),
}));
vi.mock('../runtime/workspaceProcessReservation.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../runtime/workspaceProcessReservation.js')>(),
  readWorkspaceProcessReservationIdentity: async (root: string) => {
    await electronBoundary.reservationIdentityRead(root);
    return 'a'.repeat(64);
  },
  async acquireWorkspaceProcessReservation(
    options: Parameters<typeof import('../runtime/workspaceProcessReservation.js').acquireWorkspaceProcessReservation>[0],
  ) {
    await electronBoundary.reservationAcquired(options);
    const released = new AbortController();
    electronBoundary.loseReservation = () => released.abort();
    return {
      identity: 'a'.repeat(64), invalidated: released.signal,
      async assertOwned() { if (released.signal.aborted) throw new Error('synthetic reservation released'); },
      async release() { await electronBoundary.reservationReleased(options.userDataRoot); released.abort(); },
    };
  },
}));

const roots: string[] = [];
let clients: ProfileSnapshotBrokerClient[] = [];
let trackedStartupTest: ReturnType<typeof createRestoreStartupTestLifetime> | undefined;
const workspaceId = validateWorkspaceId('11111111-1111-4111-8111-111111111111');
const operationId = '22222222-2222-4222-8222-222222222222';
const originalProfileId = 'a'.repeat(64);
const foreignProfileId = 'b'.repeat(64);
const windowBoundary = 'DESKTOP_SMOKE_TEST_WINDOW_BOUNDARY';
const restoreStartupCompositionTimeoutMs = 10_000;

beforeEach(() => {
  // Do not reset shared spies while a timed-out tracked body can still use them.
  trackedStartupTest?.assertSharedStateReleased();
  trackedStartupTest = undefined;
  logMaintenanceIo.deniedDirectory = '';
  logMaintenanceIo.observed = false;
  // Update fixtures must provide their own Windows boundary on every host.
  vi.stubEnv('SystemRoot', undefined);
  const ownedClients: ProfileSnapshotBrokerClient[] = [];
  clients = ownedClients;
  electronBoundary.reservationAcquired.mockReset();
  electronBoundary.reservationIdentityRead.mockReset();
  electronBoundary.loseReservation = undefined;
  electronBoundary.reservationReleased.mockReset();
  electronBoundary.removeHandler.mockReset();
  electronBoundary.handle.mockReset();
  electronBoundary.portClosed.mockReset();
  vi.mocked(launchWindowsInstallerForUpdate).mockReset().mockResolvedValue(undefined);
  electronBoundary.fork.mockReset();
  electronBoundary.loadWindow.mockReset().mockResolvedValue(undefined);
  electronBoundary.fetch.mockReset().mockImplementation(async () =>
    new Response(JSON.stringify({ status: 'ok' })),
  );
  // Stop at the real business-window boundary; this is not an Electron UI test.
  electronBoundary.createWindow.mockReset().mockImplementation(() => {
    throw new Error(windowBoundary);
  });
  vi.spyOn(ProfileSnapshotBrokerClient.prototype, 'waitUntilReady')
    .mockImplementation(async function (this: ProfileSnapshotBrokerClient) {
      ownedClients.push(this);
    });
  vi.spyOn(ProfileSnapshotBrokerClient.prototype, 'getStatus')
    .mockResolvedValue('normal');
  vi.spyOn(RecoveryPointScheduler.prototype, 'start').mockResolvedValue('clean');
  vi.spyOn(RecoveryPointScheduler.prototype, 'stopChecks').mockResolvedValue();
});

afterEach(async () => {
  if (trackedStartupTest !== undefined) {
    trackedStartupTest.releaseWhenSettled();
    return;
  }
  for (const client of clients.splice(0)) client.close();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  for (const root of roots.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

function beginTrackedStartupTest(context: TestContext) {
  const ownedClients = clients;
  const lifetime = createRestoreStartupTestLifetime(context, () => releaseRestoreStartupTestResources(
    ownedClients, () => vi.restoreAllMocks(), () => vi.unstubAllEnvs(),
  ));
  trackedStartupTest = lifetime;
  return lifetime;
}

describe('selector candidate rollback main handoff', () => {
  it.for(['noActivation', 'rolledBack', 'wrongReceipt', 'foreignProfile', 'contentFailure', 'ownerStillActive', 'releaseFailure',
    'anchorReleaseFailure', 'duplicate', 'duplicateAtRootRemoval', 'secretDrainFailure', 'inspectionDrainFailure', 'changedTarget'] as const)(
    'validates $0 with the existing cold owner before returning from the main callback', async (scenario, context) => {
      const lifetime = beginTrackedStartupTest(context);
      await lifetime.run(async () => {
        const recoverSource = vi.fn(async () => 'relaunchRequired' as const);
        const resolve: NonNullable<StartDesktopCompositionOptions['dependencies']>['resolveActiveWorkspace'] = async root => {
          const current = await resolveActiveWorkspaceStartup(root);
          // Only switch selection is injected; main, journal bytes and cold ownership stay real.
          return { ...current, mode: 'targetValidation', recoverFromFailure: recoverSource, switchContext: {
            operationId, sourceWorkspaceId: null, targetWorkspaceId: workspaceId, targetProfileId: originalProfileId,
          } };
        };
        const f = await lifetime.step('fixturePreparation', () => createFixture(originalProfileId, {
          ownedRoots: lifetime.roots, update: true, skipRestore: true, completeStartup: true, resolveActiveWorkspace: resolve,
        }));
        const paths = deriveWorkspaceBackupReplacementRuntimePaths(f.root, workspaceId);
        const journal = new ProfileRestoreActivationJournalStore(paths.activationJournalPath);
        const transaction = new ProfileRestoreActivationTransaction({ journalStore: journal, paths: {
          activeDatabasePath: f.databasePath, activeDocumentsRoot: createDesktopProfilePaths(deriveWorkspaceRoot(f.root, workspaceId, 1).workspaceRoot).invoiceDocumentStorageRoot,
          failedRoot: paths.activationFailedRoot, rollbackRoot: paths.activationRollbackRoot, stagingRoot: paths.activationStagingRoot,
        } });
        const boundary = new Error('SYNTHETIC_SELECTOR_CALLBACK_BOUNDARY');
        const fault = new Error('SYNTHETIC_SELECTOR_CALLBACK_FAULT');
        let completed = false;
        let selected: WorkspaceActivationMigrationRecoveryReceipt | undefined;
        let callbackFailure: unknown;
        let rollbackClaimReleased = false;
        let finalIdentityInterrupted = false;
        if (scenario === 'duplicateAtRootRemoval') electronBoundary.reservationReleased.mockImplementation(async root => {
          if (root === join(paths.activationRollbackRoot, operationId)) rollbackClaimReleased = true;
        });
        if (scenario === 'secretDrainFailure') {
          const start = secretBrokerMain.startSecretBrokerMain;
          vi.spyOn(secretBrokerMain, 'startSecretBrokerMain').mockImplementationOnce(options => {
            const handle = start(options); let drains = 0;
            return { ...handle, async sealAndDrain() {
              if (++drains === 2) throw fault;
              await handle.sealAndDrain();
            } };
          });
        }
        if (scenario === 'inspectionDrainFailure') vi.spyOn(ProfileSnapshotInspectionClient.prototype, 'shutdown').mockRejectedValueOnce(fault);
        if (scenario === 'contentFailure') vi.mocked(originalInspection.runProfileRestoreOriginalInspection).mockRejectedValue(fault);
        if (scenario === 'releaseFailure' || scenario === 'anchorReleaseFailure') electronBoundary.reservationReleased.mockImplementation(async root => {
          if (root === join(scenario === 'releaseFailure' ? paths.activationRollbackRoot : paths.activationFailedRoot, operationId)) throw fault;
        });
        vi.spyOn(activationComposition, 'createWorkspaceActivationMigrationComposition').mockImplementation(async options => ({
          async prepareBeforeBackend() { return { status: 'migrationRequired', migrationStartupPolicy: 'restoreCompatible' }; },
          async beforeMigrations(_inspection: unknown, control: { stopStartupRuntime(): Promise<void> }) {
            if (scenario !== 'ownerStillActive') await control.stopStartupRuntime();
            if (scenario === 'foreignProfile') await f.journal.write({ formatVersion: 1, operationId,
              phase: 'rolledBack', revision: 1, hadActiveDatabase: true, hadActiveDocuments: true });
            if (['rolledBack', 'wrongReceipt', 'contentFailure', 'releaseFailure', 'anchorReleaseFailure', 'duplicateAtRootRemoval'].includes(scenario)) {
              const staging = join(paths.activationStagingRoot, operationId);
              const stagedPdf = join(staging, 'activation', 'storage', 'invoices', 'company-1', 'invoice-1', 'approved-invoice.pdf');
              await mkdir(dirname(stagedPdf), { recursive: true });
              await writeFile(join(staging, 'profile.sqlite'), f.restoredBytes);
              await writeFile(stagedPdf, '%PDF-1.7 restored pdf');
              await transaction.prepare(operationId);
              await transaction.advanceToValidation();
              const rolledBack = await transaction.rollback();
              selected = { kind: 'rolledBack', journal: { ...rolledBack,
                revision: rolledBack.revision + (scenario === 'wrongReceipt' ? 1 : 0) } };
            } else selected = { kind: 'noActivation' };
            if (scenario === 'duplicateAtRootRemoval') {
              let releasedIdentityReads = 0;
              electronBoundary.reservationIdentityRead.mockImplementation(async root => {
                if (root === join(paths.activationRollbackRoot, operationId) && rollbackClaimReleased && ++releasedIdentityReads === 2) {
                  finalIdentityInterrupted = true;
                  await expect(options.completeSelectorRollback!(selected!)).rejects.toThrow();
                }
              });
            }
            if (scenario === 'changedTarget') Object.assign(options.activeWorkspace.switchContext!, { targetProfileId: foreignProfileId });
            try {
              await options.completeSelectorRollback!(selected);
              if (scenario === 'duplicate') await options.completeSelectorRollback!(selected);
              completed = true;
            }
            catch (error) {
              callbackFailure = error;
              const failure = new DesktopBackendStartupError('BACKEND_MIGRATION_STARTUP_GATE_FAILED', {
                processState: scenario === 'ownerStillActive' ? 'unknown' : 'absent',
                migrationGateSettled: true, reservationReclaimed: scenario !== 'ownerStillActive',
              });
              failure.cause = error;
              throw failure;
            }
            throw boundary;
          },
        }) as unknown as Awaited<ReturnType<typeof activationComposition.createWorkspaceActivationMigrationComposition>>);
        const observe = vi.fn();
        await lifetime.step('startup', async () => { await expect(f.start(observe)).rejects.toThrow(); });
        const succeeds = scenario === 'noActivation' || scenario === 'rolledBack';
        expect(completed).toBe(succeeds);
        expect(f.relaunch).not.toHaveBeenCalled();
        expect(recoverSource).not.toHaveBeenCalled();
        expect(electronBoundary.createWindow).not.toHaveBeenCalled();
        if (succeeds) {
          expect(observe.mock.calls.some(([error]) => hasErrorCause(error, boundary))).toBe(true);
          expect(callbackFailure).toBeUndefined();
          await expect(journal.peek()).resolves.toBeUndefined();
        } else {
          expect(callbackFailure).toBeInstanceOf(Error);
          expect(observe.mock.calls.some(([error]) => hasErrorCause(error, callbackFailure as Error))).toBe(true);
          if (['contentFailure', 'releaseFailure', 'anchorReleaseFailure', 'secretDrainFailure', 'inspectionDrainFailure'].includes(scenario)) {
            expect(hasErrorCause(callbackFailure, fault)).toBe(true);
          }
          if (scenario === 'anchorReleaseFailure') {
            await expect(journal.peek()).resolves.toBeUndefined();
            expect(await readdir(paths.activationFailedRoot)).toContain(operationId);
          } else if (selected?.kind === 'rolledBack') await expect(journal.peek()).resolves.toMatchObject({ phase: 'rolledBack' });
          if (scenario === 'foreignProfile') await expect(f.journal.peek()).resolves.toMatchObject({ phase: 'rolledBack' });
          if (scenario === 'duplicateAtRootRemoval') {
            expect(finalIdentityInterrupted).toBe(true);
            expect(await readdir(paths.activationRollbackRoot)).toContain(operationId);
          }
        }
        await lifetime.step('restoredContentCheck', async () => {
          expect(await readFile(f.databasePath, 'utf8')).toBe(f.originalBytes);
          expect(await readFile(f.pdfPath, 'utf8')).toBe('%PDF-1.7 original pdf');
          await f.assertRegistryUnchanged();
        });
      });
    },
  );
});

describe('selector installation-state startup wiring', () => {
  it('settles concurrent deferred admission readers before propagating their first failure', async context => {
    const lifetime = beginTrackedStartupTest(context);
    await lifetime.run(async () => {
      const f = await lifetime.step('fixturePreparation', () => createDeferredStartupFixture(lifetime.roots));
      let release!: () => void;
      let entered!: () => void;
      let rejected!: () => void;
      const slow = new Promise<void>(resolve => { release = resolve; });
      const started = new Promise<void>(resolve => { entered = resolve; });
      const failed = new Promise<void>(resolve => { rejected = resolve; });
      context.signal.addEventListener('abort', release, { once: true });
      const first = new Error('SYNTHETIC_DEFERRED_READ_FAILURE');
      const prepare = deferredPreparation.prepareDeferredBusinessLocalUpdateState;
      vi.spyOn(deferredPreparation, 'prepareDeferredBusinessLocalUpdateState').mockImplementationOnce(async input => {
        const prepared = await prepare(input);
        vi.spyOn(AcceptedBuildMetadataStore.prototype, 'inspectSlots').mockImplementation(async () => { rejected(); throw first; });
        const read = UpdateJournalStore.prototype.inspectSlots;
        vi.spyOn(UpdateJournalStore.prototype, 'inspectSlots').mockImplementation(async function (this: UpdateJournalStore) {
          entered(); await slow; return read.call(this);
        });
        return prepared;
      });
      const observe = vi.fn();
      let settled = false;
      const outcome = f.fixture.start(observe).then(value => { settled = true; return value; }, error => {
        settled = true; return error;
      });
      try {
        await failed;
        await started;
        expect(settled).toBe(false);
      } finally {
        release();
        context.signal.removeEventListener('abort', release);
      }
      expect(await outcome).toMatchObject({ message: 'DESKTOP_START_FAILED' });
      expect(observe).toHaveBeenCalledWith(first, 'compositionStartup', []);
      expect(f.resolve).not.toHaveBeenCalled();
      expect(f.fixture.events).toEqual([]);
    });
  });

  it.for(['metadata', 'directSetup', 'update'] as const)(
    'preserves a late $0 side slot before deferred build admission', async (owner, context) => {
      const lifetime = beginTrackedStartupTest(context);
      await lifetime.run(async () => {
        const f = await lifetime.step('fixturePreparation', () => createDeferredStartupFixture(lifetime.roots));
        const prepare = deferredPreparation.prepareDeferredBusinessLocalUpdateState;
        const path = `${owner === 'metadata' ? f.paths.acceptedBuildMetadataPath
          : owner === 'directSetup' ? f.paths.directSetupMigrationRecoveryPath : f.paths.journalPath}.next`;
        const evidence = owner === 'metadata'
          ? JSON.stringify(createBusinessAcceptedBuildMetadata(f.metadata, f.metadata.acceptedBuild))
          : 'synthetic incomplete foreign write';
        vi.spyOn(deferredPreparation, 'prepareDeferredBusinessLocalUpdateState').mockImplementationOnce(async input => {
          const prepared = await prepare(input);
          await writeFile(path, evidence, { flag: 'wx' });
          return prepared;
        });
        const read = vi.spyOn(AcceptedBuildMetadataStore.prototype, 'read');
        await lifetime.step('startup', async () => { await expect(f.fixture.start()).rejects.toThrow(); });
        expect(read).not.toHaveBeenCalled();
        expect(await readFile(path, 'utf8')).toBe(evidence);
        expect(f.resolve).not.toHaveBeenCalled();
        expect(f.fixture.events).toEqual([]);
        expect(f.fixture.createRuntimeSession).not.toHaveBeenCalled();
      });
    },
  );

  it.for([false, true])('accepts deferred business through real main and FirstStart (passive transition: %s)', async (passiveTransition, context) => {
    const lifetime = beginTrackedStartupTest(context);
    await lifetime.run(async () => {
      const f = await lifetime.step('fixturePreparation', () => createDeferredStartupFixture(lifetime.roots, true));
      const initial = (await f.fixture.registry.inspect())!;
      const passiveId = validateWorkspaceId('22222222-2222-4222-8222-222222222222');
      if (passiveTransition) {
        await f.fixture.registry.write({ ...initial, workspaces: [...initial.workspaces, {
          ...initial.workspaces[0]!, workspaceId: passiveId, workspaceLabel: 'Synthetic passive',
          lineageIdentity: { formatVersion: 1, profileId: foreignProfileId },
        }] });
      }
      vi.spyOn(WorkspaceMigrationInventoryCoordinator.prototype, 'inspect').mockResolvedValue({
        activeWorkspaceId: workspaceId, entries: [
          { workspaceId, isActive: true, appliedMigrationCount: 1, pendingMigrationCount: 0, status: 'current' },
          ...(passiveTransition ? [{ workspaceId: passiveId, isActive: false, appliedMigrationCount: 0,
            pendingMigrationCount: 0, status: 'invalidHistory' as const }] : []),
        ],
      });
      const publishOriginal = AcceptedBuildMetadataStore.prototype.publishSelected;
      const publish = vi.spyOn(AcceptedBuildMetadataStore.prototype, 'publishSelected')
        .mockImplementation(async function (this: AcceptedBuildMetadataStore, ...args) {
          expect(f.fixture.events).toContain('backendStarted');
          const journal = await new WorkspaceFirstStartMigrationJournalStore({ userDataPath: f.fixture.root }).inspect();
          if (passiveTransition) expect(journal?.value.state).toBe('registryTransitioned');
          else expect(journal).toBeUndefined();
          return publishOriginal.apply(this, args);
        });
      const observe = vi.fn();
      const lifecycle = await lifetime.step('startup', () => f.fixture.start(observe).catch(error => {
        throw observe.mock.calls[0]?.[0] ?? error;
      }));
      expect(lifecycle).toBeDefined();
      try {
        expect(observe).not.toHaveBeenCalled();
        expect(publish).toHaveBeenCalledOnce();
        expect(await f.fixture.acceptedBuild.inspectSlots()).toMatchObject({ current: { value: {
          formatVersion: 2, acceptanceScope: 'business', acceptedBuild: expect.objectContaining({ appVersion: '0.2.8' }),
          businessBaseline: expect.objectContaining({ appVersion: '0.2.8' }),
        } }, next: undefined, backup: undefined });
        const registry = (await f.fixture.registry.inspect())!;
        expect(registry.activeWorkspaceId).toBe(workspaceId);
        expect(registry.workspaces[0]).toEqual(initial.workspaces[0]);
        if (passiveTransition) expect(registry.workspaces[1]?.lifecycleState).toBe('recoveryRequired');
        expect(await new WorkspaceFirstStartMigrationJournalStore({ userDataPath: f.fixture.root }).inspect()).toBeUndefined();
        expect(await f.fixture.updateJournal.read()).toBeUndefined();
        expect(await readFile(f.fixture.databasePath, 'utf8')).toBe(f.fixture.originalBytes);
        expect(await readFile(f.fixture.pdfPath, 'utf8')).toBe('%PDF-1.7 original pdf');
        expect(electronBoundary.createWindow).toHaveBeenCalledOnce();
      } finally { await lifecycle?.shutdown(); }
    });
  });

  it('continues an already-published deferred business target without republishing it', async context => {
    const lifetime = beginTrackedStartupTest(context);
    await lifetime.run(async () => {
      const f = await lifetime.step('fixturePreparation', () => createDeferredStartupFixture(lifetime.roots, true));
      const business = createBusinessAcceptedBuildMetadata(f.metadata, f.metadata.acceptedBuild);
      await rename(f.paths.acceptedBuildMetadataPath, `${f.paths.acceptedBuildMetadataPath}.backup`);
      await writeFile(f.paths.acceptedBuildMetadataPath, JSON.stringify(business));
      const publish = vi.spyOn(AcceptedBuildMetadataStore.prototype, 'publishSelected');
      const observe = vi.fn();
      const lifecycle = await lifetime.step('startup', () => f.fixture.start(observe).catch(error => {
        throw observe.mock.calls[0]?.[0] ?? error;
      }));
      expect(lifecycle).toBeDefined();
      try {
        expect(publish).not.toHaveBeenCalled();
        expect(await f.fixture.acceptedBuild.inspectSlots()).toMatchObject({ current: { value: business },
          next: undefined, backup: undefined });
        expect(await readFile(f.fixture.databasePath, 'utf8')).toBe(f.fixture.originalBytes);
        expect(electronBoundary.createWindow).toHaveBeenCalledOnce();
      } finally { await lifecycle?.shutdown(); }
    });
  });

  it.for(['metadataReplacement', 'foreignRecovery', 'pendingMigration', 'contentChanged',
    'publicationLostReply', 'publicationReplacement', 'ownerLost'] as const)(
    'preserves deferred startup evidence on $0 without opening business', async (fault, context) => {
      const lifetime = beginTrackedStartupTest(context);
      await lifetime.run(async () => {
        const f = await lifetime.step('fixturePreparation', () => createDeferredStartupFixture(lifetime.roots, true));
        const originalMetadata = await readFile(f.paths.acceptedBuildMetadataPath);
        const first = new Error('SYNTHETIC_DEFERRED_PUBLICATION_REPLY_LOST');
        const inspect = vi.mocked(snapshotInspection.runProfileSnapshotInspection).getMockImplementation()!;
        let inspections = 0;
        vi.mocked(snapshotInspection.runProfileSnapshotInspection).mockImplementation(async input => {
          const result = await inspect(input);
          inspections++;
          if (inspections === 1 && fault === 'metadataReplacement') {
            await rename(f.paths.acceptedBuildMetadataPath, `${f.paths.acceptedBuildMetadataPath}.retained`);
            await writeFile(f.paths.acceptedBuildMetadataPath, originalMetadata);
          }
          if (inspections === 1 && fault === 'foreignRecovery') {
            await writeFile(f.paths.directSetupMigrationRecoveryPath, JSON.stringify(createAcceptedDirectSetupFixture()));
          }
          if (inspections === 2 && fault === 'contentChanged') {
            return { ...result, validation: { ...result.validation, migrationChainIdentity: 'f'.repeat(64) } };
          }
          if (inspections === 2 && fault === 'ownerLost') {
            f.fixture.assertSingleInstanceOwnership.mockImplementation(() => { throw new Error('SYNTHETIC_STARTUP_OWNER_LOST'); });
          }
          return result;
        });
        if (fault === 'pendingMigration') {
          const before = FirstStartUpdateCoordinator.prototype.beforeMigrations;
          vi.spyOn(FirstStartUpdateCoordinator.prototype, 'beforeMigrations')
            .mockImplementation(function (this: FirstStartUpdateCoordinator, inspection, options) {
              return before.call(this, { ...inspection, pendingMigrationCount: 1 }, options);
            });
        }
        const write = AcceptedBuildMetadataStore.prototype.publishSelected;
        const publish = vi.spyOn(AcceptedBuildMetadataStore.prototype, 'publishSelected')
          .mockImplementation(async function (this: AcceptedBuildMetadataStore, ...args) {
            const identity = await write.apply(this, args);
            if (fault === 'publicationLostReply') throw first;
            if (fault === 'publicationReplacement') {
              const bytes = await readFile(f.paths.acceptedBuildMetadataPath);
              await rename(f.paths.acceptedBuildMetadataPath, `${f.paths.acceptedBuildMetadataPath}.retained`);
              await writeFile(f.paths.acceptedBuildMetadataPath, bytes);
            }
            return identity;
          });
        const observe = vi.fn();
        await lifetime.step('startup', async () => { await expect(f.fixture.start(observe)).rejects.toThrow(); });
        expect(observe).toHaveBeenCalled();
        if (fault === 'publicationLostReply') expect(observe.mock.calls.some(([error]) => hasErrorCause(error, first))).toBe(true);
        expect(publish).toHaveBeenCalledTimes(fault.startsWith('publication') ? 1 : 0);
        expect(electronBoundary.createWindow).not.toHaveBeenCalled();
        expect(f.fixture.relaunch).not.toHaveBeenCalled();
        expect(await readFile(f.fixture.databasePath, 'utf8')).toBe(f.fixture.originalBytes);
        expect(await readFile(f.fixture.pdfPath, 'utf8')).toBe('%PDF-1.7 original pdf');
        expect(await f.fixture.updateJournal.inspectSlots()).toEqual({ current: undefined, next: undefined, backup: undefined });
        if (fault.startsWith('publication')) expect((await f.fixture.acceptedBuild.inspectSlots()).current?.value)
          .toMatchObject({ formatVersion: 2, acceptanceScope: 'business' });
        else expect(await readFile(f.paths.acceptedBuildMetadataPath)).toEqual(originalMetadata);
        if (fault === 'foreignRecovery') expect(await readFile(f.paths.directSetupMigrationRecoveryPath, 'utf8'))
          .toBe(JSON.stringify(createAcceptedDirectSetupFixture()));
        if (fault.endsWith('Replacement')) expect(await readFile(`${f.paths.acceptedBuildMetadataPath}.retained`)).toBeDefined();
      });
    },
  );

  it('does not open runtime resources after installation authority expires during preparation', async context => {
    const lifetime = beginTrackedStartupTest(context);
    await lifetime.run(async () => {
      const fixture = await lifetime.step('fixturePreparation', () => createFixture(originalProfileId, {
        ownedRoots: lifetime.roots, update: true, skipRestore: true,
      }));
      const prepare = WorkspaceFirstStartMigrationOrchestrator.prototype.prepareBeforeBackend;
      vi.spyOn(WorkspaceFirstStartMigrationOrchestrator.prototype, 'prepareBeforeBackend')
        .mockImplementation(async function (this: WorkspaceFirstStartMigrationOrchestrator, input) {
          const preparation = await prepare.call(this, input);
          expect(electronBoundary.loseReservation).toBeTypeOf('function');
          electronBoundary.loseReservation!();
          return preparation;
        });
      await lifetime.step('startup', async () => {
        const observe = vi.fn();
        await expect(fixture.start(observe)).rejects.toThrow();
        expect(observe).toHaveBeenCalledWith(expect.objectContaining({ reason: 'lost' }), 'compositionStartup', [expect.any(String)]);
      });
      expect(fixture.createRuntimeSession).toHaveBeenCalledOnce();
      expect(fixture.events).toEqual([]);
      expect(fixture.relaunch).not.toHaveBeenCalled();
      expect(electronBoundary.fork).not.toHaveBeenCalled();
      expect(electronBoundary.createWindow).not.toHaveBeenCalled();
      expect(electronBoundary.handle).not.toHaveBeenCalled();
      await fixture.assertRegistryUnchanged();
      await expect(readFile(fixture.databasePath, 'utf8')).resolves.toBe(fixture.originalBytes);
    });
  });

  it.for((['ready', 'relaunching'] as const).flatMap(outcome =>
    (['singleInstance', 'reservation'] as const).map(lostOwner => ({ outcome, lostOwner }))))(
    'refuses an expired installation after a $outcome workspace result ($lostOwner)', async ({ outcome, lostOwner }, context) => {
      const lifetime = beginTrackedStartupTest(context);
      await lifetime.run(async () => {
        const resolve = vi.fn(async (root: string) => {
          const selection = await resolveActiveWorkspaceStartup(root);
          if (lostOwner === 'singleInstance') {
            fixture.assertSingleInstanceOwnership.mockImplementation(() => { throw new Error('synthetic ownership lost'); });
          } else {
            expect(electronBoundary.loseReservation).toBeTypeOf('function');
            electronBoundary.loseReservation!();
          }
          if (outcome === 'relaunching') throw new ActiveWorkspaceStartupRelaunchRequiredError();
          return selection;
        });
        const fixture = await lifetime.step('fixturePreparation', () => createFixture(originalProfileId, {
          ownedRoots: lifetime.roots, update: true, skipRestore: true, resolveActiveWorkspace: resolve,
        }));
        const metadata = await fixture.acceptedBuild.read();
        await lifetime.step('startup', async () => {
          const observe = vi.fn();
          await expect(fixture.start(observe)).rejects.toThrow(lostOwner === 'singleInstance'
            ? 'DESKTOP_START_FAILED' : 'WORKSPACE_PROCESS_RESERVATION_FAILED');
          expect(observe).toHaveBeenCalledWith(expect.objectContaining({ message: lostOwner === 'singleInstance'
            ? 'synthetic ownership lost' : 'WORKSPACE_PROCESS_RESERVATION_FAILED' }), 'compositionStartup', []);
        });
        expect(resolve).toHaveBeenCalledOnce();
        expect(fixture.createRuntimeSession).not.toHaveBeenCalled();
        expect(fixture.relaunch).not.toHaveBeenCalled();
        expect(fixture.events).toEqual([]);
        expect(electronBoundary.fork).not.toHaveBeenCalled();
        expect(electronBoundary.createWindow).not.toHaveBeenCalled();
        await fixture.assertRegistryUnchanged();
        await expect(fixture.acceptedBuild.read()).resolves.toEqual(metadata);
        await expect(readFile(fixture.databasePath, 'utf8')).resolves.toBe(fixture.originalBytes);
        await expect(readFile(fixture.pdfPath, 'utf8')).resolves.toBe('%PDF-1.7 original pdf');
      });
    },
  );

  it.for(['accepted', 'installerNotApplied', 'rolledBack'] as const)(
    'prepares exact terminal $0 before workspace resolution without starting business', async (state, context) => {
      const lifetime = beginTrackedStartupTest(context);
      await lifetime.run(async () => {
        const f = await lifetime.step('fixturePreparation', () => createSelectorStartupFixture(lifetime.roots, state));
        const beforeRegistry = await readFile(join(f.fixture.root, WORKSPACE_REGISTRY_FILE_NAME));
        await lifetime.step('startup', async () => {
          const observe = vi.fn();
          await expect(f.fixture.start(observe)).rejects.toThrow('DESKTOP_START_FAILED');
          expect(observe).toHaveBeenCalledWith(f.boundary, 'compositionStartup', []);
        });
        expect(f.resolve).toHaveBeenCalledOnce();
        await expect(f.fixture.acceptedBuild.read()).resolves.toEqual(f.metadata);
        await expect(f.fixture.updateJournal.read()).resolves.toBeUndefined();
        await expect(readFile(f.paths.legacyAcceptedBuildMetadataPath)).rejects.toMatchObject({ code: 'ENOENT' });
        await expect(readFile(f.paths.legacyJournalPath)).rejects.toMatchObject({ code: 'ENOENT' });
        await expect(readFile(join(f.fixture.root, WORKSPACE_REGISTRY_FILE_NAME))).resolves.toEqual(beforeRegistry);
        await expect(readFile(f.fixture.databasePath, 'utf8')).resolves.toBe(f.fixture.originalBytes);
        await expect(readFile(f.fixture.pdfPath, 'utf8')).resolves.toBe('%PDF-1.7 original pdf');
        expect(f.fixture.events).toEqual([]);
        expect(f.fixture.createRuntimeSession).not.toHaveBeenCalled();
        expect(electronBoundary.fork).not.toHaveBeenCalled();
        expect(electronBoundary.createWindow).not.toHaveBeenCalled();
      });
    },
  );

  it.for(['nextSlot', 'metadataConflict', 'downgrade', 'differentRevision', 'lostAuthority', 'changedMetadata', 'changedDirectSetup'] as const)(
    'preserves selected bytes and refuses startup on $0', async (fault, context) => {
      const lifetime = beginTrackedStartupTest(context);
      await lifetime.run(async () => {
        const f = await lifetime.step('fixturePreparation', () => createSelectorStartupFixture(lifetime.roots));
        const originalInspect = AcceptedBuildMetadataStore.prototype.inspectSlots;
        let observed = false;
        let metadataReads = 0;
        if (fault === 'nextSlot') await writeFile(`${f.paths.legacyAcceptedBuildMetadataPath}.next`, JSON.stringify(f.metadata));
        if (fault === 'metadataConflict') await writeFile(f.paths.acceptedBuildMetadataPath, JSON.stringify({
          ...f.metadata, acceptedAt: '2026-08-19T10:00:00.000Z',
        }));
        if (fault === 'downgrade' || fault === 'differentRevision') {
          await writeFile(f.paths.legacyAcceptedBuildMetadataPath, JSON.stringify({
            ...f.metadata, ...(fault === 'downgrade' ? { appVersion: '0.2.9' } : { buildRevision: 'c'.repeat(12) }),
          }));
          // No C mismatch can conceal a failure of the running-build gate.
          await rm(f.paths.legacyJournalPath);
        }
        if (fault === 'lostAuthority' || fault === 'changedMetadata' || fault === 'changedDirectSetup') {
          vi.spyOn(AcceptedBuildMetadataStore.prototype, 'inspectSlots').mockImplementation(async function (this: AcceptedBuildMetadataStore) {
            const result = await originalInspect.call(this);
            if (result.current !== undefined) metadataReads++;
            if (!observed && result.current !== undefined && (fault !== 'changedDirectSetup' || metadataReads === 2)) {
              observed = true;
              if (fault === 'lostAuthority') {
                f.fixture.assertSingleInstanceOwnership.mockImplementation(() => { throw new Error('synthetic ownership lost'); });
              } else if (fault === 'changedMetadata') {
                await writeFile(f.paths.legacyAcceptedBuildMetadataPath, JSON.stringify({ ...f.metadata, appVersion: '0.2.9' }));
              } else {
                await writeFile(f.paths.directSetupMigrationRecoveryPath, JSON.stringify(createAcceptedDirectSetupFixture()));
              }
            }
            return result;
          });
        }
        const terminal = await readFile(f.paths.legacyJournalPath).catch(error => {
          if (error.code === 'ENOENT') return undefined;
          throw error;
        });
        await lifetime.step('startup', async () => {
          const observe = vi.fn();
          await expect(f.fixture.start(observe)).rejects.toThrow();
          const expected = fault === 'lostAuthority' ? 'synthetic ownership lost'
            : fault === 'downgrade' || fault === 'differentRevision' ? 'DESKTOP_BUILD_ADMISSION_REJECTED'
            : fault === 'changedDirectSetup' ? 'WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED'
            : 'LOCAL_UPDATE_STATE_MIGRATION_CONFLICT';
          expect(observe.mock.calls[0]?.[0]).toMatchObject({ message: expected });
        });
        expect(f.resolve).not.toHaveBeenCalled();
        if (fault === 'lostAuthority' || fault === 'changedMetadata' || fault === 'changedDirectSetup') expect(observed).toBe(true);
        if (terminal !== undefined) await expect(readFile(f.paths.legacyJournalPath)).resolves.toEqual(terminal);
        await expect(readFile(f.paths.legacyAcceptedBuildMetadataPath)).resolves.toBeDefined();
        expect(f.fixture.events).toEqual([]);
        expect(f.fixture.createRuntimeSession).not.toHaveBeenCalled();
        expect(electronBoundary.fork).not.toHaveBeenCalled();
      });
    },
  );

  it.for(['current', 'currentNext', 'backupNext', 'backup', 'businessCurrent'] as const)(
    'admits deferred metadata $0 before the actual W6 startup boundary', async (state, context) => {
      const lifetime = beginTrackedStartupTest(context);
      await lifetime.run(async () => {
        const f = await lifetime.step('fixturePreparation', () => createDeferredStartupFixture(lifetime.roots));
        const accepted = createBusinessAcceptedBuildMetadata(f.metadata, f.metadata.acceptedBuild);
        if (state === 'currentNext' || state === 'backupNext') {
          await writeFile(`${f.paths.acceptedBuildMetadataPath}.next`, JSON.stringify(accepted));
        }
        if (state === 'backup' || state === 'backupNext' || state === 'businessCurrent') {
          await rename(f.paths.acceptedBuildMetadataPath, `${f.paths.acceptedBuildMetadataPath}.backup`);
        }
        if (state === 'businessCurrent') await writeFile(f.paths.acceptedBuildMetadataPath, JSON.stringify(accepted));
        const registryBytes = await readFile(join(f.fixture.root, WORKSPACE_REGISTRY_FILE_NAME));
        const boundary = new Error('synthetic W6 composition boundary');
        const recover = vi.spyOn(WorkspaceFirstStartMigrationOrchestrator.prototype, 'recoverBeforeWorkspaceResolution')
          .mockRejectedValue(boundary);
        const observe = vi.fn();
        await lifetime.step('startup', async () => {
          await expect(f.fixture.start(observe)).rejects.toThrow('DESKTOP_START_FAILED');
        });
        expect(observe).toHaveBeenCalledWith(boundary, 'compositionStartup', []);
        expect(recover).toHaveBeenCalledOnce();
        expect(f.resolve).not.toHaveBeenCalled();
        const result = await f.fixture.acceptedBuild.inspectSlots();
        expect(result.current?.value).toEqual(state === 'businessCurrent' ? accepted : f.metadata);
        expect(result.next).toBeUndefined();
        expect(result.backup).toBeUndefined();
        await expect(readFile(join(f.fixture.root, WORKSPACE_REGISTRY_FILE_NAME))).resolves.toEqual(registryBytes);
        await expect(readFile(f.fixture.databasePath, 'utf8')).resolves.toBe(f.fixture.originalBytes);
        expect(f.fixture.events).toEqual([]);
        expect(f.fixture.createRuntimeSession).not.toHaveBeenCalled();
        expect(electronBoundary.fork).not.toHaveBeenCalled();
      });
    },
  );

  it.for(['legacyMetadata', 'directSetup', 'malformedW6', 'malformedMetadataNext', 'wrongBuild', 'lostOwner',
    'changedSelection', 'changedInitialSelection', 'changedInitialMetadata', 'lateAdoption', 'legacyRegistry', 'missingRegistry',
    'mixedBusinessNext', 'mixedBusinessBackup', 'legacyMixedBusinessNext'] as const)(
    'preserves deferred evidence and blocks W6 on $0', async (fault, context) => {
      const lifetime = beginTrackedStartupTest(context);
      await lifetime.run(async () => {
        const f = await lifetime.step('fixturePreparation', () => createDeferredStartupFixture(lifetime.roots));
        const metadataPath = f.paths.acceptedBuildMetadataPath;
        const w6Path = createWorkspaceFirstStartMigrationJournalPaths(f.fixture.root).currentPath;
        let evidencePath = metadataPath;
        if (fault === 'legacyMetadata') {
          evidencePath = f.paths.legacyAcceptedBuildMetadataPath;
          await mkdir(dirname(evidencePath), { recursive: true });
          await writeFile(evidencePath, JSON.stringify(f.metadata));
        } else if (fault === 'directSetup') {
          evidencePath = f.paths.directSetupMigrationRecoveryPath;
          await writeFile(evidencePath, JSON.stringify(createAcceptedDirectSetupFixture()));
        } else if (fault === 'malformedW6') {
          evidencePath = `${w6Path}.next`;
          await writeFile(evidencePath, '{');
        } else if (fault === 'malformedMetadataNext') {
          evidencePath = `${metadataPath}.next`;
          await writeFile(evidencePath, '{');
        } else if (fault === 'wrongBuild') {
          await writeFile(metadataPath, JSON.stringify({ ...f.metadata,
            acceptedBuild: { ...f.metadata.acceptedBuild, buildRevision: 'f'.repeat(12) } }));
        } else if (fault === 'mixedBusinessNext' || fault === 'mixedBusinessBackup' || fault === 'legacyMixedBusinessNext') {
          const path = fault === 'legacyMixedBusinessNext' ? f.paths.legacyAcceptedBuildMetadataPath : metadataPath;
          await mkdir(dirname(path), { recursive: true });
          await writeFile(metadataPath, JSON.stringify(f.metadata.businessBaseline));
          await writeFile(path, JSON.stringify(f.metadata.businessBaseline));
          evidencePath = `${path}${fault === 'mixedBusinessBackup' ? '.backup' : '.next'}`;
          await writeFile(evidencePath, JSON.stringify(createBusinessAcceptedBuildMetadata(f.metadata, f.metadata.acceptedBuild)));
        } else if (fault === 'legacyRegistry' || fault === 'missingRegistry') {
          if (fault === 'legacyRegistry') {
            await writeFile(join(f.fixture.root, WORKSPACE_REGISTRY_FILE_NAME), JSON.stringify({
              ...(await f.fixture.registry.read())!, formatVersion: 1,
            }));
          } else await rm(join(f.fixture.root, WORKSPACE_REGISTRY_FILE_NAME));
          evidencePath = `${metadataPath}.next`;
          await writeFile(evidencePath, JSON.stringify(createBusinessAcceptedBuildMetadata(f.metadata, f.metadata.acceptedBuild)));
        }
        const evidence = await readFile(evidencePath);
        if (fault === 'changedInitialSelection' || fault === 'changedInitialMetadata') {
          const inspect = AcceptedBuildMetadataStore.prototype.inspectStartup;
          let replaced = false;
          vi.spyOn(AcceptedBuildMetadataStore.prototype, 'inspectStartup').mockImplementation(async function (this: AcceptedBuildMetadataStore) {
            const result = await inspect.call(this);
            if (!replaced && result.mode === 'scoped' && result.slots.current?.value.formatVersion === 2) {
              replaced = true;
              if (fault === 'changedInitialSelection') {
                const value = (await f.fixture.registry.read())!;
                await f.fixture.registry.write({ ...value, workspaces: value.workspaces.map(entry => ({ ...entry,
                  workspaceLabel: 'Changed before preparation' })) });
              } else {
                await writeFile(metadataPath, JSON.stringify({ ...f.metadata,
                  businessBaseline: { ...f.metadata.businessBaseline, acceptedAt: '2026-08-19T10:00:00.000Z' } }));
              }
            }
            return result;
          });
        }
        if (fault === 'lostOwner' || fault === 'changedSelection' || fault === 'lateAdoption') {
          const original = AcceptedBuildMetadataStore.prototype.recoverSelected;
          vi.spyOn(AcceptedBuildMetadataStore.prototype, 'recoverSelected').mockImplementation(async function (
            this: AcceptedBuildMetadataStore, selection,
          ) {
            if (fault === 'lostOwner') electronBoundary.loseReservation!();
            else if (fault === 'lateAdoption') {
              const path = createWorkspaceLegacyAdoptionJournalPaths(f.fixture.root).nextPath;
              await mkdir(dirname(path), { recursive: true });
              await writeFile(path, '{');
            }
            else {
              const value = (await f.fixture.registry.read())!;
              await f.fixture.registry.write({ ...value, workspaces: value.workspaces.map(entry => ({ ...entry,
                workspaceLabel: 'Changed during admission' })) });
            }
            return original.call(this, selection);
          });
        }
        const recover = vi.spyOn(WorkspaceFirstStartMigrationOrchestrator.prototype, 'recoverBeforeWorkspaceResolution');
        await lifetime.step('startup', async () => { await expect(f.fixture.start()).rejects.toThrow(); });
        expect(recover).not.toHaveBeenCalled();
        expect(f.resolve).not.toHaveBeenCalled();
        if (fault === 'changedInitialMetadata') {
          expect(JSON.parse(await readFile(evidencePath, 'utf8')).businessBaseline.acceptedAt)
            .toBe('2026-08-19T10:00:00.000Z');
        } else await expect(readFile(evidencePath)).resolves.toEqual(evidence);
        await expect(readFile(f.fixture.databasePath, 'utf8')).resolves.toBe(f.fixture.originalBytes);
        expect(f.fixture.events).toEqual([]);
        expect(f.fixture.createRuntimeSession).not.toHaveBeenCalled();
        expect(electronBoundary.fork).not.toHaveBeenCalled();
      });
    },
  );

  it.for([1, 2] as const)('retains the old repairing read for a non-null v$0 business selection', async (formatVersion, context) => {
    const lifetime = beginTrackedStartupTest(context);
    await lifetime.run(async () => {
      const boundary = new Error('synthetic workspace resolution boundary');
      const resolve = vi.fn(async () => { throw boundary; });
      const fixture = await lifetime.step('fixturePreparation', () => createFixture(originalProfileId, {
        ownedRoots: lifetime.roots, skipRestore: true, update: true, resolveActiveWorkspace: resolve,
      }));
      if (formatVersion === 2) await fixture.registry.write({ ...(await fixture.registry.read())!, formatVersion });
      const registryBytes = await readFile(join(fixture.root, WORKSPACE_REGISTRY_FILE_NAME));
      const paths = createLocalUpdateRuntimePaths({ userDataPath: fixture.root,
        legacyRuntimeRoot: createDesktopProfilePaths(fixture.root).runtimeRoot });
      await writeFile(`${paths.acceptedBuildMetadataPath}.next`, '{');
      await lifetime.step('startup', async () => {
        const observe = vi.fn();
        await expect(fixture.start(observe)).rejects.toThrow('DESKTOP_START_FAILED');
        expect(observe).toHaveBeenCalledWith(boundary, 'compositionStartup', []);
      });
      expect(resolve).toHaveBeenCalledOnce();
      expect(fixture.events).toEqual([]);
      await expect(readFile(join(fixture.root, WORKSPACE_REGISTRY_FILE_NAME))).resolves.toEqual(registryBytes);
    });
  });

  it('retains an unchanged accepted Direct Setup record across selector preparation', async context => {
    const lifetime = beginTrackedStartupTest(context);
    await lifetime.run(async () => {
      const f = await lifetime.step('fixturePreparation', () => createSelectorStartupFixture(lifetime.roots));
      const dsr = Buffer.from(JSON.stringify(createAcceptedDirectSetupFixture()));
      await writeFile(f.paths.directSetupMigrationRecoveryPath, dsr);
      await lifetime.step('startup', async () => {
        const observe = vi.fn();
        await expect(f.fixture.start(observe)).rejects.toThrow('DESKTOP_START_FAILED');
        expect(observe).toHaveBeenCalledWith(f.boundary, 'compositionStartup', []);
      });
      expect(f.resolve).toHaveBeenCalledOnce();
      await expect(readFile(f.paths.directSetupMigrationRecoveryPath)).resolves.toEqual(dsr);
      await expect(f.fixture.updateJournal.read()).resolves.toBeUndefined();
      expect(f.fixture.events).toEqual([]);
    });
  });

  it.for((['creation', 'import'] as const).flatMap(kind => ([1, 2] as const).map(formatVersion => ({ kind, formatVersion }))))(
    'reclassifies null v$formatVersion after cold $kind publication', async ({ kind, formatVersion }, context) => {
      const lifetime = beginTrackedStartupTest(context);
      await lifetime.run(async () => {
        const boundary = new Error('synthetic workspace resolution boundary');
        const resolve = vi.fn(async () => { throw boundary; });
        const fixture = await lifetime.step('fixturePreparation', () => createFixture(originalProfileId, {
          ownedRoots: lifetime.roots, update: true, skipRestore: true, completeStartup: true, resolveActiveWorkspace: resolve,
        }));
        await fixture.registry.write({ formatVersion, activeWorkspaceId: null, workspaces: [] });
        const pending = await prepareColdJournal(fixture.root, kind, { state: 'rootPublished', previousActiveWorkspaceId: null });
        const operations = installCompletedColdCandidate();
        await lifetime.step('startup', async () => {
          const observe = vi.fn();
          await expect(fixture.start(observe)).rejects.toThrow('DESKTOP_START_FAILED');
          expect(observe).toHaveBeenCalledWith(boundary, 'compositionStartup', []);
        });
        expect(operations).toEqual(['validatePublished']);
        expect(resolve).toHaveBeenCalledOnce();
        await expect(pending.journal.read()).resolves.toBeUndefined();
        await expect(fixture.registry.read()).resolves.toMatchObject({ formatVersion,
          activeWorkspaceId: formatVersion === 1 ? pending.value.workspaceId : null,
          workspaces: [{ workspaceId: pending.value.workspaceId, lifecycleState: 'ready' }],
        });
        await expect(readFile(pending.publishedFile, 'utf8')).resolves.toBe('synthetic published');
        expect(fixture.events).toEqual([]);
        expect(fixture.createRuntimeSession).not.toHaveBeenCalled();
      });
    },
  );

  it.for(['creation', 'import'] as const)('retains null after discarding an unpublished cold $0 candidate', async (kind, context) => {
    const lifetime = beginTrackedStartupTest(context);
    await lifetime.run(async () => {
      const boundary = new Error('synthetic workspace resolution boundary');
      const resolve = vi.fn(async () => { throw boundary; });
      const fixture = await lifetime.step('fixturePreparation', () => createFixture(originalProfileId, {
        ownedRoots: lifetime.roots, update: true, skipRestore: true, completeStartup: true, resolveActiveWorkspace: resolve,
      }));
      await fixture.registry.write({ ...(await fixture.registry.read())!, formatVersion: 2, activeWorkspaceId: null });
      const before = await fixture.registry.read();
      const pending = await prepareColdJournal(fixture.root, kind, { previousActiveWorkspaceId: null });
      await lifetime.step('startup', async () => {
        const observe = vi.fn();
        await expect(fixture.start(observe)).rejects.toThrow('DESKTOP_START_FAILED');
        expect(observe).toHaveBeenCalledWith(boundary, 'compositionStartup', []);
      });
      expect(resolve).toHaveBeenCalledOnce();
      await expect(fixture.registry.read()).resolves.toEqual(before);
      await expect(pending.journal.read()).resolves.toBeUndefined();
      await expect(readFile(pending.candidateFile)).rejects.toMatchObject({ code: 'ENOENT' });
      expect(electronBoundary.fork).not.toHaveBeenCalled();
      expect(fixture.events).toEqual([]);
    });
  });

  it('preserves the legacy adoption recovery owner with a null selection', async context => {
    const lifetime = beginTrackedStartupTest(context);
    await lifetime.run(async () => {
      const fixture = await lifetime.step('fixturePreparation', () => createFixture(originalProfileId, {
        ownedRoots: lifetime.roots, update: true, skipRestore: true,
      }));
      await fixture.registry.write({ ...(await fixture.registry.read())!, formatVersion: 2, activeWorkspaceId: null });
      const before = await fixture.registry.read();
      const legacy = createDesktopProfilePaths(fixture.root).databaseFilePath;
      await mkdir(dirname(legacy), { recursive: true });
      await writeFile(legacy, 'synthetic legacy source');
      const journal = new WorkspaceLegacyAdoptionJournalStore(fixture.root);
      await journal.write({ formatVersion: 1, operationId, workspaceId: '55555555-5555-4555-8555-555555555555',
        sourceKind: 'legacy', state: 'prepared', createdAt: '2026-08-18T10:00:00.000Z' });
      await journal.write({ ...(await journal.read())!, state: 'recoveryRequired' });
      await lifetime.step('startup', async () => { await expect(fixture.start()).resolves.toBeUndefined(); });
      expect(fixture.relaunch).toHaveBeenCalledOnce();
      await expect(journal.read()).resolves.toBeUndefined();
      await expect(fixture.registry.read()).resolves.toEqual(before);
      await expect(readFile(legacy, 'utf8')).resolves.toBe('synthetic legacy source');
      expect(fixture.events).toEqual([]);
      expect(fixture.createRuntimeSession).not.toHaveBeenCalled();
      expect(electronBoundary.fork).not.toHaveBeenCalled();
    });
  });
});

describe('desktop restore startup composition', () => {
  it.each([false, true])('retains a real startup log failure through the production capability (incident blocked: %s)', async blockIncident => {
    const fixture = await createFixture(originalProfileId, { skipRestore: true, completeStartup: true });
    const logsRoot = join(createDesktopProfilePaths(fixture.root).runtimeRoot, 'logs');
    await mkdir(logsRoot, { recursive: true });
    await writeFile(join(logsRoot, 'desktop'), 'synthetic detail obstruction');
    if (blockIncident) await writeFile(join(logsRoot, 'incident-index'), 'preserved incident obstruction');
    const lifecycle = await fixture.start();
    try {
      expect(lifecycle).toBeDefined();
      const registration = electronBoundary.handle.mock.calls.find(call =>
        call[0] === 'eky:diagnostics:get-operational-log-failure-status');
      expect(registration).toBeDefined();
      const readStatus = registration![1] as (event: unknown) => { failureObserved: boolean };
      expect(readStatus({ sender: fixture.mainWindow.webContents,
        senderFrame: fixture.mainWindow.webContents.mainFrame })).toEqual({ failureObserved: true });
      expect(electronBoundary.loadWindow).toHaveBeenCalledOnce();
      expect(fixture.mainWindow.webContents.send).not.toHaveBeenCalled();
      if (blockIncident) {
        expect(await readFile(join(logsRoot, 'incident-index'), 'utf8')).toBe('preserved incident obstruction');
      } else {
        const bytes = await readFile(join(logsRoot, 'incident-index',
          `desktop-incident-index-${new Date().getUTCFullYear()}.jsonl`), 'utf8');
        const incidents = bytes.trim().split('\n').map(line => JSON.parse(line));
        expect(incidents.filter(entry => entry.fingerprint === 'LOG_WRITE_FAILED:desktop-info')).toHaveLength(1);
        expect(bytes).not.toContain('33333333-3333-4333-8333-333333333333');
        expect(bytes).not.toContain(fixture.root);
      }
    } finally {
      await lifecycle?.shutdown();
    }
    expect(electronBoundary.removeHandler).toHaveBeenCalledWith('eky:diagnostics:get-operational-log-failure-status');
  });

  it.each(['desktop', 'incident-index'])('preserves ordinary startup when %s log listing fails', async directory => {
    const fixture = await createFixture(originalProfileId, { skipRestore: true, completeStartup: true });
    const logsRoot = join(createDesktopProfilePaths(fixture.root).runtimeRoot, 'logs');
    await mkdir(join(logsRoot, directory), { recursive: true });
    logMaintenanceIo.deniedDirectory = join(logsRoot, directory);
    const lifecycle = await fixture.start();
    try {
      expect(logMaintenanceIo.observed).toBe(true);
      expect(lifecycle).toBeDefined();
      expect(electronBoundary.loadWindow).toHaveBeenCalledOnce();
    } finally {
      await lifecycle?.shutdown();
    }
  });

  it.each([false, true])('uses fresh isolated first-start validation after ordinary startup validation (reject: %s)', async reject => {
    const fixture = await createFixture(originalProfileId, {
      update: true, firstStartUpgrade: true, skipRestore: true, completeStartup: true,
    });
    // Passive W6 inventory is a separate contract; keep the real first-start acceptance owner.
    vi.spyOn(WorkspaceFirstStartMigrationOrchestrator.prototype, 'prepareBeforeBackend').mockResolvedValue('notRequired');
    vi.spyOn(WorkspaceFirstStartMigrationOrchestrator.prototype, 'transitionRegistryAfterActiveWorkspaceAcceptance').mockResolvedValue();
    vi.spyOn(WorkspaceFirstStartMigrationOrchestrator.prototype, 'completeAfterTargetAcceptance').mockResolvedValue();
    electronBoundary.fetch.mockImplementation(async input => String(input).endsWith('/customers')
      ? new Response(null, { status: 401 }) : new Response(JSON.stringify({ status: 'ok' })));
    const inspect = vi.mocked(snapshotInspection.runProfileSnapshotInspection).getMockImplementation()!;
    const first = new ProfileInspectionProcessError('PROFILE_SCHEMA_UNSUPPORTED', {
      processAbsent: true, reservationReclaimed: true, forced: false,
    });
    let calls = 0;
    vi.mocked(snapshotInspection.runProfileSnapshotInspection).mockImplementation(async input => {
      if (++calls === 2 && reject) throw first;
      return inspect(input);
    });
    const observe = vi.fn();
    const outcome = await fixture.start(observe).then(runtime => ({ runtime, error: undefined }),
      (error: unknown) => ({ runtime: undefined, error }));
    if (reject) {
      expect(outcome.error).toMatchObject({ message: 'DESKTOP_START_FAILED' });
      expect(observe.mock.calls.some(([error]) => hasErrorCause(error, first))).toBe(true);
      expect(electronBoundary.createWindow).not.toHaveBeenCalled();
      expect(await fixture.acceptedBuild.read()).toMatchObject({ appVersion: '0.2.7' });
    } else {
      expect(observe.mock.calls).toEqual([]);
      const runtime = outcome.runtime;
      expect(runtime).toBeDefined();
      expect(await fixture.acceptedBuild.read()).toMatchObject({ appVersion: '0.2.8' });
      expect(electronBoundary.createWindow).toHaveBeenCalledOnce();
      await runtime!.shutdown();
    }
    expect(calls).toBe(2);
    expect('validateActiveProfile' in ProfileSnapshotBrokerClient.prototype).toBe(false);
    const begin = vi.mocked(ProfileSnapshotBrokerClient.prototype.beginRestoreMaintenance);
    expect(begin).toHaveBeenCalledTimes(2);
    expect(begin.mock.calls[0]![0]).not.toBe(begin.mock.calls[1]![0]);
    await expect(readFile(fixture.databasePath, 'utf8')).resolves.toBe(fixture.originalBytes);
  });

  it.each(['rollbackRequired', 'businessRollbackStarting', 'businessRollbackCompleted'] as const)(
    'continues only the selected journal-less C operation (%s)', async state => {
      const fixture = await createFixture(originalProfileId, {
        update: true, skipRestore: true, stoppedStartupRuntime: true,
      });
      await prepareUpdateBusinessRollback(fixture, state);
      const binaryRollback = vi.spyOn(UpdateBinaryRollbackCoordinator.prototype, 'startIfRequired').mockResolvedValue('launched');
      await expect(fixture.start()).resolves.toBeUndefined();
      expect((await fixture.updateJournal.readForLiveOwner())?.state).toBe('businessRollbackCompleted');
      expect(fixture.stopForUpdate).toHaveBeenCalledOnce();
      expect(binaryRollback).toHaveBeenCalledOnce();
      expect(electronBoundary.createWindow).not.toHaveBeenCalled();
      await expect(fixture.journal.peek()).resolves.toBeUndefined();
      await expect(readFile(fixture.databasePath, 'utf8')).resolves.toBe(fixture.originalBytes);
    },
  );

  it.each(['rollbackRequired', 'businessRollbackStarting', 'businessRollbackCompleted'] as const)(
    'runs the actual W6 preparation boundary only as rollback before the C gate (%s)', async state => {
      const fixture = await createFixture(originalProfileId, {
        update: true, skipRestore: true, stoppedStartupRuntime: true, pendingMigrationCount: 1,
      });
      await prepareUpdateBusinessRollback(fixture, state, false);
      const prepare = vi.spyOn(WorkspaceFirstStartMigrationOrchestrator.prototype, 'prepareBeforeBackend');
      const binaryRollback = vi.spyOn(UpdateBinaryRollbackCoordinator.prototype, 'startIfRequired').mockResolvedValue('launched');
      await expect(fixture.start()).resolves.toBeUndefined();
      expect(prepare).toHaveBeenCalledOnce();
      await expect(prepare.mock.results[0]!.value).resolves.toBe('rollbackOnly');
      expect(binaryRollback).toHaveBeenCalledOnce();
      expect(fixture.stopForUpdate).toHaveBeenCalledOnce();
      expect(electronBoundary.createWindow).not.toHaveBeenCalled();
      await expect(readFile(fixture.databasePath, 'utf8')).resolves.toBe(fixture.originalBytes);
    },
  );

  it.each(['rollbackRequired', 'businessRollbackStarting', 'businessRollbackCompleted'] as const)(
    'admits the selected journal-less C historical schema before backend open (%s)', async state => {
      let observedPolicy: StartDesktopBackendOptions['config']['migrationStartupPolicy'];
      let observedRecovery: StartDesktopBackendOptions['config']['ownedLocalDatabaseRecovery'];
      const fixture = await createFixture(originalProfileId, {
        update: true, skipRestore: true, stoppedStartupRuntime: true, pendingMigrationCount: 1,
        async inspectBackendStartup(input) {
          observedPolicy = input.config.migrationStartupPolicy;
          observedRecovery = input.config.ownedLocalDatabaseRecovery;
        },
      });
      await prepareUpdateBusinessRollback(fixture, state);
      const binaryRollback = vi.spyOn(UpdateBinaryRollbackCoordinator.prototype, 'startIfRequired')
        .mockResolvedValue('launched');
      await expect(fixture.start()).resolves.toBeUndefined();
      expect(observedPolicy!).toBe('restoreCompatible');
      expect(observedRecovery).toBeUndefined();
      expect((await fixture.updateJournal.readForLiveOwner())?.state).toBe('businessRollbackCompleted');
      expect(binaryRollback).toHaveBeenCalledOnce();
      expect(electronBoundary.createWindow).not.toHaveBeenCalled();
      await expect(fixture.journal.peek()).resolves.toBeUndefined();
      await expect(readFile(fixture.databasePath, 'utf8')).resolves.toBe(fixture.originalBytes);
    },
  );

  it.each([false, true])('does not adopt a journal-less C replacement at the backend gate (original absent: %s)', async absent => {
    let changed: Awaited<ReturnType<UpdateJournalStore['read']>>;
    const fixture = await createFixture(originalProfileId, { update: true, skipRestore: true, stoppedStartupRuntime: true,
      async inspectBackendStartup() {
        const selected = absent ? original! : (await fixture.updateJournal.readForLiveOwner())!;
        changed = { ...selected, candidatePackageIdentity: { ...selected.candidatePackageIdentity, packageSize: 4_096 } };
        await fixture.updateJournal.write(changed);
      },
    });
    await prepareUpdateBusinessRollback(fixture);
    const original = await fixture.updateJournal.readForLiveOwner();
    if (absent) await fixture.updateJournal.clear();
    const binaryRollback = vi.spyOn(UpdateBinaryRollbackCoordinator.prototype, 'startIfRequired').mockResolvedValue('launched');
    await expect(fixture.start()).rejects.toThrow('DESKTOP_START_FAILED');
    expect(await fixture.updateJournal.readForLiveOwner()).toEqual(changed);
    expect(binaryRollback).not.toHaveBeenCalled();
    expect(electronBoundary.createWindow).not.toHaveBeenCalled();
    await expect(readFile(fixture.databasePath, 'utf8')).resolves.toBe(fixture.originalBytes);
    await expect(fixture.journal.peek()).resolves.toBeUndefined();
  });

  it.each(['prepare', 'grant'] as const)('rejects changed C admission before the backend start grant (%s)', async stage => {
    let changed: Awaited<ReturnType<UpdateJournalStore['read']>>;
    const fixture = await createFixture(originalProfileId, { update: true, skipRestore: true, stoppedStartupRuntime: true,
      async inspectBackendStartup() {
        const replace = async () => {
          const selected = (await fixture.updateJournal.readForLiveOwner())!;
          changed = { ...selected, candidatePackageIdentity: { ...selected.candidatePackageIdentity, packageSize: 4_096 } };
          await fixture.updateJournal.write(changed);
        };
        if (stage === 'prepare') await replace();
        else electronBoundary.reservationReleased.mockImplementationOnce(replace);
      },
    });
    await prepareUpdateBusinessRollback(fixture);
    const binaryRollback = vi.spyOn(UpdateBinaryRollbackCoordinator.prototype, 'startIfRequired').mockResolvedValue('launched');
    await expect(fixture.start()).rejects.toThrow('DESKTOP_START_FAILED');
    expect(await fixture.updateJournal.readForLiveOwner()).toEqual(changed);
    expect(fixture.stopForUpdate).not.toHaveBeenCalled();
    expect(binaryRollback).not.toHaveBeenCalled(); expect(electronBoundary.createWindow).not.toHaveBeenCalled();
    await expect(fixture.journal.peek()).resolves.toBeUndefined();
    await expect(readFile(fixture.databasePath, 'utf8')).resolves.toBe(fixture.originalBytes);
  });

  it('retains rollback-only C selection at grant even with its matching activation journal', async () => {
    let gateEntered = false;
    let changed: Awaited<ReturnType<UpdateJournalStore['read']>>;
    const fixture = await createFixture(originalProfileId, { update: true, stoppedStartupRuntime: true,
      async inspectBackendStartup(input) {
        const beforeMigrations = input.beforeMigrations!;
        input.beforeMigrations = (...args) => { gateEntered = true; return beforeMigrations(...args); };
        electronBoundary.reservationReleased.mockImplementationOnce(async () => {
          const selected = (await fixture.updateJournal.readForLiveOwner())!;
          changed = { ...selected, candidatePackageIdentity: { ...selected.candidatePackageIdentity, packageSize: 4_096 } };
          await fixture.updateJournal.write(changed);
        });
      },
    });
    await prepareUpdateBusinessRollback(fixture, 'businessRollbackStarting', false);
    const binaryRollback = vi.spyOn(UpdateBinaryRollbackCoordinator.prototype, 'startIfRequired').mockResolvedValue('launched');
    await expect(fixture.start()).rejects.toThrow('DESKTOP_START_FAILED');
    expect(gateEntered).toBe(false);
    expect(await fixture.updateJournal.readForLiveOwner()).toEqual(changed);
    expect(binaryRollback).not.toHaveBeenCalled();
    expect(electronBoundary.createWindow).not.toHaveBeenCalled();
  });

  it('rejects a changed accepted source before the rollback-only backend grant', async () => {
    let gateEntered = false;
    const fixture = await createFixture(originalProfileId, { update: true, skipRestore: true, stoppedStartupRuntime: true,
      async inspectBackendStartup(input) {
        const beforeMigrations = input.beforeMigrations!;
        input.beforeMigrations = (...args) => { gateEntered = true; return beforeMigrations(...args); };
        electronBoundary.reservationReleased.mockImplementationOnce(async () => {
          const paths = createLocalUpdateRuntimePaths({ userDataPath: fixture.root,
            legacyRuntimeRoot: createDesktopProfilePaths(fixture.root).runtimeRoot });
          const accepted = new AcceptedBuildMetadataStore(paths.acceptedBuildMetadataPath);
          const previous = await accepted.read();
          if (previous?.formatVersion !== 1) throw new Error('SYNTHETIC_V1_ACCEPTANCE_REQUIRED');
          await accepted.write({ ...previous, appVersion: '0.2.6' });
        });
      },
    });
    await prepareUpdateBusinessRollback(fixture, 'businessRollbackStarting', false);
    const binaryRollback = vi.spyOn(UpdateBinaryRollbackCoordinator.prototype, 'startIfRequired').mockResolvedValue('launched');
    await expect(fixture.start()).rejects.toThrow('DESKTOP_START_FAILED');
    expect(gateEntered).toBe(false);
    expect(binaryRollback).not.toHaveBeenCalled();
    expect(electronBoundary.createWindow).not.toHaveBeenCalled();
  });

  it('keeps ordinary startup on exact schema policy and its own crash-recovery authority', async () => {
    let config: StartDesktopBackendOptions['config'] | undefined;
    const fixture = await createFixture(originalProfileId, { skipRestore: true, completeStartup: true,
      async inspectBackendStartup(input) { config = input.config; },
    });
    const lifecycle = await fixture.start();
    expect(config?.migrationStartupPolicy).toBe('exactCurrentManifest');
    expect(config?.ownedLocalDatabaseRecovery).toBeDefined();
    await lifecycle!.shutdown();
  });

  it('does not activate journal-less rollback staging after the selected update changes', async () => {
    const fixture = await createFixture(originalProfileId, { update: true, skipRestore: true,
      startupMigrationChainIdentity: 'd'.repeat(64) });
    await prepareUpdateBusinessRollback(fixture);
    let changed: Awaited<ReturnType<UpdateJournalStore['read']>>;
    vi.spyOn(RecoveryPointRestoreStagingService.prototype, 'stage').mockImplementation(async () => {
      const selected = (await fixture.updateJournal.readForLiveOwner())!;
      changed = { ...selected, currentPackageIdentity: { ...selected.currentPackageIdentity, packageSha256: 'f'.repeat(64) } };
      await fixture.updateJournal.write(changed);
      return { operationId, targetDisposition: 'replaceActiveProfile', summary: {
        appVersion: '0.2.7', compatibilityStatus: 'compatible', createdAt: '2026-08-18T10:00:00.000Z',
        databaseHealth: 'healthy', documentCount: 0, formatVersion: 1, migrationChainIdentity: 'c'.repeat(64),
        profileMatchStatus: 'same', totalBusinessByteSize: 1,
      } };
    });
    const activation = vi.spyOn(ProfileRestoreActivationService.prototype, 'activate').mockResolvedValue('relaunching');
    await expect(fixture.start()).rejects.toThrow('DESKTOP_START_FAILED');
    expect(activation).not.toHaveBeenCalled();
    expect(await fixture.updateJournal.readForLiveOwner()).toEqual(changed);
    expect(fixture.stopForUpdate).not.toHaveBeenCalled();
    expect(electronBoundary.createWindow).not.toHaveBeenCalled();
    await expect(fixture.journal.peek()).resolves.toBeUndefined();
    await expect(readFile(fixture.databasePath, 'utf8')).resolves.toBe(fixture.originalBytes);
  });

  it('reads the backup label from the current registered active workspace after startup and rename', async () => {
    const fixture = await createFixture(originalProfileId, { skipRestore: true, completeStartup: true });
    const compose = profileBackupComposition.createProfileBackupComposition;
    let readLabel: (() => Promise<string | undefined>) | undefined;
    vi.spyOn(profileBackupComposition, 'createProfileBackupComposition').mockImplementation(async options => {
      readLabel = options.readActiveWorkspaceLabel;
      return compose(options);
    });
    const lifecycle = await fixture.start();
    expect(lifecycle).toBeDefined();
    const registry = (await fixture.registry.read())!;
    try {
      const active = registry.workspaces.find(entry => entry.workspaceId === registry.activeWorkspaceId)!;
      await expect(readLabel!()).resolves.toBe(active.workspaceLabel);
      await fixture.registry.write({ ...registry, workspaces: registry.workspaces.map(entry =>
        entry.workspaceId === active.workspaceId ? { ...entry, workspaceLabel: 'Synthetic Renamed Company' } : entry) });
      await expect(readLabel!()).resolves.toBe('Synthetic Renamed Company');
      const handler = electronBoundary.handle.mock.calls.find(([channel]) =>
        channel === createProfileBackupIpcChannel)![1];
      await expect(handler({ sender: fixture.mainWindow.webContents,
        senderFrame: fixture.mainWindow.webContents.mainFrame })).resolves.toBe('cancelled');
      expect(fixture.showSaveDialog).toHaveBeenCalledWith(fixture.mainWindow, expect.objectContaining({
        defaultPath: expect.stringMatching(/^Eky-varmuuskopio-Synthetic Renamed Company-\d{4}-\d{2}-\d{2}\.ekybackup$/u),
      }));
      const nextPath = join(fixture.root, `${WORKSPACE_REGISTRY_FILE_NAME}.next`);
      const nextBytes = 'Synthetic interrupted registry write';
      await writeFile(nextPath, nextBytes, { mode: 0o600 });
      await expect(readLabel!()).resolves.toBe('Synthetic Renamed Company');
      await expect(readFile(nextPath, 'utf8')).resolves.toBe(nextBytes);
      await rm(nextPath);
      const otherId = validateWorkspaceId('22222222-2222-4222-8222-222222222222');
      await fixture.registry.write({ ...registry, activeWorkspaceId: otherId,
        workspaces: [{ ...active, workspaceId: otherId, workspaceLabel: 'Synthetic Other Company' }] });
      await expect(readLabel!()).rejects.toMatchObject({ code: 'WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED' });
      await fixture.registry.write({ formatVersion: 1, activeWorkspaceId: null, workspaces: [] });
      await expect(readLabel!()).rejects.toMatchObject({ code: 'WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED' });
    } finally {
      await fixture.registry.write(registry);
      await lifecycle!.shutdown();
    }
  });

  it('keeps ordinary restore authority alive after startup and closes it on runtime shutdown', async () => {
    const fixture = await createFixture(originalProfileId, { skipRestore: true, completeStartup: true });
    const compose = profileBackupComposition.createProfileBackupComposition;
    let assertAuthority: ((stopped: boolean) => Promise<void>) | undefined;
    vi.spyOn(profileBackupComposition, 'createProfileBackupComposition').mockImplementation(async options => {
      assertAuthority = options.assertRestoreRuntimeAuthority;
      return compose(options);
    });
    const lifecycle = await fixture.start();
    expect(lifecycle).toBeDefined();
    expect(assertAuthority).toEqual(expect.any(Function));
    await expect(assertAuthority!(false)).resolves.toBeUndefined();
    await lifecycle!.shutdown();
    await expect(assertAuthority!(false)).rejects.toThrow();
  });

  it('keeps the selected update authority inside journal-less restore activation', async () => {
    const fixture = await createFixture(originalProfileId, { update: true, skipRestore: true,
      startupMigrationChainIdentity: 'd'.repeat(64) });
    await prepareUpdateBusinessRollback(fixture);
    vi.spyOn(RecoveryPointRestoreStagingService.prototype, 'stage').mockResolvedValue({
      operationId, targetDisposition: 'replaceActiveProfile', summary: {
        appVersion: '0.2.7', compatibilityStatus: 'compatible', createdAt: '2026-08-18T10:00:00.000Z',
        databaseHealth: 'healthy', documentCount: 0, formatVersion: 1,
        profileMatchStatus: 'same', totalBusinessByteSize: 1,
      },
    });
    let changed: Awaited<ReturnType<UpdateJournalStore['read']>>;
    const activation = vi.spyOn(ProfileRestoreActivationService.prototype, 'activate').mockImplementation(async (id, assertAuthority) => {
      expect(id).toBe(operationId);
      expect(assertAuthority).toEqual(expect.any(Function));
      await assertAuthority!();
      const selected = (await fixture.updateJournal.readForLiveOwner())!;
      changed = { ...selected, candidatePackageIdentity: { ...selected.candidatePackageIdentity, packageSize: 4_096 } };
      await fixture.updateJournal.write(changed);
      await assertAuthority!();
      throw new Error('SYNTHETIC_UNREACHABLE');
    });
    await expect(fixture.start()).rejects.toThrow('DESKTOP_START_FAILED');
    expect(activation).toHaveBeenCalledOnce();
    expect(await fixture.updateJournal.readForLiveOwner()).toEqual(changed);
    expect(electronBoundary.createWindow).not.toHaveBeenCalled();
    expect(await fixture.journal.peek()).toBeUndefined();
    expect(await readFile(fixture.databasePath, 'utf8')).toBe(fixture.originalBytes);
  });

  it.each(['businessRollbackStarting', 'businessRollbackCompleted'] as const)(
    'retains journal-less selection changes during completion validation (%s)', async state => {
      const fixture = await createFixture(originalProfileId, { update: true, skipRestore: true, stoppedStartupRuntime: true });
      await prepareUpdateBusinessRollback(fixture, state);
      const validate = vi.mocked(snapshotInspection.runProfileSnapshotInspection).getMockImplementation()!;
      let changed: Awaited<ReturnType<UpdateJournalStore['read']>>;
      vi.mocked(snapshotInspection.runProfileSnapshotInspection).mockImplementation(async input => {
        const result = await validate(input);
        const selected = (await fixture.updateJournal.readForLiveOwner())!;
        changed = { ...selected, currentPackageIdentity: { ...selected.currentPackageIdentity, packageSize: 4_096 } };
        await fixture.updateJournal.write(changed);
        return result;
      });
      const binaryRollback = vi.spyOn(UpdateBinaryRollbackCoordinator.prototype, 'startIfRequired').mockResolvedValue('launched');
      await expect(fixture.start()).rejects.toThrow('DESKTOP_START_FAILED');
      expect(await fixture.updateJournal.readForLiveOwner()).toEqual(changed);
      expect(binaryRollback).not.toHaveBeenCalled();
      expect(electronBoundary.createWindow).not.toHaveBeenCalled();
      await expect(fixture.journal.peek()).resolves.toBeUndefined();
      await expect(readFile(fixture.databasePath, 'utf8')).resolves.toBe(fixture.originalBytes);
    },
  );

  it.for(['revision', 'package'] as const)('does not replace a C selection changed during completion validation (%s)', {
    timeout: restoreStartupCompositionTimeoutMs,
  }, async (change, context) => {
    const lifetime = beginTrackedStartupTest(context);
    await lifetime.run(async () => {
      const fixture = await lifetime.step('fixturePreparation', async () => {
        const prepared = await createFixture(originalProfileId, {
          update: true, stoppedStartupRuntime: true, ownedRoots: lifetime.roots,
        });
        await prepareUpdateBusinessRollback(prepared);
        return prepared;
      });
      const validate = vi.mocked(snapshotInspection.runProfileSnapshotInspection).getMockImplementation()!;
      let changed: Awaited<ReturnType<UpdateJournalStore['read']>>;
      vi.mocked(snapshotInspection.runProfileSnapshotInspection).mockImplementation(async input => {
        const result = await validate(input);
        // Completion follows terminal acceptance; do not count incidental snapshot calls.
        if (await fixture.journal.peek() === undefined) {
          const journal = (await fixture.updateJournal.read())!;
          changed = change === 'revision'
            ? { ...journal, revision: journal.revision + 1 }
            : { ...journal, currentPackageIdentity: { ...journal.currentPackageIdentity, packageSha256: 'f'.repeat(64) } };
          await fixture.updateJournal.write(changed);
        }
        return result;
      });
      const binaryRollback = vi.spyOn(UpdateBinaryRollbackCoordinator.prototype, 'startIfRequired')
        .mockResolvedValue('launched');
      await lifetime.step('startupRollback', async () => {
        await expect(fixture.start()).rejects.toThrow('DESKTOP_START_FAILED');
      });
      await lifetime.step('restoredContentCheck', async () => {
        expect(changed).toBeDefined();
        expect(await fixture.updateJournal.read()).toEqual(changed);
        expect(binaryRollback).not.toHaveBeenCalled();
        expect(electronBoundary.createWindow).not.toHaveBeenCalled();
        await expect(readFile(fixture.databasePath, 'utf8')).resolves.toBe(fixture.restoredBytes);
        await fixture.assertRegistryUnchanged();
      });
    });
  });

  describe('C pre-migration rollback preparation', () => {
    const phaseTimeoutMs = 5_000;
    let lifetime: ReturnType<typeof createRestoreStartupTestLifetime>;
    let fixture: Awaited<ReturnType<typeof createFixture>>;

    beforeEach(async context => {
      lifetime = beginTrackedStartupTest(context);
      fixture = await lifetime.prepare(async () => {
        const prepared = await createFixture(originalProfileId, {
          update: true, stoppedStartupRuntime: true, ownedRoots: lifetime.roots,
        });
        await prepareUpdateBusinessRollback(prepared);
        return prepared;
      });
    }, phaseTimeoutMs);

    it('uses fresh original authority after C pre-migration validation fails', async () => {
      await lifetime.run(async () => {
        const acquired: (() => void)[] = [];
        const acquire = InMemoryWorkspaceMaintenanceLease.prototype.acquire;
        vi.spyOn(InMemoryWorkspaceMaintenanceLease.prototype, 'acquire').mockImplementation(async function (
          this: InMemoryWorkspaceMaintenanceLease, purpose,
        ) {
          const handle = await acquire.call(this, purpose);
          if (fixture.events.includes('backendStarted') && purpose === 'restore') {
            acquired.push(this.captureCurrentOwner(['restore']));
          }
          return handle;
        });
        const inspectOriginal = vi.mocked(originalInspection.runProfileRestoreOriginalInspection).getMockImplementation()!;
        vi.mocked(originalInspection.runProfileRestoreOriginalInspection).mockImplementation(async input => {
          expect(acquired).toHaveLength(1); acquired[0]!();
          return inspectOriginal(input);
        });
        vi.mocked(snapshotInspection.runProfileSnapshotInspection).mockRejectedValueOnce(new ProfileInspectionProcessError(
          'PROFILE_SCHEMA_UNSUPPORTED', { processAbsent: true, reservationReclaimed: true, forced: false },
        ));
        const binaryRollback = vi.spyOn(UpdateBinaryRollbackCoordinator.prototype, 'startIfRequired');
        await lifetime.step('startupRollback', async () => { await expect(fixture.start()).resolves.toBeUndefined(); });
        await lifetime.step('restoredContentCheck', async () => {
          const original = vi.mocked(originalInspection.runProfileRestoreOriginalInspection);
          expect(fixture.stopForUpdate).toHaveBeenCalledOnce(); expect(original).toHaveBeenCalled();
          expect(fixture.stopForUpdate.mock.invocationCallOrder[0]).toBeLessThan(original.mock.invocationCallOrder[0]!);
          expect(vi.mocked(ProfileRestoreActivationTransaction.prototype.rollback).mock.calls[0]![2]?.assertContent).toBeTypeOf('function');
          expect(binaryRollback).not.toHaveBeenCalled(); expect(fixture.relaunch).toHaveBeenCalledOnce();
          expect(acquired).toHaveLength(1); expect(acquired[0]!).toThrow();
          await fixture.assertOriginalRestored();
          await expect(fixture.updateJournal.read()).resolves.toMatchObject({ state: 'businessRollbackStarting' });
        });
      });
    }, restoreStartupCompositionTimeoutMs);
  });

  it.each(['inspectorExit', 'backendStop'] as const)('retains C recovery evidence when %s is unverified', async stage => {
    const fixture = await createFixture(originalProfileId, { update: true, stoppedStartupRuntime: true });
    await prepareUpdateBusinessRollback(fixture);
    const selected = await fixture.journal.peek();
    const update = await fixture.updateJournal.readForLiveOwner();
    vi.mocked(snapshotInspection.runProfileSnapshotInspection).mockRejectedValueOnce(new ProfileInspectionProcessError(
      stage === 'inspectorExit' ? 'PROFILE_INSPECTION_CLEANUP_UNVERIFIED' : 'PROFILE_SCHEMA_UNSUPPORTED',
      { processAbsent: stage !== 'inspectorExit', reservationReclaimed: stage !== 'inspectorExit', forced: false },
    ));
    if (stage === 'backendStop') fixture.stopForUpdate.mockRejectedValueOnce(new Error('SYNTHETIC_STOP_UNVERIFIED'));
    const binaryRollback = vi.spyOn(UpdateBinaryRollbackCoordinator.prototype, 'startIfRequired');
    await expect(fixture.start()).rejects.toThrow('PROFILE_RESTORE_RECOVERY_REQUIRED');
    expect(ProfileRestoreActivationTransaction.prototype.rollback).not.toHaveBeenCalled();
    expect(binaryRollback).not.toHaveBeenCalled();
    expect(fixture.relaunch).not.toHaveBeenCalled();
    expect(electronBoundary.createWindow).not.toHaveBeenCalled();
    await expect(fixture.journal.peek()).resolves.toEqual(selected);
    await expect(fixture.updateJournal.readForLiveOwner()).resolves.toEqual(update);
    await expect(readFile(fixture.databasePath, 'utf8')).resolves.toBe(fixture.restoredBytes);
  });

  it('blocks C rollback when its selected update changes during original inspection', async () => {
    const fixture = await createFixture(originalProfileId, { update: true, stoppedStartupRuntime: true });
    await prepareUpdateBusinessRollback(fixture); const selected = await fixture.journal.peek();
    const selectedUpdate = (await fixture.updateJournal.readForLiveOwner())!;
    vi.mocked(snapshotInspection.runProfileSnapshotInspection).mockRejectedValueOnce(new ProfileInspectionProcessError(
      'PROFILE_SCHEMA_UNSUPPORTED', { processAbsent: true, reservationReclaimed: true, forced: false },
    ));
    const original = vi.mocked(originalInspection.runProfileRestoreOriginalInspection).getMockImplementation()!;
    vi.mocked(originalInspection.runProfileRestoreOriginalInspection).mockImplementation(async input => {
      const value = await original(input);
      const update = (await fixture.updateJournal.read())!;
      await fixture.updateJournal.write({ ...update, revision: update.revision + 1 });
      return value;
    });
    const binaryRollback = vi.spyOn(UpdateBinaryRollbackCoordinator.prototype, 'startIfRequired');
    await expect(fixture.start()).rejects.toThrow('PROFILE_RESTORE_RECOVERY_REQUIRED');
    expect(originalInspection.runProfileRestoreOriginalInspection).toHaveBeenCalledOnce();
    await expect(fixture.updateJournal.readForLiveOwner()).resolves.toEqual({
      ...selectedUpdate, revision: selectedUpdate.revision + 1,
    });
    expect(ProfileRestoreActivationTransaction.prototype.rollback).not.toHaveBeenCalled();
    expect(binaryRollback).not.toHaveBeenCalled(); expect(fixture.relaunch).not.toHaveBeenCalled();
    await expect(fixture.journal.peek()).resolves.toEqual(selected);
    await expect(readFile(fixture.databasePath, 'utf8')).resolves.toBe(fixture.restoredBytes);
  });

  it.each([false, true])('continues C rollback after restore acceptance (already accepted: %s)', async acceptedRestore => {
    const fixture = await createFixture(originalProfileId, { update: true, acceptedRestore,
      stoppedStartupRuntime: true });
    await prepareUpdateBusinessRollback(fixture);
    const binaryRollback = vi.spyOn(UpdateBinaryRollbackCoordinator.prototype, 'startIfRequired')
      .mockImplementation(async () => {
        expect(await fixture.updateJournal.read()).toMatchObject({ state: 'businessRollbackCompleted' });
        expect(await fixture.journal.peek()).toBeUndefined();
        expect(fixture.stopForUpdate).toHaveBeenCalledTimes(1);
        fixture.events.push('binaryRollback');
        return 'launched';
      });
    await expect(fixture.start()).resolves.toBeUndefined();
    expect(binaryRollback).toHaveBeenCalledTimes(1);
    expect('validateActiveProfile' in ProfileSnapshotBrokerClient.prototype).toBe(false);
    expect(snapshotInspection.runProfileSnapshotInspection).toHaveBeenCalledWith(expect.objectContaining({ migrationPolicy: 'restoreCompatible' }));
    expect(fixture.events).toEqual(acceptedRestore
      ? ['backendStarted', 'binaryRollback'] : ['backendStarted', 'accept', 'binaryRollback']);
    expect(electronBoundary.createWindow).not.toHaveBeenCalled();
    expect(fixture.relaunch).not.toHaveBeenCalled();
    await expect(readFile(fixture.databasePath, 'utf8')).resolves.toBe(fixture.restoredBytes);
    await fixture.assertRegistryUnchanged();
  });

  it('admits C original migration prefix without running migrations', async () => {
    let observedPolicy: StartDesktopBackendOptions['config']['migrationStartupPolicy'] | undefined;
    const fixture = await createFixture(originalProfileId, { update: true, stoppedStartupRuntime: true,
      pendingMigrationCount: 1,
      async inspectBackendStartup(input) { observedPolicy = input.config.migrationStartupPolicy; },
    });
    await prepareUpdateBusinessRollback(fixture);
    vi.spyOn(UpdateBinaryRollbackCoordinator.prototype, 'startIfRequired').mockResolvedValue('launched');
    await expect(fixture.start()).resolves.toBeUndefined();
    expect(observedPolicy).toBe('restoreCompatible');
    expect(fixture.stopForUpdate).toHaveBeenCalledTimes(1);
    expect(electronBoundary.createWindow).not.toHaveBeenCalled();
  });

  it.each([false, true])('retains C evidence when the restored chain is not the original (accepted: %s)', async acceptedRestore => {
    const fixture = await createFixture(originalProfileId, { update: true, acceptedRestore,
      stoppedStartupRuntime: true, startupMigrationChainIdentity: 'f'.repeat(64) });
    await prepareUpdateBusinessRollback(fixture);
    const selected = await fixture.journal.peek();
    const binaryRollback = vi.spyOn(UpdateBinaryRollbackCoordinator.prototype, 'startIfRequired');
    await expect(fixture.start()).rejects.toThrow('DESKTOP_START_FAILED');
    expect(await fixture.journal.peek()).toEqual(selected);
    expect(fixture.events).not.toContain('accept');
    expect(fixture.events).not.toContain('rollback');
    expect(binaryRollback).not.toHaveBeenCalled();
    expect(electronBoundary.createWindow).not.toHaveBeenCalled();
    await expect(readFile(fixture.databasePath, 'utf8')).resolves.toBe(fixture.restoredBytes);
  });

  it.each([false, true])('retains C evidence when its update journal changes during snapshot inspection (accepted: %s)', async acceptedRestore => {
    const fixture = await createFixture(originalProfileId, { update: true, acceptedRestore, stoppedStartupRuntime: true });
    await prepareUpdateBusinessRollback(fixture);
    const selected = await fixture.journal.peek();
    const inspect = vi.mocked(snapshotInspection.runProfileSnapshotInspection).getMockImplementation()!;
    vi.mocked(snapshotInspection.runProfileSnapshotInspection).mockImplementation(async input => {
      const value = await inspect(input);
      const update = (await fixture.updateJournal.read())!;
      await fixture.updateJournal.write({ ...update, revision: update.revision + 1 });
      return value;
    });
    const binaryRollback = vi.spyOn(UpdateBinaryRollbackCoordinator.prototype, 'startIfRequired');
    await expect(fixture.start()).rejects.toThrow('PROFILE_RESTORE_RECOVERY_REQUIRED');
    expect(await fixture.journal.peek()).toEqual(selected);
    expect(fixture.events).not.toContain('accept');
    expect(fixture.events).not.toContain('rollback');
    expect(binaryRollback).not.toHaveBeenCalled();
    expect(electronBoundary.createWindow).not.toHaveBeenCalled();
  });

  it.each([false, true])('defers accepted journal cleanup until backend validation (replacement: %s)', async replacementTarget => {
    const fixture = await createFixture(originalProfileId, { replacementTarget, acceptedRestore: true });
    const selected = await fixture.journal.peek();
    let validated = false;
    const validate = vi.mocked(snapshotInspection.runProfileSnapshotInspection).getMockImplementation()!;
    vi.mocked(snapshotInspection.runProfileSnapshotInspection).mockImplementation(async input => {
      expect(await fixture.journal.peek()).toEqual(selected);
      const result = await validate(input);
      validated = true;
      return result;
    });
    const clear = ProfileRestoreActivationTransaction.prototype.clearAccepted;
    vi.spyOn(ProfileRestoreActivationTransaction.prototype, 'clearAccepted').mockImplementation(async function (
      this: ProfileRestoreActivationTransaction, ...args
    ) {
      expect(validated).toBe(true);
      return clear.apply(this, args);
    });
    await expect(fixture.start()).rejects.toThrow(windowBoundary);
    expect(fixture.events).toEqual(['backendStarted']);
    expect(await fixture.journal.peek()).toBeUndefined();
    expect(await readFile(fixture.databasePath, 'utf8')).toBe(fixture.restoredBytes);
    await fixture.assertRegistryUnchanged();
  });

  it.for([false, true])('logs terminal preparation failure before a successful rollback relaunch (replacement: %s)', async (replacementTarget, context) => {
    const lifetime = beginTrackedStartupTest(context);
    await lifetime.run(async () => {
      const fixture = await lifetime.step('fixturePreparation', () => createFixture(originalProfileId, {
        replacementTarget, ownedRoots: lifetime.roots,
      }));
      const primary = new Error('synthetic private preparation detail', { cause: new Error('PROFILE_INSPECTION_TIMEOUT') });
      vi.spyOn(ProfileRestoreActivationTransaction.prototype, 'readTerminalCleanupCensus').mockRejectedValueOnce(primary);
      await lifetime.step('startupRollback', async () => { await expect(fixture.start()).resolves.toBeUndefined(); });
      await lifetime.step('restoredContentCheck', async () => {
        expect(fixture.relaunch).toHaveBeenCalledOnce();
        expect(electronBoundary.createWindow).not.toHaveBeenCalled();
        if (replacementTarget) {
          await expect(readFile(fixture.databasePath, 'utf8')).resolves.toBe(fixture.originalBytes);
          await expect(readFile(fixture.pdfPath, 'utf8')).resolves.toBe('%PDF-1.7 original pdf');
          await expect(fixture.journal.peek()).resolves.toMatchObject({ phase: 'rolledBack' });
          await expect(fixture.registry.read()).resolves.toMatchObject({
            activeWorkspaceId: '44444444-4444-4444-8444-444444444444',
          });
        } else {
          await fixture.assertOriginalRestored();
        }
        const logged = await readRestoreDiagnosticEvents(fixture.root);
        expect(logged.filter(event => event.eventName === 'restore.acceptanceFailed')).toEqual([
          expect.objectContaining({ stage: 'acceptancePreparation', errorCode: 'PROFILE_INSPECTION_TIMEOUT',
            correlationId: operationId, retryable: false, sideEffectState: 'unknown' }),
        ]);
        expect(logged.some(event => event.eventName === 'restore.validationCompleted')).toBe(true);
        expect(logged.some(event => event.eventName === 'restore.validationFailed' || event.eventName === 'desktop.bootstrapFailed')).toBe(false);
        expect(JSON.stringify(logged)).not.toContain('synthetic private preparation detail');
      });
    });
  });

  it.each([false, true])('retains accepted content and journal when terminal cleanup fails (replacement: %s)', async replacementTarget => {
    const fixture = await createFixture(originalProfileId, { replacementTarget });
    const primary = new Error('synthetic accepted cleanup failed', { cause: new Error('PROFILE_INSPECTION_CLEANUP_UNVERIFIED') });
    vi.spyOn(ProfileRestoreActivationTransaction.prototype, 'clearAccepted').mockRejectedValueOnce(primary);
    const observed = vi.fn();
    await expect(fixture.start(observed)).rejects.toThrow('DESKTOP_START_FAILED');
    expect(observed.mock.calls[0]![0]).toBe(primary);
    expect(fixture.events).toEqual(['backendStarted', 'accept', 'backendStopped']);
    expect(await fixture.journal.peek()).toMatchObject({ phase: 'accepted' });
    expect(await readFile(fixture.databasePath, 'utf8')).toBe(fixture.restoredBytes);
    expect(await readFile(fixture.pdfPath, 'utf8')).toBe('%PDF-1.7 restored pdf');
    expect(fixture.relaunch).not.toHaveBeenCalled();
    expect(electronBoundary.createWindow).not.toHaveBeenCalled();
    await fixture.assertRegistryUnchanged();
    const logged = await readRestoreDiagnosticEvents(fixture.root);
    expect(logged.filter(event => event.eventName === 'restore.acceptanceFailed')).toEqual([
      expect.objectContaining({ stage: 'acceptedCleanup', errorCode: 'PROFILE_INSPECTION_CLEANUP_UNVERIFIED', correlationId: operationId }),
    ]);
    expect(logged.some(event => event.eventName === 'restore.validationFailed')).toBe(false);
  });

  it.each([false, true])('retains accepted cold content on backend validation failure (replacement: %s)', async replacementTarget => {
    const fixture = await createFixture(originalProfileId, { replacementTarget, acceptedRestore: true });
    const selected = await fixture.journal.peek();
    const primary = new ProfileInspectionProcessError('PROFILE_SCHEMA_UNSUPPORTED', {
      processAbsent: true, reservationReclaimed: true, forced: false,
    });
    vi.mocked(snapshotInspection.runProfileSnapshotInspection).mockRejectedValueOnce(primary);
    const observed = vi.fn();
    await expect(fixture.start(observed)).rejects.toThrow('PROFILE_RESTORE_RECOVERY_REQUIRED');
    expect(observed.mock.calls[0]![0]).toMatchObject({ message: 'PROFILE_RESTORE_RECOVERY_REQUIRED', cause: primary });
    expect(fixture.events).not.toContain('rollback');
    expect(await fixture.journal.peek()).toEqual(selected);
    expect(await readFile(fixture.databasePath, 'utf8')).toBe(fixture.restoredBytes);
    expect(fixture.relaunch).not.toHaveBeenCalled();
    await fixture.assertRegistryUnchanged();
  });

  it.each([false, true])('blocks recovery mutation when accepted publication has no reliable readback (replacement: %s)', async replacementTarget => {
    const fixture = await createFixture(originalProfileId, { replacementTarget });
    const publish = ProfileRestoreActivationTransaction.prototype.commitAcceptance;
    const primary = new Error('PROFILE_RESTORE_JOURNAL_UNAVAILABLE', { cause: new Error('PROFILE_INSPECTION_PROTOCOL_INVALID') });
    vi.spyOn(ProfileRestoreActivationTransaction.prototype, 'commitAcceptance').mockImplementationOnce(async function (
      this: ProfileRestoreActivationTransaction, ...args
    ) {
      await publish.apply(this, args);
      throw primary;
    });
    const cleanup = vi.spyOn(ProfileRestoreActivationTransaction.prototype, 'clearAccepted');
    const observed = vi.fn();
    await expect(fixture.start(observed)).rejects.toThrow('WORKSPACE_SWITCH_RECOVERY_REQUIRED');
    expect(observed.mock.calls[0]![0]).toBe(primary);
    expect(observed.mock.calls).toContainEqual([
      expect.objectContaining({ message: 'WORKSPACE_SWITCH_RECOVERY_REQUIRED', cause: primary }),
      'compositionStartup', expect.any(Array),
    ]);
    expect(await fixture.journal.peek()).toMatchObject({ phase: 'accepted' });
    expect(fixture.events).not.toContain('rollback');
    expect(cleanup).not.toHaveBeenCalled();
    expect(await readFile(fixture.databasePath, 'utf8')).toBe(fixture.restoredBytes);
    expect(fixture.relaunch).not.toHaveBeenCalled();
    expect(electronBoundary.createWindow).not.toHaveBeenCalled();
    const logged = await readRestoreDiagnosticEvents(fixture.root);
    expect(logged.filter(event => event.eventName === 'restore.acceptanceFailed')).toEqual([
      expect.objectContaining({ stage: 'acceptanceCommit', errorCode: 'PROFILE_INSPECTION_PROTOCOL_INVALID', correlationId: operationId }),
    ]);
  });

  it.each([false, true].flatMap(replacementTarget => [false, true].map(rolledBack => ({ replacementTarget, rolledBack }))))(
    'stops an originally absent rollback database before any business runtime starts %#', async ({ replacementTarget, rolledBack }) => {
      const fixture = await createFixture(originalProfileId, { replacementTarget, coldRollback: true,
        originalDatabaseAbsent: true, ...(rolledBack ? { rolledBack: true } : {}) });
      const selected = await fixture.journal.peek();
      const databaseBefore = await readFile(fixture.databasePath).catch(error => {
        if (error.code === 'ENOENT') return undefined;
        throw error;
      });
      const rollback = vi.mocked(ProfileRestoreActivationTransaction.prototype.rollback);
      rollback.mockClear();
      await expect(fixture.start()).rejects.toThrow('PROFILE_RESTORE_RECOVERY_REQUIRED');
      expect(fixture.events).not.toContain('backendStarted');
      expect(rollback).not.toHaveBeenCalled();
      expect(await fixture.journal.peek()).toEqual(selected);
      expect(await readFile(fixture.databasePath).catch(error => {
        if (error.code === 'ENOENT') return undefined;
        throw error;
      })).toEqual(databaseBefore);
      expect(fixture.relaunch).not.toHaveBeenCalled();
      await fixture.assertRegistryUnchanged();
    },
  );

  it.each([false, true])('uses original cold admission across startup rollback (replacement: %s)', async replacementTarget => {
    const fixture = await createFixture(originalProfileId, { replacementTarget, coldRollback: true });
    const exceptions: unknown[] = [];
    try { await fixture.start(error => { exceptions.push(error); }); }
    catch (error) { if (!(error instanceof Error) || error.message !== windowBoundary) throw exceptions[0] ?? error; }
    expect(electronBoundary.createWindow).toHaveBeenCalledOnce();
    expect(vi.mocked(originalInspection.runProfileRestoreOriginalInspection)).toHaveBeenCalledTimes(3);
    expect(fixture.events).toEqual(['rollback', 'backendStarted']);
    expect(await readFile(fixture.databasePath, 'utf8')).toBe(fixture.originalBytes);
    expect(await readFile(fixture.pdfPath, 'utf8')).toBe('%PDF-1.7 original pdf');
    expect(await fixture.journal.peek()).toBeUndefined();
    await fixture.assertRegistryUnchanged();
  });

  it.each([false, true])('retains cold rollback journal and bytes under a competing staging claim (replacement: %s)', async replacementTarget => {
    const fixture = await createFixture(originalProfileId, { replacementTarget, coldRollback: true });
    const selected = await fixture.journal.peek(); const bytes = await readFile(fixture.databasePath);
    electronBoundary.reservationAcquired.mockImplementation(async ({ userDataRoot }) => {
      if (userDataRoot === join(fixture.stagingRoot, operationId)) throw new Error('WORKSPACE_PROCESS_RESERVATION_FAILED');
    });
    await expect(fixture.start()).rejects.toThrow('PROFILE_RESTORE_RECOVERY_REQUIRED');
    expect(vi.mocked(originalInspection.runProfileRestoreOriginalInspection)).not.toHaveBeenCalled();
    expect(fixture.events).toEqual([]);
    expect(await fixture.journal.peek()).toEqual(selected);
    expect(await readFile(fixture.databasePath)).toEqual(bytes);
  });

  it.each([false, true])('uses cold content admission across actual forward moves (replacement: %s)', async replacementTarget => {
    const fixture = await createFixture(originalProfileId, { replacementTarget, coldForward: true });
    let reachedWindow = false;
    const startupExceptions: unknown[] = [];
    try { await fixture.start(error => { startupExceptions.push(error); }); }
    catch (error) {
      if (!(error instanceof Error) || error.message !== windowBoundary) {
        throw startupExceptions[0] ?? error;
      }
      reachedWindow = true;
    }
    expect(reachedWindow).toBe(true);
    expect(vi.mocked(coldInspection.runProfileRestoreColdInspection)).toHaveBeenCalledTimes(3);
    expect(fixture.events).toEqual(['backendStarted', 'accept']);
    expect(await readFile(fixture.databasePath, 'utf8')).toBe(fixture.restoredBytes);
    expect(await fixture.journal.peek()).toBeUndefined();
    await fixture.assertRegistryUnchanged();
  });

  it.each([false, true])('rejects foreign cold content before moving either generation (replacement: %s)', async replacementTarget => {
    const fixture = await createFixture(foreignProfileId, { replacementTarget, coldForward: true });
    const initial = await fixture.journal.peek();
    await expect(fixture.start()).rejects.toThrow('PROFILE_RESTORE_RECOVERY_REQUIRED');
    expect(fixture.events).toEqual([]);
    expect(await fixture.journal.peek()).toEqual(initial);
    expect(await readFile(fixture.databasePath, 'utf8')).toBe(fixture.originalBytes);
    expect(await readFile(join(fixture.stagingRoot, operationId, 'profile.sqlite'), 'utf8')).toBe(fixture.restoredBytes);
    await fixture.assertRegistryUnchanged();
  });

  it.each([false, true])('retains cold restore slots when the exact operation reservation is busy (replacement: %s)', async replacementTarget => {
    const fixture = await createFixture(originalProfileId, { replacementTarget });
    const operationRoot = join(fixture.stagingRoot, operationId);
    const original = await readFile(fixture.journalPath);
    await writeFile(`${fixture.journalPath}.backup`, original, { mode: 0o600 });
    await writeFile(`${fixture.journalPath}.next`, 'retain unknown next', { mode: 0o600 });
    electronBoundary.reservationAcquired.mockImplementation(async ({ userDataRoot }) => {
      if (userDataRoot === operationRoot) throw new Error('WORKSPACE_PROCESS_RESERVATION_FAILED');
    });
    const read = vi.spyOn(ProfileRestoreActivationJournalStore.prototype, 'read');

    await expect(fixture.start()).rejects.toThrow('PROFILE_RESTORE_RECOVERY_REQUIRED');

    expect(electronBoundary.reservationAcquired).toHaveBeenCalledWith(expect.objectContaining({ userDataRoot: operationRoot }));
    expect(read).not.toHaveBeenCalled();
    for (const suffix of ['', '.backup']) {
      await expect(readFile(`${fixture.journalPath}${suffix}`)).resolves.toEqual(original);
    }
    await expect(readFile(`${fixture.journalPath}.next`, 'utf8')).resolves.toBe('retain unknown next');
    expect(fixture.events).toEqual([]);
    expect(fixture.relaunch).not.toHaveBeenCalled();
    expect(electronBoundary.createWindow).not.toHaveBeenCalled();
    await fixture.assertRegistryUnchanged();
  });

  it.each([
    { replacementTarget: false, slot: 'current' },
    { replacementTarget: false, slot: 'backup' },
    { replacementTarget: false, slot: 'next' },
    { replacementTarget: true, slot: 'current' },
    { replacementTarget: true, slot: 'backup' },
    { replacementTarget: true, slot: 'next' },
  ] as const)('selects $slot restore journal without repair before admission (replacement: $replacementTarget)', async ({ replacementTarget, slot }) => {
    const fixture = await createFixture(originalProfileId, { replacementTarget });
    const original = await readFile(fixture.journalPath);
    const retained = new Map<string, Buffer>();
    if (slot === 'current') retained.set(fixture.journalPath, original);
    else await rm(fixture.journalPath);
    if (slot !== 'next') retained.set(`${fixture.journalPath}.backup`, original);
    retained.set(`${fixture.journalPath}.next`, slot === 'next'
      ? original : Buffer.from('unknown pending journal'));
    for (const [path, bytes] of retained) {
      await writeFile(path, bytes, { mode: 0o600 });
    }
    const directoryEntries = await readdir(dirname(fixture.journalPath));
    const read = vi.spyOn(ProfileRestoreActivationJournalStore.prototype, 'read');
    const peekOriginal = ProfileRestoreActivationJournalStore.prototype.peek;
    const peek = vi.spyOn(ProfileRestoreActivationJournalStore.prototype, 'peek')
      .mockImplementation(async function (this: ProfileRestoreActivationJournalStore) {
        const selected = await peekOriginal.call(this);
        if (selected !== undefined) throw new Error('SYNTHETIC_STOP_AFTER_READ_ONLY_SELECTION');
        return selected;
      });

    const startupExceptions: unknown[] = [];
    await expect(fixture.start(error => { startupExceptions.push(error); }))
      .rejects.toThrow('DESKTOP_START_FAILED');

    expect(startupExceptions).toEqual([
      expect.objectContaining({ message: 'SYNTHETIC_STOP_AFTER_READ_ONLY_SELECTION' }),
    ]);
    expect(peek).toHaveBeenCalledTimes(2);
    expect(read).not.toHaveBeenCalled();
    for (const [path, bytes] of retained) {
      await expect(readFile(path)).resolves.toEqual(bytes);
    }
    await expect(readdir(dirname(fixture.journalPath))).resolves.toEqual(directoryEntries);
    expect(fixture.events).toEqual([]);
    expect(fixture.relaunch).not.toHaveBeenCalled();
    expect(electronBoundary.createWindow).not.toHaveBeenCalled();
    await fixture.assertRegistryUnchanged();
  });

  it('reaches the window boundary using the current inspection deployment contract', async () => {
    const fixture = await createFixture(originalProfileId, { skipRestore: true });
    const startupExceptions: unknown[] = [];
    const outcome = await fixture.start(error => { startupExceptions.push(error); })
      .catch((error: unknown) => error);
    expect(startupExceptions.map(error => error instanceof Error ? error.message : 'unknown'))
      .toEqual([windowBoundary]);
    expect(outcome).toBeInstanceOf(Error);
    expect((outcome as Error).message).toBe(windowBoundary);
  });

  it.each(['WORKSPACE_PROCESS_RESERVATION_FAILED', 'BACKEND_PROCESS_RESERVATION_FAILED'])(
    'preserves %s through real composition logging without starting recovery', async code => {
      const fixture = await createFixture(originalProfileId, {
        async inspectBackendStartup() {
          throw new DesktopBackendStartupError('BACKEND_PROCESS_RESERVATION_FAILED', {
            processState: 'unknown', migrationGateSettled: true, reservationReclaimed: false,
          });
        },
      });
      if (code === 'WORKSPACE_PROCESS_RESERVATION_FAILED') {
        fixture.assertSingleInstanceOwnership.mockImplementation(() => { throw new Error(code); });
      }
      await expect(fixture.start()).rejects.toThrow(code);
      expect(fixture.relaunch).not.toHaveBeenCalled();
      expect(electronBoundary.createWindow).not.toHaveBeenCalled();
      await fixture.assertPendingRestoreRetained();
      expect(electronBoundary.reservationReleased.mock.calls.filter(([root]) => root === fixture.root))
        .toHaveLength(0);
      const directory = join(fixture.root, 'runtime', 'logs', 'desktop');
      const events = [];
      for (const file of await readdir(directory)) {
        for (const line of (await readFile(join(directory, file), 'utf8')).trim().split('\n')) {
          events.push(JSON.parse(line));
        }
      }
      expect(events).toContainEqual(expect.objectContaining({
        eventName: 'desktop.bootstrapFailed', errorCode: code, sideEffectState: 'unknown',
        stage: 'startup', retryable: false,
      }));
      expect(JSON.stringify(events)).not.toContain(fixture.root);
      expect(JSON.stringify(events)).not.toContain('d'.repeat(64));
      const incidentRoot = join(fixture.root, 'runtime', 'logs', 'incident-index');
      const incidents = [];
      for (const file of await readdir(incidentRoot)) {
        for (const line of (await readFile(join(incidentRoot, file), 'utf8')).trim().split('\n')) {
          incidents.push(JSON.parse(line));
        }
      }
      expect(incidents).toContainEqual(expect.objectContaining({
        eventName: 'desktop.bootstrapFailed', errorCode: code,
        fingerprint: `desktop.bootstrapFailed:${code}`,
      }));
      expect(JSON.stringify(incidents)).not.toContain(fixture.root);
      expect(JSON.stringify(incidents)).not.toMatch(/runtimeInstanceId|correlationId|operationId/u);
    },
  );

  it.each(['observedExit', 'uncertainFork'] as const)(
    'consumes real startup ownership and preserves the safe log (%s)', async (mode) => {
      const process = new EventEmitter();
      const kill = vi.fn(() => { process.emit('exit', 1); return true; });
      const postMessage = vi.fn(message => {
        if (message.type === 'prepare') {
          process.emit('message', { type: 'reservationReady', reservation: message.reservation });
        }
        if (message.type === 'start') {
          process.emit('message', { type: 'failed', code: 'BACKEND_MODULE_IMPORT_FAILED' });
        }
      });
      electronBoundary.fork.mockImplementation(() => {
        if (mode === 'uncertainFork') throw new Error('synthetic-private-fork-detail');
        queueMicrotask(() => process.emit('spawn'));
        return Object.assign(process, { kill, postMessage });
      });
      const fixture = await createFixture(originalProfileId, {
        replacementTarget: true, realBackend: true,
      });
      if (mode === 'observedExit') {
        await expect(fixture.start()).resolves.toBeUndefined();
        expect(kill).toHaveBeenCalledOnce();
        expect(fixture.relaunch).toHaveBeenCalledOnce();
        const logDirectory = join(fixture.root, 'runtime', 'logs', 'desktop');
        const records: { eventName: string; errorCode?: string }[] = [];
        for (const file of await readdir(logDirectory)) {
          const lines = (await readFile(join(logDirectory, file), 'utf8')).trim().split('\n');
          for (const line of lines) records.push(JSON.parse(line));
        }
        expect(records).toContainEqual(expect.objectContaining({
          eventName: 'backendProcess.healthFailed', errorCode: 'BACKEND_MODULE_IMPORT_FAILED',
        }));
        expect(records.some(record => record.eventName === 'backendProcess.started')).toBe(false);
      } else {
        await expect(fixture.start()).rejects.toThrow('DESKTOP_START_FAILED');
        expect(kill).not.toHaveBeenCalled();
        expect(fixture.relaunch).not.toHaveBeenCalled();
        await fixture.assertPendingRestoreRetained();
      }
      expect(electronBoundary.createWindow).not.toHaveBeenCalled();
    },
  );

  it.each(['unknownExit', 'pendingGate', 'reservationNotReclaimed', 'unclassified'] as const)(
    'retains pending restore, switch and profile files when startup ownership is %s', async (failureKind) => {
      const fixture = await createFixture(originalProfileId, {
        replacementTarget: true,
        async inspectBackendStartup() {
          if (failureKind === 'unclassified') throw new Error('BACKEND_READINESS_TIMEOUT');
          throw new DesktopBackendStartupError('BACKEND_READINESS_TIMEOUT', {
            processState: failureKind === 'unknownExit' ? 'unknown' : 'absent',
            migrationGateSettled: failureKind !== 'pendingGate',
            reservationReclaimed: failureKind !== 'reservationNotReclaimed',
          });
        },
      });

      await expect(fixture.start()).rejects.toThrow('BACKEND_READINESS_TIMEOUT');
      expect(fixture.stop).not.toHaveBeenCalled();
      expect(fixture.events).toEqual(['backendStarted']);
      expect(fixture.relaunch).not.toHaveBeenCalled();
      expect(electronBoundary.createWindow).not.toHaveBeenCalled();
      await fixture.assertPendingRestoreRetained();
    },
  );

  it.each([false, true])('retains reclaimed ownership when the real startup callback outlives its deadline (broker failure: %s)', async brokerFailure => {
    const callbackStoppedBackend = createCompletionGate();
    const releaseCallback = createCompletionGate();
    const callbackSettled = createCompletionGate();
    if (brokerFailure) vi.spyOn(ProfileSnapshotBrokerClient.prototype, 'close')
      .mockImplementationOnce(() => { throw new Error('synthetic cleanup failure'); });
    const originalSetTimeout = globalThis.setTimeout;
    let expireMigration: (() => void) | undefined;
    vi.spyOn(globalThis, 'setTimeout').mockImplementation((callback, timeout, ...args) => {
      if (timeout === 5 * 60_000) expireMigration = () => callback(...args);
      return originalSetTimeout(callback, timeout, ...args);
    });
    const child = new EventEmitter();
    const postMessage = vi.fn(message => {
      if (message.type === 'prepare') child.emit('message', { type: 'reservationReady', reservation: message.reservation });
      if (message.type === 'start') child.emit('message', {
        type: 'migrationGateReady', inspection: {
          appliedMigrationCount: 1, migrationChainIdentity: 'c'.repeat(64),
          pendingMigrationCount: 0, profileState: 'existing',
        },
      });
      if (message.type === 'shutdown') child.emit('exit', 0);
    });
    electronBoundary.fork.mockImplementation(() => {
      queueMicrotask(() => child.emit('spawn'));
      return Object.assign(child, { postMessage, kill: vi.fn() });
    });
    const fixture = await createFixture(originalProfileId, {
      replacementTarget: true, realBackend: true,
      async beforeMigrations(_inspection, control) {
        await control.stopStartupRuntime();
        callbackStoppedBackend.resolve();
        await releaseCallback.promise;
        callbackSettled.resolve();
      },
    });
    const observed = fixture.start().then(() => undefined, (error: unknown) => error);
    try {
      await callbackStoppedBackend.promise;
      expect(electronBoundary.reservationReleased.mock.calls.filter(([root]) => root === fixture.root))
        .toHaveLength(1);
      expect(expireMigration).toBeDefined();
      expireMigration!();
      expect(await observed).toMatchObject({ message: 'BACKEND_READINESS_TIMEOUT' });
      expect(electronBoundary.reservationReleased.mock.calls.filter(([root]) => root === fixture.root))
        .toHaveLength(1);
      expect(fixture.relaunch).not.toHaveBeenCalled();
      expect(electronBoundary.createWindow).not.toHaveBeenCalled();
      expect(electronBoundary.portClosed.mock.calls.length).toBeGreaterThanOrEqual(2);
      await fixture.assertPendingRestoreRetained();
      releaseCallback.resolve();
      await callbackSettled.promise;
      expect(electronBoundary.reservationReleased.mock.calls.filter(([root]) => root === fixture.root))
        .toHaveLength(1);
      expect(fixture.relaunch).not.toHaveBeenCalled();
      await fixture.assertPendingRestoreRetained();
    } finally {
      releaseCallback.resolve();
    }
  });

  it.each(['beforeStart', 'provenExit'] as const)(
    'permits existing source-workspace recovery only with %s ownership proof', async (proof) => {
      const fixture = await createFixture(originalProfileId, {
        replacementTarget: true,
        async inspectBackendStartup() {
          throw new DesktopBackendStartupError('BACKEND_READINESS_TIMEOUT', {
            processState: 'absent', migrationGateSettled: true, reservationReclaimed: true,
          });
        },
      });

      await expect(fixture.start(undefined, async stage => {
        if (proof === 'beforeStart' && (stage === 'backend' || stage === 'restoredBackend')) {
          throw new Error('BACKEND_READINESS_TIMEOUT');
        }
      })).resolves.toBeUndefined();
      expect(fixture.events).toEqual(proof === 'beforeStart' ? [] : ['backendStarted']);
      expect(fixture.stop).not.toHaveBeenCalled();
      expect(fixture.relaunch).toHaveBeenCalledOnce();
      expect(electronBoundary.createWindow).not.toHaveBeenCalled();
      await expect(fixture.registry.read()).resolves.toMatchObject({
        activeWorkspaceId: '44444444-4444-4444-8444-444444444444',
      });
    },
  );

  it.each(['creation', 'import'] as const)(
    'rejects an invalid active database after cold %s reconciliation removed its journal', async (kind) => {
      const fixture = await createFixture(originalProfileId, { skipRestore: true, completeStartup: true });
      const { journal } = await prepareColdJournal(fixture.root, kind);
      // The isolated inspection test boundary reads this synthetic database as JSON.
      await writeFile(fixture.databasePath, 'invalid synthetic database');
      await expect(fixture.start()).rejects.toThrow();
      expect(snapshotInspection.runProfileSnapshotInspection).toHaveBeenCalledOnce();
      expect('validateActiveProfile' in ProfileSnapshotBrokerClient.prototype).toBe(false);
      expect(electronBoundary.createWindow).not.toHaveBeenCalled();
      expect(fixture.relaunch).not.toHaveBeenCalled();
      await expect(journal.read()).resolves.toBeUndefined();
      await fixture.assertRegistryUnchanged();
    },
  );

  describe.each(['creation', 'import'] as const)('cold %s production wiring', (kind) => {
    it.each([
      { terminal: 'completed', state: 'rootPublished', duplicateLabel: false },
      { terminal: 'failed', state: 'rootPublished', duplicateLabel: false },
      { terminal: 'completed', state: 'rootPublished', duplicateLabel: true },
      { terminal: 'failed', state: 'rootPublished', duplicateLabel: true },
      { terminal: 'completed', state: 'candidateValidated', duplicateLabel: true },
      { terminal: 'failed', state: 'candidateValidated', duplicateLabel: true },
    ] as const)(
      'waits for candidate exit after $terminal from $state (historical duplicate: $duplicateLabel)', async ({ terminal, state, duplicateLabel }) => {
        const fixture = await createFixture(originalProfileId, { skipRestore: true, completeStartup: true });
        const pending = await prepareColdJournal(fixture.root, kind, {
          state, ...(duplicateLabel ? { workspaceLabel: 'SYNTHETIC  RESTORE TEST' } : {}),
        });
        const previousRegistry = await fixture.registry.read();
        expect(hasWorkspaceLabelConflict(previousRegistry!.workspaces, pending.value.workspaceLabel)).toBe(duplicateLabel);
        if (duplicateLabel) expect(pending.value.workspaceLabel).toBe('SYNTHETIC  RESTORE TEST');
        const journalBytes = await readFile(pending.paths.currentPath);
        const databaseBytes = await readFile(fixture.databasePath);
        const pdfBytes = await readFile(fixture.pdfPath);
        const child = new EventEmitter();
        let signalShutdownRequested!: () => void;
        const shutdownRequested = new Promise<void>(resolve => { signalShutdownRequested = resolve; });
        const operations: string[] = [];
        let exited = false;
        const exit = () => {
          if (!exited) { exited = true; child.emit('exit', 0); }
        };
        const kill = vi.fn(exit);
        electronBoundary.fork.mockImplementation(() => {
          queueMicrotask(() => child.emit('message', createWorkspaceCandidateReadyStatus()));
          return Object.assign(child, {
            kill,
            postMessage(raw: unknown) {
              const command = parseWorkspaceCandidateProcessCommand(raw);
              if (command === undefined) throw new Error('TEST_CANDIDATE_COMMAND_INVALID');
              if (command.type === 'prepare') {
                queueMicrotask(() => child.emit('message', createWorkspaceCandidateReservationReadyStatus(command)));
              } else if (command.type === 'start') {
                operations.push(command.operation.operation);
                const status = terminal === 'failed'
                  ? createWorkspaceCandidateFailedStatus(command)
                  : createWorkspaceCandidateCompletedStatus({
                    ...command,
                    result: {
                      actorId: 'local-owner', artifactRootHealth: 'ready',
                      companyId: 'local-company-1234567890abcdef1234567890abcdef',
                      databaseHealth: 'healthy', foreignKeyHealth: 'healthy', kind: 'readiness',
                      migrationChainIdentity: 'c'.repeat(64), profileId: foreignProfileId,
                    },
                  });
                queueMicrotask(() => child.emit('message', status));
              } else {
                signalShutdownRequested();
              }
            },
          });
        });
        const started = fixture.start().then(
          lifecycle => ({ status: 'completed' as const, lifecycle }),
          error => ({ status: 'failed' as const, error }),
        );
        try {
          await Promise.race([
            shutdownRequested,
            started.then(() => { throw new Error('TEST_RECOVERY_RETURNED_BEFORE_EXIT'); }),
          ]);
          expect(operations).toEqual(['validatePublished']);
          await expect(pending.journal.read()).resolves.toMatchObject({ state });
          await expect(readFile(pending.paths.currentPath)).resolves.toEqual(journalBytes);
          await expect(readFile(pending.publishedFile, 'utf8')).resolves.toBe('synthetic published');
          await fixture.assertRegistryUnchanged();
          expect(fixture.events).toEqual([]);
          expect(electronBoundary.createWindow).not.toHaveBeenCalled();
          expect(kill).not.toHaveBeenCalled();
          exit();
          const result = await started;
          expect(result.status).toBe(terminal);
          if (result.status === 'completed') {
            expect(result.lifecycle).toBeDefined();
            await expect(pending.journal.read()).resolves.toBeUndefined();
            const registry = await fixture.registry.read();
            expect(registry?.activeWorkspaceId).toBe(workspaceId);
            expect(registry?.workspaces).toHaveLength(2);
            expect(registry?.workspaces[0]).toEqual(previousRegistry?.workspaces[0]);
            expect(registry?.workspaces[1]).toMatchObject({
              workspaceId: pending.value.workspaceId,
              workspaceLabel: pending.value.workspaceLabel,
              lineageIdentity: pending.value.lineageIdentity,
              createdAt: pending.value.createdAt,
              lifecycleState: 'ready', layoutVersion: 1,
            });
            expect(electronBoundary.createWindow).toHaveBeenCalledOnce();
          } else {
            await expect(pending.journal.read()).resolves.toMatchObject({ state });
            await expect(readFile(pending.paths.currentPath)).resolves.toEqual(journalBytes);
            await fixture.assertRegistryUnchanged();
            expect(fixture.events).toEqual([]);
            expect(electronBoundary.createWindow).not.toHaveBeenCalled();
          }
          await expect(readFile(pending.publishedFile, 'utf8')).resolves.toBe('synthetic published');
          await expect(readFile(fixture.databasePath)).resolves.toEqual(databaseBytes);
          await expect(readFile(fixture.pdfPath)).resolves.toEqual(pdfBytes);
        } finally {
          exit();
          const result = await started;
          if (result.status === 'completed') await result.lifecycle?.shutdown();
        }
      },
    );

    it.each(['currentPath', 'backupPath', 'nextPath'] as const)(
      'rejects a legacy %s before repair, cleanup or backend startup', async slot => {
        const fixture = await createFixture(originalProfileId, { skipRestore: true });
        const pending = await prepareColdJournal(fixture.root, kind, { formatVersion: 1, slot });
        const before = await readFile(pending.paths[slot]);
        const payload = await preparePlaintext(fixture.root);
        await expect(fixture.start()).rejects.toThrow('WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED');
        await expect(readFile(pending.paths[slot])).resolves.toEqual(before);
        await expect(readFile(pending.candidateFile, 'utf8')).resolves.toBe('synthetic candidate');
        await expect(readFile(payload, 'utf8')).resolves.toBe('synthetic plaintext');
        if (slot !== 'currentPath') await expect(readFile(pending.paths.currentPath)).rejects.toMatchObject({ code: 'ENOENT' });
        expect(fixture.events).toEqual([]);
        expect(electronBoundary.fork).not.toHaveBeenCalled();
        expect(electronBoundary.createWindow).not.toHaveBeenCalled();
        await fixture.assertRegistryUnchanged();
      },
    );

    it.each(['currentPath', 'backupPath', 'nextPath'] as const)(
      'recovers guarded %s before normal startup and remains idempotent', async slot => {
        const fixture = await createFixture(originalProfileId, {
          skipRestore: true, completeStartup: true,
          async inspectBackendStartup() {
            await expect(pending.journal.read()).resolves.toBeUndefined();
            await expect(readFile(pending.candidateFile)).rejects.toMatchObject({ code: 'ENOENT' });
          },
        });
        const pending = await prepareColdJournal(fixture.root, kind, { slot });
        const payload = kind === 'import' ? await preparePlaintext(fixture.root) : undefined;
        const lifecycle = await fixture.start();
        expect(lifecycle).toBeDefined();
        expect(electronBoundary.createWindow).toHaveBeenCalledOnce();
        expect(snapshotInspection.runProfileSnapshotInspection).toHaveBeenCalledOnce();
        expect('validateActiveProfile' in ProfileSnapshotBrokerClient.prototype).toBe(false);
        expect(electronBoundary.fork).not.toHaveBeenCalled();
        if (payload !== undefined) await expect(readFile(payload)).rejects.toMatchObject({ code: 'ENOENT' });
        await fixture.assertRegistryUnchanged();
        await lifecycle!.shutdown();
        const restarted = await fixture.start();
        expect(restarted).toBeDefined();
        await restarted!.shutdown();
        await fixture.assertRegistryUnchanged();
      },
    );

    it('preserves the journal and candidate when the continuation is missing', async () => {
      const fixture = await createFixture(originalProfileId, { skipRestore: true, completeStartup: true });
      const pending = await prepareColdJournal(fixture.root, kind);
      await rm(deriveWorkspaceRoot(fixture.root, workspaceId, 1).workspaceRoot, { recursive: true });
      await expect(fixture.start()).rejects.toThrow(kind === 'creation'
        ? 'WORKSPACE_CREATION_RECOVERY_REQUIRED' : 'WORKSPACE_IMPORT_RECOVERY_REQUIRED');
      await expect(pending.journal.read()).resolves.toMatchObject({ formatVersion: 2, state: 'prepared' });
      await expect(readFile(pending.candidateFile, 'utf8')).resolves.toBe('synthetic candidate');
      expect(fixture.events).toEqual([]);
      expect(electronBoundary.createWindow).not.toHaveBeenCalled();
      await fixture.assertRegistryUnchanged();
    });

    it('blocks conflicting restore ownership before repairing the pending journal', async () => {
      const fixture = await createFixture(originalProfileId);
      const pending = await prepareColdJournal(fixture.root, kind, { slot: 'backupPath' });
      const before = await readFile(pending.paths.backupPath);
      await expect(fixture.start()).rejects.toThrow('WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED');
      await expect(readFile(pending.paths.backupPath)).resolves.toEqual(before);
      await expect(readFile(pending.paths.currentPath)).rejects.toMatchObject({ code: 'ENOENT' });
      expect(fixture.events).toEqual([]);
      await fixture.assertPendingRestoreRetained();
    });
  });

  it('preserves journal-free plaintext without inferring old writer absence', async () => {
    const fixture = await createFixture(originalProfileId, { skipRestore: true });
    const payload = await preparePlaintext(fixture.root);
    await expect(fixture.start()).rejects.toThrow('WORKSPACE_IMPORT_RECOVERY_REQUIRED');
    await expect(readFile(payload, 'utf8')).resolves.toBe('synthetic plaintext');
    expect(fixture.events).toEqual([]);
    await fixture.assertRegistryUnchanged();
  });

  it.each([false, true])('wires private gate observation with the session secret only when enabled (enabled: %s)', async enabled => {
    const original = new Error('synthetic private migration rejection');
    let installedObserver: StartDesktopBackendOptions['observeStartupException'];
    const fixture = await createFixture(originalProfileId, {
      async inspectBackendStartup(input) {
        installedObserver = input.observeStartupException;
        input.observeStartupException?.(original);
        throw new Error('BACKEND_MIGRATION_STARTUP_GATE_FAILED');
      },
    });
    const observe = vi.fn();
    await expect(fixture.start(enabled ? observe : undefined)).rejects.toThrow('DESKTOP_START_FAILED');
    if (enabled) {
      expect(installedObserver).toBeTypeOf('function');
      expect(observe.mock.calls[0]).toEqual([original, 'runtimeStartup', ['d'.repeat(64)]]);
    } else {
      expect(installedObserver).toBeUndefined();
      expect(observe).not.toHaveBeenCalled();
    }
    expect(RecoveryPointScheduler.prototype.stopChecks).toHaveBeenCalled();
  });

  it.each([false, true])('retains the original packaged exception before its safe code (observer throws: %s)', async throws => {
    const fixture = await createFixture(originalProfileId, { skipRestore: true, completeStartup: true, smoke: true });
    const original = new Error('synthetic packaged original', { cause: new Error('synthetic packaged cause') });
    electronBoundary.loadWindow.mockRejectedValueOnce(original);
    const observe = vi.fn(() => { if (throws) throw new Error('synthetic evidence failure'); });
    await expect(fixture.start(observe)).rejects.toThrow('PACKAGED_SMOKE_FAILED');
    expect(observe.mock.calls).toContainEqual([original, 'packagedSmoke', ['d'.repeat(64)]]);
  });

  it('observes the first runtime startup exception before recovery cleanup', async () => {
    const fixture = await createFixture(originalProfileId);
    const original = new Error('synthetic-original-before-backend', { cause: new Error('synthetic cause') });
    const observations: { error: unknown; stage: string; cleanupCalls: number }[] = [];
    await expect(fixture.start((error, stage) => {
      observations.push({ error, stage, cleanupCalls: vi.mocked(RecoveryPointScheduler.prototype.stopChecks).mock.calls.length });
    }, async stage => { if (stage === 'backend') throw original; })).rejects.toThrow('DESKTOP_START_FAILED');
    expect(observations[0]?.error).toBe(original);
    expect(observations[0]?.stage).toBe('runtimeStartup');
    expect(observations[0]?.cleanupCalls).toBe(0);
    expect(RecoveryPointScheduler.prototype.stopChecks).toHaveBeenCalled();
  });
  it('observes the original window exception and session secret before safe-code replacement', async () => {
    const fixture = await createFixture(originalProfileId);
    const original = new Error('synthetic-original-window-failure', { cause: new Error('synthetic-root-cause') });
    electronBoundary.createWindow.mockImplementationOnce(() => { throw original; });
    const observed: { error: unknown; stage: string; secrets: readonly string[] | undefined; stopCount: number }[] = [];
    await expect(fixture.start((error, stage, secrets) => {
      observed.push({ error, stage, secrets, stopCount: fixture.stop.mock.calls.length });
    })).rejects.toThrow('DESKTOP_START_FAILED');
    expect(observed[0]?.error).toBe(original);
    expect(observed[0]?.stage).toBe('compositionStartup');
    expect(observed[0]?.secrets).toEqual(['d'.repeat(64)]);
    expect(observed[0]?.stopCount).toBe(0);
    expect(fixture.stop).not.toHaveBeenCalled();
  });
  it.each(['success', 'spawnFailure', 'dialogFailure'] as const)(
    'holds the closed-window handoff through installer settlement (%s)', async outcome => {
      const fixture = await createFixture(originalProfileId, {
        completeStartup: true, skipRestore: true, update: true,
      });
      const readHandoff = prepareUpdateBoundary(fixture.root);
      const lifecycle = (await fixture.start())!;
      const handoff = readHandoff();
      await handoff.prepareConfirmedUpdate();
      const entered = createCompletionGate();
      const release = createCompletionGate();
      vi.mocked(launchWindowsInstallerForUpdate).mockImplementationOnce(async () => {
        entered.resolve();
        await release.promise;
        if (outcome !== 'success') throw new Error('synthetic-private-installer-failure');
      });
      const safeError = vi.mocked(updateFoundation.createLocalUpdateFoundationComposition).mock.calls[0]![0].showSafeError;
      const read = UpdateJournalStore.prototype.write;
      let lastJournalState = '';
      vi.spyOn(UpdateJournalStore.prototype, 'write').mockImplementation(async function (this: UpdateJournalStore, journal) {
        await read.call(this, journal);
        lastJournalState = journal.state;
      });
      const terminal: unknown[] = [];
      fixture.showErrorBox.mockImplementation(() => {
        terminal.push({ step: 'error', state: lastJournalState, guarded: lifecycle.isInstallerHandoffPending() });
        if (outcome === 'dialogFailure') throw new Error('synthetic dialog failure');
      });
      fixture.quit.mockImplementation(() => {
        terminal.push({ step: 'quit', state: lastJournalState, guarded: lifecycle.isInstallerHandoffPending() });
      });
      const update = handoff.handoffPreparedUpdate();
      const result = Promise.allSettled([update]);
      try {
        await Promise.race([entered.promise, result.then(() => { throw new Error('HANDOFF_FINISHED_BEFORE_LAUNCH'); })]);
        expect(fixture.mainWindow.isDestroyed()).toBe(true);
        expect(lifecycle.isInstallerHandoffPending()).toBe(true);
        expect(fixture.stopForUpdate).toHaveBeenCalledOnce();
        expect(fixture.quit).not.toHaveBeenCalled();
        const quit = vi.fn();
        const handler = createDesktopBeforeQuitHandler({ readLifecycle: () => lifecycle, quitApplication: quit });
        const event = { preventDefault: vi.fn() };
        await handler(event);
        expect(event.preventDefault).toHaveBeenCalledOnce();
        expect(quit).not.toHaveBeenCalled();
      } finally {
        release.resolve();
        await result;
      }
      expect((await result)[0]!.status).toBe(outcome === 'success' ? 'fulfilled' : 'rejected');
      const state = outcome === 'success' ? 'awaitingFirstStart' : 'failed';
      expect(terminal).toEqual([
        ...(outcome === 'success' ? [] : [{ step: 'error', state, guarded: true }]),
        { step: 'quit', state, guarded: false },
      ]);
      safeError();
      expect(fixture.showErrorBox).toHaveBeenCalledTimes(outcome === 'success' ? 0 : 1);
      expect(fixture.showErrorBox.mock.calls.flat().join(' ')).not.toContain('synthetic-private');
      expect(ProfileSnapshotBrokerClient.prototype.endUpdateMaintenance).not.toHaveBeenCalled();
      await fixture.assertRegistryUnchanged();
    },
  );

  it.each(['throws', 'stillOpen'] as const)('does not launch MSI if window destruction %s', async failure => {
    const fixture = await createFixture(originalProfileId, { completeStartup: true, skipRestore: true, update: true });
    const readHandoff = prepareUpdateBoundary(fixture.root);
    const lifecycle = (await fixture.start())!;
    await readHandoff().prepareConfirmedUpdate();
    fixture.mainWindow.destroy.mockImplementation(() => {
      if (failure === 'throws') throw new Error('synthetic window failure');
    });

    await expect(readHandoff().handoffPreparedUpdate()).rejects.toThrow();

    expect(launchWindowsInstallerForUpdate).not.toHaveBeenCalled();
    expect(fixture.showErrorBox).toHaveBeenCalledOnce();
    expect(fixture.quit).toHaveBeenCalledOnce();
    expect(lifecycle.isInstallerHandoffPending()).toBe(false);
    await expect(fixture.updateJournal.readForLiveOwner()).resolves.toMatchObject({ state: 'failed' });
    expect(ProfileSnapshotBrokerClient.prototype.endUpdateMaintenance).not.toHaveBeenCalled();
  });

  it.each(['success', 'stopFailure', 'explicitQuitWithStopFailure'] as const)(
    'defers user quit from strict shutdown through terminal handoff (%s)', async outcome => {
      const fixture = await createFixture(originalProfileId, { completeStartup: true, skipRestore: true, update: true });
      const readHandoff = prepareUpdateBoundary(fixture.root);
      const lifecycle = (await fixture.start())!;
      await readHandoff().prepareConfirmedUpdate();
      const entered = createCompletionGate();
      const release = createCompletionGate();
      fixture.stopForUpdate.mockImplementation(async () => {
        entered.resolve();
        await release.promise;
        if (outcome !== 'success') throw new BackendShutdownExitError();
      });
      const result = Promise.allSettled([readHandoff().handoffPreparedUpdate()]);
      try {
        await Promise.race([entered.promise, result.then(() => { throw new Error('HANDOFF_FINISHED_BEFORE_STOP'); })]);
        expect(lifecycle.isInstallerHandoffPending()).toBe(true);
        if (outcome !== 'explicitQuitWithStopFailure') fixture.mainWindow.destroy();
        const quit = vi.fn();
        const handler = createDesktopBeforeQuitHandler({ readLifecycle: () => lifecycle, quitApplication: quit });
        const event = { preventDefault: vi.fn() };
        await handler(event);
        expect(event.preventDefault).toHaveBeenCalledOnce();
        expect(quit).not.toHaveBeenCalled();
        expect(fixture.quit).not.toHaveBeenCalled();
        expect(launchWindowsInstallerForUpdate).not.toHaveBeenCalled();
      } finally {
        release.resolve();
        await result;
      }
      expect((await result)[0]!.status).toBe(outcome === 'success' ? 'fulfilled' : 'rejected');
      expect(lifecycle.isInstallerHandoffPending()).toBe(false);
      expect(fixture.mainWindow.destroy).toHaveBeenCalledTimes(outcome === 'explicitQuitWithStopFailure' ? 0 : 1);
      expect(fixture.quit).toHaveBeenCalledOnce();
      expect(fixture.showErrorBox).toHaveBeenCalledTimes(outcome === 'success' ? 0 : 1);
      expect(launchWindowsInstallerForUpdate).toHaveBeenCalledTimes(outcome === 'success' ? 1 : 0);
      expect(ProfileSnapshotBrokerClient.prototype.endUpdateMaintenance).not.toHaveBeenCalled();
      await expect(fixture.updateJournal.readForLiveOwner()).resolves.toMatchObject({
        state: outcome === 'success' ? 'awaitingFirstStart' : 'failed',
      });
    },
  );

  it.each(['exited', 'forced'] as const)(
    'marks only a graceful backend shutdown clean after restored startup (%s)',
    async (outcome) => {
      const fixture = await createFixture(originalProfileId, { completeStartup: true });
      fixture.stop.mockResolvedValue(outcome);
      const lifecycle = await fixture.start();
      expect(lifecycle).toBeDefined();

      if (outcome === 'exited') await lifecycle!.shutdown();
      else await expect(lifecycle!.shutdown()).rejects.toMatchObject({
        message: 'DESKTOP_SHUTDOWN_FAILED',
        cause: { runtimeFailure: { firstFailure: { phase: 'backend', reason: 'notGraceful' } } },
      });

      expect(fixture.stop).toHaveBeenCalledOnce();
      await expect(fixture.marker.consume()).resolves.toBe(
        outcome === 'exited' ? 'clean' : 'unclean',
      );
      await fixture.assertRegistryUnchanged();
    },
  );

  it('borrows the same real update lease for preparation and handoff inspection', async () => {
    const fixture = await createFixture(originalProfileId, { completeStartup: true, skipRestore: true, update: true });
    const readHandoff = prepareUpdateBoundary(fixture.root);
    const lifecycle = (await fixture.start())!;
    const acquire = vi.spyOn(InMemoryWorkspaceMaintenanceLease.prototype, 'acquire');
    const inspector = vi.mocked(snapshotInspection.runProfileSnapshotInspection);
    inspector.mockClear();
    await readHandoff().prepareConfirmedUpdate();
    const prepared = await fixture.updateJournal.readForLiveOwner();
    expect(acquire.mock.calls.map(call => call[0])).toEqual(['update']);
    expect(inspector.mock.calls[0]![0].updateMaintenanceOperationId).toBeUndefined();
    expect(inspector.mock.calls[0]![0].operationId).not.toBe(prepared!.correlationId);
    await readHandoff().handoffPreparedUpdate();
    expect(inspector).toHaveBeenCalledTimes(2);
    expect(inspector.mock.calls[1]![0]).toMatchObject({
      operationId: prepared!.correlationId, updateMaintenanceOperationId: prepared!.correlationId,
      migrationPolicy: 'exactCurrentManifest',
    });
    expect(acquire.mock.calls.map(call => call[0])).toEqual(['update']);
    expect('validateActiveProfile' in ProfileSnapshotBrokerClient.prototype).toBe(false);
    expect(ProfileSnapshotBrokerClient.prototype.endUpdateMaintenance).not.toHaveBeenCalled();
    expect(launchWindowsInstallerForUpdate).toHaveBeenCalledOnce();
    await lifecycle.shutdown();
  });

  it.each([false, true])('D2 update awaits the source password-failure notice and never bypasses its failure: %s', async noticeFails => {
    const fixture = await createFixture(originalProfileId, { completeStartup: true, skipRestore: true, update: true });
    const realStart = secretBrokerMain.startSecretBrokerMain;
    vi.spyOn(secretBrokerMain, 'startSecretBrokerMain').mockImplementation(options => ({
      ...realStart(options), hasFailedMutation: () => true,
    }));
    const readHandoff = prepareUpdateBoundary(fixture.root);
    const acknowledged = createCompletionGate();
    const noticeEntered = createCompletionGate();
    fixture.showMessageBox.mockImplementation(async () => {
      noticeEntered.resolve();
      await acknowledged.promise;
      if (noticeFails) throw new Error('SYNTHETIC_NOTICE_FAILED');
      return { response: 0, checkboxChecked: false };
    });
    const lifecycle = (await fixture.start())!;
    await readHandoff().prepareConfirmedUpdate();
    const handoff = Promise.allSettled([readHandoff().handoffPreparedUpdate()]);
    try {
      await Promise.race([noticeEntered.promise, handoff.then(() => { throw new Error('D2_NOTICE_NOT_REACHED'); })]);
      expect(fixture.stopForUpdate).toHaveBeenCalledOnce();
      expect(launchWindowsInstallerForUpdate).not.toHaveBeenCalled();
      expect(fixture.showMessageBox).toHaveBeenCalledWith(fixture.mainWindow, expect.objectContaining({
        message: 'Sähköpostisalasanan muutos ei tallentunut.', type: 'warning', buttons: ['Selvä'],
      }));
    } finally {
      acknowledged.resolve();
      await handoff;
    }
    expect((await handoff)[0]!.status).toBe(noticeFails ? 'rejected' : 'fulfilled');
    expect(launchWindowsInstallerForUpdate).toHaveBeenCalledTimes(noticeFails ? 0 : 1);
    if (noticeFails) await expect(lifecycle.shutdown()).rejects.toThrow('DESKTOP_SHUTDOWN_FAILED');
    else await lifecycle.shutdown();
  });

  it.each(['preparation', 'handoff'] as const)('retains the real update owner after uncertain %s inspection', async stage => {
    const fixture = await createFixture(originalProfileId, { completeStartup: true, skipRestore: true, update: true });
    const readHandoff = prepareUpdateBoundary(fixture.root);
    const lifecycle = (await fixture.start())!;
    const acquire = InMemoryWorkspaceMaintenanceLease.prototype.acquire;
    let assertOwner!: () => void;
    vi.spyOn(InMemoryWorkspaceMaintenanceLease.prototype, 'acquire').mockImplementation(async function (
      this: InMemoryWorkspaceMaintenanceLease, purpose,
    ) {
      const handle = await acquire.call(this, purpose);
      if (purpose === 'update') assertOwner = this.captureCurrentOwner(['update']);
      return handle;
    });
    if (stage === 'handoff') await readHandoff().prepareConfirmedUpdate();
    const before = await fixture.updateJournal.readForLiveOwner();
    vi.mocked(snapshotInspection.runProfileSnapshotInspection).mockRejectedValueOnce(new ProfileInspectionProcessError(
      'PROFILE_INSPECTION_CLEANUP_UNVERIFIED', { processAbsent: false, reservationReclaimed: false, forced: true },
    ));
    await expect(stage === 'preparation' ? readHandoff().prepareConfirmedUpdate() : readHandoff().handoffPreparedUpdate()).rejects.toThrow();
    expect(assertOwner).not.toThrow();
    expect(await fixture.updateJournal.readForLiveOwner()).toEqual(before);
    expect(ProfileSnapshotBrokerClient.prototype.endUpdateMaintenance).not.toHaveBeenCalled();
    expect(fixture.stopForUpdate).not.toHaveBeenCalled();
    expect(launchWindowsInstallerForUpdate).not.toHaveBeenCalled();
    await expect(readHandoff().prepareConfirmedUpdate()).rejects.toThrow();
    await expect(lifecycle.shutdown()).rejects.toThrow('DESKTOP_SHUTDOWN_FAILED');
  });

  it.each([false, true])(
    'ordinary shutdown waits for the in-flight update stop (failure: %s)', async failure => {
      const fixture = await createFixture(originalProfileId, {
        completeStartup: true, skipRestore: true, update: true,
      });
      const readHandoff = prepareUpdateBoundary(fixture.root);
      const lifecycle = (await fixture.start())!;
      const handoff = readHandoff();
      await handoff.prepareConfirmedUpdate();
      const entered = createCompletionGate();
      const release = createCompletionGate();
      fixture.stopForUpdate.mockImplementation(async () => {
        entered.resolve();
        await release.promise;
        if (failure) throw new BackendShutdownExitError();
      });
      const update = handoff.handoffPreparedUpdate();
      await entered.promise;
      const ordinary = lifecycle.shutdown();
      let settled = false;
      void ordinary.then(() => { settled = true; }, () => { settled = true; });
      const results = Promise.allSettled([update, ordinary]);
      await Promise.resolve();
      const settledBeforeExit = settled;
      release.resolve();
      expect((await results).map(result => result.status)).toEqual(
        failure ? ['rejected', 'rejected'] : ['fulfilled', 'fulfilled'],
      );
      expect(settledBeforeExit).toBe(false);
      expect(fixture.stopForUpdate).toHaveBeenCalledOnce();
      expect(fixture.stop).not.toHaveBeenCalled();
      expect(launchWindowsInstallerForUpdate).toHaveBeenCalledTimes(failure ? 0 : 1);
      await expect(fixture.marker.consume()).resolves.toBe(failure ? 'unclean' : 'clean');
    },
  );

  it.each([false, true])(
    'shares pending shutdown completion and failure between callers (failure: %s)',
    async (failure) => {
      const fixture = await createFixture(originalProfileId, { completeStartup: true });
      const gate = createCompletionGate();
      const entered = createCompletionGate();
      vi.mocked(RecoveryPointScheduler.prototype.stopChecks).mockImplementationOnce(() => {
        entered.resolve();
        return gate.promise;
      });
      if (failure) fixture.stop.mockRejectedValue(new Error('SYNTHETIC_STOP_FAILED'));
      const lifecycle = (await fixture.start())!;
      const first = lifecycle.shutdown();
      await entered.promise;
      let secondSettled = false;
      const second = lifecycle.shutdown();
      void second.then(() => { secondSettled = true; }, () => { secondSettled = true; });
      const results = Promise.allSettled([first, second]);
      await Promise.resolve();
      const settledBeforeRelease = secondSettled;
      gate.resolve();
      const actual = await results;

      expect(settledBeforeRelease).toBe(false);
      expect(actual.map(({ status }) => status)).toEqual(
        failure ? ['rejected', 'rejected'] : ['fulfilled', 'fulfilled'],
      );
      if (failure) {
        for (const result of actual) {
          expect(result).toMatchObject({
            status: 'rejected', reason: new Error('DESKTOP_SHUTDOWN_FAILED'),
          });
        }
        await expect(lifecycle.shutdown()).rejects.toThrow('DESKTOP_SHUTDOWN_FAILED');
      } else {
        await lifecycle.shutdown();
        expect(fixture.stop).toHaveBeenCalledOnce();
      }
      await expect(fixture.marker.consume()).resolves.toBe(failure ? 'unclean' : 'clean');
      await fixture.assertRegistryUnchanged();
    },
  );

  it('does not mark an unsuccessful backend exit as a clean shutdown', async () => {
    const fixture = await createFixture(originalProfileId, { completeStartup: true });
    fixture.stop.mockRejectedValue(new BackendShutdownExitError());
    const lifecycle = (await fixture.start())!;

    await expect(lifecycle.shutdown()).rejects.toThrow('DESKTOP_SHUTDOWN_FAILED');

    await expect(fixture.marker.consume()).resolves.toBe('unclean');
    await fixture.assertRegistryUnchanged();
  });

  it('writes the real secret drain failure to JSONL only on shutdown, separately from the aggregate', async () => {
    const fixture = await createFixture(originalProfileId, { completeStartup: true, skipRestore: true });
    const realStart = secretBrokerMain.startSecretBrokerMain;
    let closeSecretTransport: (() => void) | undefined;
    vi.spyOn(secretBrokerMain, 'startSecretBrokerMain').mockImplementation(options => {
      closeSecretTransport = () => options.transport.close();
      return realStart(options);
    });
    const lifecycle = (await fixture.start())!;
    expect(closeSecretTransport).toBeDefined();
    closeSecretTransport!();
    expect((await readRestoreDiagnosticEvents(fixture.root))
      .filter(event => event.eventName === 'desktop.shutdownFailed')).toEqual([]);

    await expect(lifecycle.shutdown()).rejects.toThrow('DESKTOP_SHUTDOWN_FAILED');
    await expect(lifecycle.shutdown()).rejects.toThrow('DESKTOP_SHUTDOWN_FAILED');
    const failures = (await readRestoreDiagnosticEvents(fixture.root))
      .filter(event => event.eventName === 'desktop.shutdownFailed');
    expect(failures.filter(event => event.stage === 'secretBrokerDrain')).toEqual([{
      appVersion: '0.2.8', buildRevision: 'a'.repeat(12),
      category: 'runtime', component: 'desktop',
      errorCode: 'SECRET_BROKER_TRANSPORT_FAILED', eventId: expect.any(String),
      eventName: 'desktop.shutdownFailed', level: 'error', outcome: 'failure',
      retryable: false, runtimeInstanceId: '33333333-3333-4333-8333-333333333333',
      schemaVersion: 1, sideEffectState: 'unknown', stage: 'secretBrokerDrain',
      timestamp: expect.any(String),
    }]);
    expect(failures.filter(event => event.stage === 'shutdown')).toEqual([
      expect.objectContaining({ errorCode: 'DESKTOP_SHUTDOWN_FAILED' }),
    ]);
    expect(fixture.stop).toHaveBeenCalledOnce();
    await expect(fixture.marker.consume()).resolves.toBe('unclean');
  });

  it.each(['none', 'backend', 'backendAndBroker', 'capability', 'broker', 'scheduler', 'quiescence'] as const)(
    'uses the real update handoff with strict shutdown (failure: %s)', async failure => {
      const fixture = await createFixture(originalProfileId, {
        completeStartup: true, skipRestore: true, update: true,
      });
      const readHandoff = prepareUpdateBoundary(fixture.root);
      const lifecycle = (await fixture.start())!;
      const handoff = readHandoff();
      await handoff.prepareConfirmedUpdate();
      const privateDetail = 'synthetic-private-shutdown-detail';
      fixture.stopForUpdate.mockImplementation(async () => {
        expect(electronBoundary.removeHandler).toHaveBeenCalled();
        if (failure === 'backendAndBroker') throw new BackendShutdownExitError();
        if (failure === 'backend') throw new Error(privateDetail);
      });
      if (failure === 'capability') electronBoundary.removeHandler.mockImplementationOnce(() => {
        throw new Error(privateDetail);
      });
      if (failure === 'broker' || failure === 'backendAndBroker') vi.spyOn(ProfileSnapshotBrokerClient.prototype, 'close')
        .mockImplementationOnce(() => { throw new Error(privateDetail); });
      if (failure === 'scheduler') vi.mocked(RecoveryPointScheduler.prototype.stopChecks)
        .mockRejectedValueOnce(new Error(privateDetail));
      if (failure === 'quiescence') vi.spyOn(BackendRequestQuiescence.prototype, 'quiesceAndWait')
        .mockRejectedValueOnce(new Error(privateDetail));
      let admission: BackendRequestQuiescence | undefined;
      const realStop = BackendRequestQuiescence.prototype.stop;
      vi.spyOn(BackendRequestQuiescence.prototype, 'stop').mockImplementation(function (this: BackendRequestQuiescence) {
        admission = this;
        realStop.call(this);
      });
      const expectedSuccess = failure === 'none';
      vi.mocked(launchWindowsInstallerForUpdate).mockImplementationOnce(async () => {
        expect(fixture.mainWindow.isDestroyed()).toBe(true);
        expect(fixture.mainWindow.destroy).toHaveBeenCalledOnce();
        expect(fixture.quit).not.toHaveBeenCalled();
      });
      if (expectedSuccess) {
        await handoff.handoffPreparedUpdate();
        await lifecycle.shutdown();
      } else {
        await expect(handoff.handoffPreparedUpdate()).rejects.toThrow(
          'The local update could not be handed off safely.',
        );
        await expect(lifecycle.shutdown()).rejects.toThrow('DESKTOP_SHUTDOWN_FAILED');
        if (failure === 'backendAndBroker') {
          await expect(lifecycle.shutdown()).rejects.toMatchObject({
            cause: {
              runtimeFailure: {
                firstFailure: { phase: 'backend', reason: 'unsuccessfulExit' },
                cleanupFailures: [{ phase: 'brokers', reason: 'operationFailed' }],
              },
              cleanupFailures: ['brokers'],
            },
          });
        }
      }

      expect(fixture.stop).not.toHaveBeenCalled();
      // Preparation failure still closes the owned backend, without authorizing handoff.
      expect(fixture.stopForUpdate).toHaveBeenCalledTimes(1);
      expect(launchWindowsInstallerForUpdate).toHaveBeenCalledTimes(expectedSuccess ? 1 : 0);
      expect(fixture.mainWindow.destroy).toHaveBeenCalledTimes(expectedSuccess ? 1 : 0);
      expect(fixture.quit).toHaveBeenCalledTimes(expectedSuccess ? 1 : 0);
      expect(lifecycle.isInstallerHandoffPending()).toBe(false);
      await expect(fixture.marker.consume()).resolves.toBe(expectedSuccess ? 'clean' : 'unclean');
      await expect(fixture.updateJournal.read()).resolves.toMatchObject({
        state: expectedSuccess ? 'awaitingFirstStart' : 'failed',
      });
      expect(admission?.begin('POST')).toBeUndefined();
      expect(admission?.readState()).toBe('stopped');
      expect(electronBoundary.removeHandler.mock.calls.length).toBeGreaterThan(1);
      expect(electronBoundary.portClosed.mock.calls.length).toBeGreaterThanOrEqual(2);
      const logs = join(fixture.root, 'runtime', 'logs', 'desktop');
      const records = [];
      for (const file of await readdir(logs)) {
        if (!file.endsWith('.jsonl')) continue;
        const content = await readFile(join(logs, file), 'utf8');
        expect(content).not.toContain(privateDetail);
        records.push(...content.trim().split('\n').map(line => JSON.parse(line)));
      }
      if (!expectedSuccess) {
        expect(records).toContainEqual(expect.objectContaining({
          eventName: 'desktop.shutdownFailed', errorCode: 'DESKTOP_SHUTDOWN_FAILED',
        }));
      }
      await fixture.assertRegistryUnchanged();
    },
  );

  it.each(['exited', 'forced'] as const)(
    'rejects handoff before inspection when ordinary shutdown has started (%s)', async outcome => {
      const fixture = await createFixture(originalProfileId, {
        completeStartup: true, skipRestore: true, update: true,
      });
      const readHandoff = prepareUpdateBoundary(fixture.root);
      const lifecycle = (await fixture.start())!;
      const handoff = readHandoff();
      await handoff.prepareConfirmedUpdate();
      const entered = createCompletionGate();
      const release = createCompletionGate();
      fixture.stop.mockImplementation(async () => {
        entered.resolve();
        await release.promise;
        return outcome;
      });
      const ordinary = lifecycle.shutdown();
      await entered.promise;
      const update = handoff.handoffPreparedUpdate();
      const results = Promise.allSettled([ordinary, update]);
      try {
        await expect(update).rejects.toThrow('The local update could not be handed off safely.');
        expect(launchWindowsInstallerForUpdate).not.toHaveBeenCalled();
        expect(ProfileSnapshotBrokerClient.prototype.endUpdateMaintenance).not.toHaveBeenCalled();
        await expect(fixture.updateJournal.readForLiveOwner()).resolves.toMatchObject({ state: 'recoveryPointValidated' });
      } finally { release.resolve(); }
      expect((await results).map(result => result.status)).toEqual([
        outcome === 'exited' ? 'fulfilled' : 'rejected', 'rejected',
      ]);
      expect(fixture.stop).toHaveBeenCalledOnce();
      expect(fixture.stopForUpdate).not.toHaveBeenCalled();
      expect(launchWindowsInstallerForUpdate).not.toHaveBeenCalled();
      await expect(fixture.marker.consume()).resolves.toBe(outcome === 'exited' ? 'clean' : 'unclean');
    },
  );

  it.each([false, true])('does not relaunch another workspace after rollback restores original database absence (replacement: %s)', async replacementTarget => {
    const fixture = await createFixture(originalProfileId, { replacementTarget, originalDatabaseAbsent: true });
    electronBoundary.fetch.mockResolvedValueOnce(new Response(null, { status: 503 }));
    await expect(fixture.start()).rejects.toThrow('PROFILE_RESTORE_RECOVERY_REQUIRED');
    expect(originalInspection.runProfileRestoreOriginalInspection).toHaveBeenCalled();
    expect(ProfileRestoreActivationTransaction.prototype.rollback).toHaveBeenCalledOnce();
    await expect(readFile(fixture.databasePath)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fixture.journal.peek()).resolves.toMatchObject({ phase: 'rolledBack', hadActiveDatabase: false });
    expect(fixture.relaunch).not.toHaveBeenCalled();
    expect(electronBoundary.createWindow).not.toHaveBeenCalled();
    await fixture.assertRegistryUnchanged();
  });

  it.each([false, true])('checks fresh original content after writer stop before rollback (replacement: %s)', async replacementTarget => {
    const fixture = await createFixture(originalProfileId, { replacementTarget });
    electronBoundary.fetch.mockResolvedValueOnce(new Response(null, { status: 503 }));
    await expect(fixture.start()).resolves.toBeUndefined();
    const inspect = vi.mocked(originalInspection.runProfileRestoreOriginalInspection);
    const rollback = vi.mocked(ProfileRestoreActivationTransaction.prototype.rollback);
    expect(inspect).toHaveBeenCalled(); expect(rollback).toHaveBeenCalledOnce();
    expect(fixture.stop.mock.invocationCallOrder[0]).toBeLessThan(inspect.mock.invocationCallOrder[0]!);
    expect(inspect.mock.invocationCallOrder[0]).toBeLessThan(rollback.mock.invocationCallOrder[0]!);
    expect(rollback.mock.calls[0]![0]?.phase).toBe('validationStarting');
    expect(rollback.mock.calls[0]![1]).toBeTypeOf('function');
    expect(rollback.mock.calls[0]![2]?.assertContent).toBeTypeOf('function');
    expect(fixture.relaunch).toHaveBeenCalledOnce();
    if (replacementTarget) {
      await expect(readFile(fixture.databasePath, 'utf8')).resolves.toBe(fixture.originalBytes);
      await expect(readFile(fixture.pdfPath, 'utf8')).resolves.toBe('%PDF-1.7 original pdf');
      await expect(fixture.journal.peek()).resolves.toMatchObject({ phase: 'rolledBack' });
      await expect(fixture.registry.read()).resolves.toMatchObject({ activeWorkspaceId: '44444444-4444-4444-8444-444444444444' });
    } else await fixture.assertOriginalRestored();
  });

  it.each([false, true])('retains original evidence when post-stop original inspection fails (replacement: %s)', async replacementTarget => {
    const fixture = await createFixture(originalProfileId, { replacementTarget });
    electronBoundary.fetch.mockResolvedValueOnce(new Response(null, { status: 503 }));
    vi.mocked(originalInspection.runProfileRestoreOriginalInspection).mockRejectedValueOnce(new Error('PROFILE_SCHEMA_UNSUPPORTED'));
    await expect(fixture.start()).rejects.toThrow('PROFILE_RESTORE_RECOVERY_REQUIRED');
    expect(ProfileRestoreActivationTransaction.prototype.rollback).not.toHaveBeenCalled();
    expect(fixture.relaunch).not.toHaveBeenCalled(); expect(electronBoundary.createWindow).not.toHaveBeenCalled();
    await fixture.assertPendingRestoreRetained();
  });

  it.each([false, true])('keeps one restore owner from isolated rejection through stopped rollback (replacement: %s)', async replacementTarget => {
    const fixture = await createFixture(originalProfileId, { replacementTarget });
    const acquired: (() => void)[] = [];
    const acquire = InMemoryWorkspaceMaintenanceLease.prototype.acquire;
    vi.spyOn(InMemoryWorkspaceMaintenanceLease.prototype, 'acquire').mockImplementation(async function (
      this: InMemoryWorkspaceMaintenanceLease, purpose,
    ) {
      const handle = await acquire.call(this, purpose);
      if (purpose === 'restore' && fixture.events.includes('backendStarted')) {
        acquired.push(this.captureCurrentOwner(['restore']));
      }
      return handle;
    });
    const first = new ProfileInspectionProcessError('PROFILE_SCHEMA_UNSUPPORTED', {
      processAbsent: true, reservationReclaimed: true, forced: false,
    });
    let assertOwner: (() => void) | undefined;
    vi.mocked(snapshotInspection.runProfileSnapshotInspection).mockImplementationOnce(async () => {
      expect(acquired).toHaveLength(1); assertOwner = acquired[0]!; assertOwner(); throw first;
    });
    const stop = fixture.stop.getMockImplementation()!;
    fixture.stop.mockImplementation(async () => { assertOwner!(); return stop(); });
    const original = vi.mocked(originalInspection.runProfileRestoreOriginalInspection).getMockImplementation()!;
    vi.mocked(originalInspection.runProfileRestoreOriginalInspection).mockImplementation(async input => {
      expect(acquired).toHaveLength(1); assertOwner!(); return original(input);
    });
    await expect(fixture.start()).resolves.toBeUndefined();
    expect(fixture.events).toEqual(['backendStarted', 'backendStopped', 'rollback']);
    expect(fixture.relaunch).toHaveBeenCalledOnce(); expect(acquired).toHaveLength(1);
    expect(assertOwner).toBeTypeOf('function'); expect(assertOwner!).toThrow();
    expect('validateActiveProfile' in ProfileSnapshotBrokerClient.prototype).toBe(false);
    expect(await readFile(fixture.databasePath, 'utf8')).toBe(fixture.originalBytes);
    expect(await fixture.journal.peek()).toMatchObject({ phase: 'rolledBack' });
  });

  it('retains restore evidence when isolated validation cannot prove inspector exit', async () => {
    const fixture = await createFixture(originalProfileId);
    vi.mocked(snapshotInspection.runProfileSnapshotInspection).mockRejectedValueOnce(new ProfileInspectionProcessError(
      'PROFILE_INSPECTION_CLEANUP_UNVERIFIED', { processAbsent: false, reservationReclaimed: false, forced: true },
    ));
    await expect(fixture.start()).rejects.toThrow();
    expect(originalInspection.runProfileRestoreOriginalInspection).not.toHaveBeenCalled();
    expect(ProfileRestoreActivationTransaction.prototype.rollback).not.toHaveBeenCalled();
    expect(fixture.relaunch).not.toHaveBeenCalled(); expect(electronBoundary.createWindow).not.toHaveBeenCalled();
    await fixture.assertPendingRestoreRetained();
  });

  it('rejects foreign restored lineage, restores original bytes and validates them on restart', async context => {
    const lifetime = beginTrackedStartupTest(context);
    await lifetime.run(async () => {
      const fixture = await lifetime.step('fixturePreparation', () => createFixture(originalProfileId, {
        validationProfileId: foreignProfileId, ownedRoots: lifetime.roots,
      }));
      await lifetime.step('startupRollback', async () => { await expect(fixture.start()).resolves.toBeUndefined(); });
      await lifetime.step('restoredContentCheck', async () => {
        expect(fixture.relaunch).toHaveBeenCalledTimes(1);
        expect(electronBoundary.createWindow).not.toHaveBeenCalled();
        expect(fixture.events).toEqual(['backendStarted', 'backendStopped', 'rollback']);
        expect(originalInspection.runProfileRestoreOriginalInspection).toHaveBeenCalled();
        await fixture.assertOriginalRestored();
      });
      await lifetime.step('startup', async () => { await expect(fixture.start()).rejects.toThrow(windowBoundary); });
      await lifetime.step('restoredContentCheck', async () => {
        expect(electronBoundary.createWindow).toHaveBeenCalledTimes(1);
        await expect(fixture.journal.read()).resolves.toBeUndefined();
        await fixture.assertRegistryUnchanged();
      });
    });
  });

  it('rolls back if health fails after deferred restore validation but before acceptance', async context => {
    const lifetime = beginTrackedStartupTest(context);
    await lifetime.run(async () => {
      const fixture = await lifetime.step('fixturePreparation', () => createFixture(originalProfileId, {
        ownedRoots: lifetime.roots,
      }));
      electronBoundary.fetch
        .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'ok' })))
        .mockResolvedValueOnce(new Response(null, { status: 503 }));

      await lifetime.step('startupRollback', async () => { await expect(fixture.start()).resolves.toBeUndefined(); });

      await lifetime.step('restoredContentCheck', async () => {
        expect(electronBoundary.fetch).toHaveBeenCalledTimes(2);
        expect(electronBoundary.createWindow).not.toHaveBeenCalled();
        expect(fixture.relaunch).toHaveBeenCalledTimes(1);
        expect(fixture.events).toEqual(['backendStarted', 'backendStopped', 'rollback']);
        await fixture.assertOriginalRestored();
      });
    });
  });

  it('does not swap files or relaunch when backend shutdown is unverified', async () => {
    const fixture = await createFixture(originalProfileId, { validationProfileId: foreignProfileId });
    fixture.stop.mockRejectedValue(new Error('SYNTHETIC_STOP_FAILED'));
    const observed = vi.fn();

    await expect(fixture.start(observed)).rejects.toThrow('PROFILE_RESTORE_RECOVERY_REQUIRED');
    expect(observed.mock.calls[0]![0]).toMatchObject({ cause: { errors: [
      { message: 'WORKSPACE_SWITCH_INVALID' }, { message: 'SYNTHETIC_STOP_FAILED' },
    ] } });

    expect(fixture.events).toEqual(['backendStarted']);
    expect(fixture.relaunch).not.toHaveBeenCalled();
    expect(electronBoundary.createWindow).not.toHaveBeenCalled();
    await fixture.assertPendingRestoreRetained();
  });

  it('keeps the journal and rollback bytes when rollback itself fails', async () => {
    const fixture = await createFixture(originalProfileId, { validationProfileId: foreignProfileId });
    vi.spyOn(ProfileRestoreActivationTransaction.prototype, 'rollback')
      .mockRejectedValueOnce(new Error('SYNTHETIC_ROLLBACK_FAILED'));

    const observed = vi.fn();
    await expect(fixture.start(observed)).rejects.toThrow('PROFILE_RESTORE_RECOVERY_REQUIRED');
    expect(observed.mock.calls[0]![0]).toMatchObject({ cause: { errors: [
      { message: 'WORKSPACE_SWITCH_INVALID' },
      { message: 'PROFILE_RESTORE_RECOVERY_REQUIRED', cause: {
        message: 'PROFILE_RESTORE_RECOVERY_REQUIRED', cause: { message: 'SYNTHETIC_ROLLBACK_FAILED' },
      } },
    ] } });

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
      expect(originalInspection.runProfileRestoreOriginalInspection).not.toHaveBeenCalled();
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
    await expect(readFile(fixture.pdfPath, 'utf8')).resolves.toBe('%PDF-1.7 restored pdf');
    await fixture.assertRegistryUnchanged();
  });
});

function createCompletionGate() {
  let resolve!: () => void;
  const promise = new Promise<void>((complete) => { resolve = complete; });
  return { promise, resolve };
}

function prepareUpdateBoundary(root: string, onShutdownStarted?: () => void) {
  // Only path validation runs; the installer boundary below is never executed.
  vi.stubEnv('SystemRoot', 'C:\\Windows');
  electronBoundary.fetch.mockImplementation(async (url: string) =>
    url.endsWith('/customers')
      ? new Response(null, { status: 401 })
      : new Response(JSON.stringify({ status: 'ok' })),
  );
  const realObserver = updateObservation.createUpdateOperationalObserver;
  vi.spyOn(updateObservation, 'createUpdateOperationalObserver').mockImplementation(options => {
    const observer = realObserver(options);
    return {
      ...observer,
      operationStarted(input) {
        observer.operationStarted(input);
        if (input.stage === 'runtimeShutdown') onShutdownStarted?.();
      },
    };
  });
  let handoff: Parameters<typeof updateFoundation.createLocalUpdateFoundationComposition>[0]['handoffCoordinator'] | undefined;
  const realFoundation = updateFoundation.createLocalUpdateFoundationComposition;
  vi.spyOn(updateFoundation, 'createLocalUpdateFoundationComposition').mockImplementation(options => {
    handoff = options.handoffCoordinator;
    return realFoundation(options);
  });
  const realProtection = profileProtection.createProfileProtectionComposition;
  vi.spyOn(profileProtection, 'createProfileProtectionComposition').mockImplementation(options => ({
    ...realProtection(options),
    createValidatedPreUpdatePoint: async () => operationId,
  }));
  vi.spyOn(ProfileSnapshotBrokerClient.prototype, 'beginMaintenance').mockResolvedValue('busy');
  vi.spyOn(ProfileSnapshotBrokerClient.prototype, 'endMaintenance').mockResolvedValue('normal');
  vi.spyOn(ProfileSnapshotBrokerClient.prototype, 'beginUpdateMaintenance').mockResolvedValue('busy');
  vi.spyOn(ProfileSnapshotBrokerClient.prototype, 'assertUpdateMaintenance').mockResolvedValue('busy');
  vi.spyOn(ProfileSnapshotBrokerClient.prototype, 'endUpdateMaintenance').mockResolvedValue('normal');
  vi.spyOn(LocalUpdatePackageCache.prototype, 'readExpectedPackageIdentity').mockImplementation(async role => ({
    appVersion: role === 'current' ? '0.2.8' : '0.2.9',
    buildRevision: (role === 'current' ? 'a' : 'b').repeat(12),
    msiProductVersion: role === 'current' ? '0.2.8' : '0.2.9',
    packageSha256: (role === 'current' ? 'a' : 'b').repeat(64),
    packageSize: 1024,
  }));
  vi.spyOn(LocalUpdatePackageCache.prototype, 'revalidateJournalPackage').mockResolvedValue({
    appVersion: '0.2.9', buildRevision: 'b'.repeat(12), msiProductVersion: '0.2.9',
    packagePath: join(root, 'synthetic-never-launched.msi'),
    productCode: '{22222222-2222-4222-8222-222222222222}',
  });
  return () => {
    if (handoff === undefined) throw new Error('TEST_HANDOFF_NOT_WIRED');
    return handoff;
  };
}

async function prepareColdJournal(root: string, kind: 'creation' | 'import', options: {
  formatVersion?: 1 | 2;
  slot?: 'currentPath' | 'backupPath' | 'nextPath';
  state?: 'prepared' | 'candidateValidated' | 'rootPublished';
  workspaceLabel?: string;
  previousActiveWorkspaceId?: typeof workspaceId | null;
} = {}) {
  const input = {
    state: options.state ?? 'prepared',
    workspaceId: validateWorkspaceId('55555555-5555-4555-8555-555555555555'),
    previousActiveWorkspaceId: options.previousActiveWorkspaceId === undefined ? workspaceId : options.previousActiveWorkspaceId,
  };
  const creationValue = createTestJournal({ ...input, profileCharacter: 'b' });
  const importValue = createTestImportJournal({ ...input, profileId: foreignProfileId });
  const value = { ...(kind === 'creation' ? creationValue : importValue),
    ...(options.workspaceLabel === undefined ? {} : { workspaceLabel: options.workspaceLabel }),
    formatVersion: options.formatVersion ?? 2 };
  const filePath = join(root, kind === 'creation' ? WORKSPACE_CREATION_JOURNAL_FILE_NAME : WORKSPACE_BACKUP_IMPORT_JOURNAL_FILE_NAME);
  const journal = kind === 'creation'
    ? new WorkspaceCreationJournalStore({ installationRoot: root, filePath })
    : new WorkspaceBackupImportJournalStore({ installationRoot: root, filePath });
  const paths = kind === 'creation'
    ? createWorkspaceCreationJournalPaths(root, filePath)
    : createWorkspaceBackupImportJournalPaths(root, filePath);
  await writeFile(paths[options.slot ?? 'currentPath'], JSON.stringify(value), { mode: 0o600 });
  const candidate = kind === 'creation'
    ? deriveWorkspaceCreationPaths(root, creationValue.operationId, input.workspaceId)
    : deriveWorkspaceBackupImportPaths(root, importValue.operationId, input.workspaceId);
  await mkdir(dirname(candidate.databaseFilePath), { recursive: true, mode: 0o700 });
  await writeFile(candidate.databaseFilePath, 'synthetic candidate', { mode: 0o600 });
  const published = createDesktopProfilePaths(deriveWorkspaceRoot(root, input.workspaceId, 1).workspaceRoot);
  if (options.state === 'rootPublished' || options.state === 'candidateValidated') {
    await mkdir(dirname(published.databaseFilePath), { recursive: true, mode: 0o700 });
    await mkdir(published.invoiceDocumentStorageRoot, { recursive: true, mode: 0o700 });
    await writeFile(published.databaseFilePath, 'synthetic published', { mode: 0o600 });
    await rm(candidate.candidateRoot, { recursive: true, force: true });
  }
  return { journal, paths, value, candidateFile: candidate.databaseFilePath, publishedFile: published.databaseFilePath };
}

async function preparePlaintext(root: string) {
  const path = await new WorkspaceBackupPlaintextQuarantine({ userDataRoot: root }).createPayloadPath();
  await writeFile(path, 'synthetic plaintext', { mode: 0o600 });
  return path;
}

async function prepareUpdateBusinessRollback(fixture: Awaited<ReturnType<typeof createFixture>>,
  state: 'rollbackRequired' | 'businessRollbackStarting' | 'businessRollbackCompleted' = 'businessRollbackStarting',
  mockPreparation = true) {
  // Inventory/migration preparation has its own suite; this fixture controls the C caller's gate.
  if (mockPreparation) vi.spyOn(WorkspaceFirstStartMigrationOrchestrator.prototype, 'prepareBeforeBackend').mockResolvedValue('notRequired');
  const paths = createLocalUpdateRuntimePaths({ userDataPath: fixture.root,
    legacyRuntimeRoot: createDesktopProfilePaths(fixture.root).runtimeRoot });
  await new AcceptedBuildMetadataStore(paths.acceptedBuildMetadataPath).write({
    acceptedAt: '2026-08-18T10:00:00.000Z', appVersion: '0.2.7', buildRevision: 'b'.repeat(12),
    formatVersion: 1, releaseChannel: 'pilot',
  });
  await fixture.updateJournal.write({
    binaryRollbackAttemptCount: 0,
    candidatePackageIdentity: { buildRevision: 'a'.repeat(12), msiProductVersion: '0.2.8',
      packageSha256: 'a'.repeat(64), packageSize: 2_048 },
    correlationId: operationId,
    createdAt: '2026-08-18T10:00:00.000Z',
    currentPackageIdentity: { buildRevision: 'b'.repeat(12), msiProductVersion: '0.2.7',
      packageSha256: 'b'.repeat(64), packageSize: 1_024 },
    currentVersion: '0.2.7', formatVersion: 1, handoffAttemptCount: 1,
    preUpdateMigrationChainIdentity: 'c'.repeat(64),
    recoveryPointReference: '55555555-5555-4555-8555-555555555555',
    releaseChannel: 'pilot', revision: state === 'rollbackRequired' ? 6 : 7, state,
    targetVersion: '0.2.8', updatedAt: '2026-08-18T11:00:00.000Z',
  });
}

async function readRestoreDiagnosticEvents(root: string): Promise<Record<string, unknown>[]> {
  const logs = join(createDesktopProfilePaths(root).runtimeRoot, 'logs', 'desktop');
  const events: Record<string, unknown>[] = [];
  for (const name of await readdir(logs)) {
    if (!name.startsWith('desktop-') || !name.endsWith('.jsonl')) continue;
    for (const line of (await readFile(join(logs, name), 'utf8')).trim().split('\n')) {
      if (line !== '') events.push(JSON.parse(line) as Record<string, unknown>);
    }
  }
  return events;
}

function createAcceptedDirectSetupFixture() {
  return { ...createDirectSetupMigrationRecovery({ at: '2026-08-18T10:00:00.000Z', appliedMigrationCount: 1,
    correlationId: operationId, recoveryPointReference: operationId, migrationPrefixIdentity: 'c'.repeat(64),
    previousAcceptedBuildIdentity: { appVersion: '0.2.7', buildRevision: 'b'.repeat(12) },
    runningTargetBuildIdentity: { appVersion: '0.2.8', buildRevision: 'a'.repeat(12) } }), state: 'accepted' as const };
}

async function createSelectorStartupFixture(ownedRoots: string[], state: 'accepted' | 'installerNotApplied' | 'rolledBack' = 'accepted') {
  const boundary = new Error('synthetic workspace resolution boundary');
  const resolve = vi.fn(async () => { throw boundary; });
  const fixture = await createFixture(originalProfileId, {
    ownedRoots, update: true, skipRestore: true, resolveActiveWorkspace: resolve,
  });
  await fixture.registry.write({ ...(await fixture.registry.read())!, formatVersion: 2, activeWorkspaceId: null });
  const originalMetadata = (await fixture.acceptedBuild.read())!;
  await prepareUpdateBusinessRollback(fixture, 'businessRollbackStarting', false);
  const metadata = state === 'accepted' ? originalMetadata : {
    ...originalMetadata, appVersion: '0.2.6', buildRevision: 'b'.repeat(12),
  };
  const originalJournal = (await fixture.updateJournal.read())!;
  const terminal = { ...originalJournal, state, revision: 9, binaryRollbackAttemptCount: state === 'rolledBack' ? 1 : 0,
    ...(state === 'accepted' ? {} : { currentVersion: '0.2.6', targetVersion: '0.2.7',
      currentPackageIdentity: { ...originalJournal.currentPackageIdentity, msiProductVersion: '0.2.6' },
      candidatePackageIdentity: { ...originalJournal.candidatePackageIdentity, msiProductVersion: '0.2.7', buildRevision: 'c'.repeat(12) } }),
  };
  const paths = createLocalUpdateRuntimePaths({ userDataPath: fixture.root,
    legacyRuntimeRoot: createDesktopProfilePaths(fixture.root).runtimeRoot });
  await mkdir(dirname(paths.legacyAcceptedBuildMetadataPath), { recursive: true });
  await writeFile(paths.legacyAcceptedBuildMetadataPath, JSON.stringify(metadata));
  await writeFile(paths.legacyJournalPath, JSON.stringify(terminal));
  await rm(paths.acceptedBuildMetadataPath);
  await rm(paths.journalPath);
  return { fixture, paths, metadata, boundary, resolve };
}

async function createDeferredStartupFixture(ownedRoots: string[], completeStartup = false) {
  if (completeStartup) {
    electronBoundary.fetch.mockImplementation(async input => String(input).endsWith('/customers')
      ? new Response(null, { status: 401 }) : new Response(JSON.stringify({ status: 'ok' })));
    vi.spyOn(WorkspaceMigrationInventoryCoordinator.prototype, 'inspect').mockResolvedValue({
      activeWorkspaceId: workspaceId, entries: [{ workspaceId, isActive: true,
        appliedMigrationCount: 1, pendingMigrationCount: 0, status: 'current' }],
    });
  }
  const resolve = vi.fn(async (root: string) => {
    if (completeStartup) return resolveActiveWorkspaceStartup(root);
    throw new Error('unexpected workspace resolution');
  });
  const fixture = await createFixture(originalProfileId, {
    ownedRoots, update: true, skipRestore: true, completeStartup, resolveActiveWorkspace: resolve,
  });
  await fixture.registry.write({ ...(await fixture.registry.read())!, formatVersion: 2 });
  const target = (await fixture.acceptedBuild.read())! as Readonly<AcceptedBuildMetadata>;
  const metadata = createSelectorAcceptedBuildMetadata({ ...target,
    appVersion: '0.2.7', buildRevision: 'b'.repeat(12) }, target);
  await fixture.acceptedBuild.write(metadata);
  const paths = createLocalUpdateRuntimePaths({ userDataPath: fixture.root,
    legacyRuntimeRoot: createDesktopProfilePaths(fixture.root).runtimeRoot });
  return { fixture, paths, metadata, resolve };
}

function installCompletedColdCandidate() {
  const operations: string[] = [];
  electronBoundary.fork.mockImplementation(() => {
    const child = new EventEmitter();
    queueMicrotask(() => child.emit('message', createWorkspaceCandidateReadyStatus()));
    return Object.assign(child, {
      kill() { child.emit('exit', 0); },
      postMessage(raw: unknown) {
        const command = parseWorkspaceCandidateProcessCommand(raw);
        if (command === undefined) throw new Error('TEST_CANDIDATE_COMMAND_INVALID');
        if (command.type === 'prepare') {
          queueMicrotask(() => child.emit('message', createWorkspaceCandidateReservationReadyStatus(command)));
        } else if (command.type === 'start') {
          operations.push(command.operation.operation);
          queueMicrotask(() => child.emit('message', createWorkspaceCandidateCompletedStatus({ ...command,
            result: { actorId: 'local-owner', artifactRootHealth: 'ready',
              companyId: 'local-company-1234567890abcdef1234567890abcdef', databaseHealth: 'healthy',
              foreignKeyHealth: 'healthy', kind: 'readiness', migrationChainIdentity: 'c'.repeat(64), profileId: foreignProfileId },
          })));
        } else queueMicrotask(() => child.emit('exit', 0));
      },
    });
  });
  return operations;
}

async function createFixture(
  restoredProfileId: string,
  options: {
    replacementTarget?: boolean;
    completeStartup?: boolean;
    smoke?: boolean;
    skipRestore?: boolean;
    inspectBackendStartup?(input: StartDesktopBackendOptions): Promise<void>;
    realBackend?: boolean;
    beforeMigrations?: StartDesktopBackendOptions['beforeMigrations'];
    update?: boolean;
    firstStartUpgrade?: boolean;
    stoppedStartupRuntime?: boolean;
    pendingMigrationCount?: number;
    startupMigrationChainIdentity?: string;
    coldForward?: boolean;
    coldRollback?: boolean;
    originalDatabaseAbsent?: boolean;
    rolledBack?: boolean;
    acceptedRestore?: boolean;
    validationProfileId?: string;
    ownedRoots?: string[];
    resolveActiveWorkspace?: NonNullable<StartDesktopCompositionOptions['dependencies']>['resolveActiveWorkspace'];
  } = {},
) {
  const root = await mkdtemp(join(tmpdir(), 'eky-desktop-restore-startup-'));
  (options.ownedRoots ?? roots).push(root);
  let windowDestroyed = false;
  const mainWindow = {
    destroy: vi.fn(() => { windowDestroyed = true; }),
    isDestroyed: () => windowDestroyed,
    webContents: { mainFrame: {}, send: vi.fn(), isDestroyed: () => windowDestroyed },
  };
  const quit = vi.fn();
  const showErrorBox = vi.fn();
  const showSaveDialog = vi.fn(async () => ({ canceled: true, filePath: '' }));
  // This composition fixture has a controlled backend, not a delivered native addon.
  const inspectionContractPath = join(root, 'resources', 'backend', 'dist',
    'database', 'connection', 'profileInspectionNativeContract.js');
  await mkdir(dirname(inspectionContractPath), { recursive: true });
  await writeFile(inspectionContractPath,
    'export const profileInspectionNativeContract = { directoryName: "synthetic-inspection-native" };\n');
  const releaseInfo = options.update ? {
    appIdentity: 'Eky' as const,
    appVersion: '0.2.8',
    architecture: 'x64' as const,
    buildRevision: 'a'.repeat(12),
    msiProductVersion: '0.2.8',
    platform: 'win32' as const,
    releaseChannel: 'pilot' as const,
    schemaVersion: 1 as const,
    upgradeCode: '11111111-1111-4111-8111-111111111111',
  } : undefined;
  const updatePaths = createLocalUpdateRuntimePaths({
    userDataPath: root, legacyRuntimeRoot: createDesktopProfilePaths(root).runtimeRoot,
  });
  if (releaseInfo !== undefined) {
    // Only path validation runs; installer execution is mocked in this fixture.
    vi.stubEnv('SystemRoot', 'C:\\Windows');
    await new AcceptedBuildMetadataStore(updatePaths.acceptedBuildMetadataPath).write({
      acceptedAt: '2026-08-18T10:00:00.000Z',
      appVersion: options.firstStartUpgrade ? '0.2.7' : releaseInfo.appVersion,
      buildRevision: releaseInfo.buildRevision,
      formatVersion: 1,
      releaseChannel: 'pilot',
    });
  }
  if (options.completeStartup) {
    electronBoundary.createWindow.mockReturnValue(mainWindow as unknown as BrowserWindow);
    const candidateRunner = join(root, 'resources', 'desktop-runtime', 'runtime', 'workspaceCandidateRunner.js');
    await mkdir(dirname(candidateRunner), { recursive: true });
    await writeFile(candidateRunner, '// Synthetic boundary; never executed.\n');
    await mkdir(join(root, 'resources', 'backend', 'dist', 'database', 'migrations'), { recursive: true });
  }
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
    [pdfPath, '%PDF-1.7 original pdf'],
    [join(staging, 'profile.sqlite'), restoredBytes],
    [stagedPdf, '%PDF-1.7 restored pdf'],
  ] as const) {
    if (file === paths.databaseFilePath && options.originalDatabaseAbsent) continue;
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
  if (!options.skipRestore) {
    await transaction.prepare(operationId);
    if (!options.coldForward) await transaction.advanceToValidation();
    if (options.acceptedRestore) await transaction.commitAcceptance();
    if (options.coldRollback) {
      const selected = (await journal.peek())!;
      await journal.write({ ...selected, phase: 'rollbackStarting', revision: selected.revision + 1 });
      if (options.rolledBack) await transaction.rollback();
    }
  }
  // Isolate the native utility boundary only; real byte/census/lineage and move guards remain active.
  vi.spyOn(coldInspection, 'runProfileRestoreColdInspection').mockImplementation(async input => {
    const sources = await input.readSources({ deadline: input.deadline!, signal: input.signal });
    const database = await readFile(sources.databaseSlot === 'active' ? paths.databaseFilePath : join(staging, 'profile.sqlite'));
    const pdf = await readFile(sources.documentsSlot === 'active' ? pdfPath : stagedPdf);
    const documents = Object.freeze([Object.freeze({ logicalPath: `artifacts/invoicing/invoice-documents/${'c'.repeat(64)}.pdf`,
      storagePath: 'company-1/invoice-1/approved-invoice.pdf', byteSize: pdf.length, sha256: hashFixtureBytes(pdf) })]);
    const bindings = encodeProfileInspectionDocumentBindings(documents);
    return Object.freeze({ documents, receipt: Object.freeze({ databaseSlot: sources.databaseSlot, documentsSlot: sources.documentsSlot,
      profileId: restoredProfileId, databaseHealth: 'healthy', migrationPolicy: 'restoreCompatible',
      migrationChainIdentity: 'c'.repeat(64), artifactCount: 1, artifactTotalByteSize: pdf.length,
      artifactIdentity: createProfileSnapshotArtifactIdentity(documents), database: Object.freeze({ byteSize: database.length, sha256: hashFixtureBytes(database) }),
      documentBindings: Object.freeze({ byteSize: bindings.length, sha256: hashFixtureBytes(bindings) }) }) });
  });
  vi.spyOn(originalInspection, 'runProfileRestoreOriginalInspection').mockImplementation(async input => {
    const sources = await input.readSources({ deadline: input.deadline!, signal: input.signal });
    const rollback = join(backupPaths.restoreRollbackRoot, operationId);
    if (sources.databaseSlot === 'absent') {
      return { status: { type: 'originalCompleted', protocolVersion: profileInspectionProtocolVersion,
        operationId, generationId: operationId, runtimeSession: 'f'.repeat(43),
        result: { sourceRole: 'original', layout: sources.layout, databaseSlot: 'absent', documentsSlot: sources.documentsSlot } } };
    }
    const database = await readFile(sources.databaseSlot === 'active' ? paths.databaseFilePath : join(rollback, 'data', 'eky.sqlite'));
    const pdf = await readFile(sources.documentsSlot === 'active' ? pdfPath : join(rollback, 'storage', 'invoices',
      'company-1', 'invoice-1', 'approved-invoice.pdf'));
    const documents = Object.freeze([Object.freeze({ logicalPath: `artifacts/invoicing/invoice-documents/${'c'.repeat(64)}.pdf`,
      storagePath: 'company-1/invoice-1/approved-invoice.pdf', byteSize: pdf.length, sha256: hashFixtureBytes(pdf) })]);
    const bindings = encodeProfileInspectionDocumentBindings(documents);
    return { documents, status: { type: 'originalCompleted', protocolVersion: profileInspectionProtocolVersion,
      operationId, generationId: operationId, runtimeSession: 'f'.repeat(43), result: {
        sourceRole: 'original', layout: sources.layout, databaseSlot: sources.databaseSlot, documentsSlot: sources.documentsSlot,
        profileId: (JSON.parse(database.toString('utf8')) as { profileId: string }).profileId,
        databaseHealth: 'healthy', migrationPolicy: 'restoreCompatible', migrationChainIdentity: 'c'.repeat(64),
        artifactCount: 1, artifactTotalByteSize: pdf.length, artifactIdentity: createProfileSnapshotArtifactIdentity(documents),
        database: { byteSize: database.length, sha256: hashFixtureBytes(database) },
        documentBindings: { byteSize: bindings.length, sha256: hashFixtureBytes(bindings) },
      } } };
  });
  const pendingJournal = await journal.read();
  const events: string[] = [];
  const realRollback = ProfileRestoreActivationTransaction.prototype.rollback;
  vi.spyOn(ProfileRestoreActivationTransaction.prototype, 'rollback')
    .mockImplementation(async function (this: ProfileRestoreActivationTransaction, ...args) {
      events.push('rollback');
      return realRollback.apply(this, args);
    });
  const realAccept = ProfileRestoreActivationTransaction.prototype.commitAcceptance;
  vi.spyOn(ProfileRestoreActivationTransaction.prototype, 'commitAcceptance')
    .mockImplementation(async function (this: ProfileRestoreActivationTransaction, ...args) {
      events.push('accept');
      return realAccept.apply(this, args);
    });
  const liveStagingRoot = createProfileSnapshotRuntimePaths(paths.runtimeRoot).stagingRoot;
  vi.spyOn(ProfileSnapshotBrokerClient.prototype, 'beginRestoreMaintenance').mockResolvedValue('busy');
  vi.spyOn(ProfileSnapshotBrokerClient.prototype, 'assertRestoreMaintenance').mockResolvedValue('busy');
  vi.spyOn(ProfileSnapshotBrokerClient.prototype, 'endRestoreMaintenance').mockResolvedValue('normal');
  vi.spyOn(ProfileSnapshotBrokerClient.prototype, 'invalidateRestoreMaintenance').mockResolvedValue('busy');
  vi.spyOn(ProfileSnapshotBrokerClient.prototype, 'captureInspectionAuthority').mockReturnValue(() => {});
  vi.spyOn(ProfileSnapshotBrokerClient.prototype, 'createProfileSnapshot').mockImplementation(async (id, policy) => {
    expect(policy).toBe(options.stoppedStartupRuntime ? 'compatibleHistoricalPrefix' : 'exactCurrentManifest');
    const snapshot = join(liveStagingRoot, id);
    const database = await readFile(paths.databaseFilePath);
    await mkdir(snapshot, { recursive: true });
    await writeFile(join(snapshot, 'profile.sqlite'), database);
    await writeFile(join(snapshot, 'snapshot-catalog-v1.json'), '[]');
    return { type: 'profileSnapshot',
      database: { logicalPath: 'profile.sqlite', databaseByteSize: database.length, sha256: hashFixtureBytes(database), totalPages: 1 },
      artifactCatalog: { logicalPath: 'snapshot-catalog-v1.json', catalogByteSize: 2, sha256: hashFixtureBytes(Buffer.from('[]')),
        artifactCount: 0, artifactTotalByteSize: 0 } };
  });
  // Only the utility's SQLite boundary is controlled; main's consumer/claims/cleanup stay real.
  vi.spyOn(snapshotInspection, 'runProfileSnapshotInspection').mockImplementation(async input => {
    input.assertAuthority();
    await input.reservation.assertMainOwned();
    const database = await readFile(join(liveStagingRoot, input.operationId, 'profile.sqlite'));
    const profileId = options.validationProfileId !== undefined && (await journal.peek())?.phase === 'validationStarting'
      ? options.validationProfileId : (JSON.parse(database.toString('utf8')) as { profileId: string }).profileId;
    const receipt = { profileId, migrationPolicy: input.migrationPolicy, databaseHealth: 'healthy' as const,
      migrationChainIdentity: 'c'.repeat(64), artifactIdentity: 'e'.repeat(64), artifactCount: 0, artifactTotalByteSize: 0,
      database: { byteSize: database.length, sha256: hashFixtureBytes(database) },
      artifactCatalog: { byteSize: 2, sha256: hashFixtureBytes(Buffer.from('[]')) } };
    input.assertAuthority();
    return { receipt, validation: { type: 'profileSnapshotValidation', activeProfileIsEmpty: false,
      // The copy matches its source; registry lineage is checked separately by main.
      profileMatchesActive: true, ...receipt } };
  });
  const stop = vi.fn(async (): Promise<BackendShutdownOutcome> => {
    events.push('backendStopped');
    return 'exited';
  });
  const relaunch = vi.fn();
  const assertSingleInstanceOwnership = vi.fn();
  const showMessageBox = vi.fn(async () => ({ response: 0, checkboxChecked: false }));
  const stopForUpdate = vi.fn(async () => undefined);
  const createRuntimeSession = options.update
    ? vi.fn(() => 'e'.repeat(64)).mockReturnValueOnce('d'.repeat(64))
    : () => 'd'.repeat(64);
  const assertRegistryUnchanged = async () => {
    await expect(readFile(registryPath)).resolves.toEqual(registryBytes);
  };
  return {
    root,
    registry,
    databasePath: paths.databaseFilePath,
    events,
    journal,
    journalPath: backupPaths.restoreActivationJournalPath,
    stagingRoot: backupPaths.stagingRoot,
    marker: new RecoveryPointCleanShutdownMarker(backupPaths.recoveryPointCleanShutdownMarkerPath),
    pdfPath,
    relaunch,
    assertSingleInstanceOwnership,
    showMessageBox,
    restoredBytes,
    originalBytes,
    stop,
    stopForUpdate,
    createRuntimeSession,
    acceptedBuild: new AcceptedBuildMetadataStore(updatePaths.acceptedBuildMetadataPath),
    updateJournal: new UpdateJournalStore(updatePaths.journalPath),
    mainWindow,
    quit,
    showErrorBox,
    showSaveDialog,
    assertRegistryUnchanged,
    async assertOriginalRestored() {
      await expect(readFile(paths.databaseFilePath, 'utf8')).resolves.toBe(originalBytes);
      await expect(readFile(pdfPath, 'utf8')).resolves.toBe('%PDF-1.7 original pdf');
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
      ), 'utf8')).resolves.toBe('%PDF-1.7 original pdf');
      await assertRegistryUnchanged();
    },
    start: (observeStartupException?: StartDesktopCompositionOptions['observeStartupException'],
      reportSmokeStage: StartDesktopCompositionOptions['reportSmokeStage'] = async () => undefined) => startDesktopComposition({
      ...(observeStartupException === undefined ? {} : { observeStartupException }),
      assertSingleInstanceOwnership,
      appVersion: '0.2.8',
      applicationPath: join(root, 'app'),
      buildInfo: {
        appVersion: '0.2.8',
        buildCreatedAt: '2026-08-18T10:00:00.000Z',
        buildDirty: false,
        buildRevision: 'a'.repeat(12),
        schemaVersion: 1,
      },
      releaseInfo,
      dependencies: {
        ...(options.resolveActiveWorkspace === undefined ? {} : { resolveActiveWorkspace: options.resolveActiveWorkspace }),
        createRuntimeSession,
        showErrorBox,
        showMessageBox,
        showSaveDialog,
        async startBackend(input) {
          events.push('backendStarted');
          try {
            await options.inspectBackendStartup?.(input);
          } catch (error) {
            if (error instanceof DesktopBackendStartupError && error.ownership.processState === 'absent' &&
                error.ownership.reservationReclaimed) {
              await input.reservationTransfer.reclaimAfterExit(new AbortController().signal);
            } else {
              input.reservationTransfer.invalidate();
            }
            throw error;
          }
          if (options.realBackend) return startDesktopBackend({
            ...input,
            ...(options.beforeMigrations === undefined ? {} : { beforeMigrations: options.beforeMigrations }),
          });
          const signal = new AbortController().signal;
          await input.reservationTransfer.prepare(signal);
          await input.reservationTransfer.assertGrant(signal);
          input.reservationTransfer.assertCurrent();
          let reclaim: Promise<void> | undefined;
          const reclaimAfterExit = () => reclaim ??= input.reservationTransfer.reclaimAfterExit(signal);
          const stopOwnedBackend = async () => {
            const outcome = await stop();
            await reclaimAfterExit();
            return outcome;
          };
          const stopOwnedBackendForUpdate = async () => {
            await stopForUpdate();
            await reclaimAfterExit();
          };
          if (options.update) {
            await input.beforeMigrations({
              appliedMigrationCount: 1,
              migrationChainIdentity: options.startupMigrationChainIdentity ?? 'c'.repeat(64),
              pendingMigrationCount: options.pendingMigrationCount ?? 0,
              profileState: 'existing',
            }, { stopStartupRuntime: stopOwnedBackendForUpdate });
            if (options.stoppedStartupRuntime && stopForUpdate.mock.calls.length > 0) {
              // The real runner returns no handle after its startup gate owns the stop.
              throw new DesktopBackendStartupStoppedError();
            }
          }
          return {
            port: 12345, stop: stopOwnedBackend, onUnexpectedExit: vi.fn(),
            stopForUpdate: stopOwnedBackendForUpdate,
            stopForRestore: async () => { throw new Error('RESTORE_FENCE_NOT_CONFIGURED_IN_FIXTURE'); },
          };
        },
      },
      quitApplication: quit,
      relaunchApplication: relaunch,
      resourcesPath: join(root, 'resources'),
      runtimeInstanceId: '33333333-3333-4333-8333-333333333333',
      reportSmokeStage,
      smokeConfiguration: {
        enabled: options.smoke === true,
        phase: 'initial',
        root: options.smoke ? root : undefined,
        userDataPath: options.smoke ? root : undefined,
      },
      userDataPath: root,
    }),
  };
}

function hashFixtureBytes(bytes: Buffer): string { return createHash('sha256').update(bytes).digest('hex'); }

function hasErrorCause(error: unknown, expected: Error): boolean {
  if (error === expected) return true;
  if (error instanceof AggregateError && error.errors.some(child => hasErrorCause(child, expected))) return true;
  return error instanceof Error && error.cause !== undefined && hasErrorCause(error.cause, expected);
}
