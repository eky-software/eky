import * as sourceComparisonFactory from '../workspaces/deletion/workspaceDeletionInventorySources.js';
import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { copyFile, mkdir, mkdtemp, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { setImmediate as nextEventLoopTurn } from 'node:timers/promises';

import type { BrowserWindow, IpcMainInvokeEvent } from 'electron';
import { afterEach, beforeEach, describe, expect, it, vi, type TestContext } from 'vitest';

import { ProfileSnapshotBrokerClient } from '../profileBackup/profileSnapshotBrokerClient.js';
import { ProfileSnapshotInspectionClient } from '../profileBackup/profileSnapshotInspectionClient.js';
import * as ownedProfileValidation from '../profileBackup/validateOwnedActiveProfile.js';
import * as terminalRestore from '../profileBackup/restore/withProfileRestoreTerminalAuthority.js';
import * as coldForwardRestore from '../profileBackup/restore/prepareProfileRestoreColdForwardRecovery.js';
import * as restoreSelectionPreparation from './prepareDesktopWorkspaceRestoreSelection.js';
import * as snapshotInspection from '../profileBackup/runProfileSnapshotInspection.js';
import * as profileBackupComposition from '../profileBackup/profileBackupComposition.js';
import { createProfileBackupIpcChannel } from '../profileBackup/portableProfileBackupTypes.js';
import * as secretBrokerMain from '../secrets/secretBrokerMain.js';
import { createProfileSnapshotRuntimePaths } from '../profileBackup/profileSnapshotRuntimePaths.js';
import { RecoveryPointScheduler } from '../profileBackup/recoveryPoint/recoveryPointScheduler.js';
import { RecoveryPointService } from '../profileBackup/recoveryPoint/recoveryPointService.js';
import { RecoveryPointCleanShutdownMarker } from '../profileBackup/recoveryPoint/recoveryPointCleanShutdownMarker.js';
import { BackendShutdownExitError, type BackendShutdownOutcome } from '../runtime/backendShutdown.js';
import { startDesktopBackend, type DesktopBackendHandle, type StartDesktopBackendOptions } from '../runtime/backendProcess.js';
import { desktopBackendReadinessTimeoutMilliseconds } from '../runtime/backendMessages.js';
import { DesktopBackendStartupError, DesktopBackendStartupStoppedError } from '../runtime/backendStartupFailure.js';
import {
  createWorkspaceCandidateCompletedStatus,
  createWorkspaceCandidateFailedStatus,
  createWorkspaceCandidateReadyStatus,
  createWorkspaceCandidateReservationReadyStatus,
  parseWorkspaceCandidateProcessCommand,
} from '../runtime/workspaceCandidateMessages.js';
import { AcceptedBuildMetadataStore } from '../update/acceptedBuildMetadataStore.js';
import { PreWorkspaceBuildAdmissionError } from '../update/preWorkspaceBuildAdmission.js';
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
import { profileInspectionProtocolVersion, profileInspectionShutdownMilliseconds,
  profileInspectionWorkMilliseconds } from '../runtime/profileInspectionMessages.js';
import { ProfileInspectionProcessError } from '../runtime/profileInspectionProcess.js';
import { encodeProfileInspectionDocumentBindings } from '../runtime/profileInspectionDocumentBindings.js';
import { createProfileSnapshotArtifactIdentity } from '../runtime/profileInspectionArtifactIdentity.js';
import { createDesktopProfilePaths } from '../runtime/desktopProfilePaths.js';
import { createTestJournal } from '../workspaces/creation/emptyWorkspaceCreationTestSupport.js';
import { createWorkspaceLegacyAdoptionJournalPaths, WorkspaceLegacyAdoptionJournalStore } from '../workspaces/adoption/workspaceLegacyAdoptionJournal.js';
import type { WorkspaceLegacyAdoptionAcceptanceAuthority } from '../workspaces/adoption/workspaceLegacyAdoptionPhaseAuthority.js';
import { hasWorkspaceLabelConflict } from '../workspaces/registry/workspaceLabelComparison.js';
import { createWorkspaceCreationJournalPaths, WORKSPACE_CREATION_JOURNAL_FILE_NAME } from '../workspaces/creation/workspaceCreationJournalPaths.js';
import { WorkspaceCreationJournalStore } from '../workspaces/creation/workspaceCreationJournalStore.js';
import { deriveWorkspaceCreationPaths } from '../workspaces/creation/workspaceCreationPaths.js';
import { createWorkspaceBackupImportJournalPaths, WORKSPACE_BACKUP_IMPORT_JOURNAL_FILE_NAME } from '../workspaces/import/workspaceBackupImportJournalPaths.js';
import { WorkspaceBackupImportJournalStore } from '../workspaces/import/workspaceBackupImportJournalStore.js';
import { deriveWorkspaceBackupImportPaths } from '../workspaces/import/workspaceBackupImportPaths.js';
import { createTestImportJournal } from '../workspaces/import/workspaceBackupImportTestSupport.js';
import { WorkspaceBackupPlaintextQuarantine } from '../workspaces/import/workspaceBackupPlaintextQuarantine.js';
import { WorkspaceBackupContainerAdapter } from '../workspaces/import/workspaceBackupContainerAdapter.js';
import { WorkspaceRemnantBindingStore } from '../workspaces/deletion/workspaceRemnantBindingStore.js';
import * as deletionCommands from '../workspaces/deletion/workspaceDeletionCommand.js';
import { createWorkspaceRemnantBindingPaths } from '../workspaces/deletion/workspaceRemnantBindingPaths.js';
import { captureWorkspaceRemnantBinding, workspaceRemnantBindingKey } from '../workspaces/deletion/workspaceRemnantBindingCodec.js';
import { deriveWorkspaceRoot } from '../workspaces/registry/deriveWorkspaceRoot.js';
import { WORKSPACE_REGISTRY_FILE_NAME } from '../workspaces/registry/workspaceRegistryPaths.js';
import { WorkspaceRegistryStore } from '../workspaces/registry/workspaceRegistryStore.js';
import type { LocalWorkspaceRegistryEntryV1 } from '../workspaces/registry/workspaceRegistryTypes.js';
import { validateWorkspaceId } from '../workspaces/registry/workspaceIdValidation.js';
import { deriveWorkspaceBackupReplacementRuntimePaths } from '../workspaces/replacement/workspaceBackupReplacementPaths.js';
import { createWorkspaceSwitchJournalPaths, serializeVersionedWorkspaceSwitchJournal, WorkspaceSwitchJournalStore } from '../workspaces/switch/workspaceSwitchJournal.js';
import { createWorkspaceSelectorSwitchJournal, createWorkspaceSelectorSwitchRegistryVariants } from '../workspaces/switch/workspaceSelectorSwitchState.js';
import { ActiveWorkspaceStartupRelaunchRequiredError, resolveActiveWorkspaceStartup, type ActiveWorkspaceStartupOptions } from '../workspaces/runtime/resolveActiveWorkspaceStartup.js';
import * as selectorRecoveryAdmission from '../workspaces/runtime/workspaceColdRecoveryAdmissionComposition.js';
import { WorkspaceFirstStartMigrationOrchestrator } from '../workspaces/update/workspaceFirstStartMigrationOrchestrator.js';
import { WorkspaceFirstStartMigrationOrchestratorError } from '../workspaces/update/workspaceFirstStartMigrationOrchestratorError.js';
import * as activationComposition from '../workspaces/update/workspaceActivationMigrationComposition.js';
import { WorkspaceActivationMigrationInspector } from '../workspaces/update/workspaceActivationMigrationInspector.js';
import type { WorkspaceActivationMigrationRecoveryReceipt } from '../workspaces/update/workspaceActivationMigrationCoordinator.js';
import { WorkspaceMigrationInventoryCoordinator } from '../workspaces/update/workspaceMigrationInventoryCoordinator.js';
import { WorkspaceFirstStartMigrationJournalStore } from '../workspaces/update/workspaceFirstStartMigrationJournalStore.js';
import { createWorkspaceFirstStartMigrationJournalPaths } from '../workspaces/update/workspaceFirstStartMigrationJournalPaths.js';
import { InMemoryWorkspaceMaintenanceLease } from '../workspaces/maintenance/workspaceMaintenanceLease.js';
import { WorkspaceManagementService, type WorkspaceManagementServiceOptions } from '../workspaces/management/workspaceManagementService.js';
import * as producerManagement from '../workspaces/management/workspaceManagementComposition.js';
import * as prodPreparation from '../workspaces/management/workspaceDeletionPreparation.js';
import type { SlotIoEvent, SlotIoObserver } from '../workspaces/persistence/crashSafeFileSlot.js';
import { captureDeletionTarget } from '../workspaces/management/workspaceDeletionTarget.js';
import { captureWorkspaceDeletionJournal, type WorkspaceDeletionJournal } from '../workspaces/deletion/workspaceDeletionJournalCodec.js';
import { deletionInventoryFormatVersion } from '../workspaces/deletion/workspaceDeletionInventoryCodec.js';
import { captureWorkspaceDeletionRegistryTransition } from '../workspaces/deletion/workspaceDeletionRegistrySelection.js';
import { createWorkspaceDeletionCommand } from '../workspaces/deletion/workspaceDeletionCommand.js';
import * as deletionCommand from '../workspaces/deletion/workspaceDeletionCommand.js';
import { createWorkspaceDeletionInventoryPaths } from '../workspaces/deletion/workspaceDeletionInventoryStore.js';
import { createWorkspaceDeletionJournalPaths, WorkspaceDeletionJournalStore } from '../workspaces/deletion/workspaceDeletionJournalStore.js';
import { MainOwnedActiveWorkspaceLifecycle } from '../workspaces/runtime/mainOwnedActiveWorkspaceLifecycle.js';
import { MainOwnedSelectorWorkspaceLifecycle } from '../workspaces/runtime/mainOwnedSelectorWorkspaceLifecycle.js';
import * as selectorLifecycle from '../workspaces/runtime/mainOwnedSelectorWorkspaceLifecycle.js';
import { createWorkspaceManagementCapability, type WorkspaceManagementCapability } from '../workspaces/management/workspaceManagementCapability.js';
import { acquireDesktopWorkspaceReservation, startDesktopComposition, type DesktopLifecycleHandle,
  type DesktopWorkspaceStartupSupportReceipt, type StartDesktopCompositionOptions } from './desktopComposition.js';
import { createWorkspaceDeletionPhaseProducer, startDesktopSelectorComposition,
  type WorkspaceDeletionPhaseEvent, type WorkspaceDeletionPhaseObserver } from './desktopSelectorComposition.js';
import { createDesktopRecoveryStartup } from './desktopRecoveryStartup.js';
import { createDesktopWorkspaceRecoverySelection } from './desktopWorkspaceRecoverySelection.js';
import { selectDesktopWorkspaceRecoveryChoice } from './desktopWorkspaceRecoveryChoice.js';
import * as recoverySelection from './desktopWorkspaceRecoverySelection.js';
import * as recoverySources from './desktopWorkspaceRecoverySources.js';
import * as deletionContinuation from './workspaceDeletionContinuation.js';
import { IncidentIndexDesktopLogFailureSink } from '../observability/infrastructure/incidentIndexDesktopLogFailureSink.js';
import { JsonLineDesktopOperationalLogger } from '../observability/infrastructure/jsonLineDesktopOperationalLogger.js';
import { WORKSPACE_BACKUP_IMPORT_JOURNAL_STATES, getWorkspaceBackupImportStateIndex } from '../workspaces/import/workspaceBackupImportJournalValidation.js';
import { BackendRequestQuiescence } from './backendRequestQuiescence.js';
import { createDesktopBeforeQuitHandler } from './desktopBeforeQuit.js';
import { createRestoreStartupTestLifetime, releaseRestoreStartupTestResources,
  runRestoreStartupTestWithShutdown } from './desktopRestoreStartupTestSupport.js';
import { registerApplicationProtocol } from './applicationProtocol.js';
import * as packagedSmoke from './packagedSmoke.js';
import { projectExceptionChain } from './startupExceptionEvidence.js';
import type { DesktopStartupSignal } from './desktopStartupObservation.js';
import { deleteWorkspaceIpcChannel, getWorkspaceManagementStatusIpcChannel, importWorkspaceBackupAsNewIpcChannel, renameWorkspaceIpcChannel, replaceActiveWorkspaceFromBackupIpcChannel } from '../workspaces/management/workspaceManagementCapabilityProtocol.js';
import { createSupportBundleIpcChannel } from '../diagnostics/desktopDiagnosticsTypes.js';
import * as supportBundleCapability from '../supportBundle/supportBundleCapability.js';
import * as supportBundleDesktopData from '../supportBundle/supportBundleDesktopData.js';
import * as supportBundleFileStore from '../supportBundle/supportBundleFileStore.js';
import { createSupportBundleSmokeFailureCapture } from './packagedSupportBundleSmokeTestSupport.js';

const electronBoundary = vi.hoisted(() => ({
  fetch: vi.fn(),
  createWindow: vi.fn(),
  loadWindow: vi.fn(async () => undefined),
  ipcHandlers: new Map<string, unknown>(),
  handle: vi.fn(),
  fork: vi.fn(),
  removeHandler: vi.fn(),
  portClosed: vi.fn(),
  reservationReleased: vi.fn(),
  reservationAcquired: vi.fn(),
  reservationIdentityRead: vi.fn(),
  useActualReservationIdentity: false,
  loseReservation: undefined as (() => void) | undefined,
  observeReservationOwned: undefined as (() => void | Promise<void>) | undefined,
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
vi.mock('../runtime/workspaceProcessReservation.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../runtime/workspaceProcessReservation.js')>();
  return {
    ...actual,
    readWorkspaceProcessReservationIdentity: async (root: string) => {
      await electronBoundary.reservationIdentityRead(root);
      return electronBoundary.useActualReservationIdentity ? actual.readWorkspaceProcessReservationIdentity(root) : 'a'.repeat(64);
    },
    async acquireWorkspaceProcessReservation(
      options: Parameters<typeof import('../runtime/workspaceProcessReservation.js').acquireWorkspaceProcessReservation>[0],
    ) {
      await electronBoundary.reservationAcquired(options);
      const released = new AbortController();
      electronBoundary.loseReservation = () => released.abort();
      return {
        identity: electronBoundary.useActualReservationIdentity
          ? await actual.readWorkspaceProcessReservationIdentity(options.userDataRoot) : 'a'.repeat(64),
        invalidated: released.signal,
        async assertOwned() {
          const observation = electronBoundary.observeReservationOwned?.();
          if (observation !== undefined) await observation;
          if (released.signal.aborted) throw new Error('synthetic reservation released');
        },
        async release() { await electronBoundary.reservationReleased(options.userDataRoot); released.abort(); },
      };
    },
  };
});

const roots: string[] = [];
let clients: ProfileSnapshotBrokerClient[] = [];
let trackedStartupTest: ReturnType<typeof createRestoreStartupTestLifetime> | undefined;
const workspaceId = validateWorkspaceId('11111111-1111-4111-8111-111111111111');
const operationId = '22222222-2222-4222-8222-222222222222';
const originalProfileId = 'a'.repeat(64);
const foreignProfileId = 'b'.repeat(64);
const windowBoundary = 'DESKTOP_SMOKE_TEST_WINDOW_BOUNDARY';
const restoreStartupCompositionTimeoutMs = 10_000;
const recoveryPublicationCompositionTimeoutMs = 30_000;

beforeEach(prepareRestoreStartupTestState);

function prepareRestoreStartupTestState() {
  // Do not reset shared spies while a timed-out tracked body can still use them.
  trackedStartupTest?.assertSharedStateReleased();
  // Restoring descriptors does not release Vitest's retained mock histories.
  vi.clearAllMocks();
  trackedStartupTest = undefined;
  logMaintenanceIo.deniedDirectory = '';
  logMaintenanceIo.observed = false;
  // Update fixtures must provide their own Windows boundary on every host.
  vi.stubEnv('SystemRoot', undefined);
  const ownedClients: ProfileSnapshotBrokerClient[] = [];
  clients = ownedClients;
  electronBoundary.reservationAcquired.mockReset();
  vi.mocked(registerApplicationProtocol).mockReset();
  electronBoundary.reservationIdentityRead.mockReset();
  electronBoundary.useActualReservationIdentity = false;
  electronBoundary.loseReservation = undefined;
  electronBoundary.observeReservationOwned = undefined;
  electronBoundary.reservationReleased.mockReset();
  electronBoundary.ipcHandlers.clear();
  electronBoundary.removeHandler.mockReset().mockImplementation((channel: string) => {
    electronBoundary.ipcHandlers.delete(channel);
  });
  electronBoundary.handle.mockReset().mockImplementation((channel: string, handler: unknown) => {
    electronBoundary.ipcHandlers.set(channel, handler);
  });
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
}

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

function observeSelectorPreparationForTest() {
  const Constructor = selectorLifecycle.MainOwnedSelectorWorkspaceLifecycle;
  type Options = ConstructorParameters<typeof Constructor>[0];
  const instances: { options: Options; proof: ReturnType<typeof vi.fn<() => Promise<void>>> | undefined }[] = [];
  const combined = vi.spyOn(Constructor.prototype, 'assertRecoveryPreparationOwned');
  const strict = vi.spyOn(Constructor.prototype, 'assertNoActiveWorkspaceRuntime');
  vi.spyOn(selectorLifecycle, 'MainOwnedSelectorWorkspaceLifecycle').mockImplementation(function(options) {
    const proof = options.kind === 'recoveryManagement'
      ? vi.fn(options.assertMainOwnedAndRuntimeAbsent.bind(options)) : undefined;
    const lifecycle = new Constructor(options.kind === 'recoveryManagement'
      ? { ...options, assertMainOwnedAndRuntimeAbsent: proof! } : options);
    instances.push({ options, proof });
    return lifecycle;
  });
  const failures: unknown[] = [];
  const deleteWorkspace = WorkspaceManagementService.prototype.deleteWorkspace;
  vi.spyOn(WorkspaceManagementService.prototype, 'deleteWorkspace').mockImplementation(async function(
    this: WorkspaceManagementService, ...args
  ) {
    try { return await deleteWorkspace.apply(this, args); }
    catch (cause) { failures.push(cause); throw cause; }
  });
  return { instances, combined, strict, failures };
}

it('clears completed startup mock histories only after the tracked body and resources settle', async context => {
  const retained = vi.fn(() => 'synthetic retained implementation');
  retained();
  const implementation = retained.getMockImplementation();
  const lifetime = beginTrackedStartupTest(context);
  const entered = createCompletionGate(), held = createCompletionGate();
  const work = lifetime.run(async () => { entered.resolve(); await held.promise; });
  void work.catch(() => undefined);
  const release = () => { entered.resolve(); held.resolve(); };
  context.signal.addEventListener('abort', release, { once: true });
  try {
    await entered.promise;
    lifetime.releaseWhenSettled();
    expect(() => prepareRestoreStartupTestState()).toThrow('DESKTOP_RESTORE_TEST_PREVIOUS_WORK_UNSETTLED');
    expect(retained.mock.calls).toHaveLength(1);
    expect(retained.getMockImplementation()).toBe(implementation);
  } finally {
    release(); await work; context.signal.removeEventListener('abort', release);
  }
  expect(retained.mock.calls).toHaveLength(1);
  prepareRestoreStartupTestState();
  expect(retained.mock.calls).toHaveLength(0);
  expect(retained.getMockImplementation()).toBe(implementation);
  expect(retained()).toBe('synthetic retained implementation');
});

describe('migration binding main ownership', () => {
  it.for(['lostAcknowledgement', 'selectionChanged'] as const)(
    'retains the first error through real migration composition: %s', async (scenario, context) => {
      const lifetime = beginTrackedStartupTest(context);
      await lifetime.run(async () => {
        let stopped = false;
        const f = await lifetime.step('fixturePreparation', () => createFixture(originalProfileId, {
          ownedRoots: lifetime.roots, replacementTarget: true, update: true, skipRestore: true,
          completeStartup: true, pendingMigrationCount: 1,
          inspectBackendStartup(input) {
            const before = input.beforeMigrations;
            input.beforeMigrations = async (inspection, control) => {
              try {
                return await before(inspection, { ...control, async stopStartupRuntime() {
                  await control.stopStartupRuntime(); stopped = true;
                } });
              } catch (cause) {
                // Model the backend runner's failure close/reclaim; the migration
                // owner itself must not mutate recovery state after uncertainty.
                if (!stopped) { await control.stopStartupRuntime(); stopped = true; }
                const error = new DesktopBackendStartupError('BACKEND_MIGRATION_STARTUP_GATE_FAILED', {
                  processState: stopped ? 'absent' : 'unknown', migrationGateSettled: true,
                  reservationReclaimed: stopped,
                });
                error.cause = cause;
                throw error;
              }
            };
            return Promise.resolve();
          },
        }));
        vi.spyOn(WorkspaceActivationMigrationInspector.prototype, 'inspect').mockResolvedValue({
          status: 'compatiblePending', appliedMigrationCount: 1, pendingMigrationCount: 1,
        });
        const candidateOperations = installCompletedColdCandidate('historicalReadiness', originalProfileId);
        const firstFailure = new Error(`SYNTHETIC_MIGRATION_${scenario}`);
        const registryPath = join(f.root, WORKSPACE_REGISTRY_FILE_NAME);
        const originalRegistry = await readFile(registryPath);
        let expectedRegistry = originalRegistry;
        const snapshot = vi.spyOn(RecoveryPointService.prototype, 'createPreMigration').mockImplementation(async () => {
          expectedRegistry = Buffer.concat([originalRegistry, Buffer.from('\n')]);
          await writeFile(registryPath, expectedRegistry);
          throw firstFailure;
        });
        const publish = WorkspaceRemnantBindingStore.prototype.publish;
        const published = vi.spyOn(WorkspaceRemnantBindingStore.prototype, 'publish').mockImplementation(async function (
          this: WorkspaceRemnantBindingStore, value, authority,
        ) {
          const result = await publish.call(this, value, authority);
          if (scenario === 'lostAcknowledgement') throw firstFailure;
          return result;
        });
        const observe = vi.fn();
        await lifetime.step('startup', async () => { await expect(f.start(observe)).rejects.toThrow(); });
        expect(published).toHaveBeenCalledOnce();
        expect(snapshot).toHaveBeenCalledTimes(scenario === 'selectionChanged' ? 1 : 0);
        expect(candidateOperations).toEqual(['validateHistoricalPublished']);
        expect(stopped).toBe(true);
        expect(f.stopForUpdate).toHaveBeenCalledOnce();
        expect(f.relaunch).not.toHaveBeenCalled();
        expect(electronBoundary.createWindow).not.toHaveBeenCalled();
        expect(observe.mock.calls.some(([error]) => hasErrorCause(error, firstFailure))).toBe(true);
        const binding = captureWorkspaceRemnantBinding(published.mock.calls[0]![0]);
        const bindingPaths = createWorkspaceRemnantBindingPaths(f.root, workspaceRemnantBindingKey(binding));
        expect(JSON.parse(await readFile(bindingPaths.currentPath, 'utf8'))).toMatchObject({
          owner: 'workspaceActivationMigration', workspaceId,
        });
        expect(await readFile(registryPath)).toEqual(expectedRegistry);
        expect(await readFile(f.databasePath, 'utf8')).toBe(f.originalBytes);
        expect(await readFile(f.pdfPath, 'utf8')).toBe('%PDF-1.7 original pdf');
      });
    });

  it.for(['beforeStop', 'afterStop'] as const)('blocks logical recovery without blocking child reclaim: %s', async (stage, context) => {
    const lifetime = beginTrackedStartupTest(context);
    await lifetime.run(async () => {
      const recover = vi.fn(async () => 'relaunchRequired' as const);
      const resolve: NonNullable<StartDesktopCompositionOptions['dependencies']>['resolveActiveWorkspace'] = async root => {
        const current = await resolveActiveWorkspaceStartup(root);
        return { ...current, mode: 'targetValidation', recoverFromFailure: recover, switchContext: {
          operationId, sourceWorkspaceId: null, targetWorkspaceId: workspaceId, targetProfileId: originalProfileId,
        } };
      };
      const f = await lifetime.step('fixturePreparation', () => createFixture(originalProfileId, {
        ownedRoots: lifetime.roots, update: true, skipRestore: true, completeStartup: true, resolveActiveWorkspace: resolve,
      }));
      const primary = new Error('SYNTHETIC_MIGRATION_BINDING_UNCERTAIN');
      let reclaimed = false;
      vi.spyOn(activationComposition, 'createWorkspaceActivationMigrationComposition').mockImplementation(async options => ({
        async prepareBeforeBackend() { return { status: 'migrationRequired', migrationStartupPolicy: 'restoreCompatible' }; },
        async beforeMigrations(_inspection: unknown, control: { stopStartupRuntime(): Promise<void> }) {
          expect(options.assertStartupCurrent()).toBeUndefined();
          expect(() => options.assertMainReservationCurrent()).toThrow();
          if (stage === 'beforeStop') options.blockContinuation();
          await control.stopStartupRuntime();
          expect(options.assertMainReservationCurrent()).toBeUndefined();
          await options.assertMainReservationOwned();
          reclaimed = true;
          if (stage === 'afterStop') options.blockContinuation();
          expect(() => options.assertStartupCurrent()).toThrow('WORKSPACE_SWITCH_RECOVERY_REQUIRED');
          const error = new DesktopBackendStartupError('BACKEND_MIGRATION_STARTUP_GATE_FAILED', {
            processState: 'absent', migrationGateSettled: true, reservationReclaimed: true,
          });
          error.cause = primary;
          throw error;
        },
      }) as unknown as Awaited<ReturnType<typeof activationComposition.createWorkspaceActivationMigrationComposition>>);
      const observe = vi.fn();
      await lifetime.step('startup', async () => { await expect(f.start(observe)).rejects.toThrow(); });
      expect(reclaimed).toBe(true);
      expect(f.stopForUpdate).toHaveBeenCalledOnce();
      expect(recover).not.toHaveBeenCalled();
      expect(f.relaunch).not.toHaveBeenCalled();
      expect(electronBoundary.createWindow).not.toHaveBeenCalled();
      expect(observe.mock.calls.some(([error]) => hasErrorCause(error, primary))).toBe(true);
      expect(await readFile(f.databasePath, 'utf8')).toBe(f.originalBytes);
      expect(await readFile(f.pdfPath, 'utf8')).toBe('%PDF-1.7 original pdf');
      await f.assertRegistryUnchanged();
    });
  });
});

describe('selector candidate rollback main handoff', () => {
  for (const scenario of ['noActivation', 'rolledBack', 'wrongReceipt', 'foreignProfile', 'contentFailure', 'ownerStillActive', 'releaseFailure',
    'anchorReleaseFailure', 'duplicate', 'duplicateAtRootRemoval', 'secretDrainFailure', 'inspectionDrainFailure', 'changedTarget'] as const) {
    it(`validates '${scenario}' with the existing cold owner before returning from the main callback`, async context => {
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
    }, scenario === 'rolledBack' || scenario === 'anchorReleaseFailure' ? restoreStartupCompositionTimeoutMs : undefined);
  }
});

describe('business-accepted selector startup', () => {
  it.for([
    { version: 1, source: 'current' }, { version: 2, source: 'current' },
    { version: 2, source: 'acceptedUpdate' }, { version: 2, source: 'prepared' },
    { version: 2, source: 'backup' },
  ] as const)('opens business metadata v$version from $source through normal FirstStart', async ({ version, source }, context) => {
    const lifetime = beginTrackedStartupTest(context);
    await lifetime.run(async () => {
      const f = await lifetime.step('fixturePreparation', () => createDeferredStartupFixture(lifetime.roots, true));
      const metadata = version === 1 ? f.metadata.acceptedBuild
        : createBusinessAcceptedBuildMetadata(f.metadata, f.metadata.acceptedBuild);
      // Seed the historical format directly; production correctly forbids v2 -> v1.
      await writeFile(f.paths.acceptedBuildMetadataPath, `${JSON.stringify(metadata)}\n`);
      if (source === 'acceptedUpdate') await seedAcceptedUpdateJournal(f);
      const journal = await seedSelectorTarget(f.fixture);
      const switchPaths = createWorkspaceSwitchJournalPaths(f.fixture.root);
      if (source === 'prepared') {
        await writeFile(switchPaths.currentPath, serializeVersionedWorkspaceSwitchJournal({
          ...(await journal.inspectSlots()).current!.value, state: 'prepared',
        }));
      } else if (source === 'backup') await rename(switchPaths.currentPath, switchPaths.backupPath);
      const before = await f.fixture.acceptedBuild.inspectSlots();
      const update = await f.fixture.updateJournal.inspectSlots();
      const registry = await f.fixture.registry.inspect();
      const firstStart = vi.spyOn(FirstStartUpdateCoordinator.prototype, 'beforeMigrations');
      const publish = vi.spyOn(AcceptedBuildMetadataStore.prototype, 'publishSelected');
      const observed = vi.fn();
      let lifecycle: Awaited<ReturnType<typeof f.fixture.start>>;
      try {
        await lifetime.step('startup', async () => {
          lifecycle = await f.fixture.start(observed).catch(error => { throw observed.mock.calls[0]?.[0] ?? error; });
        });
        expect(lifecycle).toBeDefined();
        expect(observed).not.toHaveBeenCalled();
        expect(firstStart).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ pendingMigrationCount: 0 }),
          { migrationAuthority: 'update' });
        expect(WorkspaceMigrationInventoryCoordinator.prototype.inspect).not.toHaveBeenCalled();
        expect(publish).not.toHaveBeenCalled();
        expect(electronBoundary.createWindow).toHaveBeenCalledOnce();
        expect(f.fixture.events).toContain('backendStarted');
        expect(await f.fixture.acceptedBuild.inspectSlots()).toEqual(before);
        expect(await f.fixture.updateJournal.inspectSlots()).toEqual(update);
        expect(await f.fixture.registry.inspect()).toEqual(registry);
        expect(await journal.inspectSlots()).toEqual({ current: undefined, next: undefined, backup: undefined });
        expect(await new WorkspaceFirstStartMigrationJournalStore({ userDataPath: f.fixture.root }).inspect()).toBeUndefined();
        expect(await readFile(f.fixture.databasePath, 'utf8')).toBe(f.fixture.originalBytes);
        expect(await readFile(f.fixture.pdfPath, 'utf8')).toBe('%PDF-1.7 original pdf');
      } finally { await lifecycle?.shutdown(); }
    });
  });

  it('waits for rejected real scheduler snapshot cleanup before opening a business-accepted selector', async context => {
    const lifetime = beginTrackedStartupTest(context);
    await lifetime.run(async () => {
      const f = await lifetime.step('fixturePreparation', () => createDeferredStartupFixture(lifetime.roots, true));
      await writeFile(f.paths.acceptedBuildMetadataPath, `${JSON.stringify(f.metadata.acceptedBuild)}\n`);
      const journal = await seedSelectorTarget(f.fixture);
      const before = { metadata: await f.fixture.acceptedBuild.inspectSlots(),
        registry: await f.fixture.registry.inspect(), update: await f.fixture.updateJournal.inspectSlots() };
      const events: string[] = [];
      const validationEntered = createCompletionGate(), releaseValidation = createCompletionGate();
      const snapshotEntered = createCompletionGate(), releaseSnapshot = createCompletionGate();
      const cleanupEntered = createCompletionGate(), releaseCleanup = createCompletionGate();
      const release = () => { releaseValidation.resolve(); releaseSnapshot.resolve(); releaseCleanup.resolve(); };
      const validate = ownedProfileValidation.validateOwnedActiveProfile;
      const validation = vi.spyOn(ownedProfileValidation, 'validateOwnedActiveProfile').mockImplementation(async input => {
        const result = await validate(input);
        validationEntered.resolve();
        await releaseValidation.promise;
        events.push('firstValidationCompleted');
        return result;
      });
      const clear = WorkspaceSwitchJournalStore.prototype.clearSelector;
      const cleared = vi.spyOn(WorkspaceSwitchJournalStore.prototype, 'clearSelector')
        .mockImplementation(async function (this: WorkspaceSwitchJournalStore, ...args) {
          await clear.apply(this, args);
          events.push('switchJournalCleared');
        });
      const snapshots: string[] = [];
      const snapshot = vi.mocked(ProfileSnapshotBrokerClient.prototype.createProfileSnapshot).getMockImplementation()!;
      vi.mocked(ProfileSnapshotBrokerClient.prototype.createProfileSnapshot).mockImplementation(async function (
        this: ProfileSnapshotBrokerClient, ...args
      ) {
        snapshots.push(args[0]);
        if (snapshots.length === 2) {
          events.push('automaticSnapshotStarted');
          snapshotEntered.resolve();
          await releaseSnapshot.promise;
        }
        const result = await snapshot.apply(this, args);
        if (snapshots.length === 2) events.push('automaticSnapshotCreated');
        return result;
      });
      const inspect = vi.mocked(snapshotInspection.runProfileSnapshotInspection).getMockImplementation()!;
      const inspected = vi.mocked(snapshotInspection.runProfileSnapshotInspection).mockImplementation(async input => {
        const result = await inspect(input);
        if (input.operationId === snapshots[1]) events.push('automaticSnapshotInspected');
        return result;
      });
      const remove = ProfileSnapshotInspectionClient.prototype.removeProfileSnapshot;
      const removed = vi.spyOn(ProfileSnapshotInspectionClient.prototype, 'removeProfileSnapshot')
        .mockImplementation(async function (this: ProfileSnapshotInspectionClient, id) {
          if (id === snapshots[1]) {
            cleanupEntered.resolve();
            await releaseCleanup.promise;
          }
          await remove.call(this, id);
          if (id === snapshots[1]) events.push('automaticSnapshotRemoved');
        });
      vi.spyOn(ProfileSnapshotBrokerClient.prototype, 'beginMaintenance').mockResolvedValue('busy');
      const end = vi.spyOn(ProfileSnapshotBrokerClient.prototype, 'endMaintenance').mockImplementation(async () => {
        events.push('automaticFenceReleased');
        return 'normal';
      });
      const automaticFailures: unknown[] = [];
      const automatic = RecoveryPointService.prototype.checkAutomatic;
      const checked = vi.spyOn(RecoveryPointService.prototype, 'checkAutomatic')
        .mockImplementation(async function (this: RecoveryPointService, ...args) {
          events.push('automaticCheckStarted');
          try { return await automatic.apply(this, args); }
          catch (error) { automaticFailures.push(error); throw error; }
          finally { events.push('automaticCheckSettled'); }
        });
      vi.mocked(RecoveryPointScheduler.prototype.start).mockRestore();
      vi.mocked(RecoveryPointScheduler.prototype.stopChecks).mockRestore();
      const createWindow = electronBoundary.createWindow.getMockImplementation()!;
      electronBoundary.createWindow.mockImplementation((...args) => {
        events.push('windowCreated');
        return createWindow(...args);
      });
      const firstStart = vi.spyOn(FirstStartUpdateCoordinator.prototype, 'beforeMigrations');
      const publish = vi.spyOn(AcceptedBuildMetadataStore.prototype, 'publishSelected');
      const observed = vi.fn();
      let lifecycle: DesktopLifecycleHandle | undefined;
      context.signal.addEventListener('abort', release, { once: true });
      const startup = lifetime.step('startup', async () => { lifecycle = await f.fixture.start(observed); });
      void startup.catch(() => undefined);
      const earlyStartup = startup.then(() => { throw new Error('STARTUP_COMPLETED_BEFORE_HELD_PHASE'); });
      void earlyStartup.catch(() => undefined);
      await runRestoreStartupTestWithShutdown(async () => {
        await Promise.race([validationEntered.promise, earlyStartup]);
        expect(electronBoundary.createWindow).not.toHaveBeenCalled();
        expect(cleared).not.toHaveBeenCalled();
        expect(checked).not.toHaveBeenCalled();
        expect((await journal.inspectSlots()).current?.value.state).toBe('targetSelected');
        releaseValidation.resolve();
        await Promise.race([snapshotEntered.promise, earlyStartup]);
        expect(events).toEqual(['firstValidationCompleted', 'switchJournalCleared',
          'automaticCheckStarted', 'automaticSnapshotStarted']);
        expect(await journal.inspectSlots()).toEqual({ current: undefined, next: undefined, backup: undefined });
        expect(electronBoundary.createWindow).not.toHaveBeenCalled();
        expect(inspected).toHaveBeenCalledOnce();
        releaseSnapshot.resolve();
        await Promise.race([cleanupEntered.promise, earlyStartup]);
        expect(events.at(-1)).toBe('automaticSnapshotInspected');
        expect(inspected).toHaveBeenCalledTimes(2);
        expect(electronBoundary.createWindow).not.toHaveBeenCalled();
        expect(end).not.toHaveBeenCalled();
        expect(automaticFailures).toEqual([]);
        expect((await stat(join(f.fixture.stagingRoot, snapshots[1]!))).isDirectory()).toBe(true);
        releaseCleanup.resolve();
        await startup;
        expect(lifecycle).toBeDefined();
        expect(observed).not.toHaveBeenCalled();
        expect(validation).toHaveBeenCalledOnce();
        expect(cleared).toHaveBeenCalledOnce();
        expect(checked).toHaveBeenCalledOnce();
        expect(snapshots).toHaveLength(2);
        expect(snapshots[1]).not.toBe(snapshots[0]);
        expect(removed.mock.calls.map(([id]) => id)).toEqual(snapshots);
        expect(end).toHaveBeenCalledExactlyOnceWith(snapshots[1]);
        // The existing inspection fixture has a placeholder artifact identity, not a persistable receipt.
        expect(automaticFailures).toHaveLength(1);
        expect(automaticFailures[0]).toMatchObject({ message: 'PROFILE_BACKUP_SOURCE_INVALID' });
        expect(events).toEqual(['firstValidationCompleted', 'switchJournalCleared', 'automaticCheckStarted',
          'automaticSnapshotStarted', 'automaticSnapshotCreated', 'automaticSnapshotInspected',
          'automaticSnapshotRemoved', 'automaticFenceReleased', 'automaticCheckSettled', 'windowCreated']);
        await expect(stat(join(f.fixture.stagingRoot, snapshots[1]!))).rejects.toMatchObject({ code: 'ENOENT' });
        expect(firstStart).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ pendingMigrationCount: 0 }),
          { migrationAuthority: 'update' });
        expect(WorkspaceMigrationInventoryCoordinator.prototype.inspect).not.toHaveBeenCalled();
        expect(publish).not.toHaveBeenCalled();
        expect(electronBoundary.createWindow).toHaveBeenCalledOnce();
        expect(await f.fixture.acceptedBuild.inspectSlots()).toEqual(before.metadata);
        expect(await f.fixture.updateJournal.inspectSlots()).toEqual(before.update);
        expect(await f.fixture.registry.inspect()).toEqual(before.registry);
        expect(await new WorkspaceFirstStartMigrationJournalStore({ userDataPath: f.fixture.root }).inspect()).toBeUndefined();
        expect(await readFile(f.fixture.databasePath, 'utf8')).toBe(f.fixture.originalBytes);
        expect(await readFile(f.fixture.pdfPath, 'utf8')).toBe('%PDF-1.7 original pdf');
      }, async () => {
        release();
        context.signal.removeEventListener('abort', release);
        try { await startup; }
        finally { await lifecycle?.shutdown(); }
      });
    });
  });

  it.for(['metadataNext', 'updateNext', 'directSetupNext', 'w6Next', 'metadataAtW6', 'metadataAtClear', 'ownerAtClear',
    'restoreAtClear', 'updateAtRollback'] as const)(
    'preserves original and newly conflicting evidence at $0', async (fault, context) => {
      const lifetime = beginTrackedStartupTest(context);
      await lifetime.run(async () => {
        const f = await lifetime.step('fixturePreparation', () => createDeferredStartupFixture(lifetime.roots, true));
        await f.fixture.acceptedBuild.write(createBusinessAcceptedBuildMetadata(f.metadata, f.metadata.acceptedBuild));
        if (fault === 'updateAtRollback') await seedAcceptedUpdateJournal(f);
        const journal = await seedSelectorTarget(f.fixture);
        const before = { metadata: await readFile(f.paths.acceptedBuildMetadataPath),
          registry: await f.fixture.registry.inspectSlots(), journal: await journal.inspectSlots() };
        const path = fault === 'updateNext' || fault === 'updateAtRollback' ? `${f.paths.journalPath}.next`
          : fault === 'directSetupNext' ? `${f.paths.directSetupMigrationRecoveryPath}.next`
            : fault === 'w6Next' ? createWorkspaceFirstStartMigrationJournalPaths(f.fixture.root).nextPath
              : fault === 'restoreAtClear' ? f.fixture.journalPath
              : `${f.paths.acceptedBuildMetadataPath}.next`;
        let injected = false;
        const inject = async () => {
          injected = true;
          if (fault === 'ownerAtClear') f.fixture.assertSingleInstanceOwnership.mockImplementation(() => { throw new Error('SYNTHETIC_OWNER_LOST'); });
          else { await mkdir(dirname(path), { recursive: true }); await writeFile(path, '{synthetic conflicting slot'); }
        };
        if (fault === 'metadataAtW6') {
          const recover = WorkspaceFirstStartMigrationOrchestrator.prototype.recoverBeforeWorkspaceResolution;
          vi.spyOn(WorkspaceFirstStartMigrationOrchestrator.prototype, 'recoverBeforeWorkspaceResolution')
            .mockImplementationOnce(async function (this: WorkspaceFirstStartMigrationOrchestrator) {
              await inject(); return recover.call(this);
            });
        } else if (fault === 'updateAtRollback') {
          const start = UpdateBinaryRollbackCoordinator.prototype.startIfRequired;
          vi.spyOn(UpdateBinaryRollbackCoordinator.prototype, 'startIfRequired').mockImplementationOnce(async function (this: UpdateBinaryRollbackCoordinator) {
            injected = true;
            await writeFile(path, await readFile(f.paths.journalPath));
            return start.call(this);
          });
        } else if (fault.endsWith('AtClear')) {
          const clear = WorkspaceSwitchJournalStore.prototype.clearSelector;
          vi.spyOn(WorkspaceSwitchJournalStore.prototype, 'clearSelector').mockImplementationOnce(async function (this: WorkspaceSwitchJournalStore, ...args) {
            await inject(); return clear.apply(this, args);
          });
        } else {
          const beforeMigrations = FirstStartUpdateCoordinator.prototype.beforeMigrations;
          vi.spyOn(FirstStartUpdateCoordinator.prototype, 'beforeMigrations').mockImplementationOnce(async function (this: FirstStartUpdateCoordinator, ...args) {
            await inject(); return beforeMigrations.apply(this, args);
          });
        }
        let lifecycle: Awaited<ReturnType<typeof f.fixture.start>>;
        const observed = vi.fn();
        let startupFailure: unknown;
        try {
          await lifetime.step('startup', async () => {
            try { lifecycle = await f.fixture.start(observed); }
            catch (error) { startupFailure = error; }
          });
          if (!injected && observed.mock.calls.length > 0) throw observed.mock.calls[0]![0];
          expect(injected).toBe(true);
          expect(electronBoundary.createWindow).not.toHaveBeenCalled();
          expect(f.fixture.relaunch).not.toHaveBeenCalled();
          expect(await readFile(f.paths.acceptedBuildMetadataPath)).toEqual(before.metadata);
          expect(await f.fixture.registry.inspectSlots()).toEqual(before.registry);
          expect(await journal.inspectSlots()).toEqual(before.journal);
          if (fault === 'updateAtRollback') expect(await readFile(path)).toEqual(await readFile(f.paths.journalPath));
          else if (fault !== 'ownerAtClear') expect(await readFile(path, 'utf8')).toBe('{synthetic conflicting slot');
          expect(await readFile(f.fixture.databasePath, 'utf8')).toBe(f.fixture.originalBytes);
          expect(await readFile(f.fixture.pdfPath, 'utf8')).toBe('%PDF-1.7 original pdf');
          expect(startupFailure).toBeInstanceOf(Error);
        } finally { await lifecycle?.shutdown(); }
      });
    },
  );

  it('preserves an accepted Direct Setup recovery instead of disguising it as normal startup', async context => {
    const lifetime = beginTrackedStartupTest(context);
    await lifetime.run(async () => {
      const f = await lifetime.step('fixturePreparation', () => createDeferredStartupFixture(lifetime.roots, true));
      await f.fixture.acceptedBuild.write(createBusinessAcceptedBuildMetadata(f.metadata, f.metadata.acceptedBuild));
      const journal = await seedSelectorTarget(f.fixture);
      await mkdir(dirname(f.paths.directSetupMigrationRecoveryPath), { recursive: true });
      const directSetup = JSON.stringify(createAcceptedDirectSetupFixture());
      await writeFile(f.paths.directSetupMigrationRecoveryPath, directSetup);
      const before = { metadata: await f.fixture.acceptedBuild.inspectSlots(),
        registry: await f.fixture.registry.inspectSlots(), journal: await journal.inspectSlots() };
      const firstStart = vi.spyOn(FirstStartUpdateCoordinator.prototype, 'beforeMigrations');
      await lifetime.step('startup', async () => { await expect(f.fixture.start()).rejects.toThrow(); });
      expect(f.fixture.createRuntimeSession).not.toHaveBeenCalled();
      expect(firstStart).not.toHaveBeenCalled();
      expect(electronBoundary.createWindow).not.toHaveBeenCalled();
      expect(await f.fixture.acceptedBuild.inspectSlots()).toEqual(before.metadata);
      expect(await f.fixture.registry.inspectSlots()).toEqual(before.registry);
      expect(await journal.inspectSlots()).toEqual(before.journal);
      expect(await readFile(f.paths.directSetupMigrationRecoveryPath, 'utf8')).toBe(directSetup);
      expect(await readFile(f.fixture.databasePath, 'utf8')).toBe(f.fixture.originalBytes);
      expect(await readFile(f.fixture.pdfPath, 'utf8')).toBe('%PDF-1.7 original pdf');
    });
  });

  it.for(['missingRoot', 'health', 'residualPending'] as const)(
    'requires accepted content and real owner settlement before selector return: $0', async (fault, context) => {
      const lifetime = beginTrackedStartupTest(context);
      await lifetime.run(async () => {
        const f = await lifetime.step('fixturePreparation', () => createDeferredStartupFixture(lifetime.roots, true));
        await f.fixture.acceptedBuild.write(createBusinessAcceptedBuildMetadata(f.metadata, f.metadata.acceptedBuild));
        const metadata = await f.fixture.acceptedBuild.inspectSlots();
        const journal = await seedSelectorTarget(f.fixture);
        const originalSelection = { registry: await f.fixture.registry.inspectSlots(), journal: await journal.inspectSlots() };
        if (fault === 'missingRoot') await rm(deriveWorkspaceRoot(f.fixture.root, workspaceId, 1).workspaceRoot, { recursive: true });
        if (fault === 'health') electronBoundary.fetch.mockImplementation(async () => new Response(null, { status: 500 }));
        if (fault === 'residualPending') {
          const before = FirstStartUpdateCoordinator.prototype.beforeMigrations;
          vi.spyOn(FirstStartUpdateCoordinator.prototype, 'beforeMigrations').mockImplementationOnce(async function (this: FirstStartUpdateCoordinator, inspection, options) {
            return before.call(this, { ...inspection, pendingMigrationCount: 1 }, options);
          });
        }
        await lifetime.step('startup', async () => {
          if (fault === 'residualPending') await expect(f.fixture.start()).rejects.toThrow();
          else await expect(f.fixture.start()).resolves.toBeUndefined();
        });
        expect(electronBoundary.createWindow).not.toHaveBeenCalled();
        expect(await f.fixture.acceptedBuild.inspectSlots()).toEqual(metadata);
        if (fault === 'residualPending') {
          // This mock supplies no stopped-startup receipt on gate failure.
          // Absence must not be inferred merely from a missing backend handle.
          expect(f.fixture.relaunch).not.toHaveBeenCalled();
          expect(await f.fixture.registry.inspectSlots()).toEqual(originalSelection.registry);
          expect(await journal.inspectSlots()).toEqual(originalSelection.journal);
        } else {
          expect(f.fixture.relaunch).toHaveBeenCalledOnce();
          expect((await f.fixture.registry.inspect())?.activeWorkspaceId).toBeNull();
          expect((await journal.inspectSlots()).current?.value.state).toBe('rollbackSelected');
        }
        if (fault === 'missingRoot') expect(f.fixture.createRuntimeSession).not.toHaveBeenCalled();
        else {
          if (fault === 'health') expect(f.fixture.events).toContain('backendStopped');
          expect(await readFile(f.fixture.databasePath, 'utf8')).toBe(f.fixture.originalBytes);
        }
      });
    },
  );
});

describe('B4 actual startup reporting producer', () => {
  for (const sample of [
    { stage: 'deleteAuthorization', cleanupFailure: false }, { stage: 'deleteAuthorization', cleanupFailure: true },
    { stage: 'deleteCleanup', cleanupFailure: false }, { stage: 'deleteCleanup', cleanupFailure: true },
  ] as const) it.for([sample])('captures cold admission and real service projections ($stage, cleanup failure: $cleanupFailure)',
    { timeout: 10_000 }, async ({ stage, cleanupFailure }, context) => {
    const lifetime = beginTrackedStartupTest(context);
    await lifetime.run(async () => {
      let receipt: Readonly<DesktopWorkspaceStartupSupportReceipt> | undefined;
      const receive = vi.fn((value: Readonly<DesktopWorkspaceStartupSupportReceipt>) => { receipt = value; });
      const f = await lifetime.step('fixturePreparation', () => createFixture(originalProfileId, {
        ownedRoots: lifetime.roots, update: true, skipRestore: true, observeWorkspaceStartupFailure: receive,
      }));
      const registry = { ...(await f.registry.read())!, formatVersion: 2 as const, activeWorkspaceId: null };
      await f.registry.write(registry);
      const selected = await captureDeletionTarget({ installationRoot: f.root, workspaceId,
        typedLabel: registry.workspaces[0]!.workspaceLabel, registry: f.registry,
        assertAuthority: () => context.signal.throwIfAborted() });
      const command = createWorkspaceDeletionCommand({ userDataRoot: f.root, registry: f.registry,
        assertWritersAbsent: async () => context.signal.throwIfAborted() });
      await command.publish(() => context.signal.throwIfAborted(), async () => context.signal.throwIfAborted(), selected.target,
        { operationId, target: selected.target, backupDisposition: 'explicitDataLoss' }, selected.assertCurrent);
      const journalPath = createWorkspaceDeletionJournalPaths(f.root).currentPath;
      const journalBytes = await readFile(journalPath), registryBytes = await readFile(join(f.root, WORKSPACE_REGISTRY_FILE_NAME));
      const first = new Error('SYNTHETIC_COLD_COMMAND_FIRST'), second = new Error('SYNTHETIC_COLD_CLOSE_SECOND');
      // The initial on-disk cold/build admission stays real. Repeated selection,
      // mutation authority and physical resume have their own existing deep tests.
      const realRecover = WorkspaceManagementService.recoverDeletionBeforeRuntime;
      vi.spyOn(WorkspaceManagementService, 'recoverDeletionBeforeRuntime').mockImplementationOnce(input => {
        const controlledSelection = { ...input.selection, assertSelected: async () => input.assertCurrent(), revoke() {} };
        return realRecover({ ...input, selection: controlledSelection, captureSelection: async () => controlledSelection,
          captureAuthority: async () => ({ assertCurrent: input.assertCurrent, assertOwned: async () => input.assertCurrent(),
            recordRemoved() { throw new Error('SYNTHETIC_UNEXPECTED_REMOVAL'); },
            async close() { if (cleanupFailure) throw second; },
          }), async resumeSelected(_journal, _authority, observeStage) { observeStage(stage); throw first; },
        });
      });
      const raw = vi.fn();
      await lifetime.step('startup', async () => { await expect(f.start(raw)).rejects.toThrow(); });
      expect(receive).toHaveBeenCalledOnce();
      const eligiblePrimary = stage !== 'deleteCleanup';
      expect(receipt!.observation.status).toBe(eligiblePrimary || cleanupFailure ? 'available' : 'unavailable');
      const data = supportBundleDesktopData.readSupportBundleDesktopData({
        system: { appVersion: receipt!.operationalIdentity.appVersion, buildRevision: receipt!.operationalIdentity.buildRevision,
          architecture: process.arch, platform: process.platform, electronVersion: '43.8.1' },
        availability: { backend: receipt!.backendState, database: 'notInspected', diagnosticHistory: 'notCollected', incidentHistory: 'notCollected' },
        observation: receipt!.observation,
      });
      if (data.observation.status === 'available') {
        if (eligiblePrimary) expect(data.observation.firstError).toMatchObject({
          eventName: 'workspaceManagement.operationFailed', operationId: 'workspace.deleteResume' });
        else expect(data.observation.firstError).toBeNull();
        if (cleanupFailure) expect(data.observation.cleanupError).toMatchObject({ stage: 'deleteCleanup',
          errorCode: 'WORKSPACE_DELETE_CLEANUP_FAILED', operationId: 'workspace.deleteResume',
          ...(eligiblePrimary ? { correlationId: data.observation.firstError!.correlationId } : {}),
        });
        else expect(data.observation.cleanupError).toBeNull();
      }
      expect(data.availability.backend).toBe('exitUnconfirmed');
      expect(f.events).not.toContain('backendStarted'); expect(f.createRuntimeSession).not.toHaveBeenCalled();
      expect(electronBoundary.createWindow).not.toHaveBeenCalled();
      expect(raw.mock.calls.some(([error]) => hasErrorCause(error, first))).toBe(true);
      expect((await readFile(journalPath)).equals(journalBytes)).toBe(true);
      expect((await readFile(join(f.root, WORKSPACE_REGISTRY_FILE_NAME))).equals(registryBytes)).toBe(true);
      expect(await readFile(f.databasePath, 'utf8')).toBe(f.originalBytes);
      expect(await readFile(f.pdfPath, 'utf8')).toBe('%PDF-1.7 original pdf');
      const encoded = JSON.stringify(data);
      for (const excluded of [f.root, workspaceId, first.message, second.message, operationId]) expect(encoded).not.toContain(excluded);
    });
  });

  it.for([false, true])('reports only the admitted workspace failure (packaged gate: %s)', async (update, context) => {
    const lifetime = beginTrackedStartupTest(context);
    await lifetime.run(async () => {
      const first = new Error('SYNTHETIC_NAMED_WORKSPACE_FAILURE');
      let receipt: Readonly<DesktopWorkspaceStartupSupportReceipt> | undefined;
      const receive = vi.fn((value: Readonly<DesktopWorkspaceStartupSupportReceipt>) => { receipt = value; });
      const resolve = vi.fn(async (): Promise<never> => { throw first; });
      const f = await lifetime.step('fixturePreparation', () => createFixture(originalProfileId, {
        ownedRoots: lifetime.roots, update, skipRestore: true, completeStartup: true,
        resolveActiveWorkspace: resolve, observeWorkspaceStartupFailure: receive,
      }));
      const raw = vi.fn();
      await lifetime.step('startup', async () => { await expect(f.start(raw)).rejects.toThrow(); });
      expect(resolve).toHaveBeenCalledOnce();
      expect(raw).toHaveBeenCalledWith(first, 'compositionStartup', []);
      expect(receive).toHaveBeenCalledOnce();
      expect(receive.mock.invocationCallOrder[0]).toBeGreaterThan(electronBoundary.reservationReleased.mock.invocationCallOrder[0]!);
      expect(Object.isFrozen(receipt)).toBe(true);
      expect(Object.isFrozen(receipt!.operationalIdentity)).toBe(true);
      expect(receipt).toMatchObject({ backendState: 'exitUnconfirmed', observation: { scope: 'currentOperation', status: 'unavailable' },
        operationalIdentity: { appVersion: '0.2.8', buildRevision: 'a'.repeat(12), runtimeInstanceId: '33333333-3333-4333-8333-333333333333' } });
      expect(f.createRuntimeSession).not.toHaveBeenCalled();
      expect(f.events).not.toContain('backendStarted');
      expect(electronBoundary.createWindow).not.toHaveBeenCalled();
      const data = supportBundleDesktopData.readSupportBundleDesktopData({
        system: { appVersion: receipt!.operationalIdentity.appVersion, buildRevision: receipt!.operationalIdentity.buildRevision,
          architecture: process.arch, platform: process.platform, electronVersion: '43.8.1' },
        availability: { backend: receipt!.backendState, database: 'notInspected', diagnosticHistory: 'notCollected', incidentHistory: 'notCollected' },
        observation: receipt!.observation,
      });
      const targetPath = join(f.root, 'startup-support.json.gz');
      const exporter = supportBundleCapability.createDesktopOnlySupportBundleExport({
        assertCurrent: () => context.signal.throwIfAborted(), loadDesktopData: () => data,
        operationalIdentity: receipt!.operationalIdentity, operationalLogger: receipt!.operationalLogger,
        runtimeRoot: createDesktopProfilePaths(f.root).runtimeRoot, confirmCreation: async () => true,
        selectTargetPath: async () => targetPath, showSafeError: vi.fn(),
      });
      try { await expect(exporter.create()).resolves.toBe('created'); } finally { exporter.dispose(); }
      const inspector = await import(new URL('../../scripts/inspect-support-bundle.mjs', import.meta.url).href);
      expect(inspector.inspectSupportBundle(targetPath).summary).toMatchObject({ formatVersion: 3, kind: 'desktopOnly',
        observationStatus: 'unavailable', backend: 'exitUnconfirmed' });
      const document = JSON.stringify(inspector.inspectSupportBundle(targetPath).document);
      for (const excluded of [f.root, workspaceId, originalProfileId, first.message]) expect(document).not.toContain(excluded);
      expect(await readFile(f.databasePath, 'utf8')).toBe(f.originalBytes);
      expect(await readFile(f.pdfPath, 'utf8')).toBe('%PDF-1.7 original pdf');
    });
  });

  it('does not grant reporting from build metadata when the actual build gate rejects', async context => {
    const lifetime = beginTrackedStartupTest(context);
    await lifetime.run(async () => {
      const receive = vi.fn(), resolve = vi.fn(async (): Promise<never> => { throw new Error('SYNTHETIC_UNREACHED_WORKSPACE'); });
      const f = await lifetime.step('fixturePreparation', () => createFixture(originalProfileId, {
        ownedRoots: lifetime.roots, update: true, skipRestore: true,
        observeWorkspaceStartupFailure: receive, resolveActiveWorkspace: resolve,
      }));
      const metadata = await f.acceptedBuild.read();
      if (metadata?.formatVersion !== 1) throw new Error('SYNTHETIC_INITIAL_BUILD_METADATA_MISSING');
      await f.acceptedBuild.write({ ...metadata, appVersion: '0.2.9' });
      await lifetime.step('startup', async () => { await expect(f.start()).rejects.toThrow('DESKTOP_BUILD_ADMISSION_REJECTED'); });
      expect(resolve).not.toHaveBeenCalled(); expect(receive).not.toHaveBeenCalled();
      expect(f.createRuntimeSession).not.toHaveBeenCalled();
      expect(await readFile(f.databasePath, 'utf8')).toBe(f.originalBytes);
    });
  });

  it.for(['direct', 'cause', 'aggregate'] as const)('burns reporting on a later %s build rejection', async (graph, context) => {
    const lifetime = beginTrackedStartupTest(context);
    await lifetime.run(async () => {
      const rejected = new PreWorkspaceBuildAdmissionError('downgrade');
      const first = graph === 'direct' ? rejected : graph === 'cause' ? new Error('SYNTHETIC_WRAPPED_BUILD', { cause: rejected })
        : new AggregateError([new Error('SYNTHETIC_OTHER_CAUSE'), new Error('SYNTHETIC_WRAPPED_BUILD', { cause: rejected })], 'SYNTHETIC_BUILD_GRAPH');
      const receive = vi.fn(), raw = vi.fn(), resolve = vi.fn(async (): Promise<never> => { throw first; });
      const f = await lifetime.step('fixturePreparation', () => createFixture(originalProfileId, {
        ownedRoots: lifetime.roots, update: true, skipRestore: true,
        observeWorkspaceStartupFailure: receive, resolveActiveWorkspace: resolve,
      }));
      await lifetime.step('startup', async () => { await expect(f.start(raw)).rejects.toThrow(); });
      expect(resolve).toHaveBeenCalledOnce(); expect(receive).not.toHaveBeenCalled();
      expect(raw).toHaveBeenCalledWith(first, 'compositionStartup', []);
      expect(f.createRuntimeSession).not.toHaveBeenCalled();
    });
  });

  it.for(['iterator', 'accessor', 'sparse', 'oversized'] as const)('does not bypass build rejection through a %s failure graph', async (shape, context) => {
    const lifetime = beginTrackedStartupTest(context);
    await lifetime.run(async () => {
      const rejected = new PreWorkspaceBuildAdmissionError('downgrade'), unexpectedRead = vi.fn();
      const first = new AggregateError(shape === 'oversized' ? Array(33).fill(rejected) : [rejected], 'SYNTHETIC_BUILD_GRAPH_SHAPE');
      if (shape === 'iterator') Object.defineProperty(first.errors, Symbol.iterator, { value: function* () { unexpectedRead(); } });
      if (shape === 'accessor') Object.defineProperty(first, 'cause', { get() { unexpectedRead(); return rejected; } });
      if (shape === 'sparse') delete first.errors[0];
      const receive = vi.fn(), raw = vi.fn();
      const f = await lifetime.step('fixturePreparation', () => createFixture(originalProfileId, {
        ownedRoots: lifetime.roots, update: true, skipRestore: true,
        observeWorkspaceStartupFailure: receive, resolveActiveWorkspace: async () => { throw first; },
      }));
      await lifetime.step('startup', async () => { await expect(f.start(raw)).rejects.toThrow(); });
      expect(receive).not.toHaveBeenCalled(); expect(unexpectedRead).not.toHaveBeenCalled();
      expect(raw).toHaveBeenCalledWith(first, 'compositionStartup', []);
      expect(f.createRuntimeSession).not.toHaveBeenCalled();
    });
  });

  it('does not lend a successful workspace stage to a later backend failure', async context => {
    const lifetime = beginTrackedStartupTest(context);
    await lifetime.run(async () => {
      const receive = vi.fn(), first = new Error('SYNTHETIC_BUSINESS_STARTUP_FAILURE'), raw = vi.fn();
      const f = await lifetime.step('fixturePreparation', () => createFixture(originalProfileId, {
        ownedRoots: lifetime.roots, update: true, skipRestore: true, completeStartup: true,
        observeWorkspaceStartupFailure: receive, inspectBackendStartup: async () => { throw first; },
      }));
      await lifetime.step('startup', async () => { await expect(f.start(raw)).rejects.toThrow(); });
      expect(f.events).toContain('backendStarted'); expect(receive).not.toHaveBeenCalled();
      expect(raw.mock.calls.some(([cause]) => cause === first)).toBe(true);
    });
  });

  it.for(['throw', 'rejection'] as const)('preserves the startup cause when reporting fails by %s', async (kind, context) => {
    const lifetime = beginTrackedStartupTest(context);
    await lifetime.run(async () => {
      const first = new Error('SYNTHETIC_STARTUP_BEFORE_REPORT_FAILURE'), raw = vi.fn(), unhandled = vi.fn();
      const receive = vi.fn(() => {
        const failure = new Error('SYNTHETIC_OPTIONAL_REPORT_FAILURE');
        if (kind === 'throw') throw failure;
        return Promise.reject(failure);
      });
      const f = await lifetime.step('fixturePreparation', () => createFixture(originalProfileId, {
        ownedRoots: lifetime.roots, update: true, skipRestore: true,
        resolveActiveWorkspace: async () => { throw first; }, observeWorkspaceStartupFailure: receive,
      }));
      process.on('unhandledRejection', unhandled);
      try {
        await lifetime.step('startup', async () => { await expect(f.start(raw)).rejects.toThrow(); });
        await nextEventLoopTurn();
        expect(receive).toHaveBeenCalledOnce(); expect(unhandled).not.toHaveBeenCalled();
        expect(raw).toHaveBeenCalledWith(first, 'compositionStartup', []);
      } finally { process.off('unhandledRejection', unhandled); }
    });
  });

  it('keeps smoke startup failures outside the reporting producer', async context => {
    const lifetime = beginTrackedStartupTest(context);
    await lifetime.run(async () => {
      const receive = vi.fn(), resolve = vi.fn(async (): Promise<never> => { throw new Error('SYNTHETIC_SMOKE_WORKSPACE_FAILURE'); });
      const f = await lifetime.step('fixturePreparation', () => createFixture(originalProfileId, {
        ownedRoots: lifetime.roots, smoke: true, skipRestore: true,
        resolveActiveWorkspace: resolve, observeWorkspaceStartupFailure: receive,
      }));
      await lifetime.step('startup', async () => { await expect(f.start()).rejects.toThrow(); });
      expect(resolve).toHaveBeenCalledOnce(); expect(receive).not.toHaveBeenCalled();
    });
  });
});

describe('workspace deletion phase producer', () => {
  it.for(['fulfilled', 'rejected', 'undefinedRejection', 'syncThrow', 'undefinedThrow'] as const)(
    'retains the exact promise or cause and executes once with a throwing observer: %s', async kind => {
      const first = new Error('SYNTHETIC_FIRST'), cleanup = new Error('SYNTHETIC_CLEANUP');
      const result = Object.freeze({ firstFailure: first, cleanupFailure: cleanup, cause: first });
      const cause = kind.startsWith('undefined') ? undefined : result;
      for (const enabled of [false, true]) {
        const events: WorkspaceDeletionPhaseEvent[] = [];
        const observe = createWorkspaceDeletionPhaseProducer(enabled ? event => { events.push(event); throw undefined; } : undefined);
        const original = kind === 'syncThrow' || kind === 'undefinedThrow' ? undefined
          : kind === 'fulfilled' ? Promise.resolve(result) : Promise.reject(cause);
        const work = vi.fn(() => {
          if (kind === 'syncThrow' || kind === 'undefinedThrow') throw cause;
          return original!;
        });
        if (kind === 'syncThrow' || kind === 'undefinedThrow') {
          let thrown = false;
          try { observe('preparation', work); }
          catch (actual) { thrown = true; expect(actual).toBe(cause); }
          expect(thrown).toBe(true);
        } else {
          const returned = observe('preparation', work);
          expect(returned).toBe(original);
          if (kind === 'fulfilled') expect(await returned).toBe(result);
          else await expect(returned).rejects.toBe(cause);
        }
        expect(work).toHaveBeenCalledOnce();
        expect(events).toEqual(enabled ? [
          { phase: 'preparation', event: 'entered', callId: 1 },
          { phase: 'preparation', event: kind === 'fulfilled' ? 'fulfilled' : 'rejected', callId: 1 },
        ] : []);
      }
    });

  it('adds no promise reaction without an observer', async () => {
    const original = Promise.resolve('original');
    let reads = 0, constructorReads = 0, calls = 0;
    Object.defineProperty(original, 'then', { get() {
      reads++;
      return Promise.prototype.then.bind(original);
    } });
    // Native then also reads the constructor to allocate its reaction promise.
    Object.defineProperty(original, 'constructor', { get() { constructorReads++; return Promise; } });
    // Vitest mocks attach their own settlement reaction to returned promises.
    const returned = createWorkspaceDeletionPhaseProducer()('journalPublication', () => { calls++; return original; });
    expect(returned).toBe(original); expect(calls).toBe(1); expect(reads).toBe(0); expect(constructorReads).toBe(0);
    expect(await returned).toBe('original'); expect(reads).toBe(0);
  });

  it.for([false, true])('keeps the native promise without reading its throwing own then getter (observed: %s)', async enabled => {
    const events: WorkspaceDeletionPhaseEvent[] = [];
    const original = Promise.resolve(Object.freeze({ synthetic: 'ORIGINAL_RESULT' }));
    let reads = 0, calls = 0;
    Object.defineProperty(original, 'then', { get(): never {
      reads++;
      throw new Error('SYNTHETIC_OWN_THEN_GETTER');
    } });
    const observe = createWorkspaceDeletionPhaseProducer(enabled ? event => { events.push(event); } : undefined);
    const returned = observe('preparation', () => { calls++; return original; });
    expect(returned).toBe(original); expect(calls).toBe(1); expect(reads).toBe(0);
    expect(await returned).toEqual({ synthetic: 'ORIGINAL_RESULT' }); expect(reads).toBe(0);
    expect(events).toEqual(enabled ? [
      { phase: 'preparation', event: 'entered', callId: 1 },
      { phase: 'preparation', event: 'fulfilled', callId: 1 },
    ] : []);
  });

  it('leaves registration failure unknown without replacing the work promise', () => {
    const events: WorkspaceDeletionPhaseEvent[] = [];
    const original = new Proxy(Promise.resolve('original'), {});
    let calls = 0;
    const returned = createWorkspaceDeletionPhaseProducer(event => { events.push(event); })(
      'journalPublication', () => { calls++; return original; });
    expect(returned).toBe(original); expect(calls).toBe(1);
    expect(events).toEqual([{ phase: 'journalPublication', event: 'entered', callId: 1 }]);
  });

  it('numbers nested calls per composition and sends only immutable closed data', async () => {
    const events: WorkspaceDeletionPhaseEvent[] = [], observedArgs: unknown[][] = [];
    const observe = createWorkspaceDeletionPhaseProducer((...args) => {
      observedArgs.push(args); events.push(args[0]);
    });
    await observe('preparation', () => observe('journalPublication', async () => undefined));
    expect(events).toEqual([
      { phase: 'preparation', event: 'entered', callId: 1 },
      { phase: 'journalPublication', event: 'entered', callId: 2 },
      { phase: 'journalPublication', event: 'fulfilled', callId: 2 },
      { phase: 'preparation', event: 'fulfilled', callId: 1 },
    ]);
    for (const args of observedArgs) {
      expect(args).toHaveLength(1);
      expect(Object.isFrozen(args[0])).toBe(true);
      expect(Object.keys(args[0] as object).sort()).toEqual(['callId', 'event', 'phase']);
    }
    const next: WorkspaceDeletionPhaseEvent[] = [];
    await createWorkspaceDeletionPhaseProducer(event => { next.push(event); })('preparation', async () => undefined);
    expect(next[0]?.callId).toBe(1);
  });
});

describe('restricted recovery selector composition', () => {
  // Both routes reuse the main fixture's Electron boundary, not a real writer exit.
  // Startup uses the default choice; injection remains a separate compatibility case.
  async function prepare(context: TestContext, lifetime: ReturnType<typeof beginTrackedStartupTest>,
    active: 'target' | 'other' | 'none' = 'target', route: 'direct' | 'startup' | 'injected' = 'direct',
    observation: { phase?: WorkspaceDeletionPhaseObserver; detail?: WorkspaceDeletionPhaseObserver; slot?: SlotIoObserver } = {}) {
    const startup = createDesktopRecoveryStartup<DesktopLifecycleHandle>();
    let ownershipLost = false;
    let mainOwnership: ReturnType<Awaited<ReturnType<typeof acquireDesktopWorkspaceReservation>>['captureMainOwnership']> | undefined;
    const ownershipFailure = new Error('SYNTHETIC_RECOVERY_WRITER_ABSENCE_LOST');
    const proveAbsenceOwned = async () => {
      absence.assertCurrent();
      await mainOwnership!.assertOwned();
      absence.assertCurrent();
    };
    const absence = {
      assertCurrent() {
        if (ownershipLost || mainOwnership === undefined) throw ownershipFailure;
        mainOwnership.assertCurrent();
      },
      assertOwned: vi.fn(proveAbsenceOwned),
    };
    let source: ReturnType<typeof createDesktopWorkspaceRecoverySelection> | undefined;
    let selected: Extract<Awaited<ReturnType<NonNullable<typeof source>['discover']>>, { mode: 'offered' }> | undefined;
    let capabilityOptions: Parameters<typeof createWorkspaceManagementCapability>[0] | undefined;
    let mainCapability: WorkspaceManagementCapability | undefined;
    let startupFailure: { args: Parameters<NonNullable<StartDesktopCompositionOptions['observeStartupException']>> } | undefined;
    if (route !== 'direct') context.onTestFailed(async () => {
      if (startupFailure === undefined) return;
      const [error, phase, secrets] = startupFailure.args;
      try {
        const { createRunnerFailureSink } = await import('../../../../test-reporters/runnerFailureEvidence.mjs');
        const sink = createRunnerFailureSink({ secrets: [...(secrets ?? [])] }), task = context.task;
        const retryCount = task.result?.retryCount ?? 0, repeatCount = task.result?.repeatCount ?? 0;
        sink.record({ runner: 'vitest', phase, error, testName: task.fullTestName, testId: task.id,
          file: task.file.filepath,
          ...(task.location === undefined ? {} : { line: task.location.line, column: task.location.column }),
          ...(retryCount === 0 && repeatCount === 0 ? { attempt: 0 } : {}), retryCount, repeatCount });
        await sink.flush();
      } catch { /* Preserve the assertion if private evidence cannot be delivered. */ }
    });
    const captureCapability: typeof createWorkspaceManagementCapability = input => {
      capabilityOptions = input;
      mainCapability = createWorkspaceManagementCapability(input);
      return mainCapability;
    };
    const maintenanceLease = new InMemoryWorkspaceMaintenanceLease();
    const f = await createFixture(originalProfileId, {
      ownedRoots: lifetime.roots, update: true, skipRestore: true, completeStartup: true,
      recoveryStartup: startup.port,
      ...(route !== 'direct' ? {
        startComposition(options) { return startDesktopComposition({ ...options,
          ...(observation.phase === undefined ? {} : { observeWorkspaceDeletionPhase: observation.phase }),
          ...(observation.detail === undefined ? {} : { observeWorkspaceDeletionDetail: observation.detail }),
          ...(observation.slot === undefined ? {} : { observeWorkspaceDeletionSlotIo: observation.slot }),
        }); },
        ...(route === 'injected' ? { selectWorkspaceRecoveryChoice: selectDesktopWorkspaceRecoveryChoice } : {}),
        createWorkspaceManagementCapability: captureCapability,
      } : {
      async startComposition(options) {
        const reservation = await acquireDesktopWorkspaceReservation({ userDataRoot: options.userDataPath,
          assertSingleInstanceOwnership: options.assertSingleInstanceOwnership, signal: context.signal });
        let delegated = false;
        try {
          mainOwnership = reservation.captureMainOwnership();
          const authority = { assertCurrent: () => reservation.assertMainCurrent(), assertOwned: () => reservation.assertMainOwned() };
          source = createDesktopWorkspaceRecoverySelection({ root: options.userDataPath,
            buildInfo: options.buildInfo, releaseInfo: options.releaseInfo, authority });
          startup.port.registerObservation(source);
          const offer = await source.discover();
          if (offer.mode !== 'offered') throw new Error('SYNTHETIC_RECOVERY_OFFER_MISSING');
          selected = offer;
          const operationalIdentity = { appVersion: options.appVersion, buildRevision: options.buildInfo.buildRevision,
            runtimeInstanceId: options.runtimeInstanceId };
          const logsRoot = join(createDesktopProfilePaths(options.userDataPath).runtimeRoot, 'logs');
          const failureSink = new IncidentIndexDesktopLogFailureSink({ logsRoot, operationalIdentity });
          delegated = true;
          return await startDesktopSelectorComposition({ mode: 'recoveryManagement', selection: offer,
            runtimeAbsence: absence, reservation, options: { ...options,
              ...(observation.phase === undefined ? {} : { observeWorkspaceDeletionPhase: observation.phase }),
              ...(observation.detail === undefined ? {} : { observeWorkspaceDeletionDetail: observation.detail }),
              ...(observation.slot === undefined ? {} : { observeWorkspaceDeletionSlotIo: observation.slot }),
            },
            dependencies: { showErrorBox: f.showErrorBox, showOpenDialog: f.showOpenDialog,
              showSaveDialog: f.showSaveDialog, showMessageBox: f.showMessageBox,
              createWorkspaceManagementCapability: captureCapability,
            },
            maintenanceLease,
            localUpdateRuntimePaths: createLocalUpdateRuntimePaths({ userDataPath: options.userDataPath,
              legacyRuntimeRoot: createDesktopProfilePaths(options.userDataPath).runtimeRoot }),
            operationalIdentity, operationalLogger: new JsonLineDesktopOperationalLogger({ logsRoot, failureSink }),
            failureSink, startedAt: Date.now(),
          });
        } catch (cause) {
          if (!delegated) {
            const failures = [cause];
            try { source?.closeAdmission(); } catch (failure) { failures.push(failure); }
            try { await source?.waitForSettlement(); } catch (failure) { failures.push(failure); }
            if (failures.length === 1) {
              try { await reservation.close(); } catch (failure) { failures.push(failure); }
            }
            if (failures.length > 1) throw new AggregateError(failures, 'SYNTHETIC_RECOVERY_SELECTOR_CLEANUP_FAILED', { cause });
          }
          throw cause;
        }
      },
      }),
    });
    const registry = (await f.registry.read())!;
    const entry = registry.workspaces[0]!;
    const otherId = validateWorkspaceId('44444444-4444-4444-8444-444444444444');
    await mkdir(deriveWorkspaceRoot(f.root, otherId, 1).workspaceRoot, { recursive: true });
    await f.registry.write({ formatVersion: 2, activeWorkspaceId: active === 'target' ? workspaceId : active === 'other' ? otherId : null,
      workspaces: [entry, { ...entry, workspaceId: otherId, workspaceLabel: 'Synthetic other company',
        lineageIdentity: { formatVersion: 1, profileId: foreignProfileId } }] });
    const binding = captureWorkspaceRemnantBinding({ formatVersion: 1, owner: 'workspaceImport', operationId,
      workspaceId, lineageIdentity: entry.lineageIdentity });
    const setupLease = new InMemoryWorkspaceMaintenanceLease(), held = await setupLease.acquire('import');
    const assertAuthority = setupLease.captureCurrentOwner(['import'], held);
    try {
      await new WorkspaceRemnantBindingStore(f.root, workspaceRemnantBindingKey(binding)).publish(binding,
        { assertAuthority, async assertExternalSelection() { assertAuthority(); } });
    } finally { await held.release(); }
    const journal = new WorkspaceBackupImportJournalStore({ installationRoot: f.root,
      filePath: join(f.root, WORKSPACE_BACKUP_IMPORT_JOURNAL_FILE_NAME) });
    for (const state of WORKSPACE_BACKUP_IMPORT_JOURNAL_STATES) {
      await journal.write({ formatVersion: 2, operationId, workspaceId, workspaceLabel: entry.workspaceLabel,
        createdAt: entry.createdAt, previousActiveWorkspaceId: null, state,
        lineageIdentity: getWorkspaceBackupImportStateIndex(state) >= getWorkspaceBackupImportStateIndex('candidateValidated')
          ? entry.lineageIdentity : null });
    }
    const preservedPaths = [join(f.root, WORKSPACE_REGISTRY_FILE_NAME),
      join(f.root, WORKSPACE_BACKUP_IMPORT_JOURNAL_FILE_NAME),
      createWorkspaceRemnantBindingPaths(f.root, workspaceRemnantBindingKey(binding)).currentPath,
      f.databasePath, f.pdfPath];
    const preserved = await Promise.all(preservedPaths.map(path => readFile(path)));
    const assertPreserved = async () => {
      for (const [index, path] of preservedPaths.entries()) expect(await readFile(path)).toEqual(preserved[index]);
    };
    const event = { sender: f.mainWindow.webContents, senderFrame: f.mainWindow.webContents.mainFrame };
    const readStatus = () => {
      const handler = electronBoundary.handle.mock.calls.find(([channel]) => channel === getWorkspaceManagementStatusIpcChannel)?.[1];
      if (handler === undefined) throw new Error('SYNTHETIC_RECOVERY_STATUS_HANDLER_MISSING');
      return handler(event);
    };
    return { f, startup, absence, proveAbsenceOwned, journal, binding, readStatus, assertPreserved, maintenanceLease,
      deleteWorkspace(request: unknown) {
        if (mainCapability === undefined) throw new Error('SYNTHETIC_RECOVERY_CAPABILITY_MISSING');
        return mainCapability.deleteWorkspace(event as unknown as IpcMainInvokeEvent, request);
      },
      start(signal: AbortSignal = context.signal) {
        signal.throwIfAborted();
        const starting = startup.start(() => f.start((...args) => { startupFailure ??= { args }; }));
        let cancellationTask: Promise<void> | undefined;
        const cancel = () => {
          if (cancellationTask !== undefined) return;
          try { cancellationTask = startup.shutdown(); }
          catch (cause) { cancellationTask = Promise.reject(cause); }
          void cancellationTask.catch(() => undefined);
        };
        signal.addEventListener('abort', cancel, { once: true });
        context.onTestFinished(async () => {
          signal.removeEventListener('abort', cancel);
          await cancellationTask;
        });
        if (signal.aborted) cancel();
        return starting;
      },
      readSource: () => source, readOffer: () => selected, readCapability: () => capabilityOptions,
      readStartupFailure: () => startupFailure?.args[0],
      loseAbsence() { ownershipLost = true; }, restoreAbsence() { ownershipLost = false; }, ownershipFailure };
  }

  it.for(['off', 'on', 'throwing'] as const)('phase observation preserves actual recovery cancellation: %s', async (mode, context) => {
    const lifetime = beginTrackedStartupTest(context);
    await lifetime.run(async () => {
      const observed: WorkspaceDeletionPhaseEvent[] = [];
      const phase = mode === 'off' ? undefined : (event: WorkspaceDeletionPhaseEvent) => {
        observed.push(event);
        if (mode === 'throwing') throw undefined;
      };
      const p = await lifetime.step('fixturePreparation', () => prepare(context, lifetime, 'other', 'direct',
        phase === undefined ? {} : { phase }));
      const outcome = await lifetime.step('startup', () => p.start());
      if (outcome.status !== 'fulfilled' || outcome.lifecycle === undefined) throw new Error('SYNTHETIC_SELECTOR_START_FAILED');
      try {
        expect(observed).toEqual([]);
        expect(await p.deleteWorkspace({ formatVersion: 1, workspaceId,
          typedLabel: 'Synthetic restore test', backupChoice: 'explicitDataLoss' }))
          .toEqual({ formatVersion: 1, status: 'cancelled', nextAction: 'restartRequired' });
        expect(observed).toEqual(mode === 'off' ? [] : [
          { phase: 'preparation', event: 'entered', callId: 1 },
          { phase: 'preparation', event: 'fulfilled', callId: 1 },
        ]);
        expect(p.f.showMessageBox).toHaveBeenCalledOnce();
        expect(p.maintenanceLease.readState()).toBe('idle');
        expect(p.f.relaunch).not.toHaveBeenCalled(); expect(p.f.createRuntimeSession).not.toHaveBeenCalled();
        expect(electronBoundary.fork).not.toHaveBeenCalled();
        const journal = createWorkspaceDeletionJournalPaths(p.f.root);
        for (const path of [journal.currentPath, journal.backupPath, journal.nextPath]) {
          await expect(readFile(path)).rejects.toMatchObject({ code: 'ENOENT' });
        }
        await p.assertPreserved();
      } finally { await outcome.lifecycle.shutdown(); }
      expect(electronBoundary.reservationReleased).toHaveBeenCalledOnce();
    });
  });

  it('observes the first actual preparation entry before its guard', async context => {
    const lifetime = beginTrackedStartupTest(context);
    await lifetime.run(async () => {
      const observed: WorkspaceDeletionPhaseEvent[] = [];
      const actualPreparation = vi.spyOn(prodPreparation, 'prepareWorkspaceDeletion');
      const p = await lifetime.step('fixturePreparation', () => prepare(context, lifetime, 'target', 'direct', { phase(event) {
        observed.push(event);
        if (event.phase === 'preparation' && event.event === 'entered') p.loseAbsence();
      } }));
      const outcome = await lifetime.step('startup', () => p.start());
      if (outcome.status !== 'fulfilled' || outcome.lifecycle === undefined) throw new Error('SYNTHETIC_SELECTOR_START_FAILED');
      try {
        expect(observed).toEqual([]);
        const response = await p.deleteWorkspace({ formatVersion: 1, workspaceId,
          typedLabel: 'Synthetic restore test', backupChoice: 'explicitDataLoss' })
          .then(value => ({ value }), (cause: unknown) => ({ cause }));
        expect(response).not.toMatchObject({ value: { status: 'completed' } });
        expect(actualPreparation).not.toHaveBeenCalled();
        expect(p.f.showMessageBox).not.toHaveBeenCalled();
        expect(observed).toEqual([
          { phase: 'preparation', event: 'entered', callId: 1 },
          { phase: 'preparation', event: 'rejected', callId: 1 },
        ]);
        expect(p.f.relaunch).not.toHaveBeenCalled(); expect(electronBoundary.fork).not.toHaveBeenCalled();
        expect(p.maintenanceLease.readState()).toBe('idle'); await p.assertPreserved();
        await expect(outcome.lifecycle.shutdown()).rejects.toThrow('DESKTOP_SHUTDOWN_FAILED');
        expect(electronBoundary.reservationReleased).not.toHaveBeenCalled();
      } finally { await outcome.lifecycle.shutdown().catch(() => undefined); }
    });
  });

  it('observes rejected repeated preparations and pre-binding publication attempts', async context => {
    const lifetime = beginTrackedStartupTest(context);
    await lifetime.run(async () => {
      let preparation: NonNullable<WorkspaceManagementServiceOptions['deletionPreparation']> | undefined;
      const compose = producerManagement.createWorkspaceManagementComposition;
      vi.spyOn(producerManagement, 'createWorkspaceManagementComposition').mockImplementation(async input => {
        if (input.mode === 'recoveryManagement') preparation = input.deletionPreparation;
        return compose(input);
      });
      let publication: prodPreparation.WorkspaceDeletionPreparationOptions['publish'] | undefined;
      const prepareDeletion = prodPreparation.prepareWorkspaceDeletion;
      vi.spyOn(prodPreparation, 'prepareWorkspaceDeletion').mockImplementation(input => {
        publication = input.publish;
        return prepareDeletion(input);
      });
      const create = vi.spyOn(deletionCommand, 'createWorkspaceDeletionCommand');
      const observed: WorkspaceDeletionPhaseEvent[] = [];
      let loseAtEntry = false;
      const p = await lifetime.step('fixturePreparation', () => prepare(context, lifetime, 'target', 'direct', { phase(event) {
        observed.push(event);
        if (loseAtEntry && event.phase === 'preparation' && event.event === 'entered') p.loseAbsence();
      } }));
      const outcome = await lifetime.step('startup', () => p.start());
      if (outcome.status !== 'fulfilled' || outcome.lifecycle === undefined) throw new Error('SYNTHETIC_SELECTOR_START_FAILED');
      try {
        // The admitted call captures the real publisher but cancels before mutation.
        expect(await p.deleteWorkspace({ formatVersion: 1, workspaceId,
          typedLabel: 'Synthetic restore test', backupChoice: 'explicitDataLoss' }))
          .toEqual({ formatVersion: 1, status: 'cancelled', nextAction: 'restartRequired' });
        expect(publication).toBeDefined(); expect(preparation).toBeDefined();
        loseAtEntry = true;
        // Invalid payloads must remain unreachable after the entry callback revokes ownership.
        await expect(preparation!.prepare(undefined!, undefined!, () => {}, operationId)).rejects.toBe(p.ownershipFailure);
        await expect(preparation!.prepare(undefined!, undefined!, () => {}, operationId)).rejects.toBe(p.ownershipFailure);
        for (let attempt = 0; attempt < 2; attempt++) {
          await expect(publication!(() => {}, async () => {}, undefined!, undefined!, async () => {}))
            .rejects.toBe(p.ownershipFailure);
        }
        expect(create).toHaveBeenCalledOnce();
        expect(observed).toEqual([
          { phase: 'preparation', event: 'entered', callId: 1 },
          { phase: 'preparation', event: 'fulfilled', callId: 1 },
          { phase: 'preparation', event: 'entered', callId: 2 },
          { phase: 'preparation', event: 'rejected', callId: 2 },
          { phase: 'preparation', event: 'entered', callId: 3 },
          { phase: 'preparation', event: 'rejected', callId: 3 },
          { phase: 'journalPublication', event: 'entered', callId: 4 },
          { phase: 'journalPublication', event: 'rejected', callId: 4 },
          { phase: 'journalPublication', event: 'entered', callId: 5 },
          { phase: 'journalPublication', event: 'rejected', callId: 5 },
        ]);
        for (const event of observed) {
          expect(Object.keys(event).sort()).toEqual(['callId', 'event', 'phase']);
          expect(Object.isFrozen(event)).toBe(true);
        }
        expect(p.f.showMessageBox).toHaveBeenCalledOnce();
        expect(p.f.relaunch).not.toHaveBeenCalled(); expect(p.f.createRuntimeSession).not.toHaveBeenCalled();
        expect(electronBoundary.fork).not.toHaveBeenCalled(); expect(p.maintenanceLease.readState()).toBe('idle');
        await p.assertPreserved();
        const journal = createWorkspaceDeletionJournalPaths(p.f.root);
        for (const path of [journal.currentPath, journal.backupPath, journal.nextPath]) {
          await expect(readFile(path)).rejects.toMatchObject({ code: 'ENOENT' });
        }
        await expect(outcome.lifecycle.shutdown()).rejects.toThrow('DESKTOP_SHUTDOWN_FAILED');
        expect(electronBoundary.reservationReleased).not.toHaveBeenCalled();
      } finally { await outcome.lifecycle.shutdown().catch(() => undefined); }
    });
  });

  it('excludes both ends of a status reservation started before preparation', async context => {
    const lifetime = beginTrackedStartupTest(context);
    await lifetime.run(async () => {
      let preparation: NonNullable<WorkspaceManagementServiceOptions['deletionPreparation']> | undefined;
      const compose = producerManagement.createWorkspaceManagementComposition;
      vi.spyOn(producerManagement, 'createWorkspaceManagementComposition').mockImplementation(async input => {
        if (input.mode === 'recoveryManagement') preparation = input.deletionPreparation;
        return compose(input);
      });
      const phases: WorkspaceDeletionPhaseEvent[] = [], details: WorkspaceDeletionPhaseEvent[] = [];
      const p = await lifetime.step('fixturePreparation', () => prepare(context, lifetime, 'target', 'direct', {
        phase(event) { phases.push(event); }, detail(event) { details.push(event); },
      }));
      const outcome = await lifetime.step('startup', () => p.start());
      if (outcome.status !== 'fulfilled' || outcome.lifecycle === undefined) throw new Error('SYNTHETIC_SELECTOR_START_FAILED');
      const entered = createCompletionGate(), held = createCompletionGate();
      const release = () => { entered.resolve(); held.resolve(); };
      context.signal.addEventListener('abort', release, { once: true });
      const original = p.absence.assertOwned.getMockImplementation()!;
      p.absence.assertOwned.mockImplementationOnce(async () => { entered.resolve(); await held.promise; await original(); });
      const reading = Promise.resolve(p.readStatus()).then(value => ({ value }), (cause: unknown) => ({ cause }));
      try {
        expect(await Promise.race([entered.promise.then(() => 'held'), reading.then(() => 'settled')])).toBe('held');
        expect(phases).toEqual([]); expect(details).toEqual([]); expect(preparation).toBeDefined();
        // The actual prepare owner rejects before destructive work, after the observation entry.
        await expect(preparation!.prepare(undefined!, undefined!, () => {}, operationId)).rejects.toThrow();
        expect(phases).toEqual([
          { phase: 'preparation', event: 'entered', callId: 1 },
          { phase: 'preparation', event: 'rejected', callId: 1 },
        ]);
        expect(details).toEqual([]);
        held.resolve(); await reading;
        for (const events of [phases, details]) {
          for (const [index, event] of events.entries()) {
            if (event.event === 'entered') continue;
            expect(events.slice(0, index).some(start => start.phase === event.phase &&
              start.callId === event.callId && start.event === 'entered')).toBe(true);
          }
        }
        await p.assertPreserved(); expect(electronBoundary.fork).not.toHaveBeenCalled();
      } finally {
        release(); context.signal.removeEventListener('abort', release); await reading; await outcome.lifecycle.shutdown();
      }
      expect(electronBoundary.reservationReleased).toHaveBeenCalledOnce();
    });
  });

  it('records a revoked actual recovery reservation without starting journal I/O', async context => {
    const lifetime = beginTrackedStartupTest(context);
    await lifetime.run(async () => {
      const phases: WorkspaceDeletionPhaseEvent[] = [], slots: SlotIoEvent[] = [];
      let armed = false;
      const p = await lifetime.step('fixturePreparation', () => prepare(context, lifetime, 'target', 'direct', {
        detail(event) {
          phases.push(event);
          if (armed && event.phase === 'reservation' && event.event === 'entered') { armed = false; p.loseAbsence(); }
        }, slot(event) { slots.push(event); },
      }));
      const outcome = await lifetime.step('startup', () => p.start());
      if (outcome.status !== 'fulfilled' || outcome.lifecycle === undefined) throw new Error('SYNTHETIC_SELECTOR_START_FAILED');
      try {
        expect(phases).toEqual([]); expect(slots).toEqual([]); armed = true;
        const response = await p.deleteWorkspace({ formatVersion: 1, workspaceId,
          typedLabel: 'Synthetic restore test', backupChoice: 'explicitDataLoss' })
          .then(value => ({ value }), (cause: unknown) => ({ cause }));
        expect(response).not.toMatchObject({ value: { status: 'completed' } });
        expect(armed).toBe(false);
        expect(phases.some(event => event.phase === 'reservation' && event.event === 'rejected')).toBe(true);
        expect(slots).toEqual([]); await p.assertPreserved();
        const journal = createWorkspaceDeletionJournalPaths(p.f.root);
        for (const path of [journal.currentPath, journal.backupPath, journal.nextPath]) {
          await expect(readFile(path)).rejects.toMatchObject({ code: 'ENOENT' });
        }
        expect(p.f.relaunch).not.toHaveBeenCalled(); expect(electronBoundary.fork).not.toHaveBeenCalled();
        expect(p.maintenanceLease.readState()).toBe('idle');
        await expect(outcome.lifecycle.shutdown()).rejects.toThrow('DESKTOP_SHUTDOWN_FAILED');
        expect(electronBoundary.reservationReleased).not.toHaveBeenCalled();
      } finally { await outcome.lifecycle.shutdown().catch(() => undefined); }
    });
  });

  it.for(['target', 'other', 'none'] as const)(
    'actual recovery startup transfers the exact %s selection beyond the startup scope', async (active, context) => {
      const lifetime = beginTrackedStartupTest(context);
      await lifetime.run(async () => {
        const p = await lifetime.step('fixturePreparation', () => prepare(context, lifetime, active, 'startup'));
        p.f.showMessageBox.mockResolvedValueOnce({ response: 1, checkboxChecked: false });
        const outcome = await lifetime.step('startup', () => p.start());
        if (outcome.status !== 'fulfilled') throw outcome.reason;
        try {
          expect(outcome.lifecycle).toBeDefined();
          expect(p.f.showMessageBox).toHaveBeenCalledOnce();
          expect(p.f.showMessageBox.mock.calls[0]).toMatchObject([undefined, {
            defaultId: 0, cancelId: 2, buttons: ['Jatka palautumista', 'Rajattu hallinta', 'Sulje'],
          }]);
          expect(p.readCapability()?.statusMode).toBe('recoveryManagement');
          expect(await p.readStatus()).toMatchObject({ formatVersion: 2, mode: 'recoveryManagement',
            operationState: 'idle', runtimeState: 'absent', target: { workspaceId },
            persistedActiveWorkspaceId: active === 'target' ? workspaceId
              : active === 'other' ? '44444444-4444-4444-8444-444444444444' : null });
          expect(p.f.events).toEqual([]); expect(electronBoundary.fork).not.toHaveBeenCalled();
          expect(p.f.createRuntimeSession).not.toHaveBeenCalled();
          expect(electronBoundary.loadWindow).toHaveBeenCalledExactlyOnceWith(p.f.mainWindow, 'selector');
          expect(electronBoundary.reservationReleased).not.toHaveBeenCalled();
          expect(electronBoundary.reservationAcquired).toHaveBeenCalledOnce();
          expect(p.f.relaunch).not.toHaveBeenCalled(); await p.assertPreserved();
        } finally { await outcome.lifecycle?.shutdown(); }
        expect(electronBoundary.reservationReleased).toHaveBeenCalledOnce();
      });
    },
  );

  it('actual recovery startup closes without opening a window or changing the selected target', async context => {
    const lifetime = beginTrackedStartupTest(context);
    await lifetime.run(async () => {
      const p = await lifetime.step('fixturePreparation', () => prepare(context, lifetime, 'target', 'startup'));
      p.f.showMessageBox.mockResolvedValueOnce({ response: 2, checkboxChecked: false });
      await expect(lifetime.step('startup', () => p.start())).resolves.toEqual({ status: 'fulfilled', lifecycle: undefined });
      expect(p.f.showMessageBox).toHaveBeenCalledOnce(); expect(p.f.quit).toHaveBeenCalledOnce();
      expect(p.f.events).toEqual([]); expect(p.f.relaunch).not.toHaveBeenCalled();
      expect(p.f.createRuntimeSession).not.toHaveBeenCalled(); expect(electronBoundary.fork).not.toHaveBeenCalled();
      expect(electronBoundary.createWindow).not.toHaveBeenCalled();
      expect(electronBoundary.reservationReleased).toHaveBeenCalledOnce();
      expect(electronBoundary.reservationReleased.mock.invocationCallOrder[0])
        .toBeLessThan(p.f.quit.mock.invocationCallOrder[0]!);
      await p.assertPreserved();
    });
  });

  for (const recoveryRoute of ['startup', 'injected'] as const) it.for([recoveryRoute])('actual recovery startup resumes the existing recovery exactly once with %s selection',
    { timeout: 10_000 }, async (route, context) => {
    const lifetime = beginTrackedStartupTest(context);
    await lifetime.run(async () => {
      const p = await lifetime.step('fixturePreparation', () => prepare(context, lifetime, 'none', route));
      // A just-published import must not contain the restore fixture's staging.
      await rm(p.f.stagingRoot, { recursive: true });
      expect((await readdir(dirname(dirname(p.f.databasePath)))).sort()).toEqual(['data', 'storage']);
      electronBoundary.fetch.mockImplementation(async input => String(input).endsWith('/customers')
        ? new Response(null, { status: 401 }) : new Response(JSON.stringify({ status: 'ok' })));
      const recover = vi.spyOn(WorkspaceFirstStartMigrationOrchestrator.prototype, 'recoverBeforeWorkspaceResolution');
      const operations = installCompletedColdCandidate('readiness', originalProfileId);
      const outcome = await lifetime.step('startup', () => p.start());
      if (outcome.status !== 'fulfilled') throw outcome.reason;
      try {
        expect(p.f.showMessageBox).toHaveBeenCalledOnce();
        expect(recover).toHaveBeenCalledOnce();
        expect(p.f.events).toEqual([]);
        expect(electronBoundary.loadWindow).toHaveBeenCalledExactlyOnceWith(p.f.mainWindow, 'selector');
        expect(p.readCapability()?.statusMode).not.toBe('recoveryManagement');
        expect(p.f.quit).not.toHaveBeenCalled(); expect(p.f.relaunch).not.toHaveBeenCalled();
        expect(operations).toHaveLength(1);
        expect(electronBoundary.reservationReleased.mock.calls.filter(([root]) => root === p.f.root)).toHaveLength(1);
        expect(electronBoundary.reservationAcquired.mock.calls.filter(([input]) => input.userDataRoot === p.f.root)).toHaveLength(2);
        expect(await readFile(p.f.databasePath, 'utf8')).toBe(p.f.originalBytes);
        expect(await readFile(p.f.pdfPath, 'utf8')).toBe('%PDF-1.7 original pdf');
      } finally { await outcome.lifecycle?.shutdown(); }
      expect(electronBoundary.reservationReleased.mock.calls.filter(([root]) => root === p.f.root)).toHaveLength(2);
    });
  });

  it('actual recovery startup joins a cancelled native choice before releasing ownership', async context => {
    const lifetime = beginTrackedStartupTest(context);
    await lifetime.run(async () => {
      const p = await lifetime.step('fixturePreparation', () => prepare(context, lifetime, 'target', 'startup'));
      const entered = createCompletionGate(), held = createCompletionGate();
      const release = () => { entered.resolve(); held.resolve(); };
      context.signal.addEventListener('abort', release, { once: true });
      p.f.showMessageBox.mockImplementationOnce(async () => {
        entered.resolve(); await held.promise;
        return { response: 1, checkboxChecked: false };
      });
      const started = lifetime.step('startup', () => p.start());
      let closing: Promise<void> | undefined;
      try {
        expect(await Promise.race([entered.promise.then(() => 'held'), started.then(() => 'settled')])).toBe('held');
        closing = p.startup.shutdown(); void closing.catch(() => undefined);
        await nextEventLoopTurn();
        expect(electronBoundary.reservationReleased).not.toHaveBeenCalled();
        expect(electronBoundary.createWindow).not.toHaveBeenCalled();
        held.resolve();
        expect(await started).toMatchObject({ status: 'rejected', cleanupError: undefined });
        await closing;
        expect(electronBoundary.reservationReleased).toHaveBeenCalledOnce();
        expect(electronBoundary.createWindow).not.toHaveBeenCalled();
        expect(p.f.events).toEqual([]); expect(p.f.relaunch).not.toHaveBeenCalled();
        await p.assertPreserved();
      } finally {
        release(); context.signal.removeEventListener('abort', release);
        await started; await closing;
      }
    });
  });

  it('actual recovery startup rejects a target change during the native choice without rediscovery', async context => {
    const lifetime = beginTrackedStartupTest(context);
    await lifetime.run(async () => {
      const p = await lifetime.step('fixturePreparation', () => prepare(context, lifetime, 'target', 'startup'));
      p.f.showMessageBox.mockImplementationOnce(async () => {
        const registry = (await p.f.registry.read())!;
        await p.f.registry.write({ ...registry, formatVersion: 2, activeWorkspaceId: null });
        return { response: 1, checkboxChecked: false };
      });
      const outcome = await lifetime.step('startup', () => p.start());
      expect(outcome).toMatchObject({ status: 'rejected', cleanupError: undefined });
      expect(p.f.showMessageBox).toHaveBeenCalledOnce();
      expect(p.readCapability()).toBeUndefined(); expect(electronBoundary.createWindow).not.toHaveBeenCalled();
      expect(electronBoundary.reservationReleased).toHaveBeenCalledOnce();
      expect(p.f.events).toEqual([]); expect(p.f.relaunch).not.toHaveBeenCalled();
      expect((await p.f.registry.read())?.activeWorkspaceId).toBeNull();
      expect(await readFile(p.f.databasePath, 'utf8')).toBe(p.f.originalBytes);
      expect(await readFile(p.f.pdfPath, 'utf8')).toBe('%PDF-1.7 original pdf');
    });
  });

  it('actual recovery startup closes a partial selector and retains its original construction error', async context => {
    const lifetime = beginTrackedStartupTest(context);
    await lifetime.run(async () => {
      const p = await lifetime.step('fixturePreparation', () => prepare(context, lifetime, 'target', 'startup'));
      const first = new Error('SYNTHETIC_STARTUP_RECOVERY_WINDOW_FAILURE', { cause: new Error('SYNTHETIC_STARTUP_RECOVERY_WINDOW_CAUSE') });
      p.f.showMessageBox.mockResolvedValueOnce({ response: 1, checkboxChecked: false });
      electronBoundary.createWindow.mockImplementationOnce(() => { throw first; });
      const outcome = await lifetime.step('startup', () => p.start());
      expect(outcome).toMatchObject({ status: 'rejected', cleanupError: undefined });
      expect(p.readStartupFailure()).toBe(first);
      expect(electronBoundary.reservationReleased).toHaveBeenCalledOnce();
      expect(p.f.events).toEqual([]); expect(p.f.relaunch).not.toHaveBeenCalled();
      expect(p.readCapability()).toBeUndefined(); await p.assertPreserved();
    });
  });

  it('actual recovery startup joins a fulfilled local selector when the old observation close fails', async context => {
    const lifetime = beginTrackedStartupTest(context);
    await lifetime.run(async () => {
      const p = await lifetime.step('fixturePreparation', () => prepare(context, lifetime, 'target', 'startup'));
      const first = new Error('SYNTHETIC_STARTUP_OLD_OBSERVATION_CLOSE_FAILURE');
      p.f.showMessageBox.mockResolvedValueOnce({ response: 1, checkboxChecked: false });
      const create = recoverySelection.createDesktopWorkspaceRecoverySelection;
      vi.spyOn(recoverySelection, 'createDesktopWorkspaceRecoverySelection').mockImplementation(input => {
        const owner = create(input);
        return Object.freeze({ ...owner, async waitForSettlement() {
          await owner.waitForSettlement();
          if (p.readCapability() !== undefined) throw first;
        } });
      });
      const entered = createCompletionGate(), held = createCompletionGate();
      const release = () => { entered.resolve(); held.resolve(); };
      context.signal.addEventListener('abort', release, { once: true });
      const shutdown = WorkspaceManagementService.prototype.shutdown;
      const closingService = vi.spyOn(WorkspaceManagementService.prototype, 'shutdown').mockImplementation(async function (this: WorkspaceManagementService) {
        const settled = shutdown.call(this);
        entered.resolve(); await held.promise;
        await settled;
      });
      const started = lifetime.step('startup', () => p.start());
      let settled = false;
      void started.then(() => { settled = true; }, () => { settled = true; });
      try {
        expect(await Promise.race([entered.promise.then(() => 'held'), started.then(() => 'settled')])).toBe('held');
        await nextEventLoopTurn();
        expect(settled).toBe(false); expect(closingService).toHaveBeenCalledOnce();
        expect(electronBoundary.reservationReleased).not.toHaveBeenCalled();
        held.resolve();
        const outcome = await started;
        expect(outcome.status).toBe('rejected');
        expect(p.readStartupFailure()).toMatchObject({ cause: first, errors: [first, expect.any(Error)] });
        expect(electronBoundary.reservationReleased).not.toHaveBeenCalled();
        await expect(p.readStatus()).rejects.toThrow();
        expect(p.f.events).toEqual([]); expect(p.f.relaunch).not.toHaveBeenCalled();
        await p.assertPreserved();
      } finally {
        release(); context.signal.removeEventListener('abort', release);
        await started;
      }
    });
  });

  it('actual recovery startup never reports the close choice as complete after native release fails', async context => {
    const lifetime = beginTrackedStartupTest(context);
    await lifetime.run(async () => {
      const p = await lifetime.step('fixturePreparation', () => prepare(context, lifetime, 'target', 'startup'));
      const first = new Error('SYNTHETIC_STARTUP_RECOVERY_RELEASE_FAILURE');
      p.f.showMessageBox.mockResolvedValueOnce({ response: 2, checkboxChecked: false });
      electronBoundary.reservationReleased.mockRejectedValueOnce(first);
      const outcome = await lifetime.step('startup', () => p.start());
      expect(outcome).toMatchObject({ status: 'rejected', cleanupError: undefined });
      expect(p.readStartupFailure()).toBe(first);
      expect(electronBoundary.reservationReleased).toHaveBeenCalledOnce(); expect(p.f.quit).not.toHaveBeenCalled();
      expect(electronBoundary.createWindow).not.toHaveBeenCalled(); expect(p.f.events).toEqual([]);
      await p.assertPreserved();
    });
  });

  it('actual recovery startup retains detected native ownership loss during the choice', async context => {
    const lifetime = beginTrackedStartupTest(context);
    await lifetime.run(async () => {
      const p = await lifetime.step('fixturePreparation', () => prepare(context, lifetime, 'target', 'startup'));
      p.f.showMessageBox.mockImplementationOnce(async () => {
        electronBoundary.loseReservation!();
        return { response: 1, checkboxChecked: false };
      });
      const outcome = await lifetime.step('startup', () => p.start());
      expect(outcome).toMatchObject({ status: 'rejected', cleanupError: undefined });
      expect(p.f.showMessageBox).toHaveBeenCalledOnce();
      expect(p.readCapability()).toBeUndefined(); expect(electronBoundary.createWindow).not.toHaveBeenCalled();
      expect(electronBoundary.reservationReleased).not.toHaveBeenCalled();
      expect(p.f.events).toEqual([]); expect(p.f.relaunch).not.toHaveBeenCalled();
      await p.assertPreserved();
    });
  });

  function modeledRecoveryPublication(
    slots: Parameters<typeof captureWorkspaceDeletionRegistryTransition>[0],
    content: Parameters<typeof captureWorkspaceDeletionRegistryTransition>[1],
  ) {
    const transition = captureWorkspaceDeletionRegistryTransition(slots, content);
    return { afterRegistry: transition.after,
      journal: captureWorkspaceDeletionJournal({ formatVersion: 1, phase: 'authorized', target: transition.target,
        registryBeforeSha256: transition.registryBeforeSha256, registryAfterSha256: transition.registryAfterSha256,
        previousActiveWorkspaceId: content.target.previousActiveWorkspaceId, backupDisposition: content.backupDisposition,
        inventory: { formatVersion: deletionInventoryFormatVersion, byteLength: 1, recordCount: 1, sha256: 'a'.repeat(64) },
        inventoryFileIdentity: 'b'.repeat(64), operationRootIdentity: 'c'.repeat(64), operationParentIdentity: 'd'.repeat(64) }) };
  }

  it.for(['target', 'other', 'none'] as const)('hands the same target to an independent selector owner with stored %s selection', async (active, context) => {
    const lifetime = beginTrackedStartupTest(context);
    await lifetime.run(async () => {
      const p = await lifetime.step('fixturePreparation', () => prepare(context, lifetime, active));
      const registryRead = vi.spyOn(WorkspaceRegistryStore.prototype, 'read');
      const outcome = await lifetime.step('startup', () => p.start());
      expect(outcome.status).toBe('fulfilled');
      if (outcome.status !== 'fulfilled') throw outcome.reason;
      try {
        expect(p.readSource()!.signal.aborted).toBe(true);
        expect(() => p.readOffer()!.assertCurrent()).toThrow();
        expect(await p.readStatus()).toMatchObject({ formatVersion: 2, mode: 'recoveryManagement', operationState: 'idle',
          runtimeState: 'absent', persistedActiveWorkspaceId: active === 'target' ? workspaceId : active === 'other'
            ? '44444444-4444-4444-8444-444444444444' : null,
          target: { workspaceId, workspaceLabel: 'Synthetic restore test' } });
        expect(electronBoundary.handle.mock.calls.map(([channel]) => channel).filter(channel =>
          [getWorkspaceManagementStatusIpcChannel, importWorkspaceBackupAsNewIpcChannel, renameWorkspaceIpcChannel,
            replaceActiveWorkspaceFromBackupIpcChannel].includes(String(channel))))
          .toEqual([getWorkspaceManagementStatusIpcChannel]);
        expect(p.readCapability()!.deletionRuntime).toBeDefined();
        expect(electronBoundary.ipcHandlers.has(deleteWorkspaceIpcChannel)).toBe(true);
        expect(registryRead).not.toHaveBeenCalled();
        expect(p.f.createRuntimeSession).not.toHaveBeenCalled(); expect(electronBoundary.fork).not.toHaveBeenCalled();
        expect(electronBoundary.fetch).not.toHaveBeenCalled(); expect(p.f.events).toEqual([]);
        expect(p.f.relaunch).not.toHaveBeenCalled(); expect(p.absence.assertOwned).toHaveBeenCalled();
        await p.assertPreserved();
      } finally { await outcome.lifecycle?.shutdown(); }
      expect(electronBoundary.reservationReleased).toHaveBeenCalledOnce();
    });
  });

  it.for(['dataLoss', 'deletion'] as const)('preserves recovery admission at the %s deletion consent boundary', async (consent, context) => {
    const lifetime = beginTrackedStartupTest(context);
    await lifetime.run(async () => {
      const p = await lifetime.step('fixturePreparation', () => prepare(context, lifetime));
      const outcome = await lifetime.step('startup', () => p.start());
      if (outcome.status !== 'fulfilled' || outcome.lifecycle === undefined) throw new Error('SYNTHETIC_SELECTOR_START_FAILED');
      if (consent === 'deletion') p.f.showMessageBox.mockResolvedValueOnce({ response: 1, checkboxChecked: false });
      try {
        expect(await p.deleteWorkspace({ formatVersion: 1, workspaceId,
          typedLabel: 'Synthetic restore test', backupChoice: 'explicitDataLoss' }))
          .toEqual({ formatVersion: 1, status: 'cancelled', nextAction: 'restartRequired' });
        expect(p.f.showMessageBox).toHaveBeenCalledTimes(consent === 'dataLoss' ? 1 : 2);
        expect(p.maintenanceLease.readState()).toBe('idle');
        expect(p.f.relaunch).not.toHaveBeenCalled(); expect(p.f.createRuntimeSession).not.toHaveBeenCalled();
        expect(electronBoundary.fork).not.toHaveBeenCalled();
        expect(electronBoundary.ipcHandlers.has(deleteWorkspaceIpcChannel)).toBe(consent === 'dataLoss');
        const journal = createWorkspaceDeletionJournalPaths(p.f.root);
        for (const path of [journal.currentPath, journal.backupPath, journal.nextPath]) await expect(readFile(path)).rejects.toMatchObject({ code: 'ENOENT' });
        await p.assertPreserved();
      } finally { await outcome.lifecycle.shutdown(); }
      expect(electronBoundary.reservationReleased).toHaveBeenCalledOnce();
    });
  });

  it('rejects another recovery target before native consent or a delete lease can change files', async context => {
    const lifetime = beginTrackedStartupTest(context);
    await lifetime.run(async () => {
      const p = await lifetime.step('fixturePreparation', () => prepare(context, lifetime));
      const outcome = await lifetime.step('startup', () => p.start());
      if (outcome.status !== 'fulfilled' || outcome.lifecycle === undefined) throw new Error('SYNTHETIC_SELECTOR_START_FAILED');
      const acquire = vi.spyOn(p.maintenanceLease, 'acquire');
      try {
        expect(await p.deleteWorkspace({ formatVersion: 1, workspaceId: '44444444-4444-4444-8444-444444444444',
          typedLabel: 'Synthetic other company', backupChoice: 'explicitDataLoss' }))
          .toMatchObject({ status: 'failed', sideEffectState: 'none', errorCode: 'WORKSPACE_MANAGEMENT_INVALID' });
        expect(acquire).not.toHaveBeenCalled(); expect(p.f.showMessageBox).not.toHaveBeenCalled();
        expect(p.maintenanceLease.readState()).toBe('idle');
        expect(p.f.relaunch).not.toHaveBeenCalled(); expect(electronBoundary.fork).not.toHaveBeenCalled();
        await p.assertPreserved();
      } finally { await outcome.lifecycle.shutdown(); }
    });
  });

  it('retains a target-local restore that appears at the last native consent and never publishes deletion', async context => {
    const lifetime = beginTrackedStartupTest(context);
    await lifetime.run(async () => {
      const p = await lifetime.step('fixturePreparation', () => prepare(context, lifetime));
      const outcome = await lifetime.step('startup', () => p.start());
      if (outcome.status !== 'fulfilled' || outcome.lifecycle === undefined) throw new Error('SYNTHETIC_SELECTOR_START_FAILED');
      const localJournal = createProfileSnapshotRuntimePaths(createDesktopProfilePaths(
        deriveWorkspaceRoot(p.f.root, workspaceId, 1).workspaceRoot).runtimeRoot).restoreActivationJournalPath;
      const lateBytes = Buffer.from('synthetic late local restore');
      p.f.showMessageBox.mockResolvedValueOnce({ response: 1, checkboxChecked: false })
        .mockImplementationOnce(async () => {
          await mkdir(dirname(localJournal), { recursive: true });
          await writeFile(localJournal, lateBytes, { flag: 'wx' });
          return { response: 1, checkboxChecked: false };
        });
      try {
        const result = await p.deleteWorkspace({ formatVersion: 1, workspaceId,
          typedLabel: 'Synthetic restore test', backupChoice: 'explicitDataLoss' });
        expect(result.status).not.toBe('completed');
        expect(result).toHaveProperty('nextAction', 'restartRequired');
        expect(p.f.showMessageBox).toHaveBeenCalledTimes(2);
        expect(await readFile(localJournal)).toEqual(lateBytes);
        const journal = createWorkspaceDeletionJournalPaths(p.f.root);
        for (const path of [journal.currentPath, journal.backupPath, journal.nextPath]) await expect(readFile(path)).rejects.toMatchObject({ code: 'ENOENT' });
        expect(p.maintenanceLease.readState()).toBe('idle');
        expect(p.f.relaunch).not.toHaveBeenCalled(); expect(electronBoundary.fork).not.toHaveBeenCalled();
        await p.assertPreserved();
      } finally { await outcome.lifecycle.shutdown(); }
      expect(electronBoundary.reservationReleased).toHaveBeenCalledOnce();
    });
  });

  it.for(['dataLoss', 'deletion'] as const)('joins the held recovery %s confirmation before releasing main ownership', async (consent, context) => {
    const lifetime = beginTrackedStartupTest(context);
    await lifetime.run(async () => {
      const p = await lifetime.step('fixturePreparation', () => prepare(context, lifetime));
      const outcome = await lifetime.step('startup', () => p.start());
      if (outcome.status !== 'fulfilled' || outcome.lifecycle === undefined) throw new Error('SYNTHETIC_SELECTOR_START_FAILED');
      const entered = createCompletionGate(), held = createCompletionGate();
      const release = () => { entered.resolve(); held.resolve(); };
      context.signal.addEventListener('abort', release, { once: true });
      let dialogSettled = false, requestSettled = false;
      if (consent === 'deletion') p.f.showMessageBox.mockResolvedValueOnce({ response: 1, checkboxChecked: false });
      p.f.showMessageBox.mockImplementationOnce(async () => {
        entered.resolve(); await held.promise; dialogSettled = true;
        return { response: 1, checkboxChecked: false };
      });
      const work = p.deleteWorkspace({ formatVersion: 1, workspaceId,
        typedLabel: 'Synthetic restore test', backupChoice: 'explicitDataLoss' })
        .then(value => ({ value }), (cause: unknown) => ({ cause })).finally(() => { requestSettled = true; });
      let closing: Promise<void> | undefined;
      try {
        expect(await Promise.race([entered.promise.then(() => 'held'), work.then(() => 'settled')])).toBe('held');
        closing = outcome.lifecycle.shutdown();
        await nextEventLoopTurn();
        expect(dialogSettled).toBe(false); expect(requestSettled).toBe(false);
        expect(electronBoundary.reservationReleased).not.toHaveBeenCalled();
        held.resolve();
        const result = await work;
        expect(result).not.toMatchObject({ value: { status: 'completed' } });
        await closing;
        expect(dialogSettled).toBe(true); expect(p.maintenanceLease.readState()).toBe('idle');
        expect(electronBoundary.reservationReleased).toHaveBeenCalledOnce();
        expect(p.f.relaunch).not.toHaveBeenCalled(); expect(electronBoundary.fork).not.toHaveBeenCalled();
        await p.assertPreserved();
      } finally {
        release(); context.signal.removeEventListener('abort', release);
        await work; await (closing ?? outcome.lifecycle.shutdown());
      }
    });
  });

  it('routes fixture cancellation to the real recovery close owner before joining a held dialog', async context => {
    const lifetime = beginTrackedStartupTest(context);
    await lifetime.run(async () => {
      const p = await lifetime.step('fixturePreparation', () => prepare(context, lifetime));
      const cancellation = new AbortController();
      const outcome = await lifetime.step('startup', () => p.start(cancellation.signal));
      if (outcome.status !== 'fulfilled' || outcome.lifecycle === undefined) throw new Error('SYNTHETIC_SELECTOR_START_FAILED');
      const shutdown = vi.spyOn(outcome.lifecycle, 'shutdown');
      const entered = createCompletionGate(), held = createCompletionGate();
      const release = () => { entered.resolve(); held.resolve(); };
      context.signal.addEventListener('abort', release, { once: true });
      let dialogSettled = false, shutdownSettled = false;
      p.f.showMessageBox.mockImplementationOnce(async () => {
        entered.resolve(); await held.promise; dialogSettled = true;
        return { response: 1, checkboxChecked: false };
      });
      const work = p.deleteWorkspace({ formatVersion: 1, workspaceId,
        typedLabel: 'Synthetic restore test', backupChoice: 'explicitDataLoss' })
        .then(value => ({ value }), (cause: unknown) => ({ cause }));
      try {
        expect(await Promise.race([entered.promise.then(() => 'held'), work.then(() => 'settled')])).toBe('held');
        cancellation.abort(); await nextEventLoopTurn(); expect(shutdown).toHaveBeenCalledOnce();
        const closing = shutdown.mock.results[0]!.value as Promise<void>;
        void closing.then(() => { shutdownSettled = true; }, () => { shutdownSettled = true; });
        await nextEventLoopTurn();
        expect(shutdownSettled).toBe(false); expect(dialogSettled).toBe(false);
        expect(electronBoundary.reservationReleased).not.toHaveBeenCalled();
        held.resolve(); expect(await work).not.toMatchObject({ value: { status: 'completed' } });
        await closing; expect(shutdownSettled).toBe(true); expect(dialogSettled).toBe(true);
        expect(p.maintenanceLease.readState()).toBe('idle');
        expect(electronBoundary.reservationReleased).toHaveBeenCalledOnce();
        expect(p.f.relaunch).not.toHaveBeenCalled(); expect(electronBoundary.fork).not.toHaveBeenCalled();
        await p.assertPreserved();
      } finally {
        release(); context.signal.removeEventListener('abort', release);
        await work; await outcome.lifecycle.shutdown();
      }
    });
  });

  it('releases a pre-observation fixture reservation once after immediate startup cancellation', async context => {
    const lifetime = beginTrackedStartupTest(context);
    await lifetime.run(async () => {
      const p = await lifetime.step('fixturePreparation', () => prepare(context, lifetime));
      const cancellation = new AbortController();
      const started = p.start(cancellation.signal);
      cancellation.abort();
      expect(await started).toMatchObject({ status: 'rejected' });
      await p.startup.shutdown();
      expect(electronBoundary.reservationReleased).toHaveBeenCalledOnce();
      expect(electronBoundary.createWindow).not.toHaveBeenCalled();
      expect(p.f.createRuntimeSession).not.toHaveBeenCalled(); expect(electronBoundary.fork).not.toHaveBeenCalled();
      expect(p.f.relaunch).not.toHaveBeenCalled(); await p.assertPreserved();
    });
  });

  it.for(['currentPath', 'backupPath', 'nextPath', 'foreignRestore'] as const)(
    'keeps the transferred main selection closed after a late %s without granting deletion', async (slot, context) => {
      const lifetime = beginTrackedStartupTest(context);
      await lifetime.run(async () => {
        const p = await lifetime.step('fixturePreparation', () => prepare(context, lifetime));
        const create = vi.spyOn(deletionCommand, 'createWorkspaceDeletionCommand');
        const outcome = await lifetime.step('startup', () => p.start());
        if (outcome.status !== 'fulfilled' || outcome.lifecycle === undefined) throw new Error('SYNTHETIC_SELECTOR_START_FAILED');
        const configured = create.mock.calls[0]![0];
        const assertCurrent = () => context.signal.throwIfAborted();
        try {
          await configured.coldSelection!.assertReservationOwned();
          const selected = await captureDeletionTarget({ installationRoot: p.f.root, workspaceId,
            typedLabel: 'Synthetic restore test', registry: configured.registry, assertAuthority: assertCurrent });
          const content = { operationId: '55555555-5555-4555-8555-555555555555',
            target: selected.target, backupDisposition: 'explicitDataLoss' as const };
          // Model the publisher's in-memory binding, not a published inventory or deletion permit.
          const model = modeledRecoveryPublication(await configured.registry.inspectSlots(assertCurrent), content);
          await configured.beforeJournalPublication!(model.journal, model.afterRegistry);
          await configured.coldSelection!.assertStableSelection();
          const target = slot === 'foreignRestore' ? validateWorkspaceId('44444444-4444-4444-8444-444444444444') : workspaceId;
          const restorePaths = createProfileSnapshotRuntimePaths(createDesktopProfilePaths(
            deriveWorkspaceRoot(p.f.root, target, 1).workspaceRoot).runtimeRoot);
          const path = slot === 'foreignRestore' || slot === 'currentPath' ? restorePaths.restoreActivationJournalPath
            : restorePaths.restoreActivationJournalPath + (slot === 'backupPath' ? '.backup' : '.next');
          const bytes = Buffer.from('synthetic late restore after source handoff');
          await mkdir(dirname(path), { recursive: true }); await writeFile(path, bytes, { flag: 'wx' });
          await expect(configured.coldSelection!.assertStableSelection()).rejects.toThrow();
          expect(await readFile(path)).toEqual(bytes); await p.assertPreserved();
          expect(p.f.showMessageBox).not.toHaveBeenCalled(); expect(p.f.relaunch).not.toHaveBeenCalled();
          expect(electronBoundary.fork).not.toHaveBeenCalled();
          expect(electronBoundary.ipcHandlers.has(deleteWorkspaceIpcChannel)).toBe(true);
          const deletionPaths = createWorkspaceDeletionJournalPaths(p.f.root);
          for (const path of [deletionPaths.currentPath, deletionPaths.backupPath, deletionPaths.nextPath]) {
            await expect(readFile(path)).rejects.toMatchObject({ code: 'ENOENT' });
          }
        } finally { await outcome.lifecycle.shutdown(); }
        expect(electronBoundary.reservationReleased).toHaveBeenCalledOnce();
      });
    });

  it.for(['completed', 'heldHandoff', 'heldContinuation', 'replyLost'] as const)(
    'joins the actual recovery main service and result through a modeled command: %s', async (stage, context) => {
      const lifetime = beginTrackedStartupTest(context);
      await lifetime.run(async () => {
        const p = await lifetime.step('fixturePreparation', () => prepare(context, lifetime, 'other'));
        const entered = createCompletionGate(), held = createCompletionGate();
        const release = () => { entered.resolve(); held.resolve(); };
        context.signal.addEventListener('abort', release, { once: true });
        const createCommand = deletionCommand.createWorkspaceDeletionCommand;
        let published: WorkspaceDeletionJournal | undefined, assertLease: (() => void) | undefined;
        const capture = p.maintenanceLease.captureCurrentOwner.bind(p.maintenanceLease);
        vi.spyOn(p.maintenanceLease, 'captureCurrentOwner').mockImplementation((purposes, handle) => {
          const current = capture(purposes, handle);
          if (purposes.includes('delete')) assertLease ??= current;
          return current;
        });
        const createResultRuntime = deletionContinuation.createWorkspaceDeletionResultRuntime;
        let originalComplete: ReturnType<typeof createResultRuntime>['complete'] | undefined, resultCompleted = false;
        const complete = vi.fn<ReturnType<typeof createResultRuntime>['complete']>(async value => {
          expect(p.maintenanceLease.readState()).toBe('idle');
          expect(assertLease).toBeDefined(); expect(assertLease).toThrow('WORKSPACE_MAINTENANCE_BUSY');
          if (originalComplete === undefined) throw new Error('SYNTHETIC_RECOVERY_RESULT_MISSING');
          await originalComplete(value);
          resultCompleted = true;
        });
        const resultFactory = vi.spyOn(deletionContinuation, 'createWorkspaceDeletionResultRuntime').mockImplementation(options => {
          expect(options.kind).toBe('recoveryManagement');
          const runtime = createResultRuntime(options);
          originalComplete = runtime.complete.bind(runtime);
          return Object.freeze({ ...runtime, complete });
        });
        let continuationEntered = false, heldSettled = false, terminalRecorded = false;
        vi.spyOn(deletionCommand, 'createWorkspaceDeletionCommand').mockImplementation(options => ({
          ...createCommand(options),
          async publish(current, selected, target, content, prepared, readOwned) {
            // The real prepare/handoff/result owners run; only physical publication and purge are modeled.
            current(); await selected(); await prepared(); await readOwned?.();
            const model = modeledRecoveryPublication(await options.registry.inspectSlots(current), content);
            await options.beforeJournalPublication!(model.journal, model.afterRegistry);
            if (stage === 'heldHandoff') { entered.resolve(); await held.promise; heldSettled = true; }
            current(); published = model.journal;
            return { journal: published, workspaceRootIdentity: target.rootIdentity };
          },
          async resume(operationId, authority) {
            continuationEntered = true;
            expect(published?.target.operationId).toBe(operationId);
            expect(p.maintenanceLease.readState()).toBe('busy'); assertLease!();
            await options.coldSelection!.assertStableSelection(); await authority.assertOwned();
            if (stage === 'heldContinuation' || stage === 'replyLost') { entered.resolve(); await held.promise; heldSettled = true; }
            authority.assertCurrent();
            authority.recordRemoved({ status: 'removed', journal: { ...published!, phase: 'registryPublished' } });
            terminalRecorded = true;
            return { formatVersion: 1, status: 'completed', navigation: 'reopenPrevious' };
          },
        }));
        const outcome = await lifetime.step('startup', () => p.start());
        if (outcome.status !== 'fulfilled' || outcome.lifecycle === undefined) throw new Error('SYNTHETIC_SELECTOR_START_FAILED');
        p.f.showMessageBox.mockResolvedValue({ response: 1, checkboxChecked: false });
        let settled = false, shutdownSettled = false, closing: Promise<void> | undefined;
        const work = p.deleteWorkspace({ formatVersion: 1, workspaceId,
          typedLabel: 'Synthetic restore test', backupChoice: 'explicitDataLoss' })
          .then(value => ({ value }), (cause: unknown) => ({ cause })).finally(() => { settled = true; });
        try {
          if (stage !== 'completed') {
            expect(await Promise.race([entered.promise.then(() => 'held'), work.then(() => 'settled')])).toBe('held');
            if (stage === 'replyLost') p.f.mainWindow.webContents.emit('did-start-navigation', { isMainFrame: true });
            else {
              closing = outcome.lifecycle.shutdown();
              void closing.then(() => { shutdownSettled = true; }, () => { shutdownSettled = true; });
            }
            await nextEventLoopTurn();
            expect(settled).toBe(false); expect(heldSettled).toBe(false); expect(shutdownSettled).toBe(false);
            expect(electronBoundary.reservationReleased).not.toHaveBeenCalled();
            held.resolve();
          }
          const result = await work;
          if (stage === 'completed') expect(result).toEqual({ value: {
            formatVersion: 1, status: 'completed', navigation: 'reopenPrevious' } });
          else expect(result).not.toMatchObject({ value: { status: 'completed' } });
          if (stage === 'replyLost') expect(result).toMatchObject({ cause: { message: 'WORKSPACE_MANAGEMENT_CAPABILITY_FORBIDDEN' } });
          expect(resultFactory).toHaveBeenCalledOnce();
          expect(complete).toHaveBeenCalledTimes(stage === 'completed' || stage === 'replyLost' ? 1 : 0);
          expect(resultCompleted).toBe(stage === 'completed' || stage === 'replyLost');
          expect(terminalRecorded).toBe(stage === 'completed' || stage === 'replyLost');
          expect(continuationEntered).toBe(stage !== 'heldHandoff');
          expect(assertLease).toBeDefined(); expect(assertLease).toThrow('WORKSPACE_MAINTENANCE_BUSY');
          expect(p.maintenanceLease.readState()).toBe('idle');
          expect(p.f.relaunch).not.toHaveBeenCalled(); expect(electronBoundary.fork).not.toHaveBeenCalled();
          expect(electronBoundary.ipcHandlers.has(deleteWorkspaceIpcChannel)).toBe(false);
          await p.assertPreserved();
        } finally {
          release(); context.signal.removeEventListener('abort', release);
          await work; await (closing ?? outcome.lifecycle.shutdown());
        }
        if (closing !== undefined) expect(shutdownSettled).toBe(true);
        expect(electronBoundary.reservationReleased).toHaveBeenCalledOnce();
      });
    });

  it('publishes the recovery main selection before a controlled durable stop without rereading discovery', async context => {
    const sourceReadPorts: { assertAuthority(): void; assertRecoverySourceReadCurrent?(): void }[] = [];
    const sourceCapture = sourceComparisonFactory.captureWorkspaceDeletionInventorySources;
    vi.spyOn(sourceComparisonFactory, 'captureWorkspaceDeletionInventorySources').mockImplementation(async (...values) => {
      const selected = await sourceCapture(...values);
      return Object.freeze({ ...selected, records(...args: Parameters<typeof selected.records>) {
        if (args[0] !== undefined) sourceReadPorts.push(args[0]);
        return selected.records(...args);
      } });
    });
    const lifetime = beginTrackedStartupTest(context);
    const observedPhases: WorkspaceDeletionPhaseEvent[] = [], observedDetails: WorkspaceDeletionPhaseEvent[] = [];
    const observedSlots: SlotIoEvent[] = [];
    await lifetime.run(async () => {
      const lifecycleProof = observeSelectorPreparationForTest();
      const p = await lifetime.step('fixturePreparation', () => prepare(context, lifetime, 'target', 'startup', {
        phase(event) { observedPhases.push(event); }, detail(event) { observedDetails.push(event); },
        slot(event) { observedSlots.push(event); },
      }));
      const originalCreate = deletionCommand.createWorkspaceDeletionCommand;
      const discoveries = vi.spyOn(recoverySources, 'readDesktopWorkspaceRecoveryTarget');
      let transferredAt: number | undefined;
      const callbacks: { kind: 'preparation' | 'readOwned'; side: 'before' | 'after';
        combined: number; producer: number; strict: number }[] = [];
      const fullSelections: { side: 'before' | 'after'; comparison: number | undefined; steps: string[] }[] = [];
      let comparisonOrdinal = 0, comparison: number | undefined;
      let fullSelection: string[] | undefined;
      const measured = async (kind: 'preparation' | 'readOwned', work: () => Promise<void>) => {
        fullSelection?.push(kind);
        const combined = lifecycleProof.combined.mock.calls.length, strict = lifecycleProof.strict.mock.calls.length;
        const proof = lifecycleProof.instances[0]!.proof!;
        const producer = proof.mock.calls.length;
        await work();
        callbacks.push({ kind, side: transferredAt === undefined ? 'before' : 'after',
          combined: lifecycleProof.combined.mock.calls.length - combined,
          producer: proof.mock.calls.length - producer, strict: lifecycleProof.strict.mock.calls.length - strict });
      };
      const stopped = new Error('SYNTHETIC_DURABLE_STOP_AFTER_REAL_PUBLICATION');
      const resume = vi.fn(async () => { throw stopped; });
      const create = vi.spyOn(deletionCommand, 'createWorkspaceDeletionCommand').mockImplementation(options => {
        const handoff = options.beforeJournalPublication;
        if (handoff === undefined) throw new Error('SYNTHETIC_RECOVERY_HANDOFF_MISSING');
        const command = originalCreate({ ...options,
          assertWritersAbsent() { fullSelection?.push('writers'); return options.assertWritersAbsent(); },
          observePublicationPhase(event) {
            if (event.phase === 'sourceComparison')
              comparison = event.event === 'entered' ? ++comparisonOrdinal : undefined;
            if (event.phase === 'fullSelection') {
              if (event.event === 'entered') {
                fullSelection = [];
                fullSelections.push({ side: transferredAt === undefined ? 'before' : 'after', comparison, steps: fullSelection });
              } else fullSelection = undefined;
            }
            options.observePublicationPhase?.(event);
          },
          async beforeJournalPublication(...args) {
            await handoff(...args); transferredAt = discoveries.mock.calls.length;
          } });
        return Object.freeze({ ...command, async publish(...args) {
          const tracked: Parameters<typeof command.publish> = [...args];
          tracked[4] = () => measured('preparation', args[4]);
          const readOwned = args[5];
          if (readOwned !== undefined) tracked[5] = () => measured('readOwned', readOwned);
          return command.publish(...tracked);
        }, resume });
      });
      p.f.showMessageBox.mockResolvedValueOnce({ response: 1, checkboxChecked: false });
      const outcome = await lifetime.step('startup', () => p.start());
      if (outcome.status !== 'fulfilled' || outcome.lifecycle === undefined) throw new Error('SYNTHETIC_SELECTOR_START_FAILED');
      p.f.showMessageBox.mockResolvedValue({ response: 1, checkboxChecked: false });
      await runRestoreStartupTestWithShutdown(async () => {
        expect(observedPhases).toEqual([]); expect(observedDetails).toEqual([]); expect(observedSlots).toEqual([]);
        expect(await p.deleteWorkspace({ formatVersion: 1, workspaceId,
          typedLabel: 'Synthetic restore test', backupChoice: 'explicitDataLoss' }))
          .toMatchObject({ status: 'recoveryRequired', sideEffectState: 'unknown', nextAction: 'restartRequired' });
        expect(create).toHaveBeenCalledOnce(); expect(resume).toHaveBeenCalledOnce();
        expect(lifecycleProof.instances).toHaveLength(1);
        const options = lifecycleProof.instances[0]!.options;
        if (options.kind !== 'recoveryManagement') throw new Error('SYNTHETIC_RECOVERY_LIFECYCLE_MISSING');
        expect(options.assertMainOwnedAndRuntimeAbsent).toBe(options.assertRuntimeAbsent);
        for (const side of ['before', 'after'] as const) {
          for (const kind of ['preparation', 'readOwned'] as const) {
            const selected = callbacks.filter(value => value.side === side && value.kind === kind);
            expect(selected.length).toBeGreaterThan(1);
            for (const value of selected) expect(value).toEqual({ kind, side, combined: 1, producer: 1, strict: 0 });
          }
          const selected = fullSelections.filter(value => value.side === side);
          expect(selected.length).toBeGreaterThan(0);
          for (const value of selected) {
            const recoveryComparison = value.side === 'after' && (value.comparison ?? 0) > 1;
            expect(value.steps.slice(0, 3)).toEqual(recoveryComparison
              ? ['readOwned', 'writers', 'preparation'] : ['preparation', 'writers', 'preparation']);
            expect(value.steps.at(-1)).toBe('preparation');
          }
        }
        expect(comparisonOrdinal).toBe(4);
        expect(fullSelections.filter(value => value.side === 'after' && (value.comparison ?? 0) > 1)
          .map(value => value.comparison)).toEqual([2, 2, 3, 3, 4, 4]);
        expect(lifecycleProof.failures).toHaveLength(1);
        expect(hasErrorCause(lifecycleProof.failures[0], stopped)).toBe(true);
        expect(p.absence.assertOwned).not.toHaveBeenCalled();
        expect(create.mock.calls[0]![0].observeTerminalPhase).toBeTypeOf('function');
        expect(create.mock.calls[0]![0].observeTerminalPhase).toBe(create.mock.calls[0]![0].observePublicationPhase);
        expect(transferredAt).toBeDefined(); expect(discoveries).toHaveBeenCalledTimes(transferredAt!);
        const observedSlotCount = observedSlots.length;
        expect((await new WorkspaceDeletionJournalStore(p.f.root).inspect(() => context.signal.throwIfAborted())).plan.mode).toBe('published');
        expect(observedSlots).toHaveLength(observedSlotCount);
        expect(p.maintenanceLease.readState()).toBe('idle');
        expect(p.f.relaunch).not.toHaveBeenCalled(); expect(p.f.createRuntimeSession).not.toHaveBeenCalled();
        expect(electronBoundary.fork).not.toHaveBeenCalled();
        expect(electronBoundary.ipcHandlers.has(deleteWorkspaceIpcChannel)).toBe(false);
        await p.assertPreserved();
        expect(observedPhases).toEqual([
          { phase: 'preparation', event: 'entered', callId: 1 },
          { phase: 'journalPublication', event: 'entered', callId: 2 },
          { phase: 'journalPublication', event: 'fulfilled', callId: 2 },
          { phase: 'preparation', event: 'fulfilled', callId: 1 },
        ]);
        expect(observedDetails.filter(event => event.event === 'entered' &&
          (event.phase === 'sourceComparison' || event.phase === 'selectionHandoff')).map(event => event.phase))
          .toEqual(['sourceComparison', 'selectionHandoff', 'sourceComparison', 'sourceComparison', 'sourceComparison']);
        expect(observedDetails.some(event => event.phase === 'fullSelection' && event.event === 'entered')).toBe(true);
        expect(observedDetails.some(event => event.phase === 'reservation' && event.event === 'entered')).toBe(true);
        for (const events of [observedPhases, observedDetails]) {
          expect(events.filter(event => event.event === 'rejected')).toEqual([]);
          expect(events.filter(event => event.event === 'entered').map(event => `${event.phase}:${event.callId}`).sort())
            .toEqual(events.filter(event => event.event === 'fulfilled').map(event => `${event.phase}:${event.callId}`).sort());
          for (const event of events) {
            expect(Object.isFrozen(event)).toBe(true);
            expect(Object.keys(event).sort()).toEqual(['callId', 'event', 'phase']);
          }
        }
        expect(observedSlots.filter(event => event.event === 'rejected')).toEqual([]);
        expect(observedSlots.filter(event => event.event === 'entered').map(event => event.callId).sort())
          .toEqual(observedSlots.filter(event => event.event === 'fulfilled').map(event => event.callId).sort());
        for (const event of observedSlots) {
          expect(Object.isFrozen(event)).toBe(true);
          expect(Object.keys(event).sort()).toEqual(['callId', 'event', 'operation', 'scope']);
        }
        for (const [scope, operation] of [
          ['group', 'writerWrite'], ['ioAttempt', 'fileWrite'], ['group', 'writerClose'], ['ioAttempt', 'fileClose'],
        ] as const) {
          expect(observedSlots.some(event => event.scope === scope && event.operation === operation && event.event === 'fulfilled')).toBe(true);
        }
      }, () => outcome.lifecycle!.shutdown());
      expect(electronBoundary.reservationReleased).toHaveBeenCalledOnce();
    });
    expect(sourceReadPorts).toHaveLength(4);
    expect(new Set(sourceReadPorts).size).toBe(4);
    for (const port of sourceReadPorts) {
      expect(port.assertRecoverySourceReadCurrent).toBeTypeOf('function');
      expect(() => port.assertRecoverySourceReadCurrent?.()).toThrow();
      expect(() => port.assertAuthority()).toThrow();
    }
  }, recoveryPublicationCompositionTimeoutMs);

  it.for([
    ['preparation', 'fresh'], ['readOwned', 'fresh'],
    ['preparation', 'expiredTenure'], ['readOwned', 'expiredTenure'],
  ] as const)('keeps the recovery %s callback bound to %s main ownership', async ([callback, mode], context) => {
    const lifetime = beginTrackedStartupTest(context);
    await lifetime.run(async () => {
      const lifecycleProof = observeSelectorPreparationForTest();
      const p = await lifetime.step('fixturePreparation', () => prepare(context, lifetime, 'target', 'startup'));
      p.f.showMessageBox.mockResolvedValueOnce({ response: 1, checkboxChecked: false });
      const outcome = await lifetime.step('startup', () => p.start());
      if (outcome.status !== 'fulfilled' || outcome.lifecycle === undefined) throw new Error('SYNTHETIC_SELECTOR_START_FAILED');
      p.f.showMessageBox.mockResolvedValue({ response: 1, checkboxChecked: false });
      const preparation = prodPreparation.prepareWorkspaceDeletion;
      const stopped = new Error('SYNTHETIC_PREPARATION_PROOFS_COMPLETE');
      const observations: { rejected: boolean; reason: unknown; physical: number; combined: number; producer: number }[] = [];
      let successorProved = false;
      vi.spyOn(prodPreparation, 'prepareWorkspaceDeletion').mockImplementation(input => preparation({ ...input,
        async publish(_guard, _selection, _target, _content, full, owned, readCurrent) {
          const selected = callback === 'preparation' ? full : owned;
          if (selected === undefined) throw new Error('SYNTHETIC_PREPARATION_CALLBACK_MISSING');
          if (readCurrent === undefined) throw new Error('SYNTHETIC_RECOVERY_READ_CALLBACK_MISSING');
          const captured = lifecycleProof.instances[0]!;
          if (mode === 'expiredTenure') {
            const reservation = captured.options.reservation as Awaited<ReturnType<typeof acquireDesktopWorkspaceReservation>>;
            // No child is prepared or granted. Reclaim the still-held reservation
            // in a new tenure; the startup's original receipt must stay expired.
            const transfer = reservation.bind('55555555-5555-4555-8555-555555555555', () => context.signal.throwIfAborted());
            await transfer.reclaimAfterExit(context.signal);
            await reservation.captureMainOwnership().assertOwned(); successorProved = true;
          }
          for (let invocation = 0; invocation < 2; invocation++) {
            const physical = vi.fn();
            electronBoundary.observeReservationOwned = physical;
            const before = lifecycleProof.combined.mock.calls.length, proofBefore = captured.proof!.mock.calls.length;
            const result = await selected().then(() => ({ rejected: false, reason: undefined }),
              (reason: unknown) => ({ rejected: true, reason }));
            observations.push({ ...result, physical: physical.mock.calls.length,
              combined: lifecycleProof.combined.mock.calls.length - before,
              producer: captured.proof!.mock.calls.length - proofBefore });
          }
          const physical = vi.fn();
          electronBoundary.observeReservationOwned = physical;
          if (mode === 'fresh') readCurrent();
          else expect(() => readCurrent()).toThrow();
          expect(physical).not.toHaveBeenCalled();
          throw mode === 'fresh' ? stopped : observations[0]!.reason;
        },
      }));
      try {
        expect(await p.deleteWorkspace({ formatVersion: 1, workspaceId,
          typedLabel: 'Synthetic restore test', backupChoice: 'explicitDataLoss' }))
          .toMatchObject({ status: 'recoveryRequired', nextAction: 'restartRequired' });
        expect(lifecycleProof.instances).toHaveLength(1); expect(observations).toHaveLength(2);
        if (mode === 'fresh') {
          for (const value of observations) expect(value).toEqual({ rejected: false, reason: undefined,
            physical: 1, combined: 1, producer: 1 });
          expect(hasErrorCause(lifecycleProof.failures[0], stopped)).toBe(true);
          await outcome.lifecycle.shutdown();
          expect(electronBoundary.reservationReleased).toHaveBeenCalledOnce();
        } else {
          expect(successorProved).toBe(true);
          for (const value of observations) expect(value).toMatchObject({ rejected: true, physical: 0, combined: 0, producer: 0 });
          if (callback === 'readOwned') expect(observations[1]!.reason).toBe(observations[0]!.reason);
          const first = observations[0]!.reason;
          if (!(first instanceof Error)) throw new Error('SYNTHETIC_ORIGINAL_PROOF_FAILURE_MISSING');
          expect(hasErrorCause(lifecycleProof.failures[0], first)).toBe(true);
          await expect(outcome.lifecycle.shutdown()).rejects.toThrow('DESKTOP_SHUTDOWN_FAILED');
          expect(electronBoundary.reservationReleased).not.toHaveBeenCalled();
        }
        expect(lifecycleProof.failures).toHaveLength(1);
        expect(p.absence.assertOwned).not.toHaveBeenCalled();
        expect(p.maintenanceLease.readState()).toBe('idle');
        expect(electronBoundary.fork).not.toHaveBeenCalled(); await p.assertPreserved();
      } finally {
        electronBoundary.observeReservationOwned = undefined;
        await outcome.lifecycle.shutdown().catch(() => undefined);
      }
    });
  });

  it.for(['preparation', 'readOwned'] as const)(
    'joins the recovery %s combined proof before shutdown can release ownership', async (callback, context) => {
      const lifetime = beginTrackedStartupTest(context);
      await lifetime.run(async () => {
        const lifecycleProof = observeSelectorPreparationForTest();
        const p = await lifetime.step('fixturePreparation', () => prepare(context, lifetime, 'target', 'startup'));
        p.f.showMessageBox.mockResolvedValueOnce({ response: 1, checkboxChecked: false });
        const outcome = await lifetime.step('startup', () => p.start());
        if (outcome.status !== 'fulfilled' || outcome.lifecycle === undefined) throw new Error('SYNTHETIC_SELECTOR_START_FAILED');
        p.f.showMessageBox.mockResolvedValue({ response: 1, checkboxChecked: false });
        const entered = createCompletionGate(), held = createCompletionGate();
        const release = () => { entered.resolve(); held.resolve(); };
        context.signal.addEventListener('abort', release, { once: true });
        let physicalSettled = false, callbackSettled = false, shutdownSettled = false, repeatRefused = false;
        let combinedEntered = 0, producerEntered = 0;
        let firstFailure: { reason: unknown } | undefined, repeatedFailure: { reason: unknown } | undefined;
        const releaseStates: { physicalSettled: boolean; callbackSettled: boolean }[] = [];
        const releaseReservation = electronBoundary.reservationReleased.getMockImplementation();
        electronBoundary.reservationReleased.mockImplementation(async (...args) => {
          releaseStates.push({ physicalSettled, callbackSettled }); await releaseReservation?.(...args);
        });
        const preparation = prodPreparation.prepareWorkspaceDeletion;
        vi.spyOn(prodPreparation, 'prepareWorkspaceDeletion').mockImplementation(input => preparation({ ...input,
          async publish(_guard, _selection, _target, _content, full, owned) {
            const selected = callback === 'preparation' ? full : owned;
            if (selected === undefined) throw new Error('SYNTHETIC_PREPARATION_CALLBACK_MISSING');
            const captured = lifecycleProof.instances[0]!;
            const before = lifecycleProof.combined.mock.calls.length, proofBefore = captured.proof!.mock.calls.length;
            electronBoundary.observeReservationOwned = () => {
              electronBoundary.observeReservationOwned = undefined;
              combinedEntered = lifecycleProof.combined.mock.calls.length - before;
              producerEntered = captured.proof!.mock.calls.length - proofBefore;
              entered.resolve(); return held.promise.then(() => { physicalSettled = true; });
            };
            try { await selected(); }
            catch (first) {
              firstFailure = { reason: first };
              try { await selected(); }
              catch (reason) { repeatRefused = true; repeatedFailure = { reason }; }
              throw first;
            } finally { callbackSettled = true; }
          },
        }));
        const command = Promise.resolve(p.deleteWorkspace({ formatVersion: 1, workspaceId,
          typedLabel: 'Synthetic restore test', backupChoice: 'explicitDataLoss' }))
          .then(value => ({ value }), (error: unknown) => ({ error }));
        let closing: Promise<void> | undefined;
        try {
          expect(await Promise.race([entered.promise.then(() => 'held'), command.then(() => 'settled')])).toBe('held');
          expect(combinedEntered).toBe(1); expect(producerEntered).toBe(1);
          closing = outcome.lifecycle.shutdown();
          void closing.then(() => { shutdownSettled = true; }, () => { shutdownSettled = true; });
          expect(outcome.lifecycle.shutdown()).toBe(closing);
          await nextEventLoopTurn();
          expect({ physicalSettled, callbackSettled, shutdownSettled }).toEqual({
            physicalSettled: false, callbackSettled: false, shutdownSettled: false });
          expect(electronBoundary.reservationReleased).not.toHaveBeenCalled();
          held.resolve();
          expect(await command).toMatchObject({ error: { message: 'WORKSPACE_MANAGEMENT_CAPABILITY_FORBIDDEN' } });
          expect(physicalSettled).toBe(true); expect(callbackSettled).toBe(true); expect(repeatRefused).toBe(true);
          if (callback === 'readOwned') expect(repeatedFailure!.reason).toBe(firstFailure!.reason);
          const first = firstFailure?.reason;
          if (!(first instanceof Error)) throw new Error('SYNTHETIC_ORIGINAL_PROOF_FAILURE_MISSING');
          expect(lifecycleProof.failures).toHaveLength(1);
          expect(hasErrorCause(lifecycleProof.failures[0], first)).toBe(true);
          const close = await closing.then(() => ({ status: 'closed' as const }),
            (error: unknown) => ({ status: 'uncertain' as const, error }));
          if (close.status === 'closed') expect(electronBoundary.reservationReleased).toHaveBeenCalledOnce();
          else {
            expect(close.error).toMatchObject({ message: 'DESKTOP_SHUTDOWN_FAILED' });
            expect(electronBoundary.reservationReleased).not.toHaveBeenCalled();
          }
          expect(releaseStates).toEqual(close.status === 'closed' ? [{ physicalSettled: true, callbackSettled: true }] : []);
          expect(p.maintenanceLease.readState()).toBe('idle');
          expect(electronBoundary.fork).not.toHaveBeenCalled(); await p.assertPreserved();
        } finally {
          release(); context.signal.removeEventListener('abort', release);
          electronBoundary.observeReservationOwned = undefined;
          await command; await (closing ?? outcome.lifecycle.shutdown()).catch(() => undefined);
        }
      });
    },
  );

  it('joins an admitted status read before releasing the recovery selector reservation', async context => {
    const lifetime = beginTrackedStartupTest(context);
    await lifetime.run(async () => {
      const p = await lifetime.step('fixturePreparation', () => prepare(context, lifetime));
      const outcome = await lifetime.step('startup', () => p.start());
      if (outcome.status !== 'fulfilled' || outcome.lifecycle === undefined) throw new Error('SYNTHETIC_SELECTOR_START_FAILED');
      const entered = createCompletionGate(), held = createCompletionGate();
      const release = () => { entered.resolve(); held.resolve(); };
      context.signal.addEventListener('abort', release, { once: true });
      let reached = false, returned = false;
      const inspect = WorkspaceBackupImportJournalStore.prototype.inspectSlots;
      vi.spyOn(WorkspaceBackupImportJournalStore.prototype, 'inspectSlots').mockImplementation(async function(this: WorkspaceBackupImportJournalStore, ...args) {
        const slots = await inspect.apply(this, args);
        if (!reached) { reached = true; entered.resolve(); await held.promise; returned = true; }
        return slots;
      });
      const read = Promise.resolve(p.readStatus()).then(value => ({ value }), (error: unknown) => ({ error }));
      let closing: Promise<void> | undefined;
      try {
        expect(await Promise.race([entered.promise.then(() => 'held'), read.then(() => 'settled')])).toBe('held');
        closing = outcome.lifecycle.shutdown();
        expect(outcome.lifecycle.shutdown()).toBe(closing);
        await nextEventLoopTurn();
        expect(returned).toBe(false); expect(electronBoundary.reservationReleased).not.toHaveBeenCalled();
        held.resolve();
        expect(await read).toHaveProperty('error'); await closing;
        expect(returned).toBe(true); expect(electronBoundary.reservationReleased).toHaveBeenCalledOnce();
        await p.assertPreserved();
      } finally {
        release(); context.signal.removeEventListener('abort', release);
        await read; await (closing ?? outcome.lifecycle.shutdown());
      }
    });
  });

  describe('recovery ownership proof', () => {
    it('uses one fresh physical observation per bound absence check in status reads', async context => {
      const lifetime = beginTrackedStartupTest(context);
      await lifetime.run(async () => {
        const p = await lifetime.step('fixturePreparation', () => prepare(context, lifetime));
        const outcome = await lifetime.step('startup', () => p.start());
        if (outcome.status !== 'fulfilled' || outcome.lifecycle === undefined) throw new Error('SYNTHETIC_SELECTOR_START_FAILED');
        let physical = 0;
        electronBoundary.observeReservationOwned = () => { physical++; };
        p.absence.assertOwned.mockClear();
        try {
          expect(await p.readStatus()).toMatchObject({ operationState: 'idle', target: { workspaceId } });
          const firstReads = physical;
          expect(firstReads).toBeGreaterThan(0);
          expect(firstReads).toBe(p.absence.assertOwned.mock.calls.length);
          expect(await p.readStatus()).toMatchObject({ operationState: 'idle', target: { workspaceId } });
          expect(physical).toBeGreaterThan(firstReads);
          expect(physical).toBe(p.absence.assertOwned.mock.calls.length);
          await p.assertPreserved();
        } finally {
          electronBoundary.observeReservationOwned = undefined;
          await outcome.lifecycle.shutdown();
        }
      });
    });

    it.for(['freshRead', 'nativeLoss'] as const)(
      'keeps the actual startup producer physical proof through status: %s', async (mode, context) => {
        const lifetime = beginTrackedStartupTest(context);
        await lifetime.run(async () => {
          const p = await lifetime.step('fixturePreparation', () => prepare(context, lifetime, 'target', 'startup'));
          p.f.showMessageBox.mockResolvedValueOnce({ response: 1, checkboxChecked: false });
          const outcome = await lifetime.step('startup', () => p.start());
          if (outcome.status !== 'fulfilled' || outcome.lifecycle === undefined) throw new Error('SYNTHETIC_SELECTOR_START_FAILED');
          let physical = 0;
          electronBoundary.observeReservationOwned = () => {
            physical++;
            if (mode === 'nativeLoss') throw new Error('SYNTHETIC_STARTUP_NATIVE_PROOF_LOST');
          };
          try {
            if (mode === 'freshRead') {
              expect(await p.readStatus()).toMatchObject({ operationState: 'idle', target: { workspaceId } });
              const firstReads = physical;
              expect(firstReads).toBeGreaterThan(0);
              expect(await p.readStatus()).toMatchObject({ operationState: 'idle', target: { workspaceId } });
              expect(physical).toBeGreaterThan(firstReads);
            } else {
              await expect(p.readStatus()).rejects.toThrow();
              expect(physical).toBeGreaterThan(0);
              electronBoundary.observeReservationOwned = undefined;
              await expect(p.readStatus()).rejects.toThrow();
              await expect(outcome.lifecycle.shutdown()).rejects.toThrow('DESKTOP_SHUTDOWN_FAILED');
              expect(electronBoundary.reservationReleased).not.toHaveBeenCalled();
            }
            expect(p.absence.assertOwned).not.toHaveBeenCalled();
            expect(p.f.createRuntimeSession).not.toHaveBeenCalled();
            expect(electronBoundary.fork).not.toHaveBeenCalled();
            await p.assertPreserved();
          } finally {
            electronBoundary.observeReservationOwned = undefined;
            if (mode === 'nativeLoss') await outcome.lifecycle.shutdown().catch(() => undefined);
            else await outcome.lifecycle.shutdown();
          }
        });
      },
    );

    it('keeps the approved transient observation window before the receipt-backed read', async context => {
      const lifetime = beginTrackedStartupTest(context);
      await lifetime.run(async () => {
        const p = await lifetime.step('fixturePreparation', () => prepare(context, lifetime));
        const outcome = await lifetime.step('startup', () => p.start());
        if (outcome.status !== 'fulfilled' || outcome.lifecycle === undefined) throw new Error('SYNTHETIC_SELECTOR_START_FAILED');
        let rootUnavailable = true;
        const leading = vi.fn(() => {
          if (rootUnavailable) throw new Error('SYNTHETIC_TRANSIENT_ROOT_FAILURE');
        });
        electronBoundary.observeReservationOwned = leading;
        p.absence.assertOwned.mockImplementationOnce(async () => {
          rootUnavailable = false;
          await p.proveAbsenceOwned();
        });
        try {
          expect(await p.readStatus()).toMatchObject({ operationState: 'idle', target: { workspaceId } });
          expect(rootUnavailable).toBe(false);
          expect(leading).toHaveBeenCalled();
          await p.assertPreserved();
        } finally {
          electronBoundary.observeReservationOwned = undefined;
          await outcome.lifecycle.shutdown();
        }
      });
    });

    it.for(['persistentNativeLoss', 'latchedInvalidation', 'nonVoidAbsence'] as const)(
      'retains %s across later status reads and shutdown', async (fault, context) => {
        const lifetime = beginTrackedStartupTest(context);
        await lifetime.run(async () => {
          const p = await lifetime.step('fixturePreparation', () => prepare(context, lifetime));
          const outcome = await lifetime.step('startup', () => p.start());
          if (outcome.status !== 'fulfilled' || outcome.lifecycle === undefined) throw new Error('SYNTHETIC_SELECTOR_START_FAILED');
          if (fault === 'latchedInvalidation') electronBoundary.loseReservation!();
          else if (fault === 'persistentNativeLoss') electronBoundary.observeReservationOwned = () => {
            throw new Error('SYNTHETIC_PERSISTENT_ROOT_FAILURE');
          };
          else p.absence.assertOwned.mockImplementationOnce(async () => { await p.proveAbsenceOwned(); return 1 as never; });
          try {
            await expect(p.readStatus()).rejects.toThrow();
            electronBoundary.observeReservationOwned = undefined;
            await expect(p.readStatus()).rejects.toThrow();
            await expect(outcome.lifecycle.shutdown()).rejects.toThrow('DESKTOP_SHUTDOWN_FAILED');
            expect(electronBoundary.reservationReleased).not.toHaveBeenCalled();
            await p.assertPreserved();
          } finally {
            electronBoundary.observeReservationOwned = undefined;
            await outcome.lifecycle.shutdown().catch(() => undefined);
          }
        });
      },
    );

    it('retains the bound absence failure before a competing physical error', async context => {
      const lifetime = beginTrackedStartupTest(context);
      await lifetime.run(async () => {
        const p = await lifetime.step('fixturePreparation', () => prepare(context, lifetime));
        const outcome = await lifetime.step('startup', () => p.start());
        if (outcome.status !== 'fulfilled' || outcome.lifecycle === undefined) throw new Error('SYNTHETIC_SELECTOR_START_FAILED');
        const first = new Error('SYNTHETIC_ABSENCE_FIRST_FAILURE');
        const physical = vi.fn(() => { throw new Error('SYNTHETIC_COMPETING_PHYSICAL_FAILURE'); });
        electronBoundary.observeReservationOwned = physical;
        p.absence.assertOwned.mockRejectedValueOnce(first);
        try {
          await expect(p.readStatus()).rejects.toThrow();
          await expect(p.readStatus()).rejects.toThrow();
          const failure: unknown = await outcome.lifecycle.shutdown().catch((cause: unknown) => cause);
          expect(hasErrorCause(failure, first)).toBe(true);
          expect(physical).not.toHaveBeenCalled();
          expect(electronBoundary.reservationReleased).not.toHaveBeenCalled();
          await p.assertPreserved();
        } finally {
          electronBoundary.observeReservationOwned = undefined;
          await outcome.lifecycle.shutdown().catch(() => undefined);
        }
      });
    });

    it('joins the held physical read before releasing the recovery reservation', async context => {
      const lifetime = beginTrackedStartupTest(context);
      await lifetime.run(async () => {
        const p = await lifetime.step('fixturePreparation', () => prepare(context, lifetime));
        const outcome = await lifetime.step('startup', () => p.start());
        if (outcome.status !== 'fulfilled' || outcome.lifecycle === undefined) throw new Error('SYNTHETIC_SELECTOR_START_FAILED');
        const entered = createCompletionGate(), held = createCompletionGate();
        const release = () => { entered.resolve(); held.resolve(); };
        context.signal.addEventListener('abort', release, { once: true });
        electronBoundary.observeReservationOwned = () => {
          electronBoundary.observeReservationOwned = undefined;
          entered.resolve(); return held.promise;
        };
        const read = Promise.resolve(p.readStatus()).then(value => ({ value }), (error: unknown) => ({ error }));
        let closing: Promise<void> | undefined;
        try {
          expect(await Promise.race([entered.promise.then(() => 'held'), read.then(() => 'settled')])).toBe('held');
          closing = outcome.lifecycle.shutdown();
          expect(outcome.lifecycle.shutdown()).toBe(closing);
          await nextEventLoopTurn();
          expect(electronBoundary.reservationReleased).not.toHaveBeenCalled();
          held.resolve();
          expect(await read).toHaveProperty('error');
          await closing;
          expect(electronBoundary.reservationReleased).toHaveBeenCalledOnce();
          await p.assertPreserved();
        } finally {
          release(); context.signal.removeEventListener('abort', release);
          electronBoundary.observeReservationOwned = undefined;
          await read; await (closing ?? outcome.lifecycle.shutdown());
        }
      });
    });

    it('keeps an ownership cause separate from an observed window cleanup error', async context => {
      const lifetime = beginTrackedStartupTest(context);
      await lifetime.run(async () => {
        const p = await lifetime.step('fixturePreparation', () => prepare(context, lifetime));
        const cleanup = new Error('SYNTHETIC_INDEPENDENT_WINDOW_CLEANUP');
        electronBoundary.handle.mockImplementationOnce(() => { p.loseAbsence(); p.absence.assertCurrent(); });
        vi.spyOn(p.f.mainWindow, 'destroy').mockImplementationOnce(() => { throw cleanup; });
        const outcome = await lifetime.step('startup', () => p.start());
        expect(outcome.status).toBe('rejected');
        if (outcome.status !== 'rejected') throw new Error('SYNTHETIC_OWNERSHIP_FAILURE_ACCEPTED');
        expect(outcome.reason).toBeInstanceOf(AggregateError);
        const failure = outcome.reason as AggregateError;
        expect(failure.cause).toBe(p.ownershipFailure);
        expect(failure.errors[0]).toBe(p.ownershipFailure);
        expect(failure.errors).toContain(cleanup);
        expect(p.f.mainWindow.destroy).toHaveBeenCalledOnce();
        expect(electronBoundary.reservationReleased).not.toHaveBeenCalled();
        expect(electronBoundary.loadWindow).not.toHaveBeenCalled();
        await p.assertPreserved();
      });
    });
  });

  it.for(['writerAbsence', 'singleInstance', 'asyncWriterAbsence'] as const)('retains detected %s loss after the external proof appears restored', async (loss, context) => {
    const lifetime = beginTrackedStartupTest(context);
    await lifetime.run(async () => {
      const p = await lifetime.step('fixturePreparation', () => prepare(context, lifetime));
      const outcome = await lifetime.step('startup', () => p.start());
      if (outcome.status !== 'fulfilled' || outcome.lifecycle === undefined) throw new Error('SYNTHETIC_SELECTOR_START_FAILED');
      try {
        if (loss === 'writerAbsence') p.loseAbsence();
        else if (loss === 'singleInstance') p.f.assertSingleInstanceOwnership.mockImplementationOnce(() => { throw p.ownershipFailure; });
        else p.absence.assertOwned.mockImplementationOnce(p.proveAbsenceOwned).mockImplementationOnce(p.proveAbsenceOwned)
          .mockRejectedValueOnce(p.ownershipFailure);
        await expect(p.readStatus()).rejects.toThrow(); p.restoreAbsence();
        await expect(p.readStatus()).rejects.toThrow();
        await expect(outcome.lifecycle.shutdown()).rejects.toThrow('DESKTOP_SHUTDOWN_FAILED');
        expect(electronBoundary.reservationReleased).not.toHaveBeenCalled();
        await p.assertPreserved();
      } finally {
        // The expected uncertain shutdown keeps ownership; do not fabricate a release.
        await outcome.lifecycle.shutdown().catch(() => undefined);
      }
    });
  });

  it('closes a partially constructed recovery window after an external quit without loading or reporting ready', async context => {
    const lifetime = beginTrackedStartupTest(context);
    await lifetime.run(async () => {
      const p = await lifetime.step('fixturePreparation', () => prepare(context, lifetime));
      electronBoundary.createWindow.mockImplementationOnce(() => {
        p.startup.beforeQuit(); return p.f.mainWindow as unknown as BrowserWindow;
      });
      const outcome = await lifetime.step('startup', () => p.start());
      expect(outcome).toMatchObject({ status: 'rejected' });
      expect(p.f.mainWindow.destroy).toHaveBeenCalledOnce();
      expect(electronBoundary.loadWindow).not.toHaveBeenCalled();
      expect((await readRestoreDiagnosticEvents(p.f.root)).some(value => value.eventName === 'desktop.started')).toBe(false);
      expect(electronBoundary.reservationReleased).toHaveBeenCalledOnce();
      expect(p.f.relaunch).not.toHaveBeenCalled(); await p.assertPreserved();
    });
  });

  it('drains a quit-requested handoff before releasing ownership without opening a window', async context => {
    const lifetime = beginTrackedStartupTest(context);
    await lifetime.run(async () => {
      const p = await lifetime.step('fixturePreparation', () => prepare(context, lifetime));
      const entered = createCompletionGate(), held = createCompletionGate();
      const release = () => { entered.resolve(); held.resolve(); };
      context.signal.addEventListener('abort', release, { once: true });
      let returned = false;
      p.absence.assertOwned.mockImplementationOnce(async () => {
        entered.resolve(); await held.promise; await p.proveAbsenceOwned(); returned = true;
      });
      const started = lifetime.step('startup', () => p.start());
      let closing: Promise<void> | undefined;
      try {
        expect(await Promise.race([entered.promise.then(() => 'held'), started.then(() => 'settled')])).toBe('held');
        closing = p.startup.shutdown();
        await nextEventLoopTurn();
        expect(returned).toBe(false); expect(electronBoundary.reservationReleased).not.toHaveBeenCalled();
        expect(electronBoundary.createWindow).not.toHaveBeenCalled();
        held.resolve();
        expect(await started).toMatchObject({ status: 'rejected' }); await closing;
        expect(returned).toBe(true); expect(electronBoundary.reservationReleased).toHaveBeenCalledOnce();
        expect(electronBoundary.createWindow).not.toHaveBeenCalled();
        expect(p.f.relaunch).not.toHaveBeenCalled(); await p.assertPreserved();
      } finally {
        release(); context.signal.removeEventListener('abort', release);
        await started; await closing;
      }
    });
  });

  it('closes a handed owner and partial window when capability construction fails', async context => {
    const lifetime = beginTrackedStartupTest(context);
    await lifetime.run(async () => {
      const p = await lifetime.step('fixturePreparation', () => prepare(context, lifetime));
      const first = new Error('SYNTHETIC_RECOVERY_CAPABILITY_CONSTRUCTION_FAILED');
      electronBoundary.handle.mockImplementationOnce(() => { throw first; });
      const outcome = await lifetime.step('startup', () => p.start());
      expect(outcome).toMatchObject({ status: 'rejected', reason: first });
      expect(p.f.mainWindow.destroy).toHaveBeenCalledOnce();
      expect(electronBoundary.reservationReleased).toHaveBeenCalledOnce();
      expect(p.f.relaunch).not.toHaveBeenCalled(); expect(electronBoundary.fork).not.toHaveBeenCalled();
      await p.assertPreserved();
    });
  });

  it('preserves the recovery construction cause separately from window cleanup failure', async context => {
    const lifetime = beginTrackedStartupTest(context);
    await lifetime.run(async () => {
      const p = await lifetime.step('fixturePreparation', () => prepare(context, lifetime));
      const first = new Error('SYNTHETIC_SELECTOR_CONSTRUCTION_ORIGINAL', {
        cause: new Error('SYNTHETIC_SELECTOR_CONSTRUCTION_CAUSE'),
      });
      const cleanup = new Error('SYNTHETIC_SELECTOR_WINDOW_CLOSE_ORIGINAL', {
        cause: new Error('SYNTHETIC_SELECTOR_WINDOW_CLOSE_CAUSE'),
      });
      let observed: { first: unknown; cleanup?: unknown } | undefined;
      context.onTestFailed(async () => {
        if (observed === undefined) return;
        try {
          const { createRunnerFailureSink } = await import('../../../../test-reporters/runnerFailureEvidence.mjs');
          const sink = createRunnerFailureSink(), task = context.task;
          const retryCount = task.result?.retryCount ?? 0, repeatCount = task.result?.repeatCount ?? 0;
          for (const [phase, error] of [['recoverySelectorConstructionCatch', observed.first],
            ['recoverySelectorConstructionClose', observed.cleanup]] as const) {
            if (phase === 'recoverySelectorConstructionClose' && error === undefined) continue;
            sink.record({ runner: 'vitest', phase, error, testName: task.fullTestName, testId: task.id,
              file: task.file.filepath, ...(task.location === undefined ? {} : { line: task.location.line, column: task.location.column }),
              ...(retryCount === 0 && repeatCount === 0 ? { attempt: 0 } : {}), retryCount, repeatCount });
          }
          await sink.flush();
        } catch { /* Private evidence must not replace the test failure. */ }
      });
      electronBoundary.handle.mockImplementationOnce(() => { throw first; });
      vi.spyOn(p.f.mainWindow, 'destroy').mockImplementationOnce(() => { throw cleanup; });
      const outcome = await lifetime.step('startup', () => p.start());
      if (outcome.status === 'rejected') observed = { first: outcome.reason,
        ...(outcome.reason instanceof AggregateError && outcome.reason.errors[1] !== undefined
          ? { cleanup: outcome.reason.errors[1] } : {}) };
      expect(outcome.status).toBe('rejected');
      if (outcome.status !== 'rejected') throw new Error('SYNTHETIC_SELECTOR_CONSTRUCTION_ACCEPTED');
      expect(outcome.reason).toBeInstanceOf(AggregateError);
      const failure = outcome.reason as AggregateError;
      expect(failure.cause).toBe(first);
      expect(failure.errors).toHaveLength(2);
      expect(failure.errors[0]).toBe(first);
      expect(failure.errors[1]).toBe(cleanup);
      expect(p.f.mainWindow.destroy).toHaveBeenCalledOnce();
      expect(electronBoundary.reservationReleased).toHaveBeenCalledOnce();
      expect(p.f.relaunch).not.toHaveBeenCalled(); expect(electronBoundary.fork).not.toHaveBeenCalled();
      expect(electronBoundary.loadWindow).not.toHaveBeenCalled();
      await p.assertPreserved();
    });
  });

  it('retains ownership uncertainty first detected after capability construction', async context => {
    const lifetime = beginTrackedStartupTest(context);
    await lifetime.run(async () => {
      const p = await lifetime.step('fixturePreparation', () => prepare(context, lifetime));
      const first = new Error('SYNTHETIC_RECOVERY_POST_CONSTRUCTION_OWNER_LOST', {
        cause: new Error('SYNTHETIC_RECOVERY_POST_CONSTRUCTION_OWNER_CAUSE'),
      });
      electronBoundary.handle.mockImplementation(channel => {
        if (channel === getWorkspaceManagementStatusIpcChannel) {
          p.f.assertSingleInstanceOwnership.mockImplementationOnce(() => { throw first; });
        }
      });
      const outcome = await lifetime.step('startup', () => p.start());
      expect(outcome.status).toBe('rejected');
      if (outcome.status !== 'rejected') throw new Error('SYNTHETIC_OWNER_LOSS_ACCEPTED');
      expect(hasErrorCause(outcome.reason, first)).toBe(true);
      expect(electronBoundary.reservationReleased).not.toHaveBeenCalled();
      expect(p.f.mainWindow.destroy).toHaveBeenCalledOnce();
      expect(electronBoundary.loadWindow).not.toHaveBeenCalled();
      await p.assertPreserved();
    });
  });
});

describe('backendless selector main composition', () => {
  it.for(['currentFailure', 'confirmation', 'save'] as const)(
    'B3b selector main support export (%s)', { timeout: 5_000 }, async (scenario, context) => {
      const lifetime = beginTrackedStartupTest(context);
      await lifetime.run(async () => {
        const versions = { ...process.versions, electron: '43.8.1' };
        const descriptor = Object.getOwnPropertyDescriptor(process, 'versions');
        if (descriptor === undefined) throw new Error('SYNTHETIC_PROCESS_VERSIONS_DESCRIPTOR_MISSING');
        try {
          if (descriptor.get !== undefined) vi.spyOn(process, 'versions', 'get').mockReturnValue(versions);
          else {
            Object.defineProperty(process, 'versions', { ...descriptor, value: versions });
          }
          let originalFailure: { error: unknown } | undefined;
          const observeFailure = vi.fn((error: unknown) => { originalFailure ??= { error }; });
          context.onTestFailed(async () => {
            const observed = originalFailure;
            if (observed === undefined) return;
            try {
              const { createRunnerFailureSink } = await import('../../../../test-reporters/runnerFailureEvidence.mjs');
              const sink = createRunnerFailureSink();
              const task = context.task;
              const retryCount = task.result?.retryCount ?? 0;
              const repeatCount = task.result?.repeatCount ?? 0;
              sink.record({ runner: 'vitest', phase: 'supportBundleCreationCatch', error: observed.error,
                testName: task.fullTestName, testId: task.id, file: task.file.filepath,
                ...(task.location === undefined ? {} : { line: task.location.line, column: task.location.column }),
                ...(retryCount === 0 && repeatCount === 0 ? { attempt: 0 } : {}), retryCount, repeatCount });
              await sink.flush();
            } catch { /* Private evidence must not replace the test failure. */ }
          });
          const createCapability = supportBundleCapability.createDesktopOnlySupportBundleCapability;
          vi.spyOn(supportBundleCapability, 'createDesktopOnlySupportBundleCapability').mockImplementation(options =>
            createCapability({ ...options, observeFailure }));
          const loadData = vi.spyOn(supportBundleDesktopData, 'readSupportBundleDesktopData');
          const writeArchive = vi.spyOn(supportBundleFileStore, 'writeSupportBundleAtomically');
          const f = await lifetime.step('fixturePreparation', async () => {
            const fixture = await createFixture(originalProfileId, {
              ownedRoots: lifetime.roots, update: true, skipRestore: true, completeStartup: true,
            });
            const registry = (await fixture.registry.read())!;
            const otherId = validateWorkspaceId('44444444-4444-4444-8444-444444444444');
            await mkdir(deriveWorkspaceRoot(fixture.root, otherId, 1).workspaceRoot, { recursive: true });
            await fixture.registry.write({ ...registry, formatVersion: 2, activeWorkspaceId: null,
              workspaces: [...registry.workspaces, { ...registry.workspaces[0]!, workspaceId: otherId,
                workspaceLabel: 'Synthetic conflicting company',
                lineageIdentity: { formatVersion: 1, profileId: foreignProfileId } }] });
            return fixture;
          });
          const targetPath = join(f.root, 'selector-support.json.gz');
          const registryBefore = await readFile(join(f.root, WORKSPACE_REGISTRY_FILE_NAME));
          const databaseBefore = await readFile(f.databasePath);
          const pdfBefore = await readFile(f.pdfPath);
          let enter!: () => void, release!: () => void;
          const entered = new Promise<void>(resolve => { enter = resolve; });
          const held = new Promise<void>(resolve => { release = resolve; });
          context.signal.addEventListener('abort', release, { once: true });
          f.showMessageBox.mockImplementation(async () => {
            if (scenario === 'confirmation') { enter(); await held; }
            return { response: 1, checkboxChecked: false };
          });
          f.showSaveDialog.mockImplementation(async () => {
            if (scenario === 'save') { enter(); await held; }
            return { canceled: false, filePath: targetPath };
          });
          let lifecycle: Awaited<ReturnType<typeof f.start>>;
          let work: Promise<{ value: unknown } | { error: unknown }> | undefined;
          let bodyFailure: { error: unknown } | undefined;
          try {
            await lifetime.step('startup', async () => { lifecycle = await f.start(); });
            expect(lifecycle).toBeDefined();
            expect(electronBoundary.loadWindow).toHaveBeenCalledExactlyOnceWith(f.mainWindow, 'selector');
            const event = { sender: f.mainWindow.webContents, senderFrame: f.mainWindow.webContents.mainFrame };
            const rename = electronBoundary.handle.mock.calls.find(([channel]) => channel === renameWorkspaceIpcChannel)?.[1];
            const create = electronBoundary.handle.mock.calls.find(([channel]) => channel === createSupportBundleIpcChannel)?.[1];
            if (rename === undefined || create === undefined) throw new Error('SELECTOR_SUPPORT_HANDLERS_MISSING');
            await expect(rename(event, { workspaceId, workspaceLabel: 'Synthetic conflicting company' }))
              .rejects.toThrow('WORKSPACE_MANAGEMENT_LABEL_EXISTS');
            f.showErrorBox.mockClear();
            expect(loadData).not.toHaveBeenCalled();
            expect(writeArchive).not.toHaveBeenCalled();
            work = Promise.resolve(create(event)).then(value => ({ value }), (error: unknown) => ({ error }));
            await lifetime.step('restoredContentCheck', async () => {
              if (scenario === 'currentFailure') {
                await expect(work).resolves.toEqual({ value: 'created' });
                const inspector = await import(new URL('../../scripts/inspect-support-bundle.mjs', import.meta.url).href);
                const inspected = inspector.inspectSupportBundle(targetPath);
                expect(inspected.summary).toMatchObject({ formatVersion: 3, kind: 'desktopOnly', observationStatus: 'available',
                  backend: 'exitUnconfirmed', database: 'notInspected', diagnosticHistory: 'notCollected', incidentHistory: 'notCollected' });
                const failures = (await readRestoreDiagnosticEvents(f.root))
                  .filter(event => event.eventName === 'workspaceManagement.operationFailed');
                expect(failures).toEqual([expect.objectContaining({ operationId: 'workspace.rename',
                  errorCode: 'WORKSPACE_MANAGEMENT_LABEL_EXISTS' })]);
                expect(inspected.document.observation).toEqual({ scope: 'currentOperation', status: 'available',
                  firstError: failures[0], cleanupError: null });
                expect(inspected.document.system).toMatchObject({ appVersion: '0.2.8', buildRevision: 'a'.repeat(12),
                  electronVersion: '43.8.1' });
                expect(Object.keys(inspected.document).sort()).toEqual(['availability', 'manifest', 'observation', 'system']);
                const document = JSON.stringify(inspected.document);
                for (const excluded of [f.root, workspaceId, originalProfileId, 'Synthetic conflicting company']) {
                  expect(document).not.toContain(excluded);
                }
                expect(loadData).toHaveBeenCalled();
                expect(writeArchive).toHaveBeenCalledOnce();
                expect(writeArchive.mock.calls[0]![0]).toMatchObject({ targetPath,
                  runtimeRoot: createDesktopProfilePaths(f.root).runtimeRoot });
                expect((await readFile(targetPath)).equals(writeArchive.mock.calls[0]![0].archive)).toBe(true);
                expect(observeFailure).not.toHaveBeenCalled();
              } else {
                expect(await Promise.race([entered.then(() => 'held'), work!.then(() => 'settled')])).toBe('held');
                electronBoundary.removeHandler.mockClear();
                await lifecycle!.shutdown();
                expect(electronBoundary.removeHandler).toHaveBeenCalledWith(createSupportBundleIpcChannel);
                release();
                const result = await work!;
                expect(result).toHaveProperty('error');
                if (!('error' in result)) throw new Error('STALE_SELECTOR_SUPPORT_REQUEST_ACCEPTED');
                expect(result.error).toMatchObject({ message: 'SUPPORT_BUNDLE_CREATION_FAILED' });
                expect(result.error).not.toHaveProperty('cause');
                expect(observeFailure).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ message: 'SUPPORT_BUNDLE_FORBIDDEN' }));
                expect(loadData).not.toHaveBeenCalled();
                expect(writeArchive).not.toHaveBeenCalled();
                await expect(stat(targetPath)).rejects.toMatchObject({ code: 'ENOENT' });
              }
              expect(f.showMessageBox).toHaveBeenCalledOnce();
              expect(f.showSaveDialog).toHaveBeenCalledTimes(scenario === 'confirmation' ? 0 : 1);
              expect(f.showErrorBox).not.toHaveBeenCalled();
              expect(f.createRuntimeSession).not.toHaveBeenCalled();
              expect(f.events).toEqual([]);
              expect(electronBoundary.fetch).not.toHaveBeenCalled();
              expect(electronBoundary.fork).not.toHaveBeenCalled();
              expect(electronBoundary.ipcHandlers.has(deleteWorkspaceIpcChannel)).toBe(scenario === 'currentFailure');
              expect((await readFile(join(f.root, WORKSPACE_REGISTRY_FILE_NAME))).equals(registryBefore)).toBe(true);
              expect((await readFile(f.databasePath)).equals(databaseBefore)).toBe(true);
              expect((await readFile(f.pdfPath)).equals(pdfBefore)).toBe(true);
            });
          } catch (error) {
            bodyFailure = { error };
            throw error;
          } finally {
            release();
            context.signal.removeEventListener('abort', release);
            await work;
            try { await lifecycle?.shutdown(); }
            catch (cleanupFailure) {
              if (bodyFailure !== undefined) throw new AggregateError([bodyFailure.error, cleanupFailure],
                'SYNTHETIC_SELECTOR_SUPPORT_AND_SHUTDOWN_FAILED', { cause: bodyFailure.error });
              throw cleanupFailure;
            }
          }
        } finally {
          if (descriptor.get === undefined) Object.defineProperty(process, 'versions', descriptor);
        }
      });
    },
  );

  for (const returnScenario of ['uncommitted', 'unpublished', 'completeReturn', 'returned', 'rejected', 'backup', 'registryBackup',
    'businessMetadata', 'returnNext', 'returnBackup', 'registryReturnBackup'] as const) it.for([returnScenario])(
    'recovers an interrupted selector return through main: $0',
    returnScenario === 'returnNext' || returnScenario === 'registryReturnBackup' || returnScenario === 'completeReturn' ? { timeout: 10_000 } : {}, async (scenario, context) => {
      const lifetime = beginTrackedStartupTest(context);
      await lifetime.run(async () => {
        const f = await lifetime.step('fixturePreparation', () => createDeferredStartupFixture(lifetime.roots, true));
        if (scenario === 'businessMetadata') await f.fixture.acceptedBuild.write(
          createBusinessAcceptedBuildMetadata(f.metadata, f.metadata.acceptedBuild));
        const before = { ...(await f.fixture.registry.read())!, formatVersion: 2 as const, activeWorkspaceId: null };
        const journal = createWorkspaceSelectorSwitchJournal(before, workspaceId, operationId, '2026-10-25T12:00:00.000Z');
        const registry = scenario === 'rejected' ? createWorkspaceSelectorSwitchRegistryVariants(before, workspaceId).rejected : before;
        await f.fixture.registry.write(registry);
        const paths = createWorkspaceSwitchJournalPaths(f.fixture.root);
        const state = scenario === 'uncommitted' || scenario === 'unpublished' ? 'prepared'
          : ['completeReturn', 'returnNext', 'registryReturnBackup'].includes(scenario) ? 'targetSelected' : 'rollbackSelected';
        await mkdir(dirname(paths.currentPath), { recursive: true, mode: 0o700 });
        await writeFile(scenario === 'unpublished' ? paths.nextPath : scenario === 'backup' ? paths.backupPath : paths.currentPath,
          serializeVersionedWorkspaceSwitchJournal({ ...journal, state }));
        if (scenario === 'registryBackup') {
          const registryPath = join(f.fixture.root, WORKSPACE_REGISTRY_FILE_NAME);
          await rename(registryPath, `${registryPath}.backup`);
        }
        if (scenario === 'returnNext') await writeFile(paths.nextPath,
          serializeVersionedWorkspaceSwitchJournal({ ...journal, state: 'rollbackSelected' }));
        if (scenario === 'returnBackup') await writeFile(paths.backupPath,
          serializeVersionedWorkspaceSwitchJournal({ ...journal, state: 'targetSelected' }));
        if (scenario === 'registryReturnBackup') await writeFile(`${join(f.fixture.root, WORKSPACE_REGISTRY_FILE_NAME)}.backup`,
          JSON.stringify(createWorkspaceSelectorSwitchRegistryVariants(before, workspaceId).selected));
        const metadataBefore = await f.fixture.acceptedBuild.inspectSlots();
        let lifecycle: Awaited<ReturnType<typeof f.fixture.start>>;
        try {
          await lifetime.step('startup', async () => { lifecycle = await f.fixture.start(); });
          expect(lifecycle).toBeDefined();
          expect(f.fixture.createRuntimeSession).not.toHaveBeenCalled();
          expect(electronBoundary.fork).not.toHaveBeenCalled();
          expect(f.fixture.events).toEqual([]);
          expect(electronBoundary.loadWindow).toHaveBeenCalledExactlyOnceWith(f.fixture.mainWindow, 'selector');
          expect(f.fixture.relaunch).not.toHaveBeenCalled();
          await expect(f.fixture.registry.read()).resolves.toEqual(registry);
          await expect(new WorkspaceSwitchJournalStore(f.fixture.root).inspectSlots()).resolves.toEqual({
            current: undefined, next: undefined, backup: undefined,
          });
          await expect(f.fixture.acceptedBuild.inspectSlots()).resolves.toEqual(metadataBefore);
          expect(await readFile(f.fixture.databasePath, 'utf8')).toBe(f.fixture.originalBytes);
          expect(await readFile(f.fixture.pdfPath, 'utf8')).toBe('%PDF-1.7 original pdf');
        } finally { await lifecycle?.shutdown(); }
      });
    },
  );

  it.for(['publishReturn', 'clearReturn'] as const)(
    'restarts selector return after the selected writer loses its acknowledgement: $0',
    { timeout: restoreStartupCompositionTimeoutMs }, async (scenario, context) => {
      const lifetime = beginTrackedStartupTest(context);
      await lifetime.run(async () => {
        const f = await lifetime.step('fixturePreparation', () => createDeferredStartupFixture(lifetime.roots, true));
        const registry = { ...(await f.fixture.registry.read())!, formatVersion: 2 as const, activeWorkspaceId: null };
        await f.fixture.registry.write(registry);
        const paths = createWorkspaceSwitchJournalPaths(f.fixture.root);
        const journal = { ...createWorkspaceSelectorSwitchJournal(registry, workspaceId, operationId,
          '2026-10-25T12:00:00.000Z'), state: 'targetSelected' as const };
        await mkdir(dirname(paths.currentPath), { recursive: true, mode: 0o700 });
        await writeFile(paths.currentPath, serializeVersionedWorkspaceSwitchJournal(journal));
        const fault = new Error('SYNTHETIC_SELECTOR_RETURN_ACK_LOST');
        const method = scenario === 'publishReturn' ? 'writeSelector' : 'clearSelector';
        if (method === 'writeSelector') {
          const write = WorkspaceSwitchJournalStore.prototype.writeSelector;
          vi.spyOn(WorkspaceSwitchJournalStore.prototype, 'writeSelector').mockImplementationOnce(async function (this: WorkspaceSwitchJournalStore, ...args) {
            await write.apply(this, args);
            throw fault;
          });
        } else {
          const clear = WorkspaceSwitchJournalStore.prototype.clearSelector;
          vi.spyOn(WorkspaceSwitchJournalStore.prototype, 'clearSelector').mockImplementationOnce(async function (this: WorkspaceSwitchJournalStore, ...args) {
            await clear.apply(this, args);
            throw fault;
          });
        }
        const observed = vi.fn();
        await lifetime.step('startup', async () => { await expect(f.fixture.start(observed)).rejects.toThrow(); });
        expect(observed.mock.calls.some(([error]) => hasErrorCause(error, fault))).toBe(true);
        expect(electronBoundary.createWindow).not.toHaveBeenCalled();
        expect(f.fixture.createRuntimeSession).not.toHaveBeenCalled();
        const afterFailure = await new WorkspaceSwitchJournalStore(f.fixture.root).inspectSlots();
        expect(afterFailure.current?.value.state).toBe(scenario === 'publishReturn' ? 'rollbackSelected' : undefined);
        let lifecycle: Awaited<ReturnType<typeof f.fixture.start>>;
        try {
          await lifetime.step('startup', async () => { lifecycle = await f.fixture.start(); });
          expect(lifecycle).toBeDefined();
          expect(f.fixture.createRuntimeSession).not.toHaveBeenCalled();
          expect(electronBoundary.fork).not.toHaveBeenCalled();
          await expect(f.fixture.registry.read()).resolves.toEqual(registry);
          await expect(new WorkspaceSwitchJournalStore(f.fixture.root).inspectSlots()).resolves.toEqual({
            current: undefined, next: undefined, backup: undefined,
          });
          expect(await readFile(f.fixture.databasePath, 'utf8')).toBe(f.fixture.originalBytes);
          expect(await readFile(f.fixture.pdfPath, 'utf8')).toBe('%PDF-1.7 original pdf');
        } finally { await lifecycle?.shutdown(); }
      });
    },
  );

  it.for(['profileRestore', 'replacement', 'w6', 'update', 'directSetup', 'legacyMetadata', 'metadataBackup',
    'metadataDuplicate', 'wrongBuild', 'registryChanged', 'metadataChanged', 'ownershipLost', 'lateRestore',
    'restoreAtClear', 'metadataAtClear', 'ownershipAtClear', 'restoreAtPublish', 'restoreAtRegistryRepair'] as const)(
    'preserves an interrupted selector return when authority is uncertain: $0', async (scenario, context) => {
      const lifetime = beginTrackedStartupTest(context);
      await lifetime.run(async () => {
        const f = await lifetime.step('fixturePreparation', () => createDeferredStartupFixture(lifetime.roots, true));
        const registry = { ...(await f.fixture.registry.read())!, formatVersion: 2 as const, activeWorkspaceId: null };
        await f.fixture.registry.write(registry);
        const paths = createWorkspaceSwitchJournalPaths(f.fixture.root);
        const journal = { ...createWorkspaceSelectorSwitchJournal(registry, workspaceId, operationId,
          '2026-10-25T12:00:00.000Z'), state: scenario === 'restoreAtPublish' || scenario === 'restoreAtRegistryRepair'
          ? 'targetSelected' as const : 'rollbackSelected' as const };
        await mkdir(dirname(paths.currentPath), { recursive: true, mode: 0o700 });
        await writeFile(paths.currentPath, serializeVersionedWorkspaceSwitchJournal(journal));
        if (scenario === 'restoreAtRegistryRepair') await writeFile(`${join(f.fixture.root, WORKSPACE_REGISTRY_FILE_NAME)}.backup`,
          JSON.stringify(createWorkspaceSelectorSwitchRegistryVariants(registry, workspaceId).selected));
        const update = createLocalUpdateRuntimePaths({ userDataPath: f.fixture.root,
          legacyRuntimeRoot: createDesktopProfilePaths(f.fixture.root).runtimeRoot });
        const workspaceRoot = deriveWorkspaceRoot(f.fixture.root, workspaceId, 1).workspaceRoot;
        const restorePath = createProfileSnapshotRuntimePaths(createDesktopProfilePaths(workspaceRoot).runtimeRoot).restoreActivationJournalPath;
        const conflicts: Record<string, string> = {
          profileRestore: restorePath,
          replacement: deriveWorkspaceBackupReplacementRuntimePaths(f.fixture.root, workspaceId).activationJournalPath,
          w6: createWorkspaceFirstStartMigrationJournalPaths(f.fixture.root).currentPath,
          update: update.journalPath, directSetup: update.directSetupMigrationRecoveryPath,
          legacyMetadata: update.legacyAcceptedBuildMetadataPath,
          metadataBackup: `${update.acceptedBuildMetadataPath}.backup`,
        };
        const putConflict = async (path: string) => {
          await mkdir(dirname(path), { recursive: true });
          await writeFile(path, 'synthetic conflicting owner');
        };
        if (conflicts[scenario] !== undefined) await putConflict(conflicts[scenario]!);
        if (scenario === 'wrongBuild') await f.fixture.acceptedBuild.write({ ...f.metadata,
          acceptedBuild: { ...f.metadata.acceptedBuild, buildRevision: 'f'.repeat(40) } });
        if (scenario === 'metadataDuplicate') {
          const bytes = await readFile(update.acceptedBuildMetadataPath, 'utf8');
          await writeFile(update.acceptedBuildMetadataPath, bytes.replace('{', '{"formatVersion":2,'));
        }
        if (['registryChanged', 'metadataChanged', 'ownershipLost', 'lateRestore'].includes(scenario)) {
          const inspect = selectorRecoveryAdmission.assertSelectorReturnRecoveryConflictsFromRoot;
          let calls = 0;
          vi.spyOn(selectorRecoveryAdmission, 'assertSelectorReturnRecoveryConflictsFromRoot').mockImplementation(async (...args) => {
            await inspect(...args);
            if (++calls !== 3) return;
            if (scenario === 'registryChanged') await f.fixture.registry.write({ ...registry,
              workspaces: registry.workspaces.map(entry => ({ ...entry, workspaceLabel: 'Changed selection' })) });
            if (scenario === 'metadataChanged') await f.fixture.acceptedBuild.write(
              createBusinessAcceptedBuildMetadata(f.metadata, f.metadata.acceptedBuild));
            if (scenario === 'ownershipLost') electronBoundary.loseReservation!();
            if (scenario === 'lateRestore') await putConflict(restorePath);
          });
        }
        if (['restoreAtClear', 'metadataAtClear', 'ownershipAtClear'].includes(scenario)) {
          const clear = WorkspaceSwitchJournalStore.prototype.clearSelector;
          vi.spyOn(WorkspaceSwitchJournalStore.prototype, 'clearSelector').mockImplementationOnce(async function (this: WorkspaceSwitchJournalStore, ...args) {
            if (scenario === 'restoreAtClear') await putConflict(restorePath);
            if (scenario === 'metadataAtClear') await f.fixture.acceptedBuild.write(
              createBusinessAcceptedBuildMetadata(f.metadata, f.metadata.acceptedBuild));
            if (scenario === 'ownershipAtClear') electronBoundary.loseReservation!();
            return clear.apply(this, args);
          });
        }
        if (scenario === 'restoreAtPublish') {
          const write = WorkspaceSwitchJournalStore.prototype.writeSelector;
          vi.spyOn(WorkspaceSwitchJournalStore.prototype, 'writeSelector').mockImplementationOnce(async function (this: WorkspaceSwitchJournalStore, ...args) {
            await putConflict(restorePath);
            return write.apply(this, args);
          });
        }
        if (scenario === 'restoreAtRegistryRepair') {
          const recover = WorkspaceRegistryStore.prototype.recoverSelected;
          vi.spyOn(WorkspaceRegistryStore.prototype, 'recoverSelected').mockImplementationOnce(async function (this: WorkspaceRegistryStore, ...args) {
            await putConflict(restorePath);
            return recover.apply(this, args);
          });
        }
        const originalJournal = await readFile(paths.currentPath);
        const originalRegistry = await f.fixture.registry.inspectSlots();
        let lifecycle: Awaited<ReturnType<typeof f.fixture.start>>;
        try {
          await lifetime.step('startup', async () => {
            await expect((async () => { lifecycle = await f.fixture.start(); })()).rejects.toThrow();
          });
          expect(f.fixture.createRuntimeSession).not.toHaveBeenCalled();
          expect(electronBoundary.fork).not.toHaveBeenCalled();
          expect(electronBoundary.createWindow).not.toHaveBeenCalled();
          expect(await readFile(paths.currentPath)).toEqual(originalJournal);
          if (scenario === 'restoreAtRegistryRepair') await expect(f.fixture.registry.inspectSlots()).resolves.toEqual(originalRegistry);
          expect(await readFile(f.fixture.databasePath, 'utf8')).toBe(f.fixture.originalBytes);
          expect(await readFile(f.fixture.pdfPath, 'utf8')).toBe('%PDF-1.7 original pdf');
          if (conflicts[scenario] !== undefined) expect(await readFile(conflicts[scenario]!, 'utf8')).toBe('synthetic conflicting owner');
          if (['lateRestore', 'restoreAtClear', 'restoreAtPublish'].includes(scenario)) expect(await readFile(restorePath, 'utf8')).toBe('synthetic conflicting owner');
        } finally { await lifecycle?.shutdown(); }
      });
    },
  );

  it.for(['currentPath', 'nextPath', 'backupPath'] as const)(
    'preserves source-null evidence with conflicting business-metadata slots before recovery from $0', async (slot, context) => {
      const lifetime = beginTrackedStartupTest(context);
      await lifetime.run(async () => {
        const f = await lifetime.step('fixturePreparation', () => createDeferredStartupFixture(lifetime.roots, true));
        await f.fixture.acceptedBuild.write(createBusinessAcceptedBuildMetadata(f.metadata, f.metadata.acceptedBuild));
        await writeFile(`${f.paths.acceptedBuildMetadataPath}.next`, await readFile(f.paths.acceptedBuildMetadataPath));
        const journal = await seedSelectorTarget(f.fixture);
        const paths = createWorkspaceSwitchJournalPaths(f.fixture.root);
        if (slot !== 'currentPath') await rename(paths.currentPath, paths[slot]);
        const registryBefore = await f.fixture.registry.inspectSlots();
        const journalBefore = await journal.inspectSlots();
        const metadataBefore = await f.fixture.acceptedBuild.inspectSlots();
        let lifecycle: Awaited<ReturnType<typeof f.fixture.start>>;
        try {
          await lifetime.step('startup', async () => {
            await expect((async () => { lifecycle = await f.fixture.start(); })()).rejects.toThrow();
          });
          expect(f.fixture.createRuntimeSession).not.toHaveBeenCalled();
          expect(electronBoundary.fork).not.toHaveBeenCalled();
          expect(f.fixture.events).toEqual([]);
          expect(electronBoundary.createWindow).not.toHaveBeenCalled();
          await expect(f.fixture.registry.inspectSlots()).resolves.toEqual(registryBefore);
          await expect(journal.inspectSlots()).resolves.toEqual(journalBefore);
          await expect(f.fixture.acceptedBuild.inspectSlots()).resolves.toEqual(metadataBefore);
        } finally { await lifecycle?.shutdown(); }
      });
    },
  );

  it('drains an admitted native selection before releasing ownership and rejects its late result', async context => {
    const lifetime = beginTrackedStartupTest(context);
    await lifetime.run(async () => {
      const f = await lifetime.step('fixturePreparation', () => createFixture(originalProfileId, {
        ownedRoots: lifetime.roots, update: true, skipRestore: true, completeStartup: true,
      }));
      await f.registry.write({ ...(await f.registry.read())!, formatVersion: 2, activeWorkspaceId: null });
      const lifecycle = (await lifetime.step('startup', () => f.start()))!;
      let finishSelection!: () => void;
      let enterSelection!: () => void;
      const selected = new Promise<{ canceled: boolean; filePaths: string[] }>(resolve => {
        finishSelection = () => resolve({ canceled: false, filePaths: ['synthetic.ekybackup'] });
      });
      const entered = new Promise<void>(resolve => { enterSelection = resolve; });
      f.showOpenDialog.mockImplementationOnce(() => { enterSelection(); return selected; });
      const handler = electronBoundary.handle.mock.calls.find(([channel]) => channel === importWorkspaceBackupAsNewIpcChannel)![1];
      const event = { sender: f.mainWindow.webContents, senderFrame: f.mainWindow.webContents.mainFrame };
      const operation = handler(event, { workspaceLabel: 'New company' }).then(
        () => { throw new Error('TEST_LATE_SELECTION_ACCEPTED'); }, (error: unknown) => error,
      );
      context.signal.addEventListener('abort', finishSelection, { once: true });
      let shutdown: Promise<void> | undefined;
      try {
        await entered;
        let settled = false;
        shutdown = lifecycle.shutdown().then(() => { settled = true; });
        await Promise.resolve();
        expect(settled).toBe(false);
        expect(electronBoundary.reservationReleased).not.toHaveBeenCalled();
        finishSelection();
        expect(await operation).toBeInstanceOf(Error);
        await shutdown;
        expect(electronBoundary.reservationReleased).toHaveBeenCalledTimes(1);
        expect(electronBoundary.fork).not.toHaveBeenCalled();
        expect(f.relaunch).not.toHaveBeenCalled();
        expect(f.events).toEqual([]);
      } finally {
        finishSelection();
        context.signal.removeEventListener('abort', finishSelection);
        await operation;
        await (shutdown ?? lifecycle.shutdown());
      }
    });
  });

  it('retains uncertain ownership and records a failed close instead of releasing it', async context => {
    const lifetime = beginTrackedStartupTest(context);
    await lifetime.run(async () => {
      const f = await lifetime.step('fixturePreparation', () => createFixture(originalProfileId, {
        ownedRoots: lifetime.roots, update: true, skipRestore: true, completeStartup: true,
      }));
      await f.registry.write({ ...(await f.registry.read())!, formatVersion: 2, activeWorkspaceId: null });
      const lifecycle = (await lifetime.step('startup', () => f.start()))!;
      electronBoundary.loseReservation!();
      const shutdown = lifecycle.shutdown();
      expect(lifecycle.shutdown()).toBe(shutdown);
      await expect(shutdown).rejects.toThrow('DESKTOP_SHUTDOWN_FAILED');
      expect(electronBoundary.reservationReleased).not.toHaveBeenCalled();
      const events = await readRestoreDiagnosticEvents(f.root);
      expect(events).toContainEqual(expect.objectContaining({ eventName: 'desktop.shutdownFailed' }));
      expect(events.some(event => event.eventName === 'desktop.shutdownCompleted')).toBe(false);
      expect(f.events).toEqual([]);
    });
  });

  it('drains the selector and requests quit when renderer loading fails', async context => {
    const lifetime = beginTrackedStartupTest(context);
    await lifetime.run(async () => {
      const f = await lifetime.step('fixturePreparation', () => createFixture(originalProfileId, {
        ownedRoots: lifetime.roots, update: true, skipRestore: true, completeStartup: true,
      }));
      await f.registry.write({ ...(await f.registry.read())!, formatVersion: 2, activeWorkspaceId: null });
      let failLoad!: () => void;
      electronBoundary.loadWindow.mockImplementationOnce(() => new Promise<undefined>((_resolve, reject) => {
        failLoad = () => reject(new Error('synthetic renderer failure'));
      }));
      const lifecycle = (await lifetime.step('startup', () => f.start()))!;
      let didQuit!: () => void;
      const quit = new Promise<void>(resolve => { didQuit = resolve; });
      f.quit.mockImplementation(() => {
        expect(electronBoundary.reservationReleased).toHaveBeenCalledTimes(1);
        didQuit();
      });
      try {
        failLoad();
        await quit;
        expect(f.showErrorBox).toHaveBeenCalledExactlyOnceWith('Eky ei käynnistynyt', 'Käyttöliittymää ei voitu ladata turvallisesti.');
        expect(f.events).toEqual([]);
      } finally { failLoad(); await lifecycle.shutdown(); }
    });
  });

  it.for(['ready', 'empty', 'recoveryOnly'] as const)('opens $0 without a business runtime or acceptance', async (state, context) => {
    const lifetime = beginTrackedStartupTest(context);
    await lifetime.run(async () => {
      const f = await lifetime.step('fixturePreparation', () => createFixture(originalProfileId, {
        ownedRoots: lifetime.roots, update: true, skipRestore: true, completeStartup: true,
      }));
      const registry = (await f.registry.read())!;
      await f.registry.write({ ...registry, formatVersion: 2, activeWorkspaceId: null,
        workspaces: state === 'empty' ? [] : registry.workspaces.map(entry => ({ ...entry,
          lifecycleState: state === 'recoveryOnly' ? 'recoveryRequired' : 'ready' })),
      });
      const selected = await readFile(join(f.root, WORKSPACE_REGISTRY_FILE_NAME));
      const metadata = await f.acceptedBuild.read();
      const lifecycle = await lifetime.step('startup', () => f.start());
      expect(lifecycle).toBeDefined();
      try {
        expect(electronBoundary.loadWindow).toHaveBeenCalledExactlyOnceWith(f.mainWindow, 'selector');
        expect(registerApplicationProtocol).toHaveBeenCalledExactlyOnceWith({ mode: 'selector', webRoot: join(f.root, 'app', 'web') });
        expect(f.createRuntimeSession).not.toHaveBeenCalled();
        expect(electronBoundary.fork).not.toHaveBeenCalled();
        expect(f.events).toEqual([]);
        const statusHandler = electronBoundary.handle.mock.calls.find(([channel]) => channel === getWorkspaceManagementStatusIpcChannel)![1];
        const event = { sender: f.mainWindow.webContents, senderFrame: f.mainWindow.webContents.mainFrame };
        const status = await statusHandler(event);
        expect(status).toMatchObject({ activeWorkspaceId: null });
        expect(status.workspaces).toHaveLength(state === 'empty' ? 0 : 1);
        const replace = electronBoundary.handle.mock.calls.find(([channel]) => channel === replaceActiveWorkspaceFromBackupIpcChannel)![1];
        await expect(replace(event)).rejects.toThrow();
        expect(lifecycle!.isInstallerHandoffPending()).toBe(false);
        expect(lifecycle!.deferQuitForInstallerHandoff()).toBe(false);
        await expect(f.acceptedBuild.read()).resolves.toEqual(metadata);
        await expect(readFile(join(f.root, WORKSPACE_REGISTRY_FILE_NAME))).resolves.toEqual(selected);
      } finally {
        await lifetime.step('restoredContentCheck', () => lifecycle!.shutdown());
      }
      expect(electronBoundary.reservationReleased).toHaveBeenCalledTimes(1);
    });
  });

  it('returns the shutdown owner while renderer loading is still pending', async context => {
    const lifetime = beginTrackedStartupTest(context);
    await lifetime.run(async () => {
      const f = await lifetime.step('fixturePreparation', () => createFixture(originalProfileId, {
        ownedRoots: lifetime.roots, update: true, skipRestore: true, completeStartup: true,
      }));
      await f.registry.write({ ...(await f.registry.read())!, formatVersion: 2, activeWorkspaceId: null });
      let finishLoad!: () => void;
      electronBoundary.loadWindow.mockImplementationOnce(() => new Promise<undefined>(resolve => { finishLoad = () => resolve(undefined); }));
      const lifecycle = await lifetime.step('startup', () => f.start());
      try {
        expect(lifecycle).toBeDefined();
        const closing = lifecycle!.shutdown();
        expect(lifecycle!.shutdown()).toBe(closing);
        await lifetime.step('restoredContentCheck', () => closing);
        expect(electronBoundary.reservationReleased).toHaveBeenCalledTimes(1);
      } finally { finishLoad(); }
      expect(f.events).toEqual([]);
      expect(f.quit).not.toHaveBeenCalled();
    });
  });
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

  for (const { passiveTransition, sourceNull } of [false, true].flatMap(passiveTransition =>
    [false, true].map(sourceNull => ({ passiveTransition, sourceNull })))) {
    it(`accepts deferred business through real main and FirstStart (passive: ${passiveTransition}, source-null: ${sourceNull})`, async context => {
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
        const switchStore = sourceNull ? await seedSelectorTarget(f.fixture) : undefined;
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
          if (switchStore !== undefined) expect(await switchStore.inspectSlots()).toEqual({ current: undefined, next: undefined, backup: undefined });
          expect(await readFile(f.fixture.databasePath, 'utf8')).toBe(f.fixture.originalBytes);
          expect(await readFile(f.fixture.pdfPath, 'utf8')).toBe('%PDF-1.7 original pdf');
          expect(electronBoundary.createWindow).toHaveBeenCalledOnce();
        } finally { await lifecycle?.shutdown(); }
      });
    }, passiveTransition ? restoreStartupCompositionTimeoutMs : undefined);
  }

  it.for(['missingRoot', 'invalidHistory', 'runtimeInitialization', 'health', 'healthPrepared', 'secretDrain', 'cancelLostReply'] as const)(
    'keeps source-null terminal authority at the real $0 boundary', async (fault, context) => {
      const lifetime = beginTrackedStartupTest(context);
      await lifetime.run(async () => {
        const f = await lifetime.step('fixturePreparation', () => createDeferredStartupFixture(lifetime.roots, true));
        if (fault === 'healthPrepared') {
          const initial = (await f.fixture.registry.inspect())!;
          const passiveId = validateWorkspaceId('22222222-2222-4222-8222-222222222222');
          await f.fixture.registry.write({ ...initial, workspaces: [...initial.workspaces, {
            ...initial.workspaces[0]!, workspaceId: passiveId, workspaceLabel: 'Synthetic passive',
            lineageIdentity: { formatVersion: 1, profileId: foreignProfileId },
          }] });
          vi.mocked(WorkspaceMigrationInventoryCoordinator.prototype.inspect).mockResolvedValue({
            activeWorkspaceId: workspaceId, entries: [
              { workspaceId, isActive: true, appliedMigrationCount: 1, pendingMigrationCount: 0, status: 'current' },
              { workspaceId: passiveId, isActive: false, appliedMigrationCount: 0, pendingMigrationCount: 0, status: 'invalidHistory' },
            ],
          });
        }
        const switchStore = await seedSelectorTarget(f.fixture);
        const selection = await switchStore.inspectSlots();
        const registry = await f.fixture.registry.inspect();
        if (fault === 'invalidHistory') vi.mocked(WorkspaceActivationMigrationInspector.prototype.inspect).mockResolvedValue({
          status: 'invalidHistory', appliedMigrationCount: 0, pendingMigrationCount: 0,
        });
        if (fault === 'missingRoot') await rm(deriveWorkspaceRoot(f.fixture.root, workspaceId, 1).workspaceRoot, { recursive: true });
        if (fault === 'runtimeInitialization') await rm(join(f.fixture.root, 'resources/backend/dist/database/connection/profileInspectionNativeContract.js'));
        if (['health', 'healthPrepared', 'secretDrain', 'cancelLostReply'].includes(fault)) {
          electronBoundary.fetch.mockImplementation(async () => {
            if (fault === 'healthPrepared') expect(await new WorkspaceFirstStartMigrationJournalStore({ userDataPath: f.fixture.root })
              .inspect()).toMatchObject({ value: { state: 'prepared' } });
            return new Response(null, { status: 500 });
          });
        }
        if (fault === 'cancelLostReply') {
          const cancel = WorkspaceFirstStartMigrationOrchestrator.prototype.cancelBeforeSelectorReturn;
          vi.spyOn(WorkspaceFirstStartMigrationOrchestrator.prototype, 'cancelBeforeSelectorReturn').mockImplementation(async function (this: WorkspaceFirstStartMigrationOrchestrator, authority) {
            await cancel.call(this, authority);
            throw new Error('SYNTHETIC_CANCEL_LOST_REPLY');
          });
        }
        if (fault === 'secretDrain') {
          const original = secretBrokerMain.startSecretBrokerMain;
          vi.spyOn(secretBrokerMain, 'startSecretBrokerMain').mockImplementation(options => ({
            ...original(options), async sealAndDrain() { throw new Error('SYNTHETIC_SECRET_DRAIN'); },
          }));
        }
        const observe = vi.fn();
        const mayReturn = fault === 'missingRoot' || fault === 'invalidHistory' || fault === 'health' || fault === 'healthPrepared';
        await lifetime.step('startup', async () => {
          if (mayReturn) await expect(f.fixture.start(observe)).resolves.toBeUndefined();
          else await expect(f.fixture.start(observe)).rejects.toThrow();
        });
        expect(electronBoundary.createWindow).not.toHaveBeenCalled();
        expect(f.fixture.relaunch).toHaveBeenCalledTimes(mayReturn ? 1 : 0);
        expect(await f.fixture.acceptedBuild.read()).toEqual(f.metadata);
        expect(await new WorkspaceFirstStartMigrationJournalStore({ userDataPath: f.fixture.root }).inspect()).toBeUndefined();
        if (mayReturn) {
          const returned = (await f.fixture.registry.inspect())!;
          expect(returned.activeWorkspaceId).toBeNull();
          expect(returned.workspaces[0]?.lifecycleState).toBe(fault.startsWith('health') ? 'ready' : 'recoveryRequired');
          expect(returned.workspaces.slice(1)).toEqual(registry!.workspaces.slice(1));
          expect((await switchStore.inspectSlots()).current?.value.state).toBe('rollbackSelected');
        } else {
          expect(await f.fixture.registry.inspect()).toEqual(registry);
          expect(await switchStore.inspectSlots()).toEqual(selection);
        }
        if (fault === 'missingRoot') expect(f.fixture.createRuntimeSession).not.toHaveBeenCalled();
        if (fault === 'missingRoot' || fault === 'invalidHistory' || fault === 'runtimeInitialization') expect(f.fixture.events).not.toContain('backendStarted');
        else expect(f.fixture.events).toContain('backendStopped');
        if (fault !== 'missingRoot') expect(await readFile(f.fixture.databasePath, 'utf8')).toBe(f.fixture.originalBytes);
      });
    },
  );

  for (const scenario of ['completed', 'contentFailure', 'releaseFailure'] as const) {
    it(`settles the selected source-null replacement through real rollback before selector return ('${scenario}')`, async context => {
      const lifetime = beginTrackedStartupTest(context);
      await lifetime.run(async () => {
        const f = await lifetime.step('fixturePreparation', () => createDeferredStartupFixture(lifetime.roots, true, true));
        const switchStore = await seedSelectorTarget(f.fixture);
        const registry = await f.fixture.registry.inspect();
        const switchSelection = await switchStore.inspectSlots();
        const fault = new Error('SYNTHETIC_SELECTOR_TERMINAL_ROLLBACK_FAILED');
        const paths = deriveWorkspaceBackupReplacementRuntimePaths(f.fixture.root, workspaceId);
        const inspect = vi.mocked(originalInspection.runProfileRestoreOriginalInspection).getMockImplementation()!;
        let terminalInspection = false;
        vi.mocked(originalInspection.runProfileRestoreOriginalInspection).mockImplementation(async input => {
          if ((await f.fixture.journal.peek())?.phase === 'rolledBack') {
            terminalInspection = true;
            if (scenario === 'contentFailure') throw fault;
          }
          return inspect(input);
        });
        let releaseFailed = false;
        if (scenario === 'releaseFailure') electronBoundary.reservationReleased.mockImplementation(async root => {
          if (terminalInspection && root === join(paths.activationRollbackRoot, operationId) &&
              (await f.fixture.journal.peek())?.phase === 'rolledBack') {
            releaseFailed = true;
            throw fault;
          }
        });
        electronBoundary.fetch.mockResolvedValue(new Response(null, { status: 500 }));
        const observe = vi.fn();
        await lifetime.step('startup', async () => {
          if (scenario === 'completed') await expect(f.fixture.start(observe).catch(error => {
            throw observe.mock.calls[0]?.[0] ?? error;
          })).resolves.toBeUndefined();
          else await expect(f.fixture.start(observe)).rejects.toThrow();
        });
        expect(terminalInspection).toBe(true);
        expect(f.fixture.events).toEqual(['backendStarted', 'backendStopped', 'rollback',
          ...(scenario === 'completed' ? [] : ['backendStopped'])]);
        expect(await readFile(f.fixture.databasePath, 'utf8')).toBe(f.fixture.originalBytes);
        expect(await readFile(f.fixture.pdfPath, 'utf8')).toBe('%PDF-1.7 original pdf');
        expect(await f.fixture.acceptedBuild.read()).toEqual(f.metadata);
        expect(electronBoundary.createWindow).not.toHaveBeenCalled();
        expect(f.fixture.relaunch).toHaveBeenCalledTimes(scenario === 'completed' ? 1 : 0);
        if (scenario === 'completed') {
          expect(await f.fixture.journal.peek()).toBeUndefined();
          expect(await f.fixture.registry.inspect()).toMatchObject({ activeWorkspaceId: null });
          expect((await switchStore.inspectSlots()).current?.value.state).toBe('rollbackSelected');
        } else {
          expect(observe.mock.calls.some(([error]) => hasErrorCause(error, fault))).toBe(true);
          expect(await f.fixture.journal.peek()).toMatchObject({ phase: 'rolledBack' });
          expect(await f.fixture.registry.inspect()).toEqual(registry);
          expect(await switchStore.inspectSlots()).toEqual(switchSelection);
          if (scenario === 'releaseFailure') expect(releaseFailed).toBe(true);
        }
      });
    }, scenario === 'completed' ? 20_000 : restoreStartupCompositionTimeoutMs);
  }

  it('does not publish business acceptance when fresh content changes lineage after source-null switch acceptance', async context => {
    const lifetime = beginTrackedStartupTest(context);
    await lifetime.run(async () => {
      const f = await lifetime.step('fixturePreparation', () => createDeferredStartupFixture(lifetime.roots, true));
      const switchStore = await seedSelectorTarget(f.fixture);
      const inspect = vi.mocked(snapshotInspection.runProfileSnapshotInspection).getMockImplementation()!;
      let changed = false;
      vi.mocked(snapshotInspection.runProfileSnapshotInspection).mockImplementation(async input => {
        const result = await inspect(input);
        if ((await switchStore.inspectSlots()).current !== undefined) return result;
        changed = true;
        return { ...result, receipt: { ...result.receipt, profileId: foreignProfileId },
          validation: { ...result.validation, profileId: foreignProfileId } };
      });
      await lifetime.step('startup', async () => { await expect(f.fixture.start()).rejects.toThrow(); });
      expect(changed).toBe(true);
      expect(await f.fixture.acceptedBuild.read()).toEqual(f.metadata);
      expect(await f.fixture.registry.inspect()).toMatchObject({ activeWorkspaceId: workspaceId });
      expect((await switchStore.inspectSlots()).current).toBeUndefined();
      expect(f.fixture.relaunch).not.toHaveBeenCalled();
      expect(electronBoundary.createWindow).not.toHaveBeenCalled();
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

  it.for((['creation', 'import'] as const).flatMap(kind =>
    (['prepared', 'rootPublished'] as const).map(state => ({ kind, state }))))(
    'preserves cold $kind/$state evidence when all selector registry slots are missing', async ({ kind, state }, context) => {
      const lifetime = beginTrackedStartupTest(context);
      await lifetime.run(async () => {
        const fixture = await lifetime.step('fixturePreparation', () => createFixture(originalProfileId, {
          ownedRoots: lifetime.roots, update: true, skipRestore: true, completeStartup: true,
        }));
        await fixture.registry.write({ ...(await fixture.registry.read())!, formatVersion: 2, activeWorkspaceId: null });
        const pending = await prepareColdJournal(fixture.root, kind, { state, previousActiveWorkspaceId: null });
        const payload = await preparePlaintext(fixture.root);
        const evidencePaths = [pending.paths.currentPath, fixture.databasePath, fixture.pdfPath, payload,
          state === 'prepared' ? pending.candidateFile : pending.publishedFile];
        const before: Buffer[] = [];
        for (const path of evidencePaths) before.push(await readFile(path));
        const registryPaths = ['', '.next', '.backup'].map(suffix =>
          join(fixture.root, WORKSPACE_REGISTRY_FILE_NAME + suffix));
        for (const path of registryPaths) await rm(path, { force: true });

        await lifetime.step('startup', async () => {
          await expect(fixture.start()).rejects.toThrow('WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED');
        });

        for (const [index, path] of evidencePaths.entries()) {
          await expect(readFile(path)).resolves.toEqual(before[index]);
        }
        for (const path of registryPaths) {
          await expect(readFile(path)).rejects.toMatchObject({ code: 'ENOENT' });
        }
        expect(fixture.events).toEqual([]);
        expect(fixture.createRuntimeSession).not.toHaveBeenCalled();
        expect(electronBoundary.fork).not.toHaveBeenCalled();
        expect(electronBoundary.createWindow).not.toHaveBeenCalled();
        expect(fixture.relaunch).not.toHaveBeenCalled();
      });
    },
  );

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

describe('W7.4 adoption main phase ownership', () => {
  it.for(['accepted', 'backendStopped', 'bindingReplyLost'] as const)(
    'uses the real main phase boundary when %s', async (scenario, context) => {
      const lifetime = beginTrackedStartupTest(context);
      await lifetime.run(async () => {
        let backend: DesktopBackendHandle | undefined;
        let authority: WorkspaceLegacyAdoptionAcceptanceAuthority | undefined;
        let f!: Awaited<ReturnType<typeof createFixture>>;
        const resolve: NonNullable<StartDesktopCompositionOptions['dependencies']>['resolveActiveWorkspace'] = async (root, options) => {
          if (options?.selectorAuthority === undefined) throw new Error('SYNTHETIC_MAIN_AUTHORITY_MISSING');
          const selected = await resolveActiveWorkspaceStartup(root, { ...options, selectorAuthority: options.selectorAuthority });
          if (selected.mode === 'selector') throw new Error('SYNTHETIC_ADOPTION_EXPECTED');
          return Object.freeze({ ...selected, async accept(profileId: string, current?: WorkspaceLegacyAdoptionAcceptanceAuthority) {
            authority = current;
            expect(current?.context).toBe(selected.adoptionContext);
            expect(current?.profileId).toBe(originalProfileId);
            current!.assertMutationCurrent();
            expect(f.stop).not.toHaveBeenCalled();
            if (scenario === 'backendStopped') await backend!.stop();
            await selected.accept(profileId, current);
          } });
        };
        f = await lifetime.step('fixturePreparation', () => createFixture(originalProfileId, {
          ownedRoots: lifetime.roots, update: true, skipRestore: true, completeStartup: true,
          resolveActiveWorkspace: resolve, observeControlledBackend: handle => { backend = handle; },
        }));
        electronBoundary.fetch.mockImplementation(async url => String(url).endsWith('/customers')
          ? new Response(null, { status: 401 }) : new Response(JSON.stringify({ status: 'ok' })));
        const legacy = createDesktopProfilePaths(f.root);
        const legacyPdf = join(legacy.invoiceDocumentStorageRoot, 'company-1', 'invoice-1', 'approved-invoice.pdf');
        await mkdir(dirname(legacy.databaseFilePath), { recursive: true });
        await mkdir(dirname(legacyPdf), { recursive: true });
        await copyFile(f.databasePath, legacy.databaseFilePath);
        await copyFile(f.pdfPath, legacyPdf);
        await rm(f.stagingRoot, { recursive: true, force: true });
        await rm(join(f.root, WORKSPACE_REGISTRY_FILE_NAME));
        const journal = new WorkspaceLegacyAdoptionJournalStore(f.root);
        for (const state of ['prepared', 'candidatePrepared', 'rootPublished'] as const) {
          await journal.write({ formatVersion: 1, operationId, workspaceId, sourceKind: 'legacy', state, createdAt: '2026-08-18T10:00:00.000Z' });
        }
        const publish = WorkspaceRemnantBindingStore.prototype.publish;
        const first = new Error('SYNTHETIC_ADOPTION_BINDING_REPLY_LOST');
        const published = vi.spyOn(WorkspaceRemnantBindingStore.prototype, 'publish').mockImplementation(async function (this: WorkspaceRemnantBindingStore, value, guard) {
          expect(f.stop).not.toHaveBeenCalled();
          const receipt = await publish.call(this, value, guard);
          if (scenario === 'bindingReplyLost') throw first;
          return receipt;
        });
        const observe = vi.fn();
        let lifecycle: Awaited<ReturnType<typeof f.start>>;
        try {
          if (scenario === 'accepted') lifecycle = await lifetime.step('startup', () => f.start(observe));
          else await lifetime.step('startup', async () => { await expect(f.start(observe)).rejects.toThrow(); });
          expect(authority?.phase).toBe('acceptance');
          expect(() => authority!.assertMutationCurrent()).toThrow();
          if (scenario === 'accepted') {
            expect(lifecycle).toBeDefined();
            expect((await f.registry.read())?.activeWorkspaceId).toBe(workspaceId);
            expect(await journal.read()).toBeUndefined();
            expect(f.stop).not.toHaveBeenCalled();
            expect(published).toHaveBeenCalledOnce();
          } else {
            expect(await f.registry.inspect()).toBeUndefined();
            expect(f.stop).toHaveBeenCalled();
            if (scenario === 'backendStopped') {
              expect(published).not.toHaveBeenCalled();
              expect((await journal.read())?.state).toBe('recoveryRequired');
            } else {
              expect(published).toHaveBeenCalledOnce();
              expect(observe.mock.calls.some(([error]) => hasErrorCause(error, first))).toBe(true);
              expect((await journal.read())?.state).toBe('rootPublished');
              expect(electronBoundary.reservationAcquired.mock.calls.filter(([input]) => input.userDataRoot === f.root)).toHaveLength(2);
              // Initial handoff only: uncertainty did not prevent child reclaim,
              // and did not release the reclaimed main reservation afterwards.
              expect(electronBoundary.reservationReleased.mock.calls.filter(([root]) => root === f.root)).toHaveLength(1);
            }
          }
          expect(await readFile(legacy.databaseFilePath, 'utf8')).toBe(f.originalBytes);
          expect(await readFile(legacyPdf, 'utf8')).toBe('%PDF-1.7 original pdf');
        } finally { await lifecycle?.shutdown(); }
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

  for (const replacementTarget of [false, true]) {
    it(`logs terminal preparation failure before a successful rollback relaunch (replacement: ${replacementTarget})`, async context => {
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
    }, replacementTarget ? restoreStartupCompositionTimeoutMs : undefined);
  }

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

  it.for(['completed', 'changedSelection', 'wrongWorkspace', 'changedSideSlot'] as const)(
    'binds live replacement acceptance to the main selection (%s)', async (scenario, context) => {
      const lifetime = beginTrackedStartupTest(context);
      await lifetime.run(async () => {
        const f = await lifetime.step('fixturePreparation', () => createFixture(originalProfileId, {
          replacementTarget: true, acceptedRestore: true, ownedRoots: lifetime.roots,
        }));
        const selected = await f.journal.peek();
        const terminal = terminalRestore.withProfileRestoreTerminalAuthority;
        const owner = vi.spyOn(terminalRestore, 'withProfileRestoreTerminalAuthority').mockImplementation((input, use) => {
          expect(input.operationSelection).toBeDefined(); return terminal(input, use);
        });
        const clear = ProfileRestoreActivationTransaction.prototype.clearAccepted;
        vi.spyOn(ProfileRestoreActivationTransaction.prototype, 'clearAccepted')
          .mockImplementation(async function (this: ProfileRestoreActivationTransaction, ...args) {
            expect(args[2]?.assertMutationCurrent).toBeTypeOf('function');
            if (scenario === 'changedSelection' || scenario === 'wrongWorkspace') {
              const registry = (await f.registry.read())!;
              if (scenario === 'wrongWorkspace') {
                const other = registry.workspaces.find(entry => entry.workspaceId !== registry.activeWorkspaceId);
                expect(other).toBeDefined();
                await f.registry.write({ ...registry, activeWorkspaceId: other!.workspaceId });
              } else await f.registry.write({ ...registry,
                  workspaces: registry.workspaces.map(entry => ({ ...entry, workspaceLabel: `${entry.workspaceLabel} changed` })),
                });
            } else if (scenario === 'changedSideSlot') {
              const path = join(f.root, WORKSPACE_REGISTRY_FILE_NAME);
              await writeFile(`${path}.next`, await readFile(path), { flag: 'wx', mode: 0o600 });
            }
            return clear.apply(this, args);
          });
        await lifetime.step('startup', async () => {
          if (scenario === 'completed') await expect(f.start()).rejects.toThrow(windowBoundary);
          else await expect(f.start()).rejects.toThrow();
        });
        expect(owner).toHaveBeenCalledOnce(); expect(f.relaunch).not.toHaveBeenCalled();
        expect(electronBoundary.createWindow).toHaveBeenCalledTimes(scenario === 'completed' ? 1 : 0);
        expect(await f.journal.peek()).toEqual(scenario === 'completed' ? undefined : selected);
        expect(await readFile(f.databasePath, 'utf8')).toBe(f.restoredBytes);
        if (scenario === 'changedSideSlot') {
          const path = join(f.root, WORKSPACE_REGISTRY_FILE_NAME);
          expect(await readFile(`${path}.next`)).toEqual(await readFile(path));
        }
      });
    },
  );

  it('offers the original inspection startup error before its safe process error reaches main', async context => {
    const lifetime = beginTrackedStartupTest(context);
    await lifetime.run(async () => {
      const f = await lifetime.step('fixturePreparation', () => createFixture(originalProfileId, {
        replacementTarget: true, acceptedRestore: true, completeStartup: true, ownedRoots: lifetime.roots,
      }));
      const original = new Error('SYNTHETIC_INSPECTION_STARTUP_ORIGINAL', { cause: new Error('SYNTHETIC_INSPECTION_STARTUP_CAUSE') });
      const observe = vi.fn();
      vi.mocked(snapshotInspection.runProfileSnapshotInspection).mockImplementationOnce(async input => {
        input.observeException?.(original);
        throw new ProfileInspectionProcessError('unknown', { processAbsent: true, reservationReclaimed: true, forced: false });
      });
      await lifetime.step('startup', async () => { await expect(f.start(observe)).rejects.toThrow(); });
      expect(observe.mock.calls[0]?.[0] === original).toBe(true);
      expect(observe.mock.calls[0]?.[1]).toBe('runtimeStartup');
      expect(electronBoundary.createWindow).not.toHaveBeenCalled();
    });
  });

  it('uses fresh runtime inspection selection after replacement startup selection closes', async context => {
    const lifetime = beginTrackedStartupTest(context);
    await lifetime.run(async () => {
      const f = await lifetime.step('fixturePreparation', () => createFixture(originalProfileId, {
        replacementTarget: true, acceptedRestore: true, completeStartup: true, ownedRoots: lifetime.roots,
      }));
      let client: ProfileSnapshotInspectionClient | undefined;
      const validate = ProfileSnapshotInspectionClient.prototype.validateProfileSnapshot;
      vi.spyOn(ProfileSnapshotInspectionClient.prototype, 'validateProfileSnapshot')
        .mockImplementation(function (this: ProfileSnapshotInspectionClient, ...args) {
          client = this;
          return validate.apply(this, args);
        });
      let runtimeInspection = false;
      const observe = vi.fn();
      const inspect = vi.mocked(snapshotInspection.runProfileSnapshotInspection).getMockImplementation()!;
      vi.mocked(snapshotInspection.runProfileSnapshotInspection).mockImplementation(async input => {
        if (runtimeInspection) {
          input.observeException?.(new Error('SYNTHETIC_POST_STARTUP_INSPECTION'));
          expect(input.target).toMatchObject({ kind: 'bound', workspaceId,
            lineageIdentity: { formatVersion: 1, profileId: originalProfileId } });
          if (input.target.kind !== 'bound') throw new Error('SYNTHETIC_RUNTIME_TARGET_MISSING');
          await input.target.assertSelectionCurrent(input.assertAuthority);
        }
        return inspect(input);
      });
      const lifecycle = await lifetime.step('startup', () => f.start(observe));
      expect(lifecycle).toBeDefined();
      let firstFailure: { error: unknown } | undefined;
      try {
        expect(await f.journal.peek()).toBeUndefined();
        expect(client).toBeDefined();
        runtimeInspection = true;
        const snapshotId = '33333333-3333-4333-8333-333333333333';
        await client!.createProfileSnapshot(snapshotId, 'exactCurrentManifest');
        await client!.validateProfileSnapshot(snapshotId);
        await client!.removeProfileSnapshot(snapshotId);
        expect(observe).not.toHaveBeenCalled();
        expect(electronBoundary.createWindow).toHaveBeenCalledOnce();
      } catch (error) { firstFailure = { error }; }
      try { await lifecycle?.shutdown(); }
      catch (error) {
        if (firstFailure === undefined) throw error;
        throw new AggregateError([firstFailure.error, error], 'SYNTHETIC_RUNTIME_INSPECTION_AND_SHUTDOWN_FAILED',
          { cause: firstFailure.error });
      }
      if (firstFailure !== undefined) throw firstFailure.error;
    });
  });

  it('retains reclaimed main ownership while a live terminal mutation remains pending', async context => {
    const lifetime = beginTrackedStartupTest(context);
    await lifetime.run(async () => {
      const f = await lifetime.step('fixturePreparation', () => createFixture(originalProfileId, {
        replacementTarget: true, acceptedRestore: true, ownedRoots: lifetime.roots,
      }));
      const selected = await f.journal.peek();
      const entered = createCompletionGate(); const finish = createCompletionGate();
      const settled = createCompletionGate(); const closing = createCompletionGate();
      let expireWork: (() => void) | undefined; let expireClose: (() => void) | undefined;
      let captureWork = false; let captureClose = false;
      let captureClientClose = false; let expireClientClose: (() => void) | undefined;
      const clientClosing = createCompletionGate();
      const shutdown = ProfileSnapshotInspectionClient.prototype.shutdown;
      vi.spyOn(ProfileSnapshotInspectionClient.prototype, 'shutdown').mockImplementation(function (this: ProfileSnapshotInspectionClient) {
        captureClientClose = expireClose !== undefined && expireClientClose === undefined;
        return shutdown.call(this);
      });
      const terminal = terminalRestore.withProfileRestoreTerminalAuthority;
      vi.spyOn(terminalRestore, 'withProfileRestoreTerminalAuthority').mockImplementation((input, use) => {
        expect(input.operationSelection).toBeDefined(); captureWork = true; return terminal(input, use);
      });
      const setTimer = globalThis.setTimeout;
      vi.spyOn(globalThis, 'setTimeout').mockImplementation((callback, timeout, ...args) => {
        if (captureWork && timeout === profileInspectionWorkMilliseconds) {
          captureWork = false; expireWork = () => { captureClose = true; callback(...args); };
        }
        if (captureClose && timeout === profileInspectionShutdownMilliseconds) {
          captureClose = false; expireClose = () => callback(...args); closing.resolve();
        }
        if (captureClientClose && typeof timeout === 'number' && timeout <= 2 * profileInspectionShutdownMilliseconds) {
          captureClientClose = false; expireClientClose = () => callback(...args); clientClosing.resolve();
        }
        return setTimer(callback, timeout, ...args);
      });
      const clear = ProfileRestoreActivationTransaction.prototype.clearAccepted;
      let guardedLateWrite = false; let workEntered = false;
      vi.spyOn(ProfileRestoreActivationTransaction.prototype, 'clearAccepted')
        .mockImplementation(async function (this: ProfileRestoreActivationTransaction, ...args) {
          workEntered = true; entered.resolve();
          try {
            await finish.promise;
            try { args[2]!.assertMutationCurrent!(); } catch (error) { guardedLateWrite = true; throw error; }
            await clear.apply(this, args);
          } finally { settled.resolve(); }
        });
      const result = lifetime.step('startup', () => f.start().then(() => undefined, (error: unknown) => error));
      try {
        await Promise.race([entered.promise, result.then(() => { throw new Error('TERMINAL_NOT_ENTERED'); })]);
        expect(expireWork).toBeTypeOf('function'); expireWork!(); await closing.promise;
        expect(expireClose).toBeTypeOf('function'); expireClose!();
        await clientClosing.promise;
        expect(expireClientClose).toBeTypeOf('function'); expireClientClose!();
        expect(await result).toBeInstanceOf(Error);
        expect(f.events).toContain('backendStopped');
        expect(electronBoundary.reservationAcquired.mock.calls.filter(([input]) => input.userDataRoot === f.root)).toHaveLength(2);
        expect(electronBoundary.reservationReleased.mock.calls.filter(([root]) => root === f.root)).toHaveLength(1);
        expect(ProfileSnapshotBrokerClient.prototype.invalidateRestoreMaintenance).toHaveBeenCalled();
        expect(electronBoundary.createWindow).not.toHaveBeenCalled(); expect(f.relaunch).not.toHaveBeenCalled();
        expect(await f.journal.peek()).toEqual(selected);
      } finally {
        finish.resolve(); if (workEntered) await settled.promise;
        await result; await nextEventLoopTurn();
      }
      expect(guardedLateWrite).toBe(true);
      expect(electronBoundary.reservationReleased.mock.calls.filter(([root]) => root === f.root)).toHaveLength(1);
      expect(await f.journal.peek()).toEqual(selected);
      expect(await readFile(f.databasePath, 'utf8')).toBe(f.restoredBytes);
      await f.assertRegistryUnchanged();
    });
  });

  it.for(['completed', 'changedSelection', 'healthFailure', 'releaseFailure'] as const)(
    'keeps replacement rolled-back cleanup inside the validated main owner (%s)', async (scenario, context) => {
      const lifetime = beginTrackedStartupTest(context);
      await lifetime.run(async () => {
        const f = await lifetime.step('fixturePreparation', () => createFixture(originalProfileId, {
          replacementTarget: true, coldRollback: true, rolledBack: true, ownedRoots: lifetime.roots,
        }));
        const selected = await f.journal.peek();
        let insideContinuation = false;
        const finalChecks: string[] = [];
        const inspectSelection = WorkspaceRegistryStore.prototype.inspectSlots;
        vi.spyOn(WorkspaceRegistryStore.prototype, 'inspectSlots').mockImplementation(async function (this: WorkspaceRegistryStore, ...args) {
          const slots = await inspectSelection.apply(this, args);
          if (insideContinuation) finalChecks.push('selection');
          return slots;
        });
        const validate = ownedProfileValidation.validateOwnedActiveProfile;
        const validation = vi.spyOn(ownedProfileValidation, 'validateOwnedActiveProfile').mockImplementation(input => {
          if (input.useValidatedProfile === undefined) return validate(input);
          const use = input.useValidatedProfile;
          return validate({ ...input, useValidatedProfile: async authority => {
            insideContinuation = true;
            try { await use({ ...authority, async assertCurrent() {
              await authority.assertCurrent(); finalChecks.push('content');
            } }); } finally { insideContinuation = false; }
          } });
        });
        const withSnapshot = vi.spyOn(ProfileSnapshotInspectionClient.prototype, 'withProfileSnapshot');
        const clear = ProfileRestoreActivationTransaction.prototype.clearRolledBack;
        const cleanup = vi.spyOn(ProfileRestoreActivationTransaction.prototype, 'clearRolledBack')
          .mockImplementation(async function (this: ProfileRestoreActivationTransaction, ...args) {
            expect(insideContinuation).toBe(true);
            expect(args[4]).toBeTypeOf('function');
            expect(ProfileSnapshotBrokerClient.prototype.endRestoreMaintenance).not.toHaveBeenCalled();
            if (scenario === 'completed') {
              await args[1]!();
              expect(finalChecks).toContain('selection'); expect(finalChecks.at(-1)).toBe('content');
            }
            if (scenario === 'changedSelection') {
              const registry = (await f.registry.read())!;
              await f.registry.write({ ...registry,
                workspaces: registry.workspaces.map(entry => ({ ...entry, workspaceLabel: `${entry.workspaceLabel} changed` })),
              });
            }
            return clear.apply(this, args);
          });
        if (scenario === 'healthFailure') electronBoundary.fetch.mockResolvedValueOnce(new Response(null, { status: 503 }));
        if (scenario === 'releaseFailure') vi.mocked(ProfileSnapshotBrokerClient.prototype.endRestoreMaintenance)
          .mockRejectedValueOnce(new Error('SYNTHETIC_FENCE_RELEASE_FAILURE'));
        await lifetime.step('startup', async () => {
          await expect(f.start()).rejects.toThrow(scenario === 'completed' ? windowBoundary : 'PROFILE_RESTORE_RECOVERY_REQUIRED');
        });
        await lifetime.step('restoredContentCheck', async () => {
          expect(validation).toHaveBeenCalledOnce(); expect(withSnapshot).toHaveBeenCalledOnce();
          expect(snapshotInspection.runProfileSnapshotInspection).toHaveBeenCalledOnce();
          expect(cleanup).toHaveBeenCalledTimes(scenario === 'healthFailure' ? 0 : 1);
          expect(electronBoundary.createWindow).toHaveBeenCalledTimes(scenario === 'completed' ? 1 : 0);
          expect(f.relaunch).not.toHaveBeenCalled();
          expect(await f.journal.peek()).toEqual(['completed', 'releaseFailure'].includes(scenario) ? undefined : selected);
          expect(await readFile(f.databasePath, 'utf8')).toBe(f.originalBytes);
          expect(await readFile(f.pdfPath, 'utf8')).toBe('%PDF-1.7 original pdf');
        });
      });
    },
  );

  it.for(['timeout', 'guardFailure'] as const)('retains reclaimed main ownership after rolled-back continuation work outlives close (%s)', async (failure, context) => {
    const lifetime = beginTrackedStartupTest(context);
    await lifetime.run(async () => {
      const f = await lifetime.step('fixturePreparation', () => createFixture(originalProfileId, {
        replacementTarget: true, coldRollback: true, rolledBack: true, ownedRoots: lifetime.roots,
      }));
      const selected = await f.journal.peek();
      const entered = createCompletionGate(); const finish = createCompletionGate();
      const settled = createCompletionGate(); const closing = createCompletionGate();
      let expireWork: (() => void) | undefined; let expireClose: (() => void) | undefined;
      let captureValidationTimer = false;
      let revokeGuard = false;
      const firstGuardFailure = new Error('SYNTHETIC_ROLLED_BACK_GUARD_FAILURE');
      const validate = ownedProfileValidation.validateOwnedActiveProfile;
      vi.spyOn(ownedProfileValidation, 'validateOwnedActiveProfile').mockImplementation(input => {
        captureValidationTimer = input.useValidatedProfile !== undefined;
        const use = input.useValidatedProfile;
        return use === undefined ? validate(input) : validate({ ...input, useValidatedProfile: authority => use({
          ...authority, assertMutationCurrent() {
            if (revokeGuard) throw firstGuardFailure;
            authority.assertMutationCurrent();
          },
        }) });
      });
      const setTimer = globalThis.setTimeout;
      vi.spyOn(globalThis, 'setTimeout').mockImplementation((callback, timeout, ...args) => {
        if (captureValidationTimer && timeout === profileInspectionWorkMilliseconds) {
          captureValidationTimer = false; expireWork = () => callback(...args);
        }
        if (timeout === 2 * profileInspectionShutdownMilliseconds) {
          expireClose = () => callback(...args); closing.resolve();
        }
        return setTimer(callback, timeout, ...args);
      });
      const clear = ProfileRestoreActivationTransaction.prototype.clearRolledBack;
      let guardedLateWrite = false; let workEntered = false; let cleaning = false;
      const inspect = WorkspaceRegistryStore.prototype.inspectSlots;
      vi.spyOn(WorkspaceRegistryStore.prototype, 'inspectSlots').mockImplementation(async function (this: WorkspaceRegistryStore, ...args) {
        if (failure !== 'guardFailure' || !cleaning || workEntered) return inspect.apply(this, args);
        workEntered = true; revokeGuard = true; entered.resolve();
        try { args[0]!(); return await inspect.apply(this, args); }
        finally { await finish.promise; settled.resolve(); }
      });
      vi.spyOn(ProfileRestoreActivationTransaction.prototype, 'clearRolledBack')
        .mockImplementation(async function (this: ProfileRestoreActivationTransaction, ...args) {
          if (failure === 'guardFailure') { cleaning = true; return clear.apply(this, args); }
          workEntered = true; entered.resolve();
          try {
            await finish.promise;
            try { args[4]!(); } catch (error) { guardedLateWrite = true; throw error; }
            await clear.apply(this, args);
          } finally { settled.resolve(); }
        });
      const observed: unknown[] = [];
      const result = lifetime.step('startup', () => f.start(error => { observed.push(error); })
        .then(() => undefined, (error: unknown) => error));
      try {
        await Promise.race([entered.promise, result.then(() => { throw new Error('STARTUP_FINISHED_BEFORE_CLEANUP_GATE'); })]);
        expect(expireWork).toBeTypeOf('function'); if (failure === 'timeout') expireWork!();
        await closing.promise;
        expect(expireClose).toBeTypeOf('function'); expireClose!();
        expect(await result).toMatchObject({ message: 'PROFILE_RESTORE_RECOVERY_REQUIRED' });
        expect(((observed[0] as Error).cause as AggregateError).errors[0]).toMatchObject({
          message: failure === 'timeout' ? 'PROFILE_INSPECTION_TIMEOUT' : firstGuardFailure.message,
        });
        expect(f.events).toContain('backendStopped');
        expect(electronBoundary.reservationAcquired.mock.calls.filter(([input]) => input.userDataRoot === f.root))
          .toHaveLength(2);
        expect(electronBoundary.reservationReleased.mock.calls.filter(([root]) => root === f.root)).toHaveLength(1);
        expect(ProfileSnapshotBrokerClient.prototype.invalidateRestoreMaintenance).toHaveBeenCalled();
        expect(ProfileSnapshotBrokerClient.prototype.endRestoreMaintenance).not.toHaveBeenCalled();
        expect(electronBoundary.createWindow).not.toHaveBeenCalled(); expect(f.relaunch).not.toHaveBeenCalled();
        expect(await f.journal.peek()).toEqual(selected);
      } finally {
        finish.resolve(); if (workEntered) await settled.promise;
        await result; await nextEventLoopTurn();
      }
      expect(guardedLateWrite).toBe(failure === 'timeout');
      expect(electronBoundary.reservationReleased.mock.calls.filter(([root]) => root === f.root)).toHaveLength(1);
      expect(await f.journal.peek()).toEqual(selected);
      expect(await readFile(f.databasePath, 'utf8')).toBe(f.originalBytes);
      expect(await readFile(f.pdfPath, 'utf8')).toBe('%PDF-1.7 original pdf');
      await f.assertRegistryUnchanged();
    });
  });

  for (const replacementTarget of [false, true]) {
    it.for([replacementTarget])(
      'uses original cold admission across startup rollback (replacement: %s)',
      replacementTarget ? { timeout: restoreStartupCompositionTimeoutMs } : {},
      async (replacementTarget, context) => {
        const lifetime = beginTrackedStartupTest(context);
        await lifetime.run(async () => {
          const fixture = await lifetime.step('fixturePreparation', () => createFixture(originalProfileId, {
            replacementTarget, coldRollback: true, ownedRoots: lifetime.roots,
          }));
          const exceptions: unknown[] = [];
          await lifetime.step('startupRollback', async () => {
            try { await fixture.start(error => { exceptions.push(error); }); }
            catch (error) { if (!(error instanceof Error) || error.message !== windowBoundary) throw exceptions[0] ?? error; }
          });
          await lifetime.step('restoredContentCheck', async () => {
            expect(electronBoundary.createWindow).toHaveBeenCalledOnce();
            expect(vi.mocked(originalInspection.runProfileRestoreOriginalInspection)).toHaveBeenCalledTimes(3);
            expect(fixture.events).toEqual(['rollback', 'backendStarted']);
            expect(await readFile(fixture.databasePath, 'utf8')).toBe(fixture.originalBytes);
            expect(await readFile(fixture.pdfPath, 'utf8')).toBe('%PDF-1.7 original pdf');
            expect(await fixture.journal.peek()).toBeUndefined();
            await fixture.assertRegistryUnchanged();
          });
        });
      },
    );
  }

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

  for (const replacementTarget of [false, true]) {
    it(`uses cold content admission across actual forward moves (replacement: ${replacementTarget})`, async context => {
      const lifetime = beginTrackedStartupTest(context);
      const startedAt = performance.now();
      const phase = { selectionStartedMs: null as number | null, selectionSettledMs: null as number | null,
        forwardStartedMs: null as number | null, forwardSettledMs: null as number | null };
      let readInspectionCalls = () => 0;
      context.onTestFailed(() => console.error(JSON.stringify({ diagnostic: 'coldContentAdmissionPhase',
        replacementTarget, ...phase,
        inspectionCalls: readInspectionCalls(),
        observedMs: Math.round(performance.now() - startedAt) })));
      await lifetime.run(async () => {
        const fixture = await lifetime.step('fixturePreparation', () => createFixture(originalProfileId, {
          replacementTarget, coldForward: true, ownedRoots: lifetime.roots,
        }));
        const inspection = vi.mocked(coldInspection.runProfileRestoreColdInspection);
        readInspectionCalls = () => inspection.mock.calls.length;
        let capturedDeadline: number | undefined;
        let captureCompleted = false;
        const prepare = restoreSelectionPreparation.prepareDesktopWorkspaceRestoreSelection;
        const preparation = vi.spyOn(restoreSelectionPreparation, 'prepareDesktopWorkspaceRestoreSelection').mockImplementation(async input => {
          phase.selectionStartedMs = Math.round(performance.now() - startedAt);
          capturedDeadline = input.deadline;
          expect(capturedDeadline).toBeTypeOf('number'); expect(input.signal).toBeUndefined();
          const result = await prepare(input);
          phase.selectionSettledMs = Math.round(performance.now() - startedAt);
          expect((input.maintenanceLease as InMemoryWorkspaceMaintenanceLease).readState()).toBe('idle');
          captureCompleted = true; return result;
        });
        const forward = coldForwardRestore.prepareProfileRestoreColdForwardRecovery;
        vi.spyOn(coldForwardRestore, 'prepareProfileRestoreColdForwardRecovery').mockImplementation(input => {
          phase.forwardStartedMs = Math.round(performance.now() - startedAt);
          expect(captureCompleted).toBe(replacementTarget);
          if (replacementTarget) expect(input.operationSelection!.deadline).toBe(capturedDeadline);
          else expect(input.operationSelection).toBeUndefined();
          const pending = forward(input);
          const markSettled = () => { phase.forwardSettledMs = Math.round(performance.now() - startedAt); };
          void pending.then(markSettled, markSettled);
          return pending;
        });
        let reachedWindow = false;
        const startupExceptions: unknown[] = [];
        try { await lifetime.step('startup', () => fixture.start(error => { startupExceptions.push(error); })); }
        catch (error) {
          if (!(error instanceof Error) || error.message !== windowBoundary) {
            throw startupExceptions[0] ?? error;
          }
          reachedWindow = true;
        }
        await lifetime.step('restoredContentCheck', async () => {
          expect(reachedWindow).toBe(true);
          expect(preparation).toHaveBeenCalledTimes(replacementTarget ? 1 : 0);
          expect(vi.mocked(coldInspection.runProfileRestoreColdInspection)).toHaveBeenCalledTimes(3);
          expect(fixture.events).toEqual(['backendStarted', 'accept']);
          expect(await readFile(fixture.databasePath, 'utf8')).toBe(fixture.restoredBytes);
          expect(await fixture.journal.peek()).toBeUndefined();
          await fixture.assertRegistryUnchanged();
        });
      });
    }, replacementTarget ? restoreStartupCompositionTimeoutMs : undefined);
  }

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

  it.for(['preparation', 'postGrant'] as const)(
    'retains accepted startup ownership while selected %s work remains pending', async (stage, context) => {
      const lifetime = beginTrackedStartupTest(context);
      await lifetime.run(async () => {
        const entered = createCompletionGate(); const finish = createCompletionGate();
        const settled = createCompletionGate(); const closing = createCompletionGate();
        let workEntered = false; let processExited = false;
        let expireWork: (() => void) | undefined; let expireClose: (() => void) | undefined;
        const child = new EventEmitter();
        const kill = vi.fn(() => { processExited = true; child.emit('exit', 1); return true; });
        const postMessage = vi.fn(message => {
          if (message.type === 'prepare') child.emit('message', { type: 'reservationReady', reservation: message.reservation });
        });
        electronBoundary.fork.mockImplementation(() => {
          queueMicrotask(() => child.emit('spawn')); return Object.assign(child, { kill, postMessage });
        });
        const f = await lifetime.step('fixturePreparation', () => createFixture(originalProfileId, {
          replacementTarget: true, acceptedRestore: true, realBackend: true, ownedRoots: lifetime.roots,
        }));
        const selected = await f.journal.peek();
        const setTimer = globalThis.setTimeout;
        vi.spyOn(globalThis, 'setTimeout').mockImplementation((callback, timeout, ...args) => {
          if (timeout === desktopBackendReadinessTimeoutMilliseconds) expireWork = () => callback(...args);
          if (processExited && typeof timeout === 'number' && timeout <= profileInspectionShutdownMilliseconds) {
            expireClose = () => callback(...args); closing.resolve();
          }
          return setTimer(callback, timeout, ...args);
        });
        const prepare = restoreSelectionPreparation.prepareDesktopWorkspaceRestoreSelection;
        vi.spyOn(restoreSelectionPreparation, 'prepareDesktopWorkspaceRestoreSelection').mockImplementation(async input => {
          expect(input.deadline).toBeUndefined(); expect(input.signal).toBeInstanceOf(AbortSignal);
          if (stage === 'preparation') {
            try {
              return await prepare({ ...input, sources: { ...input.sources, registry: {
                async inspectSlots(...args) {
                  workEntered = true; entered.resolve(); await finish.promise;
                  return input.sources.registry.inspectSlots(...args);
                },
              } } });
            } finally { settled.resolve(); }
          }
          const selection = await prepare(input); let calls = 0;
          return { ...selection, async assertCurrent(...args) {
            if (++calls !== 2) return selection.assertCurrent(...args);
            workEntered = true; entered.resolve();
            try { await finish.promise; return await selection.assertCurrent(...args); }
            finally { settled.resolve(); }
          } };
        });
        const result = lifetime.step('startup', () => f.start().then(() => undefined, (error: unknown) => error));
        try {
          await Promise.race([entered.promise, result.then(() => { throw new Error('SELECTED_STARTUP_WORK_NOT_ENTERED'); })]);
          expect(expireWork).toBeTypeOf('function'); expireWork!(); await closing.promise;
          expect(expireClose).toBeTypeOf('function'); expireClose!();
          expect(await result).toMatchObject({ message: 'BACKEND_READINESS_TIMEOUT' });
          expect(kill).toHaveBeenCalledOnce();
          expect(postMessage.mock.calls.some(([message]) => message.type === 'start')).toBe(false);
          expect(electronBoundary.reservationAcquired.mock.calls.filter(([input]) => input.userDataRoot === f.root)).toHaveLength(1);
          expect(electronBoundary.reservationReleased.mock.calls.filter(([root]) => root === f.root))
            .toHaveLength(stage === 'preparation' ? 0 : 1);
          expect(f.relaunch).not.toHaveBeenCalled(); expect(electronBoundary.createWindow).not.toHaveBeenCalled();
          expect(await f.journal.peek()).toEqual(selected);
        } finally {
          finish.resolve(); if (workEntered) await settled.promise;
          await result; await nextEventLoopTurn();
        }
        expect(postMessage.mock.calls.some(([message]) => message.type === 'start')).toBe(false);
        expect(electronBoundary.reservationAcquired.mock.calls.filter(([input]) => input.userDataRoot === f.root)).toHaveLength(1);
        expect(electronBoundary.reservationReleased.mock.calls.filter(([root]) => root === f.root))
          .toHaveLength(stage === 'preparation' ? 0 : 1);
        expect(await f.journal.peek()).toEqual(selected); await f.assertRegistryUnchanged();
        expect(await readFile(f.databasePath, 'utf8')).toBe(f.restoredBytes);
      });
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

  for (const state of ['prepared', 'rootPublished'] as const) {
    it.for([state])(
      'retires the observed cold import binding through main after $0 recovery',
      state === 'rootPublished' ? { timeout: restoreStartupCompositionTimeoutMs } : {},
      async (state, context) => {
        const lifetime = beginTrackedStartupTest(context);
        await lifetime.run(async () => {
          const fixture = await lifetime.step('fixturePreparation', () => createFixture(originalProfileId, {
            ownedRoots: lifetime.roots, skipRestore: true, completeStartup: true,
          }));
          const pending = await prepareColdJournal(fixture.root, 'import', { state });
          const binding = captureWorkspaceRemnantBinding({ formatVersion: 1, owner: 'workspaceImport',
            operationId: pending.value.operationId, workspaceId: pending.value.workspaceId,
            lineageIdentity: { formatVersion: 1, profileId: foreignProfileId } });
          const store = new WorkspaceRemnantBindingStore(fixture.root, workspaceRemnantBindingKey(binding));
          // Fixture setup owns these synthetic files before main acquires startup.
          const setupLease = new InMemoryWorkspaceMaintenanceLease();
          const held = await setupLease.acquire('import');
          const assertAuthority = setupLease.captureCurrentOwner(['import'], held);
          await store.publish(binding, { assertAuthority, async assertExternalSelection() { assertAuthority(); } });
          await held.release();
          const operations = installCompletedColdCandidate();
          const database = await readFile(fixture.databasePath);
          const pdf = await readFile(fixture.pdfPath);
          let lifecycle: Awaited<ReturnType<typeof fixture.start>>;
          let firstFailure: { error: unknown } | undefined;
          try {
            await lifetime.step('startup', async () => { lifecycle = await fixture.start(); });
            expect(lifecycle).toBeDefined();
            expect(operations).toEqual(state === 'prepared' ? [] : ['validatePublished']);
            await expect(pending.journal.read()).resolves.toBeUndefined();
            const slots = createWorkspaceRemnantBindingPaths(fixture.root, workspaceRemnantBindingKey(binding));
            for (const slot of ['currentPath', 'backupPath', 'nextPath'] as const) {
              await expect(readFile(slots[slot])).rejects.toMatchObject({ code: 'ENOENT' });
            }
            await expect(readFile(fixture.databasePath)).resolves.toEqual(database);
            await expect(readFile(fixture.pdfPath)).resolves.toEqual(pdf);
            expect(electronBoundary.createWindow).toHaveBeenCalledOnce();
          } catch (error) {
            firstFailure = { error };
            throw error;
          } finally {
            try { await lifecycle?.shutdown(); }
            catch (cleanupFailure) {
              if (firstFailure !== undefined) throw new AggregateError([firstFailure.error, cleanupFailure],
                'Synthetic cold import startup cleanup failed', { cause: firstFailure.error });
              throw cleanupFailure;
            }
          }
        });
      },
    );
  }

  describe.each(['creation', 'import'] as const)('cold %s production wiring', (kind) => {
    for (const coldCase of [
      { terminal: 'completed', state: 'rootPublished', duplicateLabel: false },
      { terminal: 'failed', state: 'rootPublished', duplicateLabel: false },
      { terminal: 'completed', state: 'rootPublished', duplicateLabel: true },
      { terminal: 'failed', state: 'rootPublished', duplicateLabel: true },
      { terminal: 'completed', state: 'candidateValidated', duplicateLabel: true },
      { terminal: 'failed', state: 'candidateValidated', duplicateLabel: true },
    ] as const) it.for([coldCase])(
      'waits for candidate exit after $terminal from $state (historical duplicate: $duplicateLabel)',
      kind === 'import' && coldCase.terminal === 'completed' && coldCase.state === 'candidateValidated' && coldCase.duplicateLabel
        ? { timeout: 10_000 } : {}, async ({ terminal, state, duplicateLabel }, context) => {
        const lifetime = beginTrackedStartupTest(context);
        await lifetime.run(async () => {
          const fixture = await lifetime.step('fixturePreparation', () => createFixture(originalProfileId, {
            skipRestore: true, completeStartup: true, ownedRoots: lifetime.roots,
          }));
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
        });
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
    const port = vi.spyOn(packagedSmoke, 'reportPackagedSmokeBackend').mockImplementation(() => {
      expect(fixture.events).toContain('backendStarted');
    });
    electronBoundary.loadWindow.mockRejectedValueOnce(original);
    const observe = vi.fn(() => { if (throws) throw new Error('synthetic evidence failure'); });
    await expect(fixture.start(observe)).rejects.toThrow('PACKAGED_SMOKE_FAILED');
    expect(observe.mock.calls).toContainEqual([original, 'packagedSmoke', ['d'.repeat(64)]]);
    expect(port).toHaveBeenCalledExactlyOnceWith(fixture.smokeConfiguration, 12345);
  });

  it('does not publish a packaged backend port observation during normal startup', async () => {
    const fixture = await createFixture(originalProfileId, { skipRestore: true, completeStartup: true });
    const port = vi.spyOn(packagedSmoke, 'reportPackagedSmokeBackend').mockImplementation(() => {
      throw new Error('normal startup must not publish a smoke observation');
    });
    const lifecycle = await fixture.start();
    expect(lifecycle).toBeDefined(); expect(port).not.toHaveBeenCalled();
    await lifecycle!.shutdown();
  });

  it('retains a packaged backend port observation failure and still stops its backend', async () => {
    const fixture = await createFixture(originalProfileId, { skipRestore: true, completeStartup: true, smoke: true });
    const first = new Error('synthetic backend observation writer failure');
    vi.spyOn(packagedSmoke, 'reportPackagedSmokeBackend').mockImplementation(() => { throw first; });
    const observe = vi.fn();
    await expect(fixture.start(observe)).rejects.toThrow('DESKTOP_START_FAILED');
    expect(observe.mock.calls).toContainEqual([first, 'runtimeStartup', ['d'.repeat(64)]]);
    expect(fixture.stop).toHaveBeenCalledOnce();
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

  it('keeps a late joining admission failure unclean after backend exit', async () => {
    const fixture = await createFixture(originalProfileId, { completeStartup: true, skipRestore: true, update: true });
    const readHandoff = prepareUpdateBoundary(fixture.root);
    const lifecycle = (await fixture.start())!;
    const handoff = readHandoff();
    await handoff.prepareConfirmedUpdate();
    let resume!: () => void;
    let started!: () => void;
    const gate = new Promise<void>(resolve => { resume = resolve; });
    const entered = new Promise<void>(resolve => { started = resolve; });
    fixture.stopForUpdate.mockImplementation(async () => { started(); await gate; });
    const updating = handoff.handoffPreparedUpdate().catch(error => error);
    let joining: Promise<unknown> | undefined;
    try {
      await entered;
      vi.spyOn(WorkspaceManagementService.prototype, 'closeAdmission').mockImplementationOnce(() => {
        throw new Error('synthetic-private-late-admission');
      });
      joining = lifecycle.shutdown().catch(error => error);
    } finally { resume(); await updating; await joining; }
    expect(await updating).toBeInstanceOf(Error);
    expect.soft(await joining).toMatchObject({ cause: {
      runtimeFailure: { firstFailure: { phase: 'capabilities', reason: 'operationFailed' } },
    } });
    await expect.soft(fixture.marker.consume()).resolves.toBe('unclean');
    expect(fixture.stopForUpdate).toHaveBeenCalledOnce();
    expect(fixture.stop).not.toHaveBeenCalled();
    expect(launchWindowsInstallerForUpdate).not.toHaveBeenCalled();
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

  for (const replacementTarget of [false, true]) it.for([replacementTarget])('does not relaunch another workspace after rollback restores original database absence (replacement: %s)',
    replacementTarget ? { timeout: 10_000 } : {}, async (replacementTarget, context) => {
    const lifetime = beginTrackedStartupTest(context);
    await lifetime.run(async () => {
      const fixture = await lifetime.step('fixturePreparation', () => createFixture(originalProfileId, {
        replacementTarget, originalDatabaseAbsent: true, ownedRoots: lifetime.roots,
      }));
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
  });

  for (const replacementTarget of [false, true]) {
    it(`checks fresh original content after writer stop before rollback (replacement: ${replacementTarget})`, async context => {
      const lifetime = beginTrackedStartupTest(context);
      await lifetime.run(async () => {
        const fixture = await lifetime.step('fixturePreparation', () => createFixture(originalProfileId, {
          replacementTarget, ownedRoots: lifetime.roots,
        }));
        electronBoundary.fetch.mockResolvedValueOnce(new Response(null, { status: 503 }));
        await lifetime.step('startupRollback', async () => { await expect(fixture.start()).resolves.toBeUndefined(); });
        await lifetime.step('restoredContentCheck', async () => {
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
      });
    }, replacementTarget ? restoreStartupCompositionTimeoutMs : undefined);
  }

  it.each([false, true])('retains original evidence when post-stop original inspection fails (replacement: %s)', async replacementTarget => {
    const fixture = await createFixture(originalProfileId, { replacementTarget });
    electronBoundary.fetch.mockResolvedValueOnce(new Response(null, { status: 503 }));
    vi.mocked(originalInspection.runProfileRestoreOriginalInspection).mockRejectedValueOnce(new Error('PROFILE_SCHEMA_UNSUPPORTED'));
    await expect(fixture.start()).rejects.toThrow('PROFILE_RESTORE_RECOVERY_REQUIRED');
    expect(ProfileRestoreActivationTransaction.prototype.rollback).not.toHaveBeenCalled();
    expect(fixture.relaunch).not.toHaveBeenCalled(); expect(electronBoundary.createWindow).not.toHaveBeenCalled();
    await fixture.assertPendingRestoreRetained();
  });

  for (const replacementTarget of [false, true]) {
    it(`keeps one restore owner from isolated rejection through stopped rollback (replacement: ${replacementTarget})`, async context => {
      const lifetime = beginTrackedStartupTest(context);
      await lifetime.run(async () => {
        const fixture = await lifetime.step('fixturePreparation', () => createFixture(originalProfileId, {
          replacementTarget, ownedRoots: lifetime.roots,
        }));
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
    }, replacementTarget ? restoreStartupCompositionTimeoutMs : undefined);
  }

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
  await mkdir(dirname(paths.legacyAcceptedBuildMetadataPath), { recursive: true, mode: 0o700 });
  await writeFile(paths.legacyAcceptedBuildMetadataPath, JSON.stringify(metadata));
  await writeFile(paths.legacyJournalPath, JSON.stringify(terminal));
  await rm(paths.acceptedBuildMetadataPath);
  await rm(paths.journalPath);
  return { fixture, paths, metadata, boundary, resolve };
}

async function createDeferredStartupFixture(ownedRoots: string[], completeStartup = false, selectorReplacement = false) {
  if (completeStartup) {
    electronBoundary.fetch.mockImplementation(async input => String(input).endsWith('/customers')
      ? new Response(null, { status: 401 }) : new Response(JSON.stringify({ status: 'ok' })));
    vi.spyOn(WorkspaceMigrationInventoryCoordinator.prototype, 'inspect').mockResolvedValue({
      activeWorkspaceId: workspaceId, entries: [{ workspaceId, isActive: true,
        appliedMigrationCount: 1, pendingMigrationCount: 0, status: 'current' }],
    });
  }
  const resolve = vi.fn(async (root: string, options?: Readonly<ActiveWorkspaceStartupOptions>) => {
    if (completeStartup) return options?.selectorAuthority === undefined
      ? resolveActiveWorkspaceStartup(root) : resolveActiveWorkspaceStartup(root, { ...options, selectorAuthority: options.selectorAuthority });
    throw new Error('unexpected workspace resolution');
  });
  const fixture = await createFixture(originalProfileId, {
    ownedRoots, update: true, skipRestore: !selectorReplacement, selectorReplacement, completeStartup, resolveActiveWorkspace: resolve,
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

async function seedAcceptedUpdateJournal(f: Awaited<ReturnType<typeof createDeferredStartupFixture>>) {
  // The C helper seeds historical metadata; preserve the test's selected format.
  const metadata = await readFile(f.paths.acceptedBuildMetadataPath);
  await writeFile(f.paths.acceptedBuildMetadataPath, JSON.stringify(f.metadata.acceptedBuild));
  await prepareUpdateBusinessRollback(f.fixture, 'businessRollbackStarting', false);
  await writeFile(f.paths.acceptedBuildMetadataPath, metadata);
  await f.fixture.updateJournal.write({ ...(await f.fixture.updateJournal.read())!, state: 'accepted', revision: 9 });
}

async function seedSelectorTarget(f: Awaited<ReturnType<typeof createFixture>>) {
  // Only the utility's SQLite/process result is controlled; switch, activation
  // admission, main, W6, FirstStart and their persistent files stay real.
  vi.spyOn(WorkspaceActivationMigrationInspector.prototype, 'inspect').mockResolvedValue({
    status: 'current', appliedMigrationCount: 1, pendingMigrationCount: 0,
  });
  const registry = (await f.registry.inspect())!;
  const journal = createWorkspaceSelectorSwitchJournal({ ...registry, formatVersion: 2, activeWorkspaceId: null },
    workspaceId, operationId, '2026-10-26T12:00:00.000Z');
  const paths = createWorkspaceSwitchJournalPaths(f.root);
  await mkdir(paths.directoryPath, { recursive: true, mode: 0o700 });
  await writeFile(paths.currentPath, serializeVersionedWorkspaceSwitchJournal({ ...journal, state: 'targetSelected' }), { flag: 'wx' });
  return new WorkspaceSwitchJournalStore(f.root);
}

function installCompletedColdCandidate(
  kind: 'readiness' | 'historicalReadiness' = 'readiness', profileId = foreignProfileId,
) {
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
              foreignKeyHealth: 'healthy', kind, migrationChainIdentity: 'c'.repeat(64), profileId },
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
    selectorReplacement?: boolean;
    completeStartup?: boolean;
    smoke?: boolean;
    selectorSmoke?: boolean;
    skipRestore?: boolean;
    inspectBackendStartup?(input: StartDesktopBackendOptions): Promise<void>;
    observeControlledBackend?(handle: DesktopBackendHandle): void;
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
    workspaceDeletionPublisher?: StartDesktopCompositionOptions['workspaceDeletionPublisher'];
    workspaceDeletionCommand?: StartDesktopCompositionOptions['workspaceDeletionCommand'];
    observeWorkspaceStartupFailure?: StartDesktopCompositionOptions['observeWorkspaceStartupFailure'];
    recoveryStartup?: StartDesktopCompositionOptions['recoveryStartup'];
    selectWorkspaceRecoveryChoice?: NonNullable<StartDesktopCompositionOptions['dependencies']>['selectWorkspaceRecoveryChoice'];
    createWorkspaceManagementCapability?: typeof createWorkspaceManagementCapability;
    startComposition?: typeof startDesktopComposition;
    stopForDelete?(operationId: string): Promise<void>;
  } = {},
) {
  const fixtureRoot = await mkdtemp(join(tmpdir(), 'eky-desktop-restore-startup-'));
  (options.ownedRoots ?? roots).push(fixtureRoot);
  const root = options.selectorSmoke ? join(fixtureRoot, 'user-data') : fixtureRoot;
  let windowDestroyed = false;
  const mainWindow = Object.assign(new EventEmitter(), {
    destroy: vi.fn(() => { windowDestroyed = true; }),
    isDestroyed: () => windowDestroyed,
    webContents: Object.assign(new EventEmitter(), {
      mainFrame: {}, send: vi.fn(), isDestroyed: () => windowDestroyed,
    }),
  });
  const quit = vi.fn();
  const showErrorBox = vi.fn();
  const showOpenDialog = vi.fn(async (): Promise<{ canceled: boolean; filePaths: string[] }> => ({ canceled: true, filePaths: [] }));
  const showSaveDialog = vi.fn(async () => ({ canceled: true, filePath: '' }));
  // This composition fixture has a controlled backend, not a delivered native addon.
  const inspectionContractPath = join(root, 'resources', 'backend', 'dist',
    'database', 'connection', 'profileInspectionNativeContract.js');
  await mkdir(dirname(inspectionContractPath), { recursive: true, mode: 0o700 });
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
  if (options.replacementTarget || options.selectorReplacement) {
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
  const workspaces: LocalWorkspaceRegistryEntryV1[] = [{
    workspaceId,
    workspaceLabel: 'Synthetic restore test',
    lineageIdentity: { formatVersion: 1, profileId: originalProfileId },
    layoutVersion: 1,
    lifecycleState: 'ready',
    createdAt: '2026-08-18T10:00:00.000Z',
  }];
  const sourceId = options.replacementTarget
    ? validateWorkspaceId('44444444-4444-4444-8444-444444444444') : undefined;
  if (sourceId !== undefined) {
    await mkdir(deriveWorkspaceRoot(root, sourceId, 1).workspaceRoot, { recursive: true });
    workspaces.push({
      ...workspaces[0]!,
      workspaceId: sourceId,
      workspaceLabel: 'Synthetic previous workspace',
      lineageIdentity: { formatVersion: 1, profileId: foreignProfileId },
    });
  }
  await registry.write({ formatVersion: 1, activeWorkspaceId: workspaceId, workspaces });
  const switchJournal = new WorkspaceSwitchJournalStore(root);
  if (sourceId !== undefined) {
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
    return { receipt, identity: { protocolVersion: profileInspectionProtocolVersion,
      operationId: input.operationId, generationId: input.operationId,
      runtimeSession: 'f'.repeat(43) }, validation: { type: 'profileSnapshotValidation', activeProfileIsEmpty: false,
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
    : vi.fn(() => 'd'.repeat(64));
  const assertRegistryUnchanged = async () => {
    await expect(readFile(registryPath)).resolves.toEqual(registryBytes);
  };
  const smokeConfiguration: packagedSmoke.PackagedSmokeConfiguration = options.selectorSmoke
    ? { enabled: true, phase: packagedSmoke.packagedSelectorVerificationPhase,
        root: fixtureRoot, userDataPath: root }
    : { enabled: options.smoke === true, phase: 'initial',
        root: options.smoke ? root : undefined, userDataPath: options.smoke ? root : undefined };
  return {
    root,
    smokeConfiguration,
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
    showOpenDialog,
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
      reportSmokeStage: StartDesktopCompositionOptions['reportSmokeStage'] = async () => undefined,
      observeStartupStage?: StartDesktopCompositionOptions['observeStartupStage']) => (options.startComposition ?? startDesktopComposition)({
      ...(observeStartupStage === undefined ? {} : { observeStartupStage }),
      ...(observeStartupException === undefined ? {} : { observeStartupException }),
      ...(options.observeWorkspaceStartupFailure === undefined ? {} : { observeWorkspaceStartupFailure: options.observeWorkspaceStartupFailure }),
      ...(options.recoveryStartup === undefined ? {} : { recoveryStartup: options.recoveryStartup }),
      ...(options.workspaceDeletionPublisher === undefined ? {} : { workspaceDeletionPublisher: options.workspaceDeletionPublisher }),
      ...(options.workspaceDeletionCommand === undefined ? {} : { workspaceDeletionCommand: options.workspaceDeletionCommand }),
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
        ...(options.selectWorkspaceRecoveryChoice === undefined ? {} : {
          selectWorkspaceRecoveryChoice: options.selectWorkspaceRecoveryChoice,
        }),
        ...(options.createWorkspaceManagementCapability === undefined ? {} : {
          createWorkspaceManagementCapability: options.createWorkspaceManagementCapability,
        }),
        ...(options.resolveActiveWorkspace === undefined ? {} : { resolveActiveWorkspace: options.resolveActiveWorkspace }),
        createRuntimeSession,
        showErrorBox,
        showOpenDialog,
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
          let stopping = false;
          const reclaimAfterExit = () => reclaim ??= input.reservationTransfer.reclaimAfterExit(signal);
          const stopOwnedBackend = async () => {
            stopping = true;
            const outcome = await stop();
            await reclaimAfterExit();
            return outcome;
          };
          const stopOwnedBackendForUpdate = async () => {
            stopping = true;
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
          const handle: DesktopBackendHandle = {
            port: 12345, stop: stopOwnedBackend, onUnexpectedExit: vi.fn(),
            assertRunning() {
              if (stopping) throw new Error('BACKEND_PROCESS_RESERVATION_FAILED');
            },
            stopForUpdate: stopOwnedBackendForUpdate,
            stopForRestore: async () => { throw new Error('RESTORE_FENCE_NOT_CONFIGURED_IN_FIXTURE'); },
            stopForDelete: async operationId => {
              if (options.stopForDelete === undefined) throw new Error('DELETE_FENCE_NOT_CONFIGURED_IN_FIXTURE');
              stopping = true;
              await options.stopForDelete(operationId);
              await reclaimAfterExit();
            },
          };
          options.observeControlledBackend?.(handle);
          return handle;
        },
      },
      quitApplication: quit,
      relaunchApplication: relaunch,
      resourcesPath: join(root, 'resources'),
      runtimeInstanceId: '33333333-3333-4333-8333-333333333333',
      reportSmokeStage,
      smokeConfiguration,
      userDataPath: root,
    }),
  };
}

describe('actual recovery observation main composition', () => {
  function startupFixture() {
    const startup = createDesktopRecoveryStartup<DesktopLifecycleHandle>();
    const registerObservation = vi.fn((owner: Parameters<typeof startup.port.registerObservation>[0]) =>
      startup.port.registerObservation(owner));
    return { startup, registerObservation, port: { registerObservation, isClosing: startup.port.isClosing } };
  }

  it.for(['legacyActive', 'active', 'selector'] as const)('closes the real observation before ordinary %s startup continues', async (mode, context) => {
    const lifetime = beginTrackedStartupTest(context), entry = startupFixture();
    await lifetime.run(async () => {
      electronBoundary.fetch.mockImplementation(async input => String(input).endsWith('/customers')
        ? new Response(null, { status: 401 }) : new Response(JSON.stringify({ status: 'ok' })));
      const f = await lifetime.step('fixturePreparation', () => createFixture(originalProfileId, {
        ownedRoots: lifetime.roots, update: true, skipRestore: true, completeStartup: true, recoveryStartup: entry.port,
      }));
      if (mode !== 'legacyActive') await f.registry.write({ ...(await f.registry.read())!, formatVersion: 2,
        activeWorkspaceId: mode === 'selector' ? null : workspaceId });
      const registryBefore = await readFile(join(f.root, WORKSPACE_REGISTRY_FILE_NAME));
      const databaseBefore = await readFile(f.databasePath), pdfBefore = await readFile(f.pdfPath);
      const read = recoverySources.readDesktopWorkspaceRecoveryTarget;
      const reading = vi.spyOn(recoverySources, 'readDesktopWorkspaceRecoveryTarget').mockImplementation(async input => {
        expect(entry.registerObservation).toHaveBeenCalledOnce();
        expect(f.createRuntimeSession).not.toHaveBeenCalled(); expect(electronBoundary.fork).not.toHaveBeenCalled();
        expect(f.events).toEqual([]);
        return read(input);
      });
      const failures: unknown[] = [];
      const outcome = await lifetime.step('startup', () => entry.startup.start(() => f.start(cause => { failures.push(cause); })));
      if (outcome.status !== 'fulfilled') throw failures[0] ?? outcome.reason;
      try {
        expect(reading).toHaveBeenCalledTimes(2); expect(entry.registerObservation).toHaveBeenCalledOnce();
        await expect(entry.registerObservation.mock.calls[0]![0].waitForSettlement()).resolves.toBeUndefined();
        if (mode === 'selector') expect(electronBoundary.loadWindow).toHaveBeenCalledExactlyOnceWith(f.mainWindow, 'selector');
        else expect(electronBoundary.loadWindow).toHaveBeenCalledExactlyOnceWith(f.mainWindow);
        expect(f.events).toEqual(mode === 'selector' ? [] : ['backendStarted']);
        expect(f.showMessageBox).not.toHaveBeenCalled();
        expect(await readFile(join(f.root, WORKSPACE_REGISTRY_FILE_NAME))).toEqual(registryBefore);
        expect(await readFile(f.databasePath)).toEqual(databaseBefore); expect(await readFile(f.pdfPath)).toEqual(pdfBefore);
      } finally { await outcome.lifecycle?.shutdown(); }
    });
  });

  it('joins the real pending source read before quit can release the installation reservation', async context => {
    const lifetime = beginTrackedStartupTest(context), entry = startupFixture();
    await lifetime.run(async () => {
      const f = await lifetime.step('fixturePreparation', () => createFixture(originalProfileId, {
        ownedRoots: lifetime.roots, update: true, skipRestore: true, completeStartup: true, recoveryStartup: entry.port,
      }));
      const registryBefore = await readFile(join(f.root, WORKSPACE_REGISTRY_FILE_NAME));
      const entered = createCompletionGate(), held = createCompletionGate();
      const release = () => { entered.resolve(); held.resolve(); };
      context.signal.addEventListener('abort', release, { once: true });
      const read = recoverySources.readDesktopWorkspaceRecoveryTarget;
      let returned = false;
      vi.spyOn(recoverySources, 'readDesktopWorkspaceRecoveryTarget').mockImplementationOnce(async input => {
        expect(entry.registerObservation).toHaveBeenCalledOnce();
        const result = await read(input); entered.resolve(); await held.promise; returned = true; return result;
      });
      const observed = vi.fn();
      const started = lifetime.step('startup', () => entry.startup.start(() => f.start(observed)));
      let closing: Promise<void> | undefined;
      try {
        expect(await Promise.race([entered.promise.then(() => 'held'), started.then(() => 'settled')])).toBe('held');
        closing = entry.startup.shutdown(); void closing.catch(() => undefined);
        await nextEventLoopTurn();
        expect(returned).toBe(false); expect(electronBoundary.reservationReleased).not.toHaveBeenCalled();
        expect(electronBoundary.createWindow).not.toHaveBeenCalled(); expect(f.events).toEqual([]);
        held.resolve();
        const outcome = await started; expect(outcome).toMatchObject({ status: 'rejected', cleanupError: undefined });
        await closing;
        expect(returned).toBe(true); expect(electronBoundary.reservationReleased).toHaveBeenCalledOnce();
        expect(electronBoundary.createWindow).not.toHaveBeenCalled(); expect(f.createRuntimeSession).not.toHaveBeenCalled();
        expect(observed).toHaveBeenCalledOnce(); expect(f.relaunch).not.toHaveBeenCalled();
        expect(await readFile(join(f.root, WORKSPACE_REGISTRY_FILE_NAME))).toEqual(registryBefore);
      } finally {
        release(); context.signal.removeEventListener('abort', release);
        await started; await closing;
      }
    });
  });

  it.for(['active', 'selector', 'relaunch', 'backendPreparation'] as const)('does not admit new %s work after observation has drained and quit begins', async (mode, context) => {
    const lifetime = beginTrackedStartupTest(context), entry = startupFixture();
    await lifetime.run(async () => {
      const entered = createCompletionGate(), held = createCompletionGate();
      const release = () => { entered.resolve(); held.resolve(); };
      context.signal.addEventListener('abort', release, { once: true });
      const resolve: NonNullable<StartDesktopCompositionOptions['dependencies']>['resolveActiveWorkspace'] = async (root, options) => {
        const selection = await resolveActiveWorkspaceStartup(root, options);
        if (mode !== 'backendPreparation') {
          await entry.registerObservation.mock.calls[0]![0].waitForSettlement();
          entered.resolve(); await held.promise;
          if (mode === 'relaunch') throw new ActiveWorkspaceStartupRelaunchRequiredError();
        }
        return selection;
      };
      const f = await lifetime.step('fixturePreparation', () => createFixture(originalProfileId, {
        ownedRoots: lifetime.roots, update: true, skipRestore: true, completeStartup: true,
        recoveryStartup: entry.port, resolveActiveWorkspace: resolve,
      }));
      if (mode === 'selector') await f.registry.write({ ...(await f.registry.read())!, formatVersion: 2, activeWorkspaceId: null });
      const registryBefore = await readFile(join(f.root, WORKSPACE_REGISTRY_FILE_NAME));
      const databaseBefore = await readFile(f.databasePath), pdfBefore = await readFile(f.pdfPath);
      const observed = vi.fn();
      const started = lifetime.step('startup', () => entry.startup.start(() => f.start(observed, async stage => {
        if (mode === 'backendPreparation' && stage === 'backend') {
          await entry.registerObservation.mock.calls[0]![0].waitForSettlement();
          entered.resolve(); await held.promise;
        }
      })));
      let closing: Promise<void> | undefined;
      try {
        expect(await Promise.race([entered.promise.then(() => 'held'), started.then(() => 'settled')])).toBe('held');
        closing = entry.startup.shutdown(); void closing.catch(() => undefined);
        await nextEventLoopTurn();
        expect(electronBoundary.reservationReleased).not.toHaveBeenCalled();
        held.resolve();
        const outcome = await started;
        try {
          expect(outcome).toMatchObject({ status: 'rejected', cleanupError: undefined });
          await closing;
          expect(f.events).toEqual([]); expect(electronBoundary.fork).not.toHaveBeenCalled();
          expect(electronBoundary.createWindow).not.toHaveBeenCalled(); expect(f.relaunch).not.toHaveBeenCalled();
          expect(f.createRuntimeSession).toHaveBeenCalledTimes(mode === 'backendPreparation' ? 1 : 0);
          expect(electronBoundary.reservationReleased).toHaveBeenCalledOnce(); expect(observed).toHaveBeenCalled();
          expect(await readFile(join(f.root, WORKSPACE_REGISTRY_FILE_NAME))).toEqual(registryBefore);
          expect(await readFile(f.databasePath)).toEqual(databaseBefore); expect(await readFile(f.pdfPath)).toEqual(pdfBefore);
        } finally { if (outcome.status === 'fulfilled') await outcome.lifecycle?.shutdown(); }
      } finally {
        release(); context.signal.removeEventListener('abort', release);
        await started; await closing;
      }
    });
  });

  it.for(['runtimeRecovery', 'firstStartRecovery'] as const)('blocks recovery relaunch after quit in %s while allowing cleanup to finish', async (mode, context) => {
    const lifetime = beginTrackedStartupTest(context), entry = startupFixture();
    await lifetime.run(async () => {
      const entered = createCompletionGate(), held = createCompletionGate();
      const release = () => { entered.resolve(); held.resolve(); };
      context.signal.addEventListener('abort', release, { once: true });
      const recover = vi.fn(async () => 'relaunchRequired' as const);
      const first = new WorkspaceFirstStartMigrationOrchestratorError('rollbackRequired');
      const resolve: NonNullable<StartDesktopCompositionOptions['dependencies']>['resolveActiveWorkspace'] = async (root, options) => {
        const selection = await resolveActiveWorkspaceStartup(root, options);
        return mode === 'runtimeRecovery' ? { ...selection, recoverFromFailure: recover } : selection;
      };
      if (mode === 'firstStartRecovery') {
        const prepare = WorkspaceFirstStartMigrationOrchestrator.prototype.prepareBeforeBackend;
        vi.spyOn(WorkspaceFirstStartMigrationOrchestrator.prototype, 'prepareBeforeBackend')
          .mockImplementationOnce(async function (this: WorkspaceFirstStartMigrationOrchestrator, input) {
            await prepare.call(this, input);
            entered.resolve(); await held.promise;
            throw first;
          });
      }
      const f = await lifetime.step('fixturePreparation', () => createFixture(originalProfileId, {
        ownedRoots: lifetime.roots, update: true, skipRestore: true, completeStartup: true,
        recoveryStartup: entry.port, resolveActiveWorkspace: resolve,
      }));
      const registryBefore = await readFile(join(f.root, WORKSPACE_REGISTRY_FILE_NAME));
      const databaseBefore = await readFile(f.databasePath), pdfBefore = await readFile(f.pdfPath);
      const observed = vi.fn();
      const started = lifetime.step('startup', () => entry.startup.start(() => f.start(observed, async stage => {
        if (mode === 'runtimeRecovery' && stage === 'backend') { entered.resolve(); await held.promise; }
      })));
      let closing: Promise<void> | undefined;
      try {
        const reached = await Promise.race([entered.promise.then(() => 'held'), started.then(() => 'settled')]);
        if (reached === 'settled') throw observed.mock.calls[0]?.[0] ?? new Error('SYNTHETIC_RECOVERY_RELAUNCH_BOUNDARY_NOT_REACHED');
        closing = entry.startup.shutdown(); void closing.catch(() => undefined);
        await nextEventLoopTurn();
        expect(electronBoundary.reservationReleased).not.toHaveBeenCalled();
        held.resolve();
        await expect(started).resolves.toEqual({ status: 'fulfilled', lifecycle: undefined });
        await closing;
        expect(recover).toHaveBeenCalledTimes(mode === 'runtimeRecovery' ? 1 : 0);
        if (mode === 'firstStartRecovery') expect(observed).toHaveBeenCalledWith(first, 'compositionStartup', [expect.any(String)]);
        else expect(observed).toHaveBeenCalledWith(expect.objectContaining({ message: 'WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED' }),
          'runtimeStartup', [expect.any(String)]);
        expect(f.relaunch).not.toHaveBeenCalled(); expect(f.events).toEqual([]);
        expect(electronBoundary.fork).not.toHaveBeenCalled(); expect(electronBoundary.createWindow).not.toHaveBeenCalled();
        expect(electronBoundary.loadWindow).not.toHaveBeenCalled();
        expect((await readRestoreDiagnosticEvents(f.root)).some(event => event.eventName === 'desktop.started')).toBe(false);
        expect(electronBoundary.reservationReleased).toHaveBeenCalledOnce();
        expect(await readFile(join(f.root, WORKSPACE_REGISTRY_FILE_NAME))).toEqual(registryBefore);
        expect(await readFile(f.databasePath)).toEqual(databaseBefore); expect(await readFile(f.pdfPath)).toEqual(pdfBefore);
      } finally {
        release(); context.signal.removeEventListener('abort', release);
        await started; await closing;
      }
    });
  });

  it.for(['beforeRecovery', 'duringRecovery'] as const)('stops forward startup %s without revoking an admitted import cleanup', async (mode, context) => {
    const lifetime = beginTrackedStartupTest(context), entry = startupFixture();
    await lifetime.run(async () => {
      const f = await lifetime.step('fixturePreparation', () => createFixture(originalProfileId, {
        ownedRoots: lifetime.roots, update: true, skipRestore: true, completeStartup: true, recoveryStartup: entry.port,
      }));
      await f.registry.write({ ...(await f.registry.read())!, formatVersion: 2 });
      const pending = await prepareColdJournal(f.root, 'import');
      const journalBefore = await readFile(pending.paths.currentPath), candidateBefore = await readFile(pending.candidateFile);
      const registryBefore = await readFile(join(f.root, WORKSPACE_REGISTRY_FILE_NAME));
      const forwardRecovery = vi.spyOn(WorkspaceFirstStartMigrationOrchestrator.prototype, 'recoverBeforeWorkspaceResolution');
      installCompletedColdCandidate();
      let closing: Promise<void> | undefined;
      const requestClose = () => {
        closing = entry.startup.shutdown(); void closing.catch(() => undefined);
      };
      if (mode === 'beforeRecovery') {
        const create = recoverySelection.createDesktopWorkspaceRecoverySelection;
        vi.spyOn(recoverySelection, 'createDesktopWorkspaceRecoverySelection').mockImplementation(input => {
          const owner = create(input);
          return Object.freeze({ ...owner, async waitForSettlement() {
            await owner.waitForSettlement(); if (closing === undefined) requestClose();
          } });
        });
      } else {
        const clear = WorkspaceBackupImportJournalStore.prototype.discardBeforePublicationSelected;
        vi.spyOn(WorkspaceBackupImportJournalStore.prototype, 'discardBeforePublicationSelected').mockImplementation(async function (this: WorkspaceBackupImportJournalStore, ...args) {
          requestClose(); await clear.apply(this, args);
        });
      }
      const outcome = await lifetime.step('startup', () => entry.startup.start(() => f.start()));
      try {
        expect(outcome).toMatchObject({ status: 'rejected', cleanupError: undefined });
        await closing;
        expect(forwardRecovery).not.toHaveBeenCalled();
        if (mode === 'beforeRecovery') {
          expect(await readFile(pending.paths.currentPath)).toEqual(journalBefore);
          expect(await readFile(pending.candidateFile)).toEqual(candidateBefore);
        } else {
          await expect(pending.journal.read()).resolves.toBeUndefined();
          await expect(readFile(pending.candidateFile)).rejects.toMatchObject({ code: 'ENOENT' });
        }
        expect(await readFile(join(f.root, WORKSPACE_REGISTRY_FILE_NAME))).toEqual(registryBefore);
        expect(f.events).toEqual([]); expect(f.createRuntimeSession).not.toHaveBeenCalled();
        expect(electronBoundary.createWindow).not.toHaveBeenCalled(); expect(f.relaunch).not.toHaveBeenCalled();
        expect(electronBoundary.reservationReleased).toHaveBeenCalledOnce();
      } finally { if (outcome.status === 'fulfilled') await outcome.lifecycle?.shutdown(); await closing; }
    });
  });

  it.for(['source', 'registration', 'sourceAndCleanup'] as const)('preserves the original %s failure before the safe startup conversion', async (failure, context) => {
    const lifetime = beginTrackedStartupTest(context), entry = startupFixture();
    await lifetime.run(async () => {
      const f = await lifetime.step('fixturePreparation', () => createFixture(originalProfileId, {
        ownedRoots: lifetime.roots, update: true, skipRestore: true, completeStartup: true, recoveryStartup: entry.port,
      }));
      const registryBefore = await readFile(join(f.root, WORKSPACE_REGISTRY_FILE_NAME));
      const first = new Error('SYNTHETIC_RECOVERY_OBSERVATION_FAILED', { cause: new Error('SYNTHETIC_RECOVERY_SOURCE_CAUSE') });
      const cleanup = new Error('SYNTHETIC_RECOVERY_OBSERVATION_CLOSE_FAILED');
      const reading = vi.spyOn(recoverySources, 'readDesktopWorkspaceRecoveryTarget');
      if (failure === 'registration') entry.registerObservation.mockImplementationOnce(() => { throw first; });
      else reading.mockRejectedValueOnce(first);
      if (failure === 'sourceAndCleanup') {
        const create = recoverySelection.createDesktopWorkspaceRecoverySelection;
        vi.spyOn(recoverySelection, 'createDesktopWorkspaceRecoverySelection').mockImplementation(input => {
          const owner = create(input);
          return Object.freeze({ ...owner, async waitForSettlement() { await owner.waitForSettlement(); throw cleanup; } });
        });
      }
      const observed = vi.fn();
      context.onTestFailed(async () => {
        const original = observed.mock.calls[0]?.[0];
        if (original === undefined) return;
        try {
          const { createRunnerFailureSink } = await import('../../../../test-reporters/runnerFailureEvidence.mjs');
          const sink = createRunnerFailureSink(), task = context.task;
          const retryCount = task.result?.retryCount ?? 0, repeatCount = task.result?.repeatCount ?? 0;
          sink.record({ runner: 'vitest', phase: 'compositionStartup', error: original,
            testName: task.fullTestName, testId: task.id, file: task.file.filepath,
            ...(task.location === undefined ? {} : { line: task.location.line, column: task.location.column }),
            ...(retryCount === 0 && repeatCount === 0 ? { attempt: 0 } : {}), retryCount, repeatCount });
          await sink.flush();
        } catch { /* Private evidence cannot replace the test failure. */ }
      });
      const outcome = await lifetime.step('startup', () => entry.startup.start(() => f.start(observed)));
      expect(outcome.status).toBe('rejected');
      if (outcome.status !== 'rejected') throw new Error('SYNTHETIC_RECOVERY_SOURCE_ERROR_ACCEPTED');
      expect(observed).toHaveBeenCalledOnce();
      const original = observed.mock.calls[0]![0];
      if (failure === 'sourceAndCleanup') {
        expect(original).toMatchObject({ cause: first, errors: [first, cleanup] });
        expect(outcome.cleanupError).toMatchObject({ errors: [cleanup] });
        expect(electronBoundary.reservationReleased).not.toHaveBeenCalled();
      } else {
        expect(observed).toHaveBeenCalledExactlyOnceWith(first, 'compositionStartup', []);
        expect(outcome.cleanupError).toBeUndefined(); expect(electronBoundary.reservationReleased).toHaveBeenCalledOnce();
      }
      if (failure === 'registration') expect(reading).not.toHaveBeenCalled();
      expect(electronBoundary.createWindow).not.toHaveBeenCalled(); expect(electronBoundary.fork).not.toHaveBeenCalled();
      expect(f.createRuntimeSession).not.toHaveBeenCalled(); expect(f.events).toEqual([]); expect(f.relaunch).not.toHaveBeenCalled();
      expect(outcome.reason).toBeInstanceOf(Error);
      expect(outcome.reason).not.toMatchObject({ message: expect.stringContaining('SYNTHETIC') });
      expect(await readFile(join(f.root, WORKSPACE_REGISTRY_FILE_NAME))).toEqual(registryBefore);
    });
  });

  it('hands an unbound historical import back to its existing recovery owner once', async context => {
    const lifetime = beginTrackedStartupTest(context), entry = startupFixture();
    await lifetime.run(async () => {
      electronBoundary.fetch.mockImplementation(async input => String(input).endsWith('/customers')
        ? new Response(null, { status: 401 }) : new Response(JSON.stringify({ status: 'ok' })));
      const f = await lifetime.step('fixturePreparation', () => createFixture(originalProfileId, {
        ownedRoots: lifetime.roots, update: true, skipRestore: true, completeStartup: true, recoveryStartup: entry.port,
      }));
      await f.registry.write({ ...(await f.registry.read())!, formatVersion: 2 });
      const pending = await prepareColdJournal(f.root, 'import');
      const registryBefore = await readFile(join(f.root, WORKSPACE_REGISTRY_FILE_NAME));
      const databaseBefore = await readFile(f.databasePath), pdfBefore = await readFile(f.pdfPath);
      const operations = installCompletedColdCandidate();
      const failures: unknown[] = [];
      const outcome = await lifetime.step('startup', () => entry.startup.start(() => f.start(cause => { failures.push(cause); })));
      if (outcome.status !== 'fulfilled') throw failures[0] ?? outcome.reason;
      try {
        expect(entry.registerObservation).toHaveBeenCalledOnce();
        await expect(entry.registerObservation.mock.calls[0]![0].waitForSettlement()).resolves.toBeUndefined();
        await expect(pending.journal.read()).resolves.toBeUndefined();
        await expect(readFile(pending.candidateFile)).rejects.toMatchObject({ code: 'ENOENT' });
        expect(operations).toEqual([]); expect(f.events).toEqual(['backendStarted']);
        expect(await readFile(join(f.root, WORKSPACE_REGISTRY_FILE_NAME))).toEqual(registryBefore);
        expect(await readFile(f.databasePath)).toEqual(databaseBefore); expect(await readFile(f.pdfPath)).toEqual(pdfBefore);
      } finally { await outcome.lifecycle?.shutdown(); }
    });
  });
});

describe('recovery startup presentation main coupling', () => {
  it.for(['active', 'selector'] as const)('returns a drainable %s lifecycle without late loading or success after startup closure', async (mode, context) => {
    const lifetime = beginTrackedStartupTest(context);
    let closing = false;
    const recoveryStartup = { isClosing: () => closing, registerObservation: vi.fn() };
    await lifetime.run(async () => {
      electronBoundary.fetch.mockImplementation(async input => String(input).endsWith('/customers')
        ? new Response(null, { status: 401 }) : new Response(JSON.stringify({ status: 'ok' })));
      const f = await lifetime.step('fixturePreparation', () => createFixture(originalProfileId, {
        ownedRoots: lifetime.roots, update: true, skipRestore: true, completeStartup: true, recoveryStartup,
      }));
      if (mode === 'selector') await f.registry.write({ ...(await f.registry.read())!, formatVersion: 2, activeWorkspaceId: null });
      const registryBefore = await readFile(join(f.root, WORKSPACE_REGISTRY_FILE_NAME));
      electronBoundary.createWindow.mockImplementationOnce(() => { closing = true; return f.mainWindow as unknown as BrowserWindow; });
      const lifecycle = await lifetime.step('startup', () => f.start());
      const releaseCount = () => electronBoundary.reservationReleased.mock.calls.filter(([root]) => root === f.root).length;
      let releasesBeforeShutdown = 0;
      try {
        expect(lifecycle).toBeDefined();
        expect(electronBoundary.loadWindow).not.toHaveBeenCalled();
        const canShow = electronBoundary.createWindow.mock.calls[0]?.[3];
        expect(canShow).toBeTypeOf('function'); expect(canShow()).toBe(false);
        expect((await readRestoreDiagnosticEvents(f.root)).some(event => event.eventName === 'desktop.started')).toBe(false);
        expect(f.showErrorBox).not.toHaveBeenCalled(); expect(f.relaunch).not.toHaveBeenCalled();
        expect(recoveryStartup.registerObservation).toHaveBeenCalledOnce();
        await expect(recoveryStartup.registerObservation.mock.calls[0]![0].waitForSettlement()).resolves.toBeUndefined();
        expect(f.events).toEqual(mode === 'active' ? ['backendStarted'] : []);
        expect(await readFile(join(f.root, WORKSPACE_REGISTRY_FILE_NAME))).toEqual(registryBefore);
      } finally { releasesBeforeShutdown = releaseCount(); await lifecycle?.shutdown(); }
      expect(releaseCount()).toBe(releasesBeforeShutdown + 1);
    });
  });
});

describe('restore startup fixture preparation', () => {
  it('publishes the final replacement registry once and preserves both switch transitions', async context => {
    const lifetime = beginTrackedStartupTest(context);
    await lifetime.run(async () => {
      const publication = vi.spyOn(WorkspaceRegistryStore.prototype, 'write');
      const transitions: unknown[] = [];
      const writeSwitch = WorkspaceSwitchJournalStore.prototype.write;
      const switchWrites = vi.spyOn(WorkspaceSwitchJournalStore.prototype, 'write').mockImplementation(async function (
        this: WorkspaceSwitchJournalStore, value,
      ) {
        const before = await this.read();
        await writeSwitch.call(this, value);
        transitions.push({ before, after: await this.read() });
      });
      const fixture = await lifetime.step('fixturePreparation', () => createFixture(originalProfileId, {
        replacementTarget: true, skipRestore: true, ownedRoots: lifetime.roots,
      }));
      await lifetime.step('restoredContentCheck', async () => {
        const sourceId = validateWorkspaceId('44444444-4444-4444-8444-444444444444');
        const target = {
          workspaceId,
          workspaceLabel: 'Synthetic restore test',
          lineageIdentity: { formatVersion: 1, profileId: originalProfileId },
          layoutVersion: 1,
          lifecycleState: 'ready',
          createdAt: '2026-08-18T10:00:00.000Z',
        };
        const expectedRegistry = {
          formatVersion: 1,
          activeWorkspaceId: workspaceId,
          workspaces: [target, {
            ...target,
            workspaceId: sourceId,
            workspaceLabel: 'Synthetic previous workspace',
            lineageIdentity: { formatVersion: 1, profileId: foreignProfileId },
          }],
        };
        const expectedBytes = Buffer.from(`${JSON.stringify(expectedRegistry)}\n`);
        expect(publication).toHaveBeenCalledExactlyOnceWith(expectedRegistry);
        const registrySlots = await fixture.registry.inspectSlots();
        expect(registrySlots.current?.value).toEqual(expectedRegistry);
        expect(Buffer.from(registrySlots.current!.bytes).equals(expectedBytes)).toBe(true);
        expect(registrySlots.backup).toBeUndefined();
        expect(registrySlots.next).toBeUndefined();
        expect((await readFile(join(fixture.root, WORKSPACE_REGISTRY_FILE_NAME))).equals(expectedBytes)).toBe(true);
        const prepared = {
          formatVersion: 1, operationId, sourceWorkspaceId: sourceId, targetWorkspaceId: workspaceId,
          state: 'prepared', createdAt: '2026-08-18T10:00:00.000Z',
        };
        const selected = { ...prepared, state: 'targetSelected' };
        expect(switchWrites).toHaveBeenCalledTimes(2);
        expect(switchWrites).toHaveBeenNthCalledWith(1, prepared);
        expect(switchWrites).toHaveBeenNthCalledWith(2, selected);
        expect(publication.mock.invocationCallOrder[0]).toBeLessThan(switchWrites.mock.invocationCallOrder[0]!);
        expect(transitions).toEqual([
          { before: undefined, after: prepared },
          { before: prepared, after: selected },
        ]);
        const switchSlots = await new WorkspaceSwitchJournalStore(fixture.root).inspectSlots();
        expect(switchSlots.current?.value).toEqual(selected);
        expect(Buffer.from(switchSlots.current!.bytes).equals(Buffer.from(serializeVersionedWorkspaceSwitchJournal(selected)))).toBe(true);
        expect(switchSlots.backup).toBeUndefined();
        expect(switchSlots.next).toBeUndefined();
        expect(fixture.events).toEqual([]);
        expect(electronBoundary.fork).not.toHaveBeenCalled();
        expect(electronBoundary.reservationAcquired).not.toHaveBeenCalled();
        expect(electronBoundary.createWindow).not.toHaveBeenCalled();
      });
    });
  });
});

describe('packaged empty-selector verification main coupling', () => {
  async function prepare(context: TestContext, options: Parameters<typeof createFixture>[1] = {}) {
    const descriptor = Object.getOwnPropertyDescriptor(process, 'versions');
    if (descriptor === undefined) throw new Error('SYNTHETIC_PROCESS_VERSIONS_DESCRIPTOR_MISSING');
    if (descriptor.get !== undefined) vi.spyOn(process, 'versions', 'get').mockReturnValue({ ...process.versions, electron: '43.8.1' });
    else {
      Object.defineProperty(process, 'versions', { ...descriptor, value: { ...process.versions, electron: '43.8.1' } });
      context.onTestFinished(() => { Object.defineProperty(process, 'versions', descriptor); });
    }
    const lifetime = beginTrackedStartupTest(context);
    const fixture = await lifetime.prepare(() => createFixture(originalProfileId, {
      ...options, ownedRoots: lifetime.roots, update: true, skipRestore: true, completeStartup: true, selectorSmoke: true,
    }));
    const registry = (await fixture.registry.read())!;
    const emptyRegistry = { ...registry, formatVersion: 2 as const, activeWorkspaceId: null, workspaces: [] };
    await fixture.registry.write(emptyRegistry);
    const reporter = packagedSmoke.createPackagedSmokeProgressReporter(fixture.smokeConfiguration);
    await reporter.reportStage('startup');
    // Only the renderer transport is controlled; the real capability writes the archive.
    const execute = vi.fn(async (script: string, gesture: boolean) => {
      expect([script, gesture]).toEqual(['window.ekyDesktop.createSupportBundle()', true]);
      const handler = electronBoundary.ipcHandlers.get(createSupportBundleIpcChannel);
      if (typeof handler !== 'function') throw new Error('SUPPORT_CAPABILITY_NOT_REGISTERED');
      const result = await handler({ sender: fixture.mainWindow.webContents, senderFrame: fixture.mainWindow.webContents.mainFrame });
      if (result === 'created') {
        const inspector = await import(new URL('../../scripts/inspect-support-bundle.mjs', import.meta.url).href);
        const target = packagedSmoke.resolvePackagedSmokeSupportBundlePath(fixture.smokeConfiguration)!;
        expect(inspector.inspectSupportBundle(target).summary).toMatchObject({ formatVersion: 3,
          kind: 'desktopOnly', observationStatus: 'unavailable', backend: 'exitUnconfirmed' });
      }
      return result;
    });
    Object.assign(fixture.mainWindow.webContents, { executeJavaScript: execute });
    const smoke = vi.spyOn(packagedSmoke, 'runPackagedSelectorSmoke');
    const resultPath = join(fixture.smokeConfiguration.root!, 'result', 'desktop-smoke-result.json');
    const readResult = async () => packagedSmoke.readPackagedSmokeResult(JSON.parse(await readFile(resultPath, 'utf8')));
    return { lifetime, fixture, registry, emptyRegistry, reporter, smoke, resultPath, readResult, execute };
  }

  it('loads the actual empty selector, closes its owner and writes the result before quit', async context => {
    const f = await prepare(context);
    await f.lifetime.run(async () => {
      const bytes = await readFile(join(f.fixture.root, WORKSPACE_REGISTRY_FILE_NAME));
      f.fixture.quit.mockImplementation(() => {
        expect(packagedSmoke.readPackagedSmokeResult(JSON.parse(readFileSync(f.resultPath, 'utf8'))))
          .toEqual({ stage: 'shutdown', status: 'ok', electronVersion: '43.8.1' });
        expect(electronBoundary.reservationReleased).toHaveBeenCalledExactlyOnceWith(f.fixture.root);
        expect(f.fixture.mainWindow.destroy).toHaveBeenCalledOnce();
      });
      const lifecycle = await f.lifetime.step('startup', () => f.fixture.start(undefined, f.reporter.reportStage));
      try {
        expect(f.smoke).toHaveBeenCalledOnce();
        expect(electronBoundary.loadWindow).toHaveBeenCalledExactlyOnceWith(f.fixture.mainWindow, 'selector');
        expect(await f.readResult()).toEqual({ stage: 'shutdown', status: 'ok', electronVersion: '43.8.1' });
        expect(f.execute).toHaveBeenCalledOnce();
        expect(f.fixture.showMessageBox).not.toHaveBeenCalled();
        expect(f.fixture.showSaveDialog).not.toHaveBeenCalled();
        await expect(stat(packagedSmoke.resolvePackagedSmokeSupportBundlePath(f.fixture.smokeConfiguration)!))
          .rejects.toMatchObject({ code: 'ENOENT' });
        expect(f.fixture.quit).toHaveBeenCalledOnce();
        expect(f.fixture.createRuntimeSession).not.toHaveBeenCalled();
        expect(f.fixture.events).toEqual([]);
        expect(electronBoundary.fork).not.toHaveBeenCalled();
        expect(await readFile(join(f.fixture.root, WORKSPACE_REGISTRY_FILE_NAME))).toEqual(bytes);
        expect(electronBoundary.ipcHandlers.has(deleteWorkspaceIpcChannel)).toBe(false);
      } finally { await lifecycle?.shutdown(); }
    });
  });

  it.for(['export', 'exportAndShutdown'] as const)(
    'preserves the original %s failure before safe projection without a blocking dialog', async (variant, context) => {
      const f = await prepare(context), original = new Error('SYNTHETIC_SELECTOR_SUPPORT_WRITE_FAILURE');
      const capture = createSupportBundleSmokeFailureCapture(context);
      let captured = false;
      const observe = vi.fn((error: unknown) => {
        if (!captured) { captured = true; capture(error); }
      });
      vi.spyOn(supportBundleFileStore, 'writeSupportBundleAtomically').mockImplementationOnce(() => { throw original; });
      if (variant === 'exportAndShutdown') electronBoundary.reservationReleased.mockRejectedValueOnce(
        new Error('SYNTHETIC_SELECTOR_SUPPORT_CLOSE_FAILURE'));
      await f.lifetime.run(async () => {
        const before = await readFile(join(f.fixture.root, WORKSPACE_REGISTRY_FILE_NAME));
        await expect(f.lifetime.step('startup', () => f.fixture.start(observe, f.reporter.reportStage)))
          .rejects.toThrow('DESKTOP_SMOKE_SUPPORT_BUNDLE_INVALID');
        expect(observe.mock.calls[0]?.[0]).toBe(original);
        expect(f.fixture.showErrorBox).not.toHaveBeenCalled();
        expect(f.fixture.showMessageBox).not.toHaveBeenCalled(); expect(f.fixture.showSaveDialog).not.toHaveBeenCalled();
        expect(f.fixture.quit).not.toHaveBeenCalled();
        expect(electronBoundary.reservationReleased).toHaveBeenCalledOnce();
        expect(f.fixture.createRuntimeSession).not.toHaveBeenCalled();
        expect(electronBoundary.fork).not.toHaveBeenCalled();
        expect(await f.readResult()).toEqual({ stage: 'supportBundle', status: 'started' });
        expect(await readFile(join(f.fixture.root, WORKSPACE_REGISTRY_FILE_NAME))).toEqual(before);
        await expect(stat(packagedSmoke.resolvePackagedSmokeSupportBundlePath(f.fixture.smokeConfiguration)!))
          .rejects.toMatchObject({ code: 'ENOENT' });
      });
    },
  );

  it.for(['active', 'nonemptySelector', 'missingRegistry', 'pendingRegistry', 'wrongProfile', 'otherProfile'] as const)(
    'rejects %s before business startup or selector success', async (scenario, context) => {
      const f = await prepare(context);
      await f.lifetime.run(async () => {
        const path = join(f.fixture.root, WORKSPACE_REGISTRY_FILE_NAME);
        if (scenario === 'active') await f.fixture.registry.write({ ...f.registry, formatVersion: 2 });
        if (scenario === 'nonemptySelector') await f.fixture.registry.write({ ...f.registry, formatVersion: 2, activeWorkspaceId: null });
        if (scenario === 'missingRegistry') await rm(path);
        if (scenario === 'pendingRegistry') await writeFile(`${path}.next`, await readFile(path));
        if (scenario === 'wrongProfile') f.fixture.smokeConfiguration.userDataPath = f.fixture.smokeConfiguration.root;
        if (scenario === 'otherProfile') {
          f.fixture.smokeConfiguration.root = join(f.fixture.root, 'other');
          f.fixture.smokeConfiguration.userDataPath = join(f.fixture.smokeConfiguration.root, 'user-data');
        }
        const observe = vi.fn();
        let lifecycle: Awaited<ReturnType<typeof f.fixture.start>>;
        try {
          await expect(f.lifetime.step('startup', async () => {
            lifecycle = await f.fixture.start(observe, f.reporter.reportStage);
          })).rejects.toThrow();
          expect(f.smoke).not.toHaveBeenCalled();
          expect(f.fixture.createRuntimeSession).not.toHaveBeenCalled();
          expect(f.fixture.events).toEqual([]);
          expect(electronBoundary.createWindow).not.toHaveBeenCalled();
          expect(f.fixture.quit).not.toHaveBeenCalled();
          expect(await f.readResult()).toEqual({ stage: 'startup', status: 'started' });
          expect(observe).toHaveBeenCalledOnce();
        } finally { await lifecycle?.shutdown(); }
      });
    });

  it.for(['load', 'shutdown', 'loadAndShutdown', 'loadAndUndefinedShutdown'] as const)(
    'retains the original %s failure without an ok result', async (failure, context) => {
    const f = await prepare(context);
    await f.lifetime.run(async () => {
      const first = new Error(`synthetic-selector-${failure}`);
      const cleanup = failure === 'loadAndUndefinedShutdown' ? undefined : new Error('synthetic-selector-release');
      if (failure !== 'shutdown') electronBoundary.loadWindow.mockRejectedValueOnce(first);
      if (failure === 'shutdown') electronBoundary.reservationReleased.mockRejectedValueOnce(first);
      if (failure === 'loadAndShutdown' || failure === 'loadAndUndefinedShutdown') {
        electronBoundary.reservationReleased.mockRejectedValueOnce(cleanup);
      }
      const observe = vi.fn();
      let lifecycle: Awaited<ReturnType<typeof f.fixture.start>>;
      try {
        await expect(f.lifetime.step('startup', async () => {
          lifecycle = await f.fixture.start(observe, f.reporter.reportStage);
        })).rejects.toThrow();
        expect(f.fixture.quit).not.toHaveBeenCalled();
        expect((await f.readResult())?.status).toBe('started');
        expect(f.fixture.createRuntimeSession).not.toHaveBeenCalled();
        expect(f.fixture.events).toEqual([]);
        const original = observe.mock.calls[0]?.[0];
        expect(original === first || original?.cause === first).toBe(true);
        if (failure === 'loadAndShutdown' || failure === 'loadAndUndefinedShutdown') {
          expect(original).toBeInstanceOf(AggregateError);
          expect(original.errors[0]).toBe(first);
          expect(original.errors[1].cause).toBe(cleanup);
          expect(original.errors).toHaveLength(2);
          expect(projectExceptionChain(original, []).chain.map(part => part.message)).toEqual([
            'WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED', first.message,
          ]);
          expect(packagedSmoke.readPackagedSmokeResult(JSON.parse(await readFile(f.resultPath, 'utf8')))?.status).toBe('started');
        }
        if (failure === 'shutdown') expect(f.fixture.mainWindow.destroy).not.toHaveBeenCalled();
      } finally { await lifecycle?.shutdown(); }
    });
    });

  it.for(['load', 'shutdown'] as const)('joins a held %s before success or quit', async (heldAt, context) => {
    const f = await prepare(context);
    await f.lifetime.run(async () => {
      const entered = createCompletionGate(), release = createCompletionGate();
      const hold = async () => { entered.resolve(); await release.promise; return undefined; };
      if (heldAt === 'load') electronBoundary.loadWindow.mockImplementationOnce(hold);
      else electronBoundary.reservationReleased.mockImplementationOnce(hold);
      let settled = false;
      const outcome = f.lifetime.step('startup', () => f.fixture.start(undefined, f.reporter.reportStage))
        .then(value => ({ value }), error => ({ error })).then(result => { settled = true; return result; });
      let failure: { error: unknown } | undefined;
      try {
        await Promise.race([entered.promise, outcome.then(() => { throw new Error('SELECTOR_TEST_GATE_NOT_REACHED'); })]);
        await nextEventLoopTurn();
        expect(settled).toBe(false);
        expect(f.fixture.quit).not.toHaveBeenCalled();
        expect(f.fixture.mainWindow.destroy).not.toHaveBeenCalled();
        expect((await f.readResult())?.status).toBe('started');
        if (heldAt === 'load') expect(f.smoke).not.toHaveBeenCalled();
      } catch (error) { failure = { error }; }
      finally { release.resolve(); }
      const result = await outcome;
      if ('error' in result) {
        if (failure !== undefined) throw new AggregateError([failure.error, result.error], 'SELECTOR_TEST_AND_JOIN_FAILED', { cause: failure.error });
        throw result.error;
      }
      await result.value?.shutdown();
      if (failure !== undefined) throw failure.error;
      expect(await f.readResult()).toEqual({ stage: 'shutdown', status: 'ok', electronVersion: '43.8.1' });
    });
  });

  it.for(['beforeSelection', 'duringLoad'] as const)('rejects an added company %s without creating a session', async (changedAt, context) => {
    let f: Awaited<ReturnType<typeof prepare>>;
    const change = async () => { await f.fixture.registry.write({ ...f.registry, formatVersion: 2 }); };
    f = await prepare(context, changedAt === 'beforeSelection' ? {
      async resolveActiveWorkspace(root, options) { await change(); return resolveActiveWorkspaceStartup(root, options); },
    } : {});
    await f.lifetime.run(async () => {
      if (changedAt === 'duringLoad') electronBoundary.loadWindow.mockImplementationOnce(async () => { await change(); return undefined; });
      await expect(f.lifetime.step('startup', () => f.fixture.start(undefined, f.reporter.reportStage))).rejects.toThrow();
      expect(f.fixture.createRuntimeSession).not.toHaveBeenCalled();
      expect(f.fixture.events).toEqual([]);
      expect(f.smoke).not.toHaveBeenCalled();
      expect(f.fixture.quit).not.toHaveBeenCalled();
      expect((await f.readResult())?.status).toBe('started');
    });
  });
});

describe('W7.4 main replacement binding', () => {
  it.for(['ownStop', 'lostAcknowledgement', 'shutdown', 'reservationLoss'] as const)(
    'keeps the real main replacement boundary across %s', async (scenario, context) => {
      const lifetime = beginTrackedStartupTest(context);
      await lifetime.run(async () => {
        let service: Parameters<typeof createWorkspaceManagementCapability>[0]['service'] | undefined;
        const f = await lifetime.step('fixturePreparation', () => createFixture(originalProfileId, {
          ownedRoots: lifetime.roots, update: true, skipRestore: true, completeStartup: true,
          createWorkspaceManagementCapability(options) {
            service = options.service;
            return createWorkspaceManagementCapability(options);
          },
        }));
        electronBoundary.fetch.mockImplementation(async (url: string) => url.endsWith('/customers')
          ? new Response(null, { status: 401 }) : new Response(JSON.stringify({ status: 'ok' })));
        vi.spyOn(RecoveryPointService.prototype, 'createPreRestore').mockResolvedValue({
          artifactId: operationId, byteSize: 1, createdAt: '2026-10-29T00:00:00.000Z', kind: 'preRestore',
          state: 'validatedGood', validatedAt: '2026-10-29T00:00:00.000Z',
        });
        vi.spyOn(WorkspaceBackupContainerAdapter.prototype, 'inspect').mockResolvedValue({ appVersion: '0.3.0',
          containerSha256: 'c'.repeat(64), migrationChainIdentity: 'd'.repeat(64), profileId: originalProfileId });
        const candidateFailure = new Error('SYNTHETIC_CANDIDATE_STAGE_FAILED');
        const acknowledgementFailure = new Error('SYNTHETIC_BINDING_ACK_LOST');
        const stage = vi.spyOn(WorkspaceBackupContainerAdapter.prototype, 'stage').mockRejectedValue(candidateFailure);
        const entered = createCompletionGate(); const finish = createCompletionGate();
        const publish = WorkspaceRemnantBindingStore.prototype.publish;
        const published = vi.spyOn(WorkspaceRemnantBindingStore.prototype, 'publish').mockImplementation(async function (
          this: WorkspaceRemnantBindingStore, value, authority,
        ) {
          const receipt = await publish.call(this, value, authority);
          entered.resolve();
          if (scenario !== 'ownStop') await finish.promise;
          if (scenario === 'lostAcknowledgement') throw acknowledgementFailure;
          return receipt;
        });
        let lifecycle: Awaited<ReturnType<typeof f.start>>;
        let request: Promise<unknown> | undefined;
        let closing: Promise<void> | undefined;
        let shutdownChecked = false;
        let firstFailure: { error: unknown } | undefined;
        try {
          lifecycle = await lifetime.step('startup', () => f.start());
          if (lifecycle === undefined || service === undefined) throw new Error('MANAGEMENT_NOT_CAPTURED');
          const registryBefore = await readFile(join(f.root, WORKSPACE_REGISTRY_FILE_NAME));
          electronBoundary.reservationReleased.mockClear();
          request = service.replaceActiveFromBackup({ targetWorkspaceId: workspaceId,
            containerPath: join(f.root, 'synthetic.ekybackup'), password: 'synthetic-only' }).catch(error => error as unknown);
          if (scenario !== 'ownStop') {
            const reached = await Promise.race([entered.promise.then(() => true), request]);
            if (reached !== true) throw reached;
            expect(f.stop).toHaveBeenCalledOnce();
            expect(electronBoundary.removeHandler).toHaveBeenCalled();
            if (scenario === 'shutdown') {
              closing = lifecycle.shutdown();
              void closing.catch(() => undefined);
              let settled = false;
              void closing.finally(() => { settled = true; }).catch(() => undefined);
              await nextEventLoopTurn();
              expect(settled).toBe(false);
              expect(electronBoundary.reservationReleased).not.toHaveBeenCalled();
            }
            if (scenario === 'reservationLoss') electronBoundary.loseReservation!();
            finish.resolve();
          }
          const result = await request;
          expect(result).toBeInstanceOf(Error);
          expect(published).toHaveBeenCalledOnce();
          const binding = captureWorkspaceRemnantBinding(published.mock.calls[0]![0]);
          const paths = createWorkspaceRemnantBindingPaths(f.root, workspaceRemnantBindingKey(binding));
          expect(JSON.parse(await readFile(paths.currentPath, 'utf8'))).toMatchObject({ workspaceId, owner: 'workspaceReplacement' });
          expect(await readFile(join(f.root, WORKSPACE_REGISTRY_FILE_NAME))).toEqual(registryBefore);
          expect(await readFile(f.databasePath, 'utf8')).toBe(f.originalBytes);
          if (scenario === 'ownStop') {
            expect(hasErrorCause(result, candidateFailure)).toBe(true);
            expect(stage).toHaveBeenCalledOnce();
            expect(f.relaunch).toHaveBeenCalledOnce();
            await lifecycle.shutdown();
          } else {
            if (scenario === 'lostAcknowledgement') expect(hasErrorCause(result, acknowledgementFailure)).toBe(true);
            expect(stage).not.toHaveBeenCalled();
            expect(f.relaunch).not.toHaveBeenCalled();
            await expect(service.rename(workspaceId, 'Later')).rejects.toThrow();
            await expect(closing ?? lifecycle.shutdown()).rejects.toMatchObject({
              message: 'WORKSPACE_PROCESS_RESERVATION_FAILED', reason: 'lost',
            });
            expect(electronBoundary.reservationReleased).not.toHaveBeenCalled();
          }
          shutdownChecked = true;
        } catch (error) {
          firstFailure = { error };
          throw error;
        } finally {
          finish.resolve();
          await request;
          if (!shutdownChecked) {
            try { await (closing ?? lifecycle?.shutdown()); }
            catch (cleanupFailure) {
              if (firstFailure !== undefined) throw new AggregateError([firstFailure.error, cleanupFailure],
                'SYNTHETIC_REPLACEMENT_AND_SHUTDOWN_FAILED', { cause: firstFailure.error });
              throw cleanupFailure;
            }
          }
        }
      });
    });
});

describe('W7.4 normal startup deletion guard', () => {
  it.for((['active', 'selector'] as const).flatMap(mode =>
    (['currentPath', 'backupPath', 'nextPath'] as const).map(slot => ({ mode, slot }))))(
    'blocks $mode startup at deletion $slot before backend or ordinary recovery', async ({ mode, slot }, context) => {
      const lifetime = beginTrackedStartupTest(context);
      await lifetime.run(async () => {
        const f = await lifetime.step('fixturePreparation', () => createFixture(originalProfileId, {
          ownedRoots: lifetime.roots, update: true, skipRestore: true, completeStartup: true,
        }));
        await f.registry.write({ ...(await f.registry.read())!, formatVersion: 2,
          activeWorkspaceId: mode === 'selector' ? null : workspaceId });
        const before = await readFile(join(f.root, WORKSPACE_REGISTRY_FILE_NAME));
        const deletion = createWorkspaceDeletionJournalPaths(f.root);
        await mkdir(deletion.directoryPath, { recursive: true, mode: 0o700 });
        await writeFile(deletion[slot], 'unparsed deletion evidence', { flag: 'wx', mode: 0o600 });
        const observed = vi.fn();
        let lifecycle: Awaited<ReturnType<typeof f.start>>;
        let firstFailure: { error: unknown } | undefined;
        try {
          await lifetime.step('startup', async () => {
            await expect((async () => { lifecycle = await f.start(observed); })())
              .rejects.toThrow('WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED');
          });
          expect(observed).toHaveBeenCalledExactlyOnceWith(
            expect.objectContaining({ message: 'WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED' }), 'compositionStartup', []);
          expect(f.events).toEqual([]); expect(f.createRuntimeSession).not.toHaveBeenCalled();
          expect(electronBoundary.fork).not.toHaveBeenCalled(); expect(electronBoundary.createWindow).not.toHaveBeenCalled();
          expect(electronBoundary.reservationReleased).toHaveBeenCalledExactlyOnceWith(f.root);
          expect(await readFile(join(f.root, WORKSPACE_REGISTRY_FILE_NAME))).toEqual(before);
          expect(await readFile(deletion[slot], 'utf8')).toBe('unparsed deletion evidence');
          if (slot !== 'currentPath') await expect(readFile(deletion.currentPath)).rejects.toMatchObject({ code: 'ENOENT' });
          expect(await readFile(f.databasePath, 'utf8')).toBe(f.originalBytes);
          expect(await readFile(f.pdfPath, 'utf8')).toBe('%PDF-1.7 original pdf');
        } catch (error) { firstFailure = { error }; throw error; }
        finally {
          try { await lifecycle?.shutdown(); }
          catch (cleanupFailure) {
            if (firstFailure !== undefined) throw new AggregateError([firstFailure.error, cleanupFailure],
              'SYNTHETIC_DELETION_ADMISSION_AND_SHUTDOWN_FAILED', { cause: firstFailure.error });
            throw cleanupFailure;
          }
        }
      });
    });
});

describe('W7.4 actual main deletion chain', () => {
  it.for(['active', 'selector', 'passive', 'cold'] as const)(
    'completes the actual published file chain under the %s main owner', { timeout: 60_000 }, async (mode, context) => {
      const lifetime = beginTrackedStartupTest(context);
      await lifetime.run(async () => {
        electronBoundary.useActualReservationIdentity = true;
        let service: WorkspaceManagementService | undefined;
        let publishedOperationId: string | undefined;
        let requesterCurrent = true;
        const stopForDelete = vi.fn(async () => undefined);
        const fixtureOptions: Parameters<typeof createFixture>[1] = {
          ownedRoots: lifetime.roots, update: true, skipRestore: true, completeStartup: true, stopForDelete,
          createWorkspaceManagementCapability(options) {
            service = options.service as WorkspaceManagementService;
            return createWorkspaceManagementCapability(options);
          },
        };
        const f = await lifetime.step('fixturePreparation', () => createFixture(originalProfileId, fixtureOptions));
        f.assertSingleInstanceOwnership.mockImplementation(() => context.signal.throwIfAborted());
        const originalRegistry = (await f.registry.read())!;
        const targetWorkspaceId = mode === 'passive' ? validateWorkspaceId('77777777-7777-4777-8777-777777777777') : workspaceId;
        const registry = { ...originalRegistry, formatVersion: 2 as const,
          activeWorkspaceId: mode === 'selector' ? null : workspaceId,
          workspaces: mode === 'passive' ? [...originalRegistry.workspaces, {
            ...originalRegistry.workspaces[0]!, workspaceId: targetWorkspaceId,
            workspaceLabel: 'Synthetic other company', lineageIdentity: { formatVersion: 1 as const, profileId: foreignProfileId },
          }] : originalRegistry.workspaces,
        };
        const targetRoot = deriveWorkspaceRoot(f.root, targetWorkspaceId, 1).workspaceRoot;
        await mkdir(targetRoot, { recursive: true, mode: 0o700 });
        await writeFile(join(targetRoot, 'synthetic-owned-payload'), 'owned target bytes', { mode: 0o600 });
        const externalBackup = join(f.root, 'synthetic-user-export.ekybackup');
        await writeFile(externalBackup, 'retained external bytes', { mode: 0o600 });
        await f.registry.write(registry);
        const command = createWorkspaceDeletionCommand({ userDataRoot: f.root, registry: f.registry,
          async assertWritersAbsent() {
            context.signal.throwIfAborted();
            // Native execution/lock ownership are controlled; main's lifecycle and file identities stay real.
            expect(stopForDelete).toHaveBeenCalledTimes(mode === 'selector' || mode === 'cold' ? 0 : 1);
          },
        });
        if (mode === 'cold') {
          await lifetime.step('fixturePreparation', async () => {
            const selected = await captureDeletionTarget({ installationRoot: f.root,
              workspaceId: targetWorkspaceId, typedLabel: registry.workspaces[0]!.workspaceLabel,
              registry: f.registry, assertAuthority: () => context.signal.throwIfAborted() });
            publishedOperationId = operationId;
            await command.publish(() => context.signal.throwIfAborted(), async () => context.signal.throwIfAborted(),
              selected.target, { operationId, target: selected.target, backupDisposition: 'explicitDataLoss' },
              selected.assertCurrent);
            const paths = createWorkspaceDeletionJournalPaths(f.root);
            expect(captureWorkspaceDeletionJournal(JSON.parse(await readFile(paths.currentPath, 'utf8'))).phase).toBe('authorized');
            expect(await readFile(f.databasePath, 'utf8')).toBe(f.originalBytes);
          });
          // Startup must consume the real journal, not the injected live command.
          expect(fixtureOptions.workspaceDeletionCommand).toBeUndefined();
        } else fixtureOptions.workspaceDeletionCommand = {
          async publish(...args) {
            publishedOperationId = args[3].operationId;
            return command.publish(...args);
          },
          resume(id, authority) {
            requesterCurrent = false;
            return command.resume(id, authority);
          },
        };
        electronBoundary.fetch.mockImplementation(async (url: string) => url.endsWith('/customers')
          ? new Response(null, { status: 401 }) : new Response(JSON.stringify({ status: 'ok' })));
        vi.spyOn(ProfileSnapshotBrokerClient.prototype, 'beginDeleteMaintenance').mockResolvedValue('busy');
        vi.spyOn(ProfileSnapshotBrokerClient.prototype, 'assertDeleteMaintenance').mockResolvedValue('busy');
        const marker = vi.spyOn(RecoveryPointCleanShutdownMarker.prototype, 'markClean');
        let lifecycle: Awaited<ReturnType<typeof f.start>>;
        let firstFailure: { error: unknown } | undefined;
        try {
          await lifetime.step('startup', async () => { lifecycle = await f.start(); });
          if (lifecycle === undefined || service === undefined) throw new Error('MISSING_MAIN_DELETION_OWNER');
          if (mode === 'cold') {
            expect(requesterCurrent).toBe(true);
            expect(f.events).toEqual([]);
            expect(f.createRuntimeSession).not.toHaveBeenCalled();
            expect(electronBoundary.fork).not.toHaveBeenCalled();
            expect(electronBoundary.createWindow).toHaveBeenCalledOnce();
            expect(registerApplicationProtocol).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ mode: 'selector' }));
            expect(f.showMessageBox).not.toHaveBeenCalled();
            expect(stopForDelete).not.toHaveBeenCalled();
            expect(electronBoundary.reservationReleased).not.toHaveBeenCalledWith(f.root);
          } else {
            f.showMessageBox.mockResolvedValue({ response: 1, checkboxChecked: false });
            const result = await lifetime.step('restoredContentCheck', () => service!.deleteWorkspace({
              formatVersion: 1, workspaceId: targetWorkspaceId,
              typedLabel: registry.workspaces.find(entry => entry.workspaceId === targetWorkspaceId)!.workspaceLabel,
              backupChoice: 'explicitDataLoss',
            }, {
              assertCurrent() { context.signal.throwIfAborted(); if (!requesterCurrent) throw new Error('SYNTHETIC_REQUESTER_GONE'); },
              closeAdmissionForOwnStop() { service!.closeAdmission(); },
            }));
            expect(result).toEqual({ formatVersion: 1, status: 'completed', navigation: mode === 'passive' ? 'reopenPrevious' : 'selector' });
            expect(requesterCurrent).toBe(false);
          }
          expect(publishedOperationId).toBeDefined();
          const selectedRegistry = await f.registry.inspectSlots();
          expect(selectedRegistry.current!.value).toEqual({ ...registry,
            activeWorkspaceId: mode === 'passive' ? workspaceId : null,
            workspaces: mode === 'passive' ? originalRegistry.workspaces : [],
          });
          expect(selectedRegistry.backup).toBeUndefined(); expect(selectedRegistry.next).toBeUndefined();
          await expect(readdir(targetRoot)).rejects.toMatchObject({ code: 'ENOENT' });
          const journalPaths = createWorkspaceDeletionJournalPaths(f.root);
          for (const path of [journalPaths.currentPath, journalPaths.backupPath, journalPaths.nextPath,
            createWorkspaceDeletionInventoryPaths(f.root, publishedOperationId!).directoryPath]) {
            await expect(readFile(path)).rejects.toMatchObject({ code: 'ENOENT' });
          }
          expect(await readFile(externalBackup, 'utf8')).toBe('retained external bytes');
          if (mode === 'passive') {
            expect(await readFile(f.databasePath, 'utf8')).toBe(f.originalBytes);
            expect(await readFile(f.pdfPath, 'utf8')).toBe('%PDF-1.7 original pdf');
          }
          expect(marker).not.toHaveBeenCalled();
          // These service/cold calls bypass capability admission; registration is not deletion authority.
          expect(electronBoundary.ipcHandlers.has(deleteWorkspaceIpcChannel)).toBe(true);
        } catch (error) { firstFailure = { error }; throw error; }
        finally {
          try { await lifecycle?.shutdown(); }
          catch (cleanupFailure) {
            if (firstFailure !== undefined) throw new AggregateError([firstFailure.error, cleanupFailure],
              'SYNTHETIC_DELETION_AND_SHUTDOWN_FAILED', { cause: firstFailure.error });
            throw cleanupFailure;
          }
        }
        expect(electronBoundary.ipcHandlers.has(deleteWorkspaceIpcChannel)).toBe(false);
        expect(marker).toHaveBeenCalledTimes(mode === 'passive' ? 1 : 0);
        if (mode === 'cold') {
          expect(electronBoundary.reservationReleased.mock.calls.filter(([root]) => root === f.root)).toHaveLength(1);
        }
      });
    });
});

describe('W7.4 main deletion completion wiring', () => {
  it.for(['removed', 'responseLost', 'beforeReceipt', 'releaseFailure', 'selectorRemoved', 'otherCompanyRemoved',
    'completedBeforeShutdown', 'releaseFailureBeforeShutdown'] as const)(
    'preserves the actual marker boundary across %s', async (scenario, context) => {
      const lifetime = beginTrackedStartupTest(context);
      await lifetime.run(async () => {
        const entered = createCompletionGate();
        const finish = createCompletionGate();
        const releaseFails = scenario === 'releaseFailure' || scenario === 'releaseFailureBeforeShutdown';
        const closeFails = scenario === 'beforeReceipt' || releaseFails;
        let service: WorkspaceManagementService | undefined;
        let binding: WorkspaceDeletionJournal | undefined;
        const targetWorkspaceId = scenario === 'otherCompanyRemoved'
          ? validateWorkspaceId('77777777-7777-4777-8777-777777777777') : workspaceId;
        const command: NonNullable<StartDesktopCompositionOptions['workspaceDeletionCommand']> = {
          async publish(assertCurrent, assertSelected, target, publication) {
            assertCurrent(); await assertSelected(); assertCurrent();
            // Modeled durable owner: this proves C's delivery ordering, not D's purge.
            binding = captureWorkspaceDeletionJournal({ formatVersion: 1, phase: 'authorized',
              target: { formatVersion: deletionInventoryFormatVersion, operationId: publication.operationId, workspaceId: target.workspaceId,
                lineageIdentity: { formatVersion: 1, profileId: target.profileId }, registryEntrySha256: target.registryEntrySha256 },
              registryBeforeSha256: target.registrySha256, registryAfterSha256: 'b'.repeat(64),
              previousActiveWorkspaceId: target.previousActiveWorkspaceId, backupDisposition: publication.backupDisposition,
              inventory: { formatVersion: deletionInventoryFormatVersion, byteLength: 1, recordCount: 1, sha256: 'c'.repeat(64) },
              inventoryFileIdentity: 'd'.repeat(64), operationRootIdentity: 'e'.repeat(64), operationParentIdentity: 'f'.repeat(64) });
            return { journal: binding, workspaceRootIdentity: target.rootIdentity };
          },
          async resume(_id, authority) {
            await authority.assertOwned();
            const targetRoot = deriveWorkspaceRoot(f.root, targetWorkspaceId, 1).workspaceRoot;
            await rm(targetRoot, { recursive: true });
            if (scenario !== 'beforeReceipt') authority.recordRemoved({ status: 'removed',
              journal: { ...binding!, phase: 'registryPublished' } });
            entered.resolve();
            await finish.promise;
            if (scenario === 'beforeReceipt') authority.recordRemoved({ status: 'removed',
              journal: { ...binding!, phase: 'registryPublished' } });
            if (scenario === 'responseLost') throw new Error('SYNTHETIC_DELETION_RESPONSE_LOST');
            return { formatVersion: 1, status: 'completed',
              navigation: scenario === 'otherCompanyRemoved' ? 'reopenPrevious' : 'selector' };
          },
        };
        const f = await lifetime.step('fixturePreparation', () => createFixture(originalProfileId, {
          ownedRoots: lifetime.roots, update: true, skipRestore: true, completeStartup: true,
          workspaceDeletionCommand: command,
          async stopForDelete() {},
          createWorkspaceManagementCapability(options) {
            service = options.service as WorkspaceManagementService;
            return createWorkspaceManagementCapability(options);
          },
        }));
        electronBoundary.fetch.mockImplementation(async (url: string) => url.endsWith('/customers')
          ? new Response(null, { status: 401 }) : new Response(JSON.stringify({ status: 'ok' })));
        vi.spyOn(ProfileSnapshotBrokerClient.prototype, 'beginDeleteMaintenance').mockResolvedValue('busy');
        vi.spyOn(ProfileSnapshotBrokerClient.prototype, 'assertDeleteMaintenance').mockResolvedValue('busy');
        const marker = vi.spyOn(RecoveryPointCleanShutdownMarker.prototype, 'markClean');
        const originalRegistry = (await f.registry.read())!;
        const registry = { ...originalRegistry, formatVersion: 2 as const,
          activeWorkspaceId: scenario === 'selectorRemoved' ? null : workspaceId,
          workspaces: scenario === 'otherCompanyRemoved' ? [...originalRegistry.workspaces, {
            ...originalRegistry.workspaces[0]!, workspaceId: targetWorkspaceId,
            workspaceLabel: 'Synthetic other company', lineageIdentity: { formatVersion: 1 as const, profileId: foreignProfileId },
          }] : originalRegistry.workspaces,
        };
        if (scenario === 'otherCompanyRemoved') await mkdir(deriveWorkspaceRoot(f.root, targetWorkspaceId, 1).workspaceRoot, { recursive: true, mode: 0o700 });
        await f.registry.write(registry);
        const releaseFailure = new Error('SYNTHETIC_DELETE_LEASE_RELEASE_FAILED');
        if (releaseFails) {
          const acquire = InMemoryWorkspaceMaintenanceLease.prototype.acquire;
          const capture = InMemoryWorkspaceMaintenanceLease.prototype.captureCurrentOwner;
          const handles = new WeakMap<Awaited<ReturnType<typeof acquire>>, Awaited<ReturnType<typeof acquire>>>();
          vi.spyOn(InMemoryWorkspaceMaintenanceLease.prototype, 'acquire').mockImplementation(async function (this: InMemoryWorkspaceMaintenanceLease, purpose) {
            const original = await acquire.call(this, purpose);
            if (purpose !== 'delete') return original;
            const wrapped = { async release() { await original.release(); throw releaseFailure; } };
            handles.set(wrapped, original);
            return wrapped;
          });
          vi.spyOn(InMemoryWorkspaceMaintenanceLease.prototype, 'captureCurrentOwner').mockImplementation(function (this: InMemoryWorkspaceMaintenanceLease, purposes, expected) {
            return capture.call(this, purposes, expected === undefined ? undefined : handles.get(expected) ?? expected);
          });
        }
        const lifecycle = await lifetime.step('startup', () => f.start());
        if (lifecycle === undefined || service === undefined) throw new Error('MISSING_MAIN_DELETION_OWNER');
        f.showMessageBox.mockResolvedValue({ response: 1, checkboxChecked: false });
        const work = service.deleteWorkspace({ formatVersion: 1, workspaceId: targetWorkspaceId,
          typedLabel: registry.workspaces.find(entry => entry.workspaceId === targetWorkspaceId)!.workspaceLabel, backupChoice: 'explicitDataLoss' },
        { assertCurrent() {}, closeAdmissionForOwnStop() { service!.closeAdmission(); } })
          .then(value => ({ value }), error => ({ error }));
        let closing: Promise<void> | undefined;
        let checked = false;
        let firstFailure: { error: unknown } | undefined;
        try {
          const reached = await Promise.race([entered.promise.then(() => 'held' as const), work]);
          if (reached !== 'held') throw 'error' in reached ? reached.error : new Error('DURABLE_OWNER_NOT_ENTERED');
          const commandSettlesFirst = scenario === 'completedBeforeShutdown' || scenario === 'releaseFailureBeforeShutdown';
          if (commandSettlesFirst) {
            finish.resolve();
            if (releaseFails) expect(await work).toHaveProperty('error');
            else expect(await work).toEqual({ value: { formatVersion: 1, status: 'completed', navigation: 'selector' } });
          }
          closing = lifecycle.shutdown();
          let settled = false;
          void closing.then(() => { settled = true; }, () => { settled = true; });
          await nextEventLoopTurn();
          if (!commandSettlesFirst) expect(settled).toBe(false);
          expect(marker).not.toHaveBeenCalled();
          finish.resolve();
          if (!commandSettlesFirst) expect(await work).toHaveProperty('error'); // The response was revoked, not an accepted terminal.
          if (closeFails) {
            await expect(closing).rejects.toThrow('DESKTOP_SHUTDOWN_FAILED');
            await expect(lifecycle.shutdown()).rejects.toThrow('DESKTOP_SHUTDOWN_FAILED');
            if (releaseFails) await expect(closing.catch(error => hasErrorCause(error.cause.managementFailure, releaseFailure))).resolves.toBe(true);
          } else await closing;
          checked = true;
          expect(marker).toHaveBeenCalledTimes(scenario === 'otherCompanyRemoved' ? 1 : 0);
          const root = deriveWorkspaceRoot(f.root, targetWorkspaceId, 1).workspaceRoot;
          if (scenario === 'otherCompanyRemoved') await expect(readFile(f.databasePath, 'utf8')).resolves.toBe(f.originalBytes);
          else await expect(readFile(f.databasePath)).rejects.toMatchObject({ code: 'ENOENT' });
          await expect(readdir(root)).rejects.toMatchObject({ code: 'ENOENT' });
          const markerPath = createProfileSnapshotRuntimePaths(createDesktopProfilePaths(root).runtimeRoot).recoveryPointCleanShutdownMarkerPath;
          for (const slot of [markerPath, `${markerPath}.next`, `${markerPath}.backup`]) {
            await expect(readFile(slot)).rejects.toMatchObject({ code: 'ENOENT' });
          }
          if (scenario === 'otherCompanyRemoved') await expect(f.marker.consume()).resolves.toBe('clean');
          const events = await readRestoreDiagnosticEvents(f.root);
          expect(events.some(event => event.eventName === 'desktop.shutdownCompleted'))
            .toBe(!closeFails);
          expect(electronBoundary.ipcHandlers.has(deleteWorkspaceIpcChannel)).toBe(false);
        } catch (error) {
          firstFailure = { error };
          throw error;
        } finally {
          finish.resolve(); await work;
          try {
            if (closing !== undefined) {
              if (checked && closeFails) await closing.catch(() => undefined);
              else await closing;
            } else await lifecycle.shutdown();
          } catch (cleanupFailure) {
            if (firstFailure !== undefined) throw new AggregateError([firstFailure.error, cleanupFailure],
              'SYNTHETIC_DELETION_AND_SHUTDOWN_FAILED', { cause: firstFailure.error });
            throw cleanupFailure;
          }
        }
      });
    });
});

describe('W7.5 main deletion result wiring', () => {
  it.for([
    { mode: 'active', outcome: 'completed' },
    { mode: 'selector', outcome: 'completed' },
    { mode: 'passive', outcome: 'completed' },
    { mode: 'selector', outcome: 'replyLost' },
    { mode: 'active', outcome: 'quitReentry' },
    { mode: 'active', outcome: 'releaseFailure' },
    { mode: 'active', outcome: 'cancelLive' },
    { mode: 'selector', outcome: 'cancelLive' },
    { mode: 'selector', outcome: 'cancelStopped' },
    { mode: 'active', outcome: 'returnRequested' },
  ] as const)('projects $mode / $outcome through the real main and capability owners', async ({ mode, outcome }, context) => {
    const lifetime = beginTrackedStartupTest(context);
    await lifetime.run(async () => {
      let capability: WorkspaceManagementCapability | undefined;
      const failureCauses: unknown[] = [];
      let binding: WorkspaceDeletionJournal | undefined;
      let lifecycle: Awaited<ReturnType<typeof startDesktopComposition>> | undefined;
      let closing: Promise<void> | undefined;
      const command: NonNullable<StartDesktopCompositionOptions['workspaceDeletionCommand']> = {
        async publish(assertCurrent, assertSelected, target, publication) {
          assertCurrent(); await assertSelected(); assertCurrent();
          // Controlled receipt only: W7.4 owns the actual file/journal matrix.
          binding = captureWorkspaceDeletionJournal({ formatVersion: 1, phase: 'authorized',
            target: { formatVersion: deletionInventoryFormatVersion, operationId: publication.operationId,
              workspaceId: target.workspaceId, lineageIdentity: { formatVersion: 1, profileId: target.profileId },
              registryEntrySha256: target.registryEntrySha256 },
            registryBeforeSha256: target.registrySha256, registryAfterSha256: 'b'.repeat(64),
            previousActiveWorkspaceId: target.previousActiveWorkspaceId, backupDisposition: publication.backupDisposition,
            inventory: { formatVersion: deletionInventoryFormatVersion, byteLength: 1, recordCount: 1, sha256: 'c'.repeat(64) },
            inventoryFileIdentity: 'd'.repeat(64), operationRootIdentity: 'e'.repeat(64), operationParentIdentity: 'f'.repeat(64) });
          return { journal: binding, workspaceRootIdentity: target.rootIdentity };
        },
        async resume(_id, authority) {
          await authority.assertOwned();
          authority.recordRemoved({ status: 'removed', journal: { ...binding!, phase: 'registryPublished' } });
          if (outcome === 'replyLost') f.mainWindow.webContents.emit('did-start-loading');
          return { formatVersion: 1, status: 'completed', navigation: mode === 'passive' ? 'reopenPrevious' : 'selector' };
        },
      };
      const stopForDelete = vi.fn(async () => undefined);
      const f = await lifetime.step('fixturePreparation', () => createFixture(originalProfileId, {
        ownedRoots: lifetime.roots, update: true, skipRestore: true, completeStartup: true,
        workspaceDeletionCommand: command, stopForDelete,
        createWorkspaceManagementCapability(options) {
          const resultRuntime = options.deletionRuntime;
          if (resultRuntime === undefined) throw new Error('MISSING_MAIN_DELETION_RESULT_RUNTIME');
          capability = createWorkspaceManagementCapability({ ...options, deletionRuntime: {
            ...resultRuntime,
            projectFailure(failure) {
              failureCauses.push(failure.cause);
              return resultRuntime.projectFailure(failure);
            },
          } });
          return capability;
        },
      }));
      Object.assign(f.mainWindow, { isMinimized: () => false, isVisible: () => true,
        restore: vi.fn(), show: vi.fn(), focus: vi.fn() });
      Object.assign(f.mainWindow.webContents, { focus: vi.fn() });
      f.assertSingleInstanceOwnership.mockImplementation(() => context.signal.throwIfAborted());
      const original = (await f.registry.read())!;
      const targetId = mode === 'passive' ? validateWorkspaceId('77777777-7777-4777-8777-777777777777') : workspaceId;
      const registry = { ...original, formatVersion: 2 as const, activeWorkspaceId: mode === 'selector' ? null : workspaceId,
        workspaces: mode === 'passive' ? [...original.workspaces, { ...original.workspaces[0]!, workspaceId: targetId,
          workspaceLabel: 'Synthetic other company', lineageIdentity: { formatVersion: 1 as const, profileId: foreignProfileId } }]
          : original.workspaces };
      if (mode === 'passive') await mkdir(deriveWorkspaceRoot(f.root, targetId, 1).workspaceRoot, { recursive: true, mode: 0o700 });
      await f.registry.write(registry);
      const before = await readFile(join(f.root, WORKSPACE_REGISTRY_FILE_NAME));
      electronBoundary.fetch.mockImplementation(async (url: string) => url.endsWith('/customers')
        ? new Response(null, { status: 401 }) : new Response(JSON.stringify({ status: 'ok' })));
      vi.spyOn(ProfileSnapshotBrokerClient.prototype, 'beginDeleteMaintenance').mockResolvedValue('busy');
      vi.spyOn(ProfileSnapshotBrokerClient.prototype, 'assertDeleteMaintenance').mockResolvedValue('busy');
      const releaseFailure = new Error('SYNTHETIC_RESULT_LEASE_RELEASE_FAILED');
      if (outcome === 'releaseFailure') {
        const acquire = InMemoryWorkspaceMaintenanceLease.prototype.acquire;
        const capture = InMemoryWorkspaceMaintenanceLease.prototype.captureCurrentOwner;
        const handles = new WeakMap<Awaited<ReturnType<typeof acquire>>, Awaited<ReturnType<typeof acquire>>>();
        vi.spyOn(InMemoryWorkspaceMaintenanceLease.prototype, 'acquire').mockImplementation(async function (this: InMemoryWorkspaceMaintenanceLease, purpose) {
          const originalHandle = await acquire.call(this, purpose);
          if (purpose !== 'delete') return originalHandle;
          const wrapped = { async release() { await originalHandle.release(); throw releaseFailure; } };
          handles.set(wrapped, originalHandle); return wrapped;
        });
        vi.spyOn(InMemoryWorkspaceMaintenanceLease.prototype, 'captureCurrentOwner').mockImplementation(function (this: InMemoryWorkspaceMaintenanceLease, purposes, expected) {
          return capture.call(this, purposes, expected === undefined ? undefined : handles.get(expected) ?? expected);
        });
      }
      let shutdownChecked = false;
      let firstFailure: { error: unknown } | undefined;
      try {
        lifecycle = await lifetime.step('startup', () => f.start());
        if (lifecycle === undefined || capability === undefined) throw new Error('MISSING_MAIN_DELETION_RESULT_OWNER');
        if (outcome === 'quitReentry') f.relaunch.mockImplementation(() => { closing = lifecycle!.shutdown(); });
        if (outcome === 'cancelLive') f.showMessageBox.mockResolvedValue({ response: 0, checkboxChecked: false });
        else if (outcome === 'cancelStopped' || outcome === 'returnRequested') {
          f.showMessageBox.mockResolvedValueOnce({ response: 1, checkboxChecked: false })
            .mockResolvedValueOnce({ response: 0, checkboxChecked: false })
            .mockResolvedValueOnce({ response: outcome === 'returnRequested' ? 1 : 0, checkboxChecked: false });
        } else f.showMessageBox.mockResolvedValue({ response: 1, checkboxChecked: false });
        const event = { sender: f.mainWindow.webContents, senderFrame: f.mainWindow.webContents.mainFrame } as unknown as IpcMainInvokeEvent;
        const result = await lifetime.step('restoredContentCheck', () => capability!.deleteWorkspace(event, {
          formatVersion: 1, workspaceId: targetId,
          typedLabel: registry.workspaces.find(entry => entry.workspaceId === targetId)!.workspaceLabel,
          backupChoice: 'explicitDataLoss',
        }).then(value => ({ value }), error => ({ error })));
        if (outcome === 'replyLost' || outcome === 'quitReentry') {
          expect(result).toMatchObject({ error: { message: 'WORKSPACE_MANAGEMENT_CAPABILITY_FORBIDDEN' } });
          expect(f.relaunch).toHaveBeenCalledOnce();
        } else if (outcome === 'releaseFailure') {
          expect(result).toEqual({ value: { formatVersion: 1, status: 'recoveryRequired',
            errorCode: 'WORKSPACE_DELETE_FAILED', sideEffectState: 'unknown', nextAction: 'restartRequired' } });
          expect(failureCauses).toHaveLength(1);
          expect(hasErrorCause(failureCauses[0], releaseFailure)).toBe(true);
          expect(f.relaunch).not.toHaveBeenCalled();
        } else if (outcome === 'cancelLive' || outcome === 'cancelStopped' || outcome === 'returnRequested') {
          expect(result).toEqual({ value: { formatVersion: 1, status: 'cancelled',
            nextAction: outcome === 'cancelLive' ? 'continue' : outcome === 'cancelStopped' ? 'restartRequired' : 'relaunching' } });
          expect(binding).toBeUndefined();
          expect(f.relaunch).toHaveBeenCalledTimes(outcome === 'returnRequested' ? 1 : 0);
        } else {
          expect(result).toEqual({ value: { formatVersion: 1, status: 'completed',
            navigation: mode === 'passive' ? 'reopenPrevious' : 'selector' } });
          expect(f.relaunch).toHaveBeenCalledOnce();
        }
        expect(stopForDelete).toHaveBeenCalledTimes(mode === 'selector' || outcome === 'cancelLive' ? 0 : 1);
        // These modeled receipts must not be presented as real payload deletion.
        expect(await readFile(join(f.root, WORKSPACE_REGISTRY_FILE_NAME))).toEqual(before);
        expect(await readFile(f.databasePath, 'utf8')).toBe(f.originalBytes);
        expect(await readFile(f.pdfPath, 'utf8')).toBe('%PDF-1.7 original pdf');
        expect(electronBoundary.ipcHandlers.has(deleteWorkspaceIpcChannel)).toBe(outcome === 'cancelLive');
        expect(JSON.stringify(result)).not.toMatch(/SYNTHETIC|cause|stack|password|workspaceId/);
        closing ??= lifecycle.shutdown();
        if (outcome === 'releaseFailure') {
          await expect(closing).rejects.toThrow('DESKTOP_SHUTDOWN_FAILED');
        } else await closing;
        shutdownChecked = true;
      } catch (error) { firstFailure = { error }; throw error; }
      finally {
        if (!shutdownChecked) {
          try { await (closing ?? lifecycle?.shutdown()); }
          catch (cleanupFailure) {
            if (firstFailure !== undefined) throw new AggregateError([firstFailure.error, cleanupFailure],
              'SYNTHETIC_RESULT_AND_SHUTDOWN_FAILED', { cause: firstFailure.error });
            throw cleanupFailure;
          }
        }
      }
    });
  });
});

describe('W7.5 default deletion command wiring', () => {
  for (const mode of ['active', 'selector'] as const) {
    it.for(['reservationLost', 'shutdown', 'lateOwner'] as const)(
      `keeps the real ${mode} default command guarded across %s`, async (failure, context) => {
      const lifetime = beginTrackedStartupTest(context);
      await lifetime.run(async () => {
        const created: Parameters<typeof deletionCommands.createWorkspaceDeletionCommand>[0][] = [];
        const create = deletionCommands.createWorkspaceDeletionCommand;
        vi.spyOn(deletionCommands, 'createWorkspaceDeletionCommand').mockImplementation(input => {
          created.push(input); return create(input);
        });
        let backend: DesktopBackendHandle | undefined;
        const f = await lifetime.step('fixturePreparation', () => createFixture(originalProfileId, {
          ownedRoots: lifetime.roots, update: true, skipRestore: true, completeStartup: true,
          createWorkspaceManagementCapability, async stopForDelete() {},
          observeControlledBackend: value => { backend = value; },
        }));
        const registry = (await f.registry.read())!;
        await f.registry.write({ ...registry, formatVersion: 2, activeWorkspaceId: mode === 'selector' ? null : workspaceId });
        electronBoundary.fetch.mockImplementation(async (url: string) => url.endsWith('/customers')
          ? new Response(null, { status: 401 }) : new Response(JSON.stringify({ status: 'ok' })));
        const lifecycle = await lifetime.step('startup', () => f.start());
        if (lifecycle === undefined) throw new Error('MISSING_DEFAULT_DELETION_LIFECYCLE');
        let closing: Promise<void> | undefined;
        try {
          expect(created).toHaveLength(1);
          expect(created[0]!.userDataRoot).toBe(f.root);
          expect(electronBoundary.handle.mock.calls.some(([channel]) => channel === deleteWorkspaceIpcChannel)).toBe(true);
          const guard = created[0]!.assertWritersAbsent;
          await expect(guard()).rejects.toThrow(mode === 'active'
            ? 'WORKSPACE_PROCESS_RESERVATION_FAILED' : 'WORKSPACE_RUNTIME_STILL_ACTIVE');
          const before = await readFile(join(f.root, WORKSPACE_REGISTRY_FILE_NAME));
          if (mode === 'active') {
            if (backend === undefined) throw new Error('MISSING_CONTROLLED_DELETION_BACKEND');
            await backend.stopForDelete('88888888-8888-4888-8888-888888888888');
          }
          // Control only the lifecycle boundary; this does not prove native absence.
          const prototype = mode === 'active' ? MainOwnedActiveWorkspaceLifecycle.prototype : MainOwnedSelectorWorkspaceLifecycle.prototype;
          vi.spyOn(prototype, 'assertNoActiveWorkspaceRuntime').mockImplementation(async () => {
            await Promise.resolve();
            if (failure === 'reservationLost') electronBoundary.loseReservation?.();
            if (failure === 'shutdown') closing = lifecycle.shutdown();
          });
          const late = new Error('SYNTHETIC_DEFAULT_DELETE_OWNER_CHANGED');
          const observePhysical = vi.fn(() => {
            f.assertSingleInstanceOwnership.mockImplementation(() => { throw late; });
          });
          if (failure === 'lateOwner') electronBoundary.observeReservationOwned = observePhysical;
          await expect(guard()).rejects.toThrow();
          if (failure === 'lateOwner') expect(observePhysical).toHaveBeenCalledOnce();
          expect(await readFile(join(f.root, WORKSPACE_REGISTRY_FILE_NAME))).toEqual(before);
        } finally {
          f.assertSingleInstanceOwnership.mockImplementation(() => undefined);
          electronBoundary.observeReservationOwned = undefined;
          const stop = closing ?? lifecycle.shutdown();
          if (failure === 'shutdown') await stop;
          else await expect(stop).rejects.toThrow(mode === 'active'
            ? 'WORKSPACE_PROCESS_RESERVATION_FAILED' : 'DESKTOP_SHUTDOWN_FAILED');
        }
      });
    });
  }
});

describe('W7.3 main preparation wiring', () => {
  it.for(['active', 'selector'] as const)('connects the W7.3 preparation in the real %s main composition', async (mode, context) => {
    const lifetime = beginTrackedStartupTest(context);
    await lifetime.run(async () => {
      const lifecycleProof = observeSelectorPreparationForTest();
      const publish = vi.fn<NonNullable<StartDesktopCompositionOptions['workspaceDeletionPublisher']>>(async () => {
        throw new Error('UNEXPECTED_JOURNAL_PUBLICATION');
      });
      let capability: WorkspaceManagementCapability | undefined;
      const f = await lifetime.step('fixturePreparation', () => createFixture(originalProfileId, {
        ownedRoots: lifetime.roots, update: true, skipRestore: true, completeStartup: true, workspaceDeletionPublisher: publish,
        createWorkspaceManagementCapability(options) {
          capability = createWorkspaceManagementCapability(options);
          return capability;
        },
      }));
      const registry = (await f.registry.read())!;
      await f.registry.write({ ...registry, formatVersion: 2, activeWorkspaceId: mode === 'selector' ? null : workspaceId });
      // This controlled HTTP boundary must still reject a different runtime session.
      electronBoundary.fetch.mockImplementation(async (url: string) => url.endsWith('/customers')
        ? new Response(null, { status: 401 }) : new Response(JSON.stringify({ status: 'ok' })));
      const startupFailures: unknown[] = [];
      let lifecycle: Awaited<ReturnType<typeof f.start>>;
      let firstFailure: { error: unknown } | undefined;
      try {
        await lifetime.step('startup', async () => {
          try { lifecycle = await f.start(error => { startupFailures.push(error); }); }
          catch (error) { throw startupFailures[0] ?? error; }
        });
        expect(lifecycle).toBeDefined();
        await lifetime.step('restoredContentCheck', async () => {
          expect(electronBoundary.handle.mock.calls.some(([channel]) => channel === deleteWorkspaceIpcChannel)).toBe(false);
          const statusHandler = electronBoundary.handle.mock.calls.find(([channel]) => channel === getWorkspaceManagementStatusIpcChannel)![1];
          const status = await statusHandler({ sender: f.mainWindow.webContents, senderFrame: f.mainWindow.webContents.mainFrame });
          expect(status.activeWorkspaceId).toBe(mode === 'selector' ? null : workspaceId);
          if (capability === undefined) throw new Error('MANAGEMENT_CAPABILITY_NOT_CAPTURED');
          f.showMessageBox.mockClear();
          const selected = await readFile(join(f.root, WORKSPACE_REGISTRY_FILE_NAME));
          await expect(capability.prepareDeletion({ sender: f.mainWindow.webContents,
            senderFrame: f.mainWindow.webContents.mainFrame } as unknown as IpcMainInvokeEvent,
          { formatVersion: 1, workspaceId, typedLabel: registry.workspaces[0]!.workspaceLabel,
            backupChoice: 'explicitDataLoss' })).resolves.toBe('cancelled');
          expect(f.showMessageBox).toHaveBeenCalledExactlyOnceWith(f.mainWindow, expect.objectContaining({
            title: 'Poisto ilman varmuuskopiota', defaultId: 0, cancelId: 0,
          }));
          expect(publish).not.toHaveBeenCalled();
          expect(lifecycleProof.combined).not.toHaveBeenCalled();
          expect(lifecycleProof.instances).toHaveLength(mode === 'selector' ? 1 : 0);
          for (const value of lifecycleProof.instances) {
            expect(value.options.kind).not.toBe('recoveryManagement');
            expect(value.options).not.toHaveProperty('assertMainOwnedAndRuntimeAbsent');
          }
          expect(f.showSaveDialog).not.toHaveBeenCalled();
          expect(f.events).toEqual(mode === 'selector' ? [] : ['backendStarted']);
          expect(electronBoundary.handle.mock.calls.some(([channel]) => /delete/i.test(String(channel)))).toBe(false);
          expect(await readFile(join(f.root, WORKSPACE_REGISTRY_FILE_NAME))).toEqual(selected);
          expect(await readFile(f.databasePath, 'utf8')).toBe(f.originalBytes);
        });
      } catch (error) {
        firstFailure = { error };
        throw error;
      } finally {
        // Cancellation must not skip the shutdown of an already returned owner.
        try { await lifecycle?.shutdown(); }
        catch (cleanupFailure) {
          if (firstFailure !== undefined) throw new AggregateError([firstFailure.error, cleanupFailure],
            'SYNTHETIC_W7_PREPARATION_AND_SHUTDOWN_FAILED', { cause: firstFailure.error });
          throw cleanupFailure;
        }
      }
    });
  });

  it.for([
    { mode: 'active', heldAt: 'confirmation', closeFailure: false, backendFailure: false },
    { mode: 'active', heldAt: 'publication', closeFailure: false, backendFailure: false },
    { mode: 'selector', heldAt: 'confirmation', closeFailure: false, backendFailure: false },
    { mode: 'active', heldAt: 'confirmation', closeFailure: true, backendFailure: false },
    { mode: 'active', heldAt: 'confirmation', closeFailure: true, backendFailure: true },
  ] as const)('retains the reservation while external shutdown joins a held $mode $heldAt request (close failure: $closeFailure, backend failure: $backendFailure)', async ({ mode, heldAt, closeFailure, backendFailure }, context) => {
    const lifetime = beginTrackedStartupTest(context);
    await lifetime.run(async () => {
      const entered = createCompletionGate();
      const release = createCompletionGate();
      const draining = createCompletionGate();
      const runtimeStopped = createCompletionGate();
      const originalManagementFailure = new Error('SYNTHETIC_MANAGEMENT_DRAIN_FAILED');
      let capability: WorkspaceManagementCapability | undefined;
      const publish = vi.fn<NonNullable<StartDesktopCompositionOptions['workspaceDeletionPublisher']>>(async (assertAuthority, assertSelection) => {
        assertAuthority();
        await assertSelection();
        entered.resolve();
        await release.promise;
        assertAuthority();
      });
      const stopForDelete = vi.fn(async (_operationId: string) => undefined);
      const f = await lifetime.step('fixturePreparation', () => createFixture(originalProfileId, {
        ownedRoots: lifetime.roots, update: true, skipRestore: true, completeStartup: true,
        workspaceDeletionPublisher: publish, stopForDelete,
        createWorkspaceManagementCapability(options) {
          capability = createWorkspaceManagementCapability(options);
          return capability;
        },
      }));
      const registry = (await f.registry.read())!;
      await f.registry.write({ ...registry, formatVersion: 2, activeWorkspaceId: mode === 'selector' ? null : workspaceId });
      electronBoundary.fetch.mockImplementation(async (url: string) => url.endsWith('/customers')
        ? new Response(null, { status: 401 }) : new Response(JSON.stringify({ status: 'ok' })));
      vi.spyOn(ProfileSnapshotBrokerClient.prototype, 'beginDeleteMaintenance').mockResolvedValue('busy');
      vi.spyOn(ProfileSnapshotBrokerClient.prototype, 'assertDeleteMaintenance').mockResolvedValue('busy');
      const serviceShutdown = WorkspaceManagementService.prototype.shutdown;
      vi.spyOn(WorkspaceManagementService.prototype, 'shutdown').mockImplementation(function (this: WorkspaceManagementService) {
        const work = serviceShutdown.call(this);
        draining.resolve();
        return work.then(() => { if (closeFailure) throw originalManagementFailure; });
      });
      const stopRuntime = MainOwnedActiveWorkspaceLifecycle.prototype.stopAndProveHandlesClosed;
      vi.spyOn(MainOwnedActiveWorkspaceLifecycle.prototype, 'stopAndProveHandlesClosed').mockImplementation(async function (
        this: MainOwnedActiveWorkspaceLifecycle, ...args
      ) {
        try { return await stopRuntime.apply(this, args); }
        finally { runtimeStopped.resolve(); }
      });
      const markClean = vi.spyOn(RecoveryPointCleanShutdownMarker.prototype, 'markClean');
      let lifecycle: Awaited<ReturnType<typeof f.start>>;
      let request: Promise<{ value: unknown } | { error: unknown }> | undefined;
      let closing: Promise<void> | undefined;
      let closeResultChecked = false;
      let firstFailure: { error: unknown } | undefined;
      try {
        await lifetime.step('startup', async () => { lifecycle = await f.start(); });
        if (lifecycle === undefined || capability === undefined) throw new Error('MANAGEMENT_CAPABILITY_NOT_CAPTURED');
        const originalRegistry = await readFile(join(f.root, WORKSPACE_REGISTRY_FILE_NAME));
        f.showMessageBox.mockImplementation(async () => {
          if (heldAt === 'confirmation') { entered.resolve(); await release.promise; }
          return { response: 1, checkboxChecked: false };
        });
        request = capability.prepareDeletion({ sender: f.mainWindow.webContents,
          senderFrame: f.mainWindow.webContents.mainFrame } as unknown as IpcMainInvokeEvent,
        { formatVersion: 1, workspaceId, typedLabel: registry.workspaces[0]!.workspaceLabel, backupChoice: 'explicitDataLoss' })
          .then(value => ({ value }), error => ({ error }));
        const reached = await Promise.race([entered.promise.then(() => 'held' as const), request]);
        if (reached !== 'held') throw 'error' in reached ? reached.error : new Error('REQUEST_DID_NOT_REACH_HOLD');
        expect(stopForDelete).toHaveBeenCalledTimes(heldAt === 'publication' ? 1 : 0);
        expect(markClean).not.toHaveBeenCalled();
        if (backendFailure) f.stop.mockRejectedValue(new BackendShutdownExitError());
        electronBoundary.reservationReleased.mockClear();
        closing = lifecycle.shutdown();
        const joined = await Promise.race([draining.promise.then(() => 'draining'), closing.then(() => 'closed')]);
        expect(joined).toBe('draining');
        if (mode === 'active') {
          await runtimeStopped.promise;
          // Flush the lifecycle continuation, not a wall-clock sleep: management
          // remains deliberately held after the existing runtime owner settled.
          await nextEventLoopTurn();
        }
        let shutdownSettled = false;
        void closing.then(() => { shutdownSettled = true; }, () => { shutdownSettled = true; });
        await nextEventLoopTurn();
        expect(shutdownSettled).toBe(false);
        expect(electronBoundary.reservationReleased).not.toHaveBeenCalled();
        expect(markClean).not.toHaveBeenCalled();
        expect((await readRestoreDiagnosticEvents(f.root)).some(event => event.eventName === 'desktop.shutdownCompleted')).toBe(false);
        release.resolve();
        expect(await request).toHaveProperty('error');
        if (closeFailure) {
          await expect(closing).rejects.toMatchObject({ message: 'DESKTOP_SHUTDOWN_FAILED', cause: {
            runtimeFailure: { firstFailure: backendFailure
              ? { phase: 'backend', reason: 'unsuccessfulExit' } : { phase: 'capabilities', reason: 'operationFailed' } },
            cleanupFailures: ['management'],
          } });
          await expect(closing.catch(error => hasErrorCause(error.cause.managementFailure, originalManagementFailure))).resolves.toBe(true);
          if (!backendFailure) {
            await expect(closing.catch(error => hasErrorCause(error.cause.runtimeFailure, originalManagementFailure))).resolves.toBe(true);
          }
          expect(electronBoundary.reservationReleased).not.toHaveBeenCalled();
        } else {
          await closing;
          expect(electronBoundary.reservationReleased).toHaveBeenCalledOnce();
        }
        closeResultChecked = true;
        expect(markClean).toHaveBeenCalledTimes(mode === 'active' && !closeFailure ? 1 : 0);
        await expect(f.marker.consume()).resolves.toBe(mode === 'active' && !closeFailure ? 'clean' : 'unclean');
        expect(f.relaunch).not.toHaveBeenCalled();
        expect(publish).toHaveBeenCalledTimes(heldAt === 'publication' ? 1 : 0);
        expect(await readFile(join(f.root, WORKSPACE_REGISTRY_FILE_NAME))).toEqual(originalRegistry);
        expect(await readFile(f.databasePath, 'utf8')).toBe(f.originalBytes);
        expect(electronBoundary.handle.mock.calls.some(([channel]) => /delete/i.test(String(channel)))).toBe(false);
      } catch (error) {
        firstFailure = { error };
        throw error;
      } finally {
        release.resolve();
        await request;
        try { await (closing ?? lifecycle?.shutdown()); }
        catch (cleanupFailure) {
          if (firstFailure !== undefined) throw new AggregateError([firstFailure.error, cleanupFailure],
            'SYNTHETIC_W7_PREPARATION_AND_SHUTDOWN_FAILED', { cause: firstFailure.error });
          if (!closeResultChecked || !closeFailure) throw cleanupFailure;
        }
      }
    });
  });
});

describe('W7.5 main support export lifetime', () => {
  for (const heldAt of ['confirmation', 'target'] as const) {
    it(`revokes a pending ${heldAt} export through actual main shutdown`, async (context) => {
      const lifetime = beginTrackedStartupTest(context);
      await lifetime.run(async () => {
        const f = await lifetime.step('fixturePreparation', () => createFixture(originalProfileId, {
          skipRestore: true, completeStartup: true, ownedRoots: lifetime.roots,
        }));
        const observeFailure = vi.fn();
        const createCapability = supportBundleCapability.createSupportBundleCapability;
        vi.spyOn(supportBundleCapability, 'createSupportBundleCapability').mockImplementation(options =>
          createCapability({ ...options, observeFailure }));
        let enter!: () => void, release!: () => void;
        const entered = new Promise<void>(resolve => { enter = resolve; });
        const held = new Promise<void>(resolve => { release = resolve; });
        let lifecycle: Awaited<ReturnType<typeof f.start>>;
        let work: Promise<{ value: unknown } | { error: unknown }> | undefined;
        let firstFailure: { error: unknown } | undefined;
        const targetPath = join(f.root, 'support.json.gz');
        try {
          await lifetime.step('startup', async () => { lifecycle = await f.start(); });
          expect(lifecycle).toBeDefined();
          const originalDatabase = await readFile(f.databasePath);
          const originalPdf = await readFile(f.pdfPath);
          f.showMessageBox.mockImplementation(async () => {
            if (heldAt === 'confirmation') { enter(); await held; }
            return { response: 1, checkboxChecked: false };
          });
          f.showSaveDialog.mockImplementation(async () => {
            if (heldAt === 'target') { enter(); await held; }
            return { canceled: false, filePath: targetPath };
          });
          const handler = electronBoundary.handle.mock.calls.find(([channel]) => channel === createSupportBundleIpcChannel)?.[1];
          if (handler === undefined) throw new Error('SUPPORT_CAPABILITY_NOT_REGISTERED');
          work = Promise.resolve(handler({ sender: f.mainWindow.webContents,
            senderFrame: f.mainWindow.webContents.mainFrame }))
            .then(value => ({ value }), error => ({ error }));
          expect(await Promise.race([entered.then(() => 'held'), work])).toBe('held');
          await lifecycle!.shutdown();
          expect(electronBoundary.removeHandler).toHaveBeenCalledWith(createSupportBundleIpcChannel);
          release();
          const result = await work;
          expect(result).toHaveProperty('error');
          if (!('error' in result)) throw new Error('STALE_SUPPORT_REQUEST_WAS_ACCEPTED');
          expect(result.error).toMatchObject({ message: 'SUPPORT_BUNDLE_CREATION_FAILED' });
          expect(result.error).not.toHaveProperty('cause');
          expect(observeFailure).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ message: 'SUPPORT_BUNDLE_FORBIDDEN' }));
          expect(f.showMessageBox).toHaveBeenCalledOnce();
          expect(electronBoundary.fetch.mock.calls.some(([url]) =>
            String(url).includes('/diagnostics/support-bundle-data'))).toBe(false);
          await expect(stat(targetPath)).rejects.toMatchObject({ code: 'ENOENT' });
          await expect(readFile(f.databasePath)).resolves.toEqual(originalDatabase);
          await expect(readFile(f.pdfPath)).resolves.toEqual(originalPdf);
          await f.assertRegistryUnchanged();
          expect(electronBoundary.ipcHandlers.has(deleteWorkspaceIpcChannel)).toBe(false);
        } catch (error) {
          firstFailure = { error };
          throw error;
        } finally {
          release();
          await work;
          try { await lifecycle?.shutdown(); }
          catch (cleanupFailure) {
            if (firstFailure !== undefined) throw new AggregateError([firstFailure.error, cleanupFailure],
              'SYNTHETIC_SUPPORT_AND_SHUTDOWN_FAILED', { cause: firstFailure.error });
            throw cleanupFailure;
          }
        }
      });
    });
  }
});

describe('desktop startup stage observations', () => {
  it('preserves normal group order across held status, health, validation, acceptance and rejected real scheduler cleanup', async context => {
    const lifetime = beginTrackedStartupTest(context);
    await lifetime.run(async () => {
      const f = await lifetime.step('fixturePreparation', () => createDeferredStartupFixture(lifetime.roots, true));
      await writeFile(f.paths.acceptedBuildMetadataPath, `${JSON.stringify(f.metadata.acceptedBuild)}\n`);
      const journal = await seedSelectorTarget(f.fixture);
      const before = { metadata: await f.fixture.acceptedBuild.inspectSlots(),
        registry: await f.fixture.registry.inspect(), update: await f.fixture.updateJournal.inspectSlots() };
      const events: string[] = [];
      const signals: DesktopStartupSignal[] = [];
      const observeStartupStage = (signal: DesktopStartupSignal) => { signals.push(signal); throw undefined; };
      const expectLatest = (stage: DesktopStartupSignal['stage'], event: DesktopStartupSignal['event']) => {
        expect(signals.at(-1)).toEqual({ stage, phase: 'work', event });
      };
      const statusEntered = createCompletionGate(), releaseStatus = createCompletionGate();
      const healthEntered = createCompletionGate(), releaseHealth = createCompletionGate();
      const validationEntered = createCompletionGate(), releaseValidation = createCompletionGate();
      const acceptanceEntered = createCompletionGate(), releaseAcceptance = createCompletionGate();
      const snapshotEntered = createCompletionGate(), releaseSnapshot = createCompletionGate();
      const cleanupEntered = createCompletionGate(), releaseCleanup = createCompletionGate();
      const release = () => {
        releaseStatus.resolve(); releaseHealth.resolve(); releaseValidation.resolve();
        releaseAcceptance.resolve(); releaseSnapshot.resolve(); releaseCleanup.resolve();
      };
      vi.mocked(ProfileSnapshotBrokerClient.prototype.getStatus).mockImplementationOnce(async () => {
        statusEntered.resolve(); await releaseStatus.promise; return 'normal';
      });
      const fetch = electronBoundary.fetch.getMockImplementation()!;
      electronBoundary.fetch.mockImplementationOnce(async (...args) => {
        healthEntered.resolve(); await releaseHealth.promise; return fetch(...args);
      });
      const validate = ownedProfileValidation.validateOwnedActiveProfile;
      const validation = vi.spyOn(ownedProfileValidation, 'validateOwnedActiveProfile').mockImplementation(async input => {
        const result = await validate(input);
        validationEntered.resolve(); await releaseValidation.promise;
        events.push('firstValidationCompleted');
        return result;
      });
      const clear = WorkspaceSwitchJournalStore.prototype.clearSelector;
      const cleared = vi.spyOn(WorkspaceSwitchJournalStore.prototype, 'clearSelector')
        .mockImplementation(async function (this: WorkspaceSwitchJournalStore, ...args) {
          await clear.apply(this, args);
          events.push('switchJournalCleared');
          acceptanceEntered.resolve(); await releaseAcceptance.promise;
        });
      const snapshots: string[] = [];
      const snapshot = vi.mocked(ProfileSnapshotBrokerClient.prototype.createProfileSnapshot).getMockImplementation()!;
      vi.mocked(ProfileSnapshotBrokerClient.prototype.createProfileSnapshot).mockImplementation(async function (
        this: ProfileSnapshotBrokerClient, ...args
      ) {
        snapshots.push(args[0]);
        if (snapshots.length === 2) {
          events.push('automaticSnapshotStarted');
          snapshotEntered.resolve(); await releaseSnapshot.promise;
        }
        const result = await snapshot.apply(this, args);
        if (snapshots.length === 2) events.push('automaticSnapshotCreated');
        return result;
      });
      const inspect = vi.mocked(snapshotInspection.runProfileSnapshotInspection).getMockImplementation()!;
      const inspected = vi.mocked(snapshotInspection.runProfileSnapshotInspection).mockImplementation(async input => {
        const result = await inspect(input);
        if (input.operationId === snapshots[1]) events.push('automaticSnapshotInspected');
        return result;
      });
      const remove = ProfileSnapshotInspectionClient.prototype.removeProfileSnapshot;
      const removed = vi.spyOn(ProfileSnapshotInspectionClient.prototype, 'removeProfileSnapshot')
        .mockImplementation(async function (this: ProfileSnapshotInspectionClient, id) {
          if (id === snapshots[1]) { cleanupEntered.resolve(); await releaseCleanup.promise; }
          await remove.call(this, id);
          if (id === snapshots[1]) events.push('automaticSnapshotRemoved');
        });
      vi.spyOn(ProfileSnapshotBrokerClient.prototype, 'beginMaintenance').mockResolvedValue('busy');
      const end = vi.spyOn(ProfileSnapshotBrokerClient.prototype, 'endMaintenance').mockImplementation(async () => {
        events.push('automaticFenceReleased'); return 'normal';
      });
      const automaticFailures: unknown[] = [];
      const automatic = RecoveryPointService.prototype.checkAutomatic;
      const checked = vi.spyOn(RecoveryPointService.prototype, 'checkAutomatic')
        .mockImplementation(async function (this: RecoveryPointService, ...args) {
          events.push('automaticCheckStarted');
          try { return await automatic.apply(this, args); }
          catch (error) { automaticFailures.push(error); throw error; }
          finally { events.push('automaticCheckSettled'); }
        });
      vi.mocked(RecoveryPointScheduler.prototype.start).mockRestore();
      vi.mocked(RecoveryPointScheduler.prototype.stopChecks).mockRestore();
      const createWindow = electronBoundary.createWindow.getMockImplementation()!;
      electronBoundary.createWindow.mockImplementation((...args) => {
        events.push('windowCreated'); return createWindow(...args);
      });
      const firstStart = vi.spyOn(FirstStartUpdateCoordinator.prototype, 'beforeMigrations');
      const publish = vi.spyOn(AcceptedBuildMetadataStore.prototype, 'publishSelected');
      const observed = vi.fn();
      let lifecycle: DesktopLifecycleHandle | undefined;
      context.signal.addEventListener('abort', release, { once: true });
      const startup = lifetime.step('startup', async () => {
        lifecycle = await f.fixture.start(observed, undefined, observeStartupStage);
      });
      void startup.catch(() => undefined);
      const earlyStartup = startup.then(() => { throw new Error('STARTUP_COMPLETED_BEFORE_HELD_PHASE'); });
      void earlyStartup.catch(() => undefined);
      await runRestoreStartupTestWithShutdown(async () => {
        await Promise.race([statusEntered.promise, earlyStartup]);
        expectLatest('snapshotStatus', 'entered');
        expect(validation).not.toHaveBeenCalled();
        expect(electronBoundary.createWindow).not.toHaveBeenCalled();
        releaseStatus.resolve();
        await Promise.race([healthEntered.promise, earlyStartup]);
        expectLatest('backendHealth', 'entered');
        expect(validation).not.toHaveBeenCalled();
        expect(electronBoundary.createWindow).not.toHaveBeenCalled();
        releaseHealth.resolve();
        await Promise.race([validationEntered.promise, earlyStartup]);
        expectLatest('activeProfileAdmission', 'entered');
        expect(electronBoundary.createWindow).not.toHaveBeenCalled();
        expect(cleared).not.toHaveBeenCalled();
        expect(checked).not.toHaveBeenCalled();
        expect((await journal.inspectSlots()).current?.value.state).toBe('targetSelected');
        releaseValidation.resolve();
        await Promise.race([acceptanceEntered.promise, earlyStartup]);
        expectLatest('workspaceAcceptance', 'entered');
        expect(electronBoundary.createWindow).not.toHaveBeenCalled();
        expect(checked).not.toHaveBeenCalled();
        releaseAcceptance.resolve();
        await Promise.race([snapshotEntered.promise, earlyStartup]);
        expectLatest('schedulerInitialCheck', 'entered');
        expect(events).toEqual(['firstValidationCompleted', 'switchJournalCleared',
          'automaticCheckStarted', 'automaticSnapshotStarted']);
        expect(await journal.inspectSlots()).toEqual({ current: undefined, next: undefined, backup: undefined });
        expect(electronBoundary.createWindow).not.toHaveBeenCalled();
        expect(inspected).toHaveBeenCalledOnce();
        releaseSnapshot.resolve();
        await Promise.race([cleanupEntered.promise, earlyStartup]);
        // Entered also survives rejection while the scheduler's cleanup is held.
        expectLatest('schedulerInitialCheck', 'entered');
        const duringCleanup = signals.at(-1);
        expect(events.at(-1)).toBe('automaticSnapshotInspected');
        expect(inspected).toHaveBeenCalledTimes(2);
        expect(electronBoundary.createWindow).not.toHaveBeenCalled();
        expect(end).not.toHaveBeenCalled();
        expect(automaticFailures).toEqual([]);
        expect((await stat(join(f.fixture.stagingRoot, snapshots[1]!))).isDirectory()).toBe(true);
        releaseCleanup.resolve();
        await startup;
        expectLatest('windowCreation', 'returned');
        const stages = ['snapshotReady', 'snapshotStatus', 'restoreValidation', 'restoreRelaunchHandling',
          'backendHealth', 'activeProfileAdmission', 'sessionIsolation', 'restoredAcceptance', 'workspaceAcceptance',
          'registryTransition', 'packagedFaultGate', 'buildAcceptance', 'selectorFreshness', 'migrationCompletion',
          'schedulerInitialCheck', 'windowPreparation', 'windowCreation'];
        expect(signals).toEqual(stages.flatMap(stage => ['entered', 'returned'].map(event =>
          ({ stage, phase: 'work', event }))));
        expect(duringCleanup).toEqual({ stage: 'schedulerInitialCheck', phase: 'work', event: 'entered' });
        expect(lifecycle).toBeDefined();
        expect(observed).not.toHaveBeenCalled();
        expect(validation).toHaveBeenCalledOnce();
        expect(cleared).toHaveBeenCalledOnce();
        expect(checked).toHaveBeenCalledOnce();
        expect(snapshots).toHaveLength(2);
        expect(snapshots[1]).not.toBe(snapshots[0]);
        expect(removed.mock.calls.map(([id]) => id)).toEqual(snapshots);
        expect(end).toHaveBeenCalledExactlyOnceWith(snapshots[1]);
        // The placeholder receipt exercises rejection, not recovery-point persistence.
        expect(automaticFailures).toHaveLength(1);
        expect(automaticFailures[0]).toMatchObject({ message: 'PROFILE_BACKUP_SOURCE_INVALID' });
        expect(events).toEqual(['firstValidationCompleted', 'switchJournalCleared', 'automaticCheckStarted',
          'automaticSnapshotStarted', 'automaticSnapshotCreated', 'automaticSnapshotInspected',
          'automaticSnapshotRemoved', 'automaticFenceReleased', 'automaticCheckSettled', 'windowCreated']);
        await expect(stat(join(f.fixture.stagingRoot, snapshots[1]!))).rejects.toMatchObject({ code: 'ENOENT' });
        expect(firstStart).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ pendingMigrationCount: 0 }),
          { migrationAuthority: 'update' });
        expect(WorkspaceMigrationInventoryCoordinator.prototype.inspect).not.toHaveBeenCalled();
        expect(publish).not.toHaveBeenCalled();
        expect(electronBoundary.createWindow).toHaveBeenCalledOnce();
        expect(await f.fixture.acceptedBuild.inspectSlots()).toEqual(before.metadata);
        expect(await f.fixture.updateJournal.inspectSlots()).toEqual(before.update);
        expect(await f.fixture.registry.inspect()).toEqual(before.registry);
        expect(await new WorkspaceFirstStartMigrationJournalStore({ userDataPath: f.fixture.root }).inspect()).toBeUndefined();
        expect(await readFile(f.fixture.databasePath, 'utf8')).toBe(f.fixture.originalBytes);
        expect(await readFile(f.fixture.pdfPath, 'utf8')).toBe('%PDF-1.7 original pdf');
      }, async () => {
        release(); context.signal.removeEventListener('abort', release);
        try { await startup; }
        finally { await lifecycle?.shutdown(); }
      });
    });
  });

  it.for([
    { undefinedFailure: false, cleanupFailure: false, observerThrows: false, secretDrainFalse: false, stopFalse: false },
    { undefinedFailure: false, cleanupFailure: false, observerThrows: true, secretDrainFalse: false, stopFalse: false },
    { undefinedFailure: true, cleanupFailure: false, observerThrows: true, secretDrainFalse: false, stopFalse: false },
    { undefinedFailure: true, cleanupFailure: true, observerThrows: true, secretDrainFalse: false, stopFalse: false },
    { undefinedFailure: false, cleanupFailure: false, observerThrows: true, secretDrainFalse: true, stopFalse: false },
    { undefinedFailure: false, cleanupFailure: false, observerThrows: true, secretDrainFalse: false, stopFalse: true },
  ])('preserves rejection and cleanup group-return semantics $undefinedFailure/$cleanupFailure/$observerThrows/$secretDrainFalse/$stopFalse', async (scenario, context) => {
    const lifetime = beginTrackedStartupTest(context);
    await lifetime.run(async () => {
      const f = await lifetime.step('fixturePreparation', () => createFixture(originalProfileId, {
        ownedRoots: lifetime.roots, skipRestore: true, completeStartup: true,
      }));
      const registryBefore = await f.registry.inspect();
      const original: unknown = scenario.undefinedFailure ? undefined : new Error('synthetic status failure');
      const cleanupFailure = new Error('synthetic separate cleanup failure');
      const signals: DesktopStartupSignal[] = [];
      const observeStartupStage = (signal: DesktopStartupSignal) => {
        signals.push(signal);
        if (scenario.observerThrows) throw undefined;
      };
      vi.mocked(ProfileSnapshotBrokerClient.prototype.getStatus).mockRejectedValueOnce(original);
      const drainFailures: unknown[] = [];
      if (scenario.secretDrainFalse) {
        const start = secretBrokerMain.startSecretBrokerMain;
        vi.spyOn(secretBrokerMain, 'startSecretBrokerMain').mockImplementation(options => {
          const handle = start(options);
          return { ...handle, async sealAndDrain() {
            await handle.sealAndDrain();
            drainFailures.push(cleanupFailure); throw cleanupFailure;
          } };
        });
      }
      if (scenario.stopFalse) f.stop.mockResolvedValueOnce('forced');
      const cleanupEntered = createCompletionGate(), releaseCleanup = createCompletionGate();
      const shutdown = ProfileSnapshotInspectionClient.prototype.shutdown;
      const cleanupErrors: unknown[] = [];
      vi.spyOn(ProfileSnapshotInspectionClient.prototype, 'shutdown').mockImplementationOnce(async function (
        this: ProfileSnapshotInspectionClient,
      ) {
        cleanupEntered.resolve(); await releaseCleanup.promise; await shutdown.call(this);
        if (scenario.cleanupFailure) { cleanupErrors.push(cleanupFailure); throw cleanupFailure; }
      });
      const observed = vi.fn();
      let settled = false;
      const outcome = lifetime.step('startup', () => f.start(observed, undefined, observeStartupStage)).then(
        value => { settled = true; return { status: 'fulfilled' as const, value }; },
        error => { settled = true; return { status: 'rejected' as const, error }; },
      );
      const early = outcome.then(() => { throw new Error('STARTUP_CLEANUP_NOT_HELD'); });
      void early.catch(() => undefined);
      const release = () => releaseCleanup.resolve();
      context.signal.addEventListener('abort', release, { once: true });
      await runRestoreStartupTestWithShutdown(async () => {
        await Promise.race([cleanupEntered.promise, early]);
        expect(settled).toBe(false);
        expect(observed.mock.calls[0]![0]).toBe(original);
        expect(observed.mock.calls[0]![1]).toBe('runtimeStartup');
        expect(f.stop).not.toHaveBeenCalled();
        expect(electronBoundary.createWindow).not.toHaveBeenCalled();
        const duringCleanup = signals.at(-1);
        expect(signals).toEqual([
          { phase: 'work', stage: 'snapshotReady', event: 'entered' },
          { phase: 'work', stage: 'snapshotReady', event: 'returned' },
          { phase: 'work', stage: 'snapshotStatus', event: 'entered' },
          { phase: 'failure', stage: 'startupCatch', event: 'entered' },
          { phase: 'cleanup', stage: 'secretDrain', event: 'entered' },
          { phase: 'cleanup', stage: 'secretDrain', event: 'returned' },
          { phase: 'cleanup', stage: 'schedulerStop', event: 'entered' },
          { phase: 'cleanup', stage: 'schedulerStop', event: 'returned' },
          { phase: 'cleanup', stage: 'inspectionShutdown', event: 'entered' },
        ]);
        // A caught drain failure still returns control, not cleanup authority.
        expect(drainFailures.length > 0).toBe(scenario.secretDrainFalse);
        release();
        const result = await outcome;
        expect(result.status).toBe('rejected');
        if (result.status === 'rejected') expect(result.error).toMatchObject({ message: 'DESKTOP_START_FAILED' });
        expect(observed.mock.calls[0]![0]).toBe(original);
        expect(cleanupErrors).toEqual(scenario.cleanupFailure ? [cleanupFailure] : []);
        expect(f.stop).toHaveBeenCalledOnce();
        expect(signals).toContainEqual({ phase: 'cleanup', stage: 'inspectionShutdown', event: 'returned' });
        expect(signals).toContainEqual({ phase: 'cleanup', stage: 'backendStop', event: 'returned' });
        expect(signals).toContainEqual({ phase: 'cleanup', stage: 'brokerClose', event: 'returned' });
        const blocked = scenario.cleanupFailure || scenario.secretDrainFalse || scenario.stopFalse;
        expect(signals.some(signal => signal.stage === 'recoveryHandling')).toBe(!blocked);
        expect(signals.at(-1)).toEqual({ phase: 'recovery',
          stage: blocked ? 'recoveryAdmission' : 'recoveryHandling', event: 'entered' });
        expect(signals.some(signal => signal.stage === 'snapshotStatus' && signal.event === 'returned')).toBe(false);
        expect(signals.some(signal => signal.stage === 'startupCatch' && signal.event === 'returned')).toBe(false);
        expect(signals.some(signal => signal.stage === 'recoveryHandling' && signal.event === 'returned')).toBe(false);
        expect(duringCleanup).toEqual({ phase: 'cleanup', stage: 'inspectionShutdown', event: 'entered' });
        expect(f.relaunch).not.toHaveBeenCalled();
        expect(electronBoundary.createWindow).not.toHaveBeenCalled();
        expect(await f.registry.inspect()).toEqual(registryBefore);
        expect(await readFile(f.databasePath, 'utf8')).toBe(f.originalBytes);
        expect(await readFile(f.pdfPath, 'utf8')).toBe('%PDF-1.7 original pdf');
      }, async () => {
        release(); context.signal.removeEventListener('abort', release);
        const result = await outcome;
        if (result.status === 'fulfilled') await result.value?.shutdown();
      });
    });
  });
});

function hashFixtureBytes(bytes: Buffer): string { return createHash('sha256').update(bytes).digest('hex'); }

function hasErrorCause(error: unknown, expected: Error): boolean {
  if (error === expected) return true;
  if (error instanceof AggregateError && error.errors.some(child => hasErrorCause(child, expected))) return true;
  return error instanceof Error && error.cause !== undefined && hasErrorCause(error.cause, expected);
}
