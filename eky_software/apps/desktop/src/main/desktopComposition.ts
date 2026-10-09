import { randomUUID } from 'node:crypto';
import type { StartupExceptionStage } from './startupExceptionEvidence.js';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as waitForReservationRelease } from 'node:timers/promises';

import {
  BrowserWindow,
  dialog,
  ipcMain,
  MessageChannelMain,
  net,
  safeStorage,
  session,
  shell,
  type MessageBoxOptions,
  type MessageBoxReturnValue,
  type OpenDialogOptions,
  type OpenDialogReturnValue,
  type SaveDialogOptions,
  type SaveDialogReturnValue,
} from 'electron';

import {
  createOperationalLogFolderCapability,
  type OperationalLogFolderCapability,
} from '../diagnostics/operationalLogFolderCapability.js';
import {
  createSupportBundleCapability,
  type SupportBundleCapability,
} from '../supportBundle/supportBundleCapability.js';
import { removeExpiredSupportBundleTemporaryFiles } from '../supportBundle/supportBundleFileStore.js';
import {
  createInvoicePdfPreviewWindowController,
  type InvoicePdfPreviewWindowController,
} from '../pdf/invoicePdfPreviewWindow.js';
import {
  DesktopBackendStartupStoppedError,
  startDesktopBackend,
  type DesktopBackendHandle,
  type DesktopBackendStartupControl,
  type StartDesktopBackendOptions,
} from '../runtime/backendProcess.js';
import { DesktopBackendStartupError } from '../runtime/backendStartupFailure.js';
import {
  acquireWorkspaceProcessReservation,
  readWorkspaceProcessReservationIdentity,
  WorkspaceProcessReservationError,
  type WorkspaceProcessReservation,
  type WorkspaceProcessReservationTransfer,
} from '../runtime/workspaceProcessReservation.js';
import { parseWorkspaceProcessReservationDescriptor } from '../runtime/workspaceProcessReservationDescriptor.js';
import { createDesktopRuntimeSession } from '../runtime/runtimeSession.js';
import { createDesktopProfilePaths } from '../runtime/desktopProfilePaths.js';
import { createDesktopOperationalEvent } from '../observability/createDesktopOperationalEvent.js';
import type { DesktopOperationalIdentity } from '../observability/desktopOperationalEvent.js';
import type { DesktopOperationalLogger } from '../observability/desktopOperationalLogger.js';
import { maintainDesktopIncidentIndex } from '../observability/infrastructure/desktopIncidentIndexRetention.js';
import { maintainDesktopOperationalLogs } from '../observability/infrastructure/desktopOperationalLogRetention.js';
import { DesktopIncidentIndexingOperationalLogger } from '../observability/infrastructure/jsonLineDesktopIncidentIndex.js';
import { JsonLineDesktopOperationalLogger } from '../observability/infrastructure/jsonLineDesktopOperationalLogger.js';
import { createMainSecretBrokerTransport } from '../secrets/electronSecretBrokerTransport.js';
import { startSecretBrokerMain } from '../secrets/secretBrokerMain.js';
import { SafeStorageStringProtector } from '../secrets/safeStorageStringProtector.js';
import { createInvoicePdfArchiveRuntimePaths } from '../invoicePdfArchive/invoicePdfArchivePaths.js';
import { InvoicePdfArchiveConfigStore } from '../invoicePdfArchive/invoicePdfArchiveConfig.js';
import { InvoicePdfArchiveJournalStore } from '../invoicePdfArchive/invoicePdfArchiveJournal.js';
import { InvoicePdfArchiveService } from '../invoicePdfArchive/invoicePdfArchiveService.js';
import { InvoicePdfArchiveError } from '../invoicePdfArchive/invoicePdfArchiveTypes.js';
import { createWorkspaceInvoicePdfArchiveDirectoryResolver } from '../invoicePdfArchive/workspaceInvoicePdfArchiveDirectory.js';
import { createInvoicePdfArchiveBackendLoader } from '../invoicePdfArchive/invoicePdfArchiveBackendLoader.js';
import { createInvoicePdfArchiveBrokerTransport } from '../invoicePdfArchive/electronInvoicePdfArchiveBrokerTransport.js';
import { startInvoicePdfArchiveBrokerMain } from '../invoicePdfArchive/invoicePdfArchiveBrokerMain.js';
import {
  createInvoicePdfArchiveCapability,
  type InvoicePdfArchiveCapability,
} from '../invoicePdfArchive/invoicePdfArchiveCapability.js';
import { registerElectronPermissionPolicy } from '../security/electronPermissionPolicy.js';
import {
  createApplicationWindow,
  loadApplicationWindow,
} from './applicationWindow.js';
import { registerApplicationProtocol } from './applicationProtocol.js';
import { BackendRequestQuiescence } from './backendRequestQuiescence.js';
import { readSafeStartupFailureCode } from './earlyStartup.js';
import { createBackendRequestHeaders } from './protocolPolicy.js';
import { assertW6b2PackagedUpdateWriteState } from './w6b2PackagedUpdateWriteProbe.js';
import { assertDifferentRuntimeSessionRejected } from './runtimeSessionAcceptanceValidation.js';
import {
  createInvoiceDeliveryConfirmation,
  type InvoiceDeliveryDialogAdapter,
} from './invoiceDeliveryConfirmation.js';
import {
  createPackagedSmokeSecretFileStore,
  runPackagedSmokeCheck,
  writePackagedSmokeResult,
  type PackagedSmokeConfiguration,
  type PackagedSmokeStage,
} from './packagedSmoke.js';
import {
  resolveW6b2PackagedRollbackProgressPath,
  type W6b2PackagedProofConfiguration,
  type W6b2PackagedProofResult,
} from './w6b2PackagedProof.js';
import {
  createW6b2PackagedFaultInjection,
  createW6b2PackagedHandoffProfileProtection,
} from './w6b2PackagedFaultInjection.js';
import { runW6b2PackagedFaultProofController } from './w6b2PackagedFaultProofController.js';
import { runW6b2PackagedProofController } from './w6b2PackagedProofController.js';
import { runW6b2PackagedSessionProbe } from './w6b2PackagedSessionProbe.js';
import {
  reportDesktopStarted,
  runPackagedDesktopStartupProof,
} from './desktopStartupCompletion.js';
import { restoreWindowInputFocus } from './windowInputFocus.js';
import { resolveDesktopWorkspaceStartup } from './resolveDesktopWorkspaceStartup.js';
import type { DesktopBuildInfo } from '../release/desktopBuildInfo.js';
import type { DesktopReleaseInfo } from '../release/desktopReleaseInfo.js';
import { createProfileSnapshotBrokerTransport } from '../profileBackup/electronProfileSnapshotBrokerTransport.js';
import type { BackupPasswordWindowController } from '../profileBackup/passwordWindow/backupPasswordWindow.js';
import type { ProfileBackupCapability } from '../profileBackup/profileBackupCapability.js';
import { createProfileBackupComposition } from '../profileBackup/profileBackupComposition.js';
import {
  ProfileSnapshotBrokerClient,
  ProfileSnapshotBrokerError,
} from '../profileBackup/profileSnapshotBrokerClient.js';
import { createProfileSnapshotRuntimePaths } from '../profileBackup/profileSnapshotRuntimePaths.js';
import { RecoveryPointCleanShutdownMarker } from '../profileBackup/recoveryPoint/recoveryPointCleanShutdownMarker.js';
import { RecoveryPointKeyProtector } from '../profileBackup/recoveryPoint/recoveryPointKeyProtector.js';
import { RecoveryPointRotationService } from '../profileBackup/recoveryPoint/recoveryPointRotationService.js';
import { RecoveryPointScheduler } from '../profileBackup/recoveryPoint/recoveryPointScheduler.js';
import { RecoveryPointService } from '../profileBackup/recoveryPoint/recoveryPointService.js';
import { RecoveryPointStore } from '../profileBackup/recoveryPoint/recoveryPointStore.js';
import { ProfileRestoreActivationJournalStore } from '../profileBackup/restore/profileRestoreActivationJournalStore.js';
import { ProfileRestoreActivationService } from '../profileBackup/restore/profileRestoreActivationService.js';
import { ProfileRestoreActivationTransaction } from '../profileBackup/restore/profileRestoreActivationTransaction.js';
import { RecoveryPointRestoreStagingService } from '../profileBackup/restore/recoveryPointRestoreStagingService.js';
import { ProfileRestoreStartupRecovery } from '../profileBackup/restore/profileRestoreStartupRecovery.js';
import { createProfileRecoveryOperationalObserver } from '../profileBackup/profileRecoveryOperationalObserver.js';
import {
  runPackagedEmptyArtifactSnapshotSmoke,
  runPackagedProfileBackupAfterRestore,
  runPackagedProfileBackupBeforeRestore,
  verifyPackagedRestoredDatabaseBeforeBackend,
} from '../profileBackup/packagedProfileBackupSmoke.js';
import {
  runPackagedLegacyProfileBeforeRestore,
  verifyPackagedLegacyInvoice,
} from '../profileBackup/packagedLegacyProfileSmoke.js';
import {
  createLocalUpdateFoundationComposition,
  createLocalUpdatePackageCacheComposition,
} from '../update/localUpdateFoundationComposition.js';
import type { LocalUpdateSelectionCapability } from '../update/localUpdateSelectionCapability.js';
import { createLocalUpdateRuntimePaths } from '../update/localUpdateRuntimePaths.js';
import { DirectSetupMigrationRecoveryStore } from '../update/directSetupMigrationRecoveryStore.js';
import { migrateLegacyLocalUpdateState } from '../update/migrateLegacyLocalUpdateState.js';
import { AcceptedBuildMetadataStore } from '../update/acceptedBuildMetadataStore.js';
import {
  PreWorkspaceBuildAdmissionError,
  requirePreWorkspaceBuildAdmission,
} from '../update/preWorkspaceBuildAdmission.js';
import { readEncryptedSecretStorageIdentity } from '../update/encryptedSecretStorageIdentity.js';
import { FirstStartUpdateCoordinator } from '../update/firstStartUpdateCoordinator.js';
import { createProfileProtectionComposition } from '../update/profileProtectionComposition.js';
import { UpdateJournalStore } from '../update/updateJournalStore.js';
import { readUpdateProtectedRecoveryPointReferences } from '../update/updateRecoveryPointProtection.js';
import { createUpdateOperationalObserver } from '../update/updateOperationalObserver.js';
import { LocalUpdateHandoffCoordinator } from '../update/localUpdateHandoffCoordinator.js';
import { confirmLocalUpdateWithNativeDialog } from '../update/localUpdateConfirmation.js';
import { UpdateBusinessRollbackCoordinator } from '../update/updateBusinessRollbackCoordinator.js';
import { UpdateBinaryRollbackCoordinator } from '../update/updateBinaryRollbackCoordinator.js';
import {
  resolveStartupRecoveryAuthority,
  StartupRecoveryAuthorityConflictError,
} from '../update/startupRecoveryAuthority.js';
import { launchWindowsInstallerForUpdate } from '../update/windowsInstallerHandoff.js';
import { launchWindowsInstallerRollback } from '../update/windowsInstallerRollbackHandoff.js';
import { createUpdateRecoveryComposition } from '../update/recoveryWindow/updateRecoveryComposition.js';
import {
  resolveActiveWorkspaceStartup,
  type ActiveWorkspaceStartupSelection,
} from '../workspaces/runtime/resolveActiveWorkspaceStartup.js';
import { WorkspaceSwitchError } from '../workspaces/switch/workspaceSwitchError.js';
import { InMemoryWorkspaceMaintenanceLease } from '../workspaces/maintenance/workspaceMaintenanceLease.js';
import { deriveWorkspaceBackupReplacementRuntimePaths } from '../workspaces/replacement/workspaceBackupReplacementPaths.js';
import { createWorkspaceBackupReplacementStartupRecovery } from '../workspaces/replacement/workspaceBackupReplacementStartupRecovery.js';
import { createWorkspaceManagementComposition, recoverWorkspaceManagementBeforeRuntime } from '../workspaces/management/workspaceManagementComposition.js';
import { WorkspaceManagementRecoveryRequiredError } from '../workspaces/management/workspaceManagementOperationGuard.js';
import { readColdWorkspaceRecoveryAdmissionFromRoot } from '../workspaces/runtime/workspaceColdRecoveryAdmissionComposition.js';
import {
  createWorkspaceManagementCapability,
  type WorkspaceManagementCapability,
} from '../workspaces/management/workspaceManagementCapability.js';
import { confirmActiveWorkspaceReplacement } from '../workspaces/management/workspaceReplacementConfirmation.js';
import { DeferredWorkspaceRuntimeRelaunch } from '../workspaces/runtime/deferredWorkspaceRuntimeRelaunch.js';
import {
  MainOwnedActiveWorkspaceLifecycle,
  WorkspaceRuntimeStopError,
} from '../workspaces/runtime/mainOwnedActiveWorkspaceLifecycle.js';
import { createWorkspaceFirstStartMigrationComposition } from '../workspaces/update/workspaceFirstStartMigrationComposition.js';
import { WorkspaceFirstStartMigrationOrchestratorError } from '../workspaces/update/workspaceFirstStartMigrationOrchestratorError.js';
import type { WorkspaceFirstStartMigrationOrchestration } from '../workspaces/update/workspaceFirstStartMigrationOrchestratorTypes.js';
import { createWorkspaceActivationMigrationComposition } from '../workspaces/update/workspaceActivationMigrationComposition.js';
import type { WorkspaceCandidateReservationOwner } from '../workspaces/runtime/electronWorkspaceCandidateRuntimeFactory.js';

export interface DesktopLifecycleHandle {
  applicationWindow: BrowserWindow;
  focusApplicationWindow(): void;
  shutdown(): Promise<void>;
}

export interface DesktopCompositionDependencies {
  createRuntimeSession(): string;
  openPath(path: string): Promise<string>;
  showErrorBox(title: string, message: string): void;
  showMessageBox(
    owner: BrowserWindow | undefined,
    options: MessageBoxOptions,
  ): Promise<MessageBoxReturnValue>;
  showOpenDialog(
    owner: BrowserWindow,
    options: OpenDialogOptions,
  ): Promise<OpenDialogReturnValue>;
  showSaveDialog(
    owner: BrowserWindow,
    options: SaveDialogOptions,
  ): Promise<SaveDialogReturnValue>;
  startBackend(
    options: StartDesktopBackendOptions,
  ): Promise<DesktopBackendHandle>;
  resolveActiveWorkspace(
    userDataRoot: string,
  ): Promise<Readonly<ActiveWorkspaceStartupSelection>>;
}

export interface StartDesktopCompositionOptions {
  assertSingleInstanceOwnership(): void;
  appVersion: string;
  applicationPath: string;
  buildInfo: Readonly<DesktopBuildInfo>;
  releaseInfo: Readonly<DesktopReleaseInfo> | undefined;
  dependencies?: Partial<DesktopCompositionDependencies>;
  quitApplication(): void;
  relaunchApplication(): void;
  resourcesPath: string;
  runtimeInstanceId: string;
  reportSmokeStage(stage: PackagedSmokeStage): Promise<void>;
  smokeConfiguration: PackagedSmokeConfiguration;
  userDataPath: string;
  observeStartupException?(error: unknown, stage: StartupExceptionStage, secrets?: readonly string[]): void;
  w6b2PackagedProof?: Readonly<{
    configuration: Readonly<W6b2PackagedProofConfiguration>;
    interruptProcess(
      configuration: Extract<
        W6b2PackagedProofConfiguration,
        { readonly controlFormatVersion: 2 }
      >,
    ): Promise<never>;
    isQuitRequested(): boolean;
    isRelaunchRequested(): boolean;
    reportResult(result: W6b2PackagedProofResult): Promise<void>;
  }>;
}

const defaultDesktopCompositionDependencies: DesktopCompositionDependencies = {
  createRuntimeSession: createDesktopRuntimeSession,
  openPath: (path) => shell.openPath(path),
  showErrorBox(title, message) {
    dialog.showErrorBox(title, message);
  },
  showMessageBox(owner, options) {
    return owner === undefined || owner.isDestroyed()
      ? dialog.showMessageBox(options)
      : dialog.showMessageBox(owner, options);
  },
  showOpenDialog: (owner, options) => dialog.showOpenDialog(owner, options),
  showSaveDialog: (owner, options) => dialog.showSaveDialog(owner, options),
  startBackend: startDesktopBackend,
  resolveActiveWorkspace: resolveActiveWorkspaceStartup,
};

const reservationReclaimPollMilliseconds = 10;

/** One installation owner; process senders retain their existing exit/deadline duties. */
export async function acquireDesktopWorkspaceReservation(options: {
  readonly userDataRoot: string;
  readonly assertSingleInstanceOwnership: () => void;
  readonly signal: AbortSignal;
}) {
  options.assertSingleInstanceOwnership();
  let held: WorkspaceProcessReservation | undefined =
    await acquireWorkspaceProcessReservation(options);
  const identity = held.identity;
  type TransferPhase = 'bound' | 'preparing' | 'released' | 'authorizing' | 'authorized' | 'granted' | 'reclaiming';
  let active: { phase: TransferPhase; pending: boolean } | undefined;
  let invalid = false;
  let closing = false;
  let closeTask: Promise<void> | undefined;
  const fail = () => new WorkspaceProcessReservationError('lost');
  const invalidate = () => { invalid = true; };
  const assertMainInstance = () => {
    if (invalid || closing) throw fail();
    try { options.assertSingleInstanceOwnership(); }
    catch { invalidate(); throw fail(); }
  };
  let removeLossListener = () => {};
  const observeHeld = (reservation: WorkspaceProcessReservation) => {
    const lost = () => { if (held === reservation) invalidate(); };
    reservation.invalidated.addEventListener('abort', lost, { once: true });
    removeLossListener = () => reservation.invalidated.removeEventListener('abort', lost);
    if (reservation.invalidated.aborted) lost();
  };
  observeHeld(held);
  try {
    if (options.signal.aborted) throw new WorkspaceProcessReservationError('aborted');
    assertMainInstance();
  }
  catch (error) {
    removeLossListener();
    await held.release();
    throw error;
  }

  const assertMainOwned = async () => {
    assertMainInstance();
    const reservation = held;
    if (active !== undefined || reservation === undefined) throw fail();
    try { await reservation.assertOwned(); }
    catch { invalidate(); throw fail(); }
    assertMainInstance();
    if (active !== undefined || held !== reservation) throw fail();
  };

  return Object.freeze({
    assertMainOwned,
    invalidate,
    bind(generationId: string, assertAuthority: () => void): WorkspaceProcessReservationTransfer {
      assertMainInstance();
      if (active !== undefined || held === undefined) throw fail();
      const descriptor = parseWorkspaceProcessReservationDescriptor({
        generationId, identity, userDataRoot: options.userDataRoot,
      });
      if (descriptor === undefined) throw fail();
      assertAuthority();
      const transfer = { phase: 'bound' as TransferPhase, pending: false };
      active = transfer;
      let grantSignal: AbortSignal | undefined;
      const assertTransfer = () => {
        assertMainInstance();
        if (active !== transfer) throw fail();
      };
      const assertSignal = (signal: AbortSignal) => {
        assertTransfer();
        if (signal.aborted) throw new WorkspaceProcessReservationError('aborted');
      };
      const assertAuthorityCurrent = () => {
        assertTransfer();
        try { assertAuthority(); }
        catch { invalidate(); throw fail(); }
      };
      const assertIdentity = async () => {
        try {
          if (await readWorkspaceProcessReservationIdentity(options.userDataRoot) !== identity) throw fail();
        } catch { invalidate(); throw fail(); }
        assertTransfer();
      };
      return Object.freeze({
        descriptor,
        async prepare(signal: AbortSignal) {
          assertSignal(signal);
          if (transfer.phase !== 'bound' || held === undefined) { invalidate(); throw fail(); }
          const reservation = held;
          transfer.phase = 'preparing';
          transfer.pending = true;
          try {
            assertAuthorityCurrent();
            try { await reservation.assertOwned(); }
            catch { invalidate(); throw fail(); }
            assertSignal(signal);
            assertAuthorityCurrent();
            removeLossListener();
            try { await reservation.release(); }
            catch { invalidate(); throw fail(); }
            held = undefined;
            assertTransfer();
            transfer.phase = 'released';
            assertSignal(signal);
            assertAuthorityCurrent();
          } finally { transfer.pending = false; }
        },
        async assertGrant(signal: AbortSignal) {
          assertSignal(signal);
          if (transfer.phase !== 'released') { invalidate(); throw fail(); }
          transfer.phase = 'authorizing';
          transfer.pending = true;
          try {
            assertAuthorityCurrent();
            await assertIdentity();
            assertSignal(signal);
            assertAuthorityCurrent();
            grantSignal = signal;
            transfer.phase = 'authorized';
          } finally { transfer.pending = false; }
        },
        assertCurrent() {
          assertTransfer();
          if (transfer.phase !== 'authorized' || grantSignal === undefined) { invalidate(); throw fail(); }
          assertSignal(grantSignal);
          assertAuthorityCurrent();
          transfer.phase = 'granted';
        },
        async reclaimAfterExit(signal: AbortSignal) {
          assertSignal(signal);
          if (transfer.pending || transfer.phase === 'reclaiming') { invalidate(); throw fail(); }
          transfer.phase = 'reclaiming';
          try {
            if (held === undefined) {
              let reclaimed: WorkspaceProcessReservation;
              // Native pipe release can lag the child's exit notification. Ownership
              // is still absent until a real acquisition within the caller's deadline.
              for (;;) {
                assertSignal(signal);
                try {
                  reclaimed = await acquireWorkspaceProcessReservation({
                    userDataRoot: options.userDataRoot, expectedIdentity: identity, signal,
                  });
                  break;
                } catch (error) {
                  if (!(error instanceof WorkspaceProcessReservationError)
                    || error.reason !== 'busy' || error.cleanupFailed) throw error;
                  await waitForReservationRelease(reservationReclaimPollMilliseconds, undefined, { signal });
                }
              }
              // A cancelled acquisition cannot publish ownership or touch a later owner.
              try { assertSignal(signal); }
              catch {
                await reclaimed.release();
                throw fail();
              }
              held = reclaimed;
              observeHeld(reclaimed);
            }
            await held.assertOwned();
            assertSignal(signal);
            active = undefined;
          } catch { invalidate(); throw fail(); }
        },
        invalidate() {
          if (active === transfer) invalidate();
        },
      });
    },
    close(): Promise<void> {
      if (closeTask !== undefined) return closeTask;
      if (active !== undefined || invalid || held === undefined) return Promise.reject(fail());
      closing = true;
      const reservation = held;
      removeLossListener();
      closeTask = Promise.resolve().then(() => reservation.release()).then(() => { held = undefined; });
      return closeTask;
    },
  });
}

type DesktopWorkspaceReservation = Awaited<ReturnType<typeof acquireDesktopWorkspaceReservation>>;

export async function startDesktopComposition(
  options: StartDesktopCompositionOptions,
): Promise<DesktopLifecycleHandle | undefined> {
  const dependencies = {
    ...defaultDesktopCompositionDependencies,
    ...options.dependencies,
  };
  const smokeMode = options.smokeConfiguration.enabled;
  const backendRoot = join(options.resourcesPath, 'backend');
  const installationRuntimeRoot = createDesktopProfilePaths(
    options.userDataPath,
  ).runtimeRoot;
  const operationalLogsRoot = join(installationRuntimeRoot, 'logs');
  const retention = maintainDesktopOperationalLogs({
    logsRoot: operationalLogsRoot,
  });
  maintainDesktopIncidentIndex({ logsRoot: operationalLogsRoot });
  const desktopOperationalLogger =
    new DesktopIncidentIndexingOperationalLogger(
      new JsonLineDesktopOperationalLogger({
        logsRoot: operationalLogsRoot,
      }),
      operationalLogsRoot,
    );
  const desktopStartedAt = Date.now();
  const desktopAppVersion = options.appVersion;
  const desktopOperationalIdentity = {
    appVersion: desktopAppVersion,
    buildRevision: options.buildInfo.buildRevision,
    runtimeInstanceId: options.runtimeInstanceId,
  } as const;

  let startupSessionSecret: string | undefined;
  let reservation: DesktopWorkspaceReservation | undefined;
  let startupActive = true;
  const assertStartupAuthority = () => {
    if (!startupActive) throw new WorkspaceProcessReservationError('lost');
    options.assertSingleInstanceOwnership();
  };
  const workspaceMaintenanceLease = new InMemoryWorkspaceMaintenanceLease();

  try {
    await mkdir(options.userDataPath, { recursive: true });
    reservation = await acquireDesktopWorkspaceReservation({
      userDataRoot: options.userDataPath,
      assertSingleInstanceOwnership: options.assertSingleInstanceOwnership,
      signal: new AbortController().signal,
    });
    const workspaceReservation = reservation;
    const startupReservationOwner: WorkspaceCandidateReservationOwner = {
      bindCandidate: ({ generationId }) => workspaceReservation.bind(generationId, assertStartupAuthority),
    };
    await workspaceReservation.assertMainOwned();
    desktopOperationalLogger.write(
      createDesktopOperationalEvent(
        { eventName: 'desktop.starting' },
        desktopOperationalIdentity,
      ),
    );
    desktopOperationalLogger.write(
      createDesktopOperationalEvent(
        {
          deletedByteCount: retention.deletedByteCount,
          deletedFileCount: retention.deletedFileCount,
          eventName: 'operationalLog.retentionCompleted',
          ...(retention.oldestRemainingMonth === undefined
            ? {}
            : { oldestRemainingMonth: retention.oldestRemainingMonth }),
        },
        desktopOperationalIdentity,
      ),
    );
    const coldRecoveryAdmission = await readColdWorkspaceRecoveryAdmissionFromRoot(options.userDataPath);
    const installationUpdateState = await createInstallationUpdateState({
      installationRuntimeRoot,
      userDataPath: options.userDataPath,
    });
    const preWorkspaceBuildAdmission = await requirePreWorkspaceBuildAdmission({
      buildInfo: options.buildInfo,
      releaseInfo: options.releaseInfo,
      stores: {
        acceptedBuild: installationUpdateState.acceptedBuildMetadataStore,
        directSetupRecovery:
          installationUpdateState.directSetupMigrationRecoveryStore,
        journal: installationUpdateState.updateJournalStore,
      },
    });
    await recoverWorkspaceManagementBeforeRuntime({
      admission: coldRecoveryAdmission,
      async assertRecoveryAdmission() {
        assertStartupAuthority();
        await workspaceReservation.assertMainOwned();
        if (await readColdWorkspaceRecoveryAdmissionFromRoot(options.userDataPath) !== coldRecoveryAdmission) {
          throw new WorkspaceManagementRecoveryRequiredError();
        }
        assertStartupAuthority();
      },
      appVersion: desktopAppVersion,
      buildRevision: options.buildInfo.buildRevision,
      maintenanceLease: workspaceMaintenanceLease,
      reservationOwner: {
        bindCandidate: ({ generationId }) => {
          const assertLease = workspaceMaintenanceLease.captureCurrentOwner(['create', 'import']);
          return workspaceReservation.bind(generationId, () => {
            assertStartupAuthority();
            assertLease();
          });
        },
      },
      resourcesPath: options.resourcesPath,
      userDataRoot: options.userDataPath,
      workspaceRuntimeAbsence: {
        async assertNoActiveWorkspaceRuntime() {
          assertStartupAuthority();
          await workspaceReservation.assertMainOwned();
        },
      },
    });
    const workspaceFirstStartMigration =
      createWorkspaceFirstStartMigrationComposition({
        acceptedBuildStore:
          installationUpdateState.acceptedBuildMetadataStore,
        admission: preWorkspaceBuildAdmission,
        buildInfo: options.buildInfo,
        directSetupRecoveryStore:
          installationUpdateState.directSetupMigrationRecoveryStore,
        releaseInfo: options.releaseInfo,
        resourcesPath: options.resourcesPath,
        reservationOwner: startupReservationOwner,
        updateJournalStore: installationUpdateState.updateJournalStore,
        userDataRoot: options.userDataPath,
      });
    await workspaceFirstStartMigration.recoverBeforeWorkspaceResolution();
    const workspaceStartup = await resolveDesktopWorkspaceStartup({
      createRuntimeSession: dependencies.createRuntimeSession,
      relaunchApplication: options.relaunchApplication,
      resolveActiveWorkspace: dependencies.resolveActiveWorkspace,
      userDataRoot: options.userDataPath,
    });
    if (workspaceStartup.status === 'relaunching') {
      await workspaceReservation.close();
      return undefined;
    }
    const { activeWorkspace, runtimeSessionSecret } = workspaceStartup;
    startupSessionSecret = runtimeSessionSecret;
    await workspaceFirstStartMigration.prepareBeforeBackend({
      activeWorkspaceId: activeWorkspace.workspaceId,
      workspaceState:
        activeWorkspace.mode === 'adoption'
          ? 'legacyAdoptionPendingAcceptance'
          : 'publishedRegistry',
    });
    const lifecycle = await startDesktopCompositionRuntime({
      activeWorkspace,
      backendRoot,
      desktopAppVersion,
      desktopOperationalIdentity,
      desktopOperationalLogger,
      desktopStartedAt,
      installationRuntimeRoot,
      installationUpdateState,
      operationalLogsRoot,
      options,
      dependencies,
      runtimeSessionSecret,
      smokeMode,
      workspaceFirstStartMigration,
      workspaceMaintenanceLease,
      workspaceReservation,
      startupReservationOwner,
      assertStartupAuthority,
    });
    if (lifecycle === undefined) {
      await workspaceReservation.close();
      return undefined;
    }
    let shutdown: Promise<void> | undefined;
    return {
      applicationWindow: lifecycle.applicationWindow,
      focusApplicationWindow: () => lifecycle.focusApplicationWindow(),
      shutdown() {
        shutdown ??= Promise.resolve().then(async () => {
          await lifecycle.shutdown();
          await workspaceReservation.close();
        });
        return shutdown;
      },
    };
  } catch (error) {
    // Closing refuses unresolved transfers; their reservation stays held until exit.
    await reservation?.close().catch(() => undefined);
    try { options.observeStartupException?.(error, 'compositionStartup', startupSessionSecret === undefined ? [] : [startupSessionSecret]); } catch { /* Optional private evidence. */ }
    const errorCode = readSafeStartupFailureCode(error);
    try {
      desktopOperationalLogger.write(
        createDesktopOperationalEvent(
          {
            errorCode,
            eventName: 'desktop.bootstrapFailed',
            retryable: false,
            sideEffectState:
              error instanceof PreWorkspaceBuildAdmissionError
                ? 'none'
                : 'unknown',
            stage:
              error instanceof PreWorkspaceBuildAdmissionError
                ? 'preWorkspaceBuildAdmission'
                : error instanceof WorkspaceFirstStartMigrationOrchestratorError
                  ? 'workspaceFirstStartMigration'
                : 'startup',
          },
          desktopOperationalIdentity,
        ),
      );
    } catch {
      // The safe outer bootstrap boundary remains authoritative.
    }
    if (
      error instanceof WorkspaceFirstStartMigrationOrchestratorError &&
      error.relaunchRequired
    ) {
      options.relaunchApplication();
      return undefined;
    }
    throw new Error(errorCode);
  } finally {
    startupActive = false;
  }
}

interface DesktopCompositionRuntimeOptions {
  activeWorkspace: Readonly<ActiveWorkspaceStartupSelection>;
  backendRoot: string;
  desktopAppVersion: string;
  desktopOperationalIdentity: DesktopOperationalIdentity;
  desktopOperationalLogger: DesktopOperationalLogger;
  desktopStartedAt: number;
  dependencies: DesktopCompositionDependencies;
  installationRuntimeRoot: string;
  installationUpdateState: InstallationUpdateState;
  operationalLogsRoot: string;
  options: StartDesktopCompositionOptions;
  runtimeSessionSecret: string;
  smokeMode: boolean;
  workspaceFirstStartMigration: WorkspaceFirstStartMigrationOrchestration;
  workspaceMaintenanceLease: InMemoryWorkspaceMaintenanceLease;
  workspaceReservation: DesktopWorkspaceReservation;
  startupReservationOwner: WorkspaceCandidateReservationOwner;
  assertStartupAuthority(): void;
}

interface InstallationUpdateState {
  acceptedBuildMetadataStore: AcceptedBuildMetadataStore;
  directSetupMigrationRecoveryStore: DirectSetupMigrationRecoveryStore;
  localUpdateRuntimePaths: ReturnType<typeof createLocalUpdateRuntimePaths>;
  updateJournalStore: UpdateJournalStore;
}

async function createInstallationUpdateState(input: {
  installationRuntimeRoot: string;
  userDataPath: string;
}): Promise<InstallationUpdateState> {
  const localUpdateRuntimePaths = createLocalUpdateRuntimePaths({
    legacyRuntimeRoot: input.installationRuntimeRoot,
    userDataPath: input.userDataPath,
  });
  const updateJournalStore = new UpdateJournalStore(
    localUpdateRuntimePaths.journalPath,
  );
  const acceptedBuildMetadataStore = new AcceptedBuildMetadataStore(
    localUpdateRuntimePaths.acceptedBuildMetadataPath,
  );
  const directSetupMigrationRecoveryStore =
    new DirectSetupMigrationRecoveryStore(
      localUpdateRuntimePaths.directSetupMigrationRecoveryPath,
    );
  await migrateLegacyLocalUpdateState({
    acceptedBuild: {
      current: acceptedBuildMetadataStore,
      legacy: new AcceptedBuildMetadataStore(
        localUpdateRuntimePaths.legacyAcceptedBuildMetadataPath,
      ),
    },
    journal: {
      current: updateJournalStore,
      legacy: new UpdateJournalStore(
        localUpdateRuntimePaths.legacyJournalPath,
      ),
    },
  });
  return {
    acceptedBuildMetadataStore,
    directSetupMigrationRecoveryStore,
    localUpdateRuntimePaths,
    updateJournalStore,
  };
}

async function startDesktopCompositionRuntime({
  activeWorkspace,
  backendRoot,
  desktopAppVersion,
  desktopOperationalIdentity,
  desktopOperationalLogger,
  desktopStartedAt,
  dependencies,
  installationRuntimeRoot,
  installationUpdateState,
  operationalLogsRoot,
  options,
  runtimeSessionSecret,
  smokeMode,
  workspaceFirstStartMigration,
  workspaceMaintenanceLease,
  workspaceReservation,
  startupReservationOwner,
  assertStartupAuthority,
}: DesktopCompositionRuntimeOptions): Promise<
  DesktopLifecycleHandle | undefined
> {
  const startupExceptionObservation = options.observeStartupException === undefined ? {} : {
    observeStartupException: (error: unknown) =>
      options.observeStartupException?.(error, 'runtimeStartup', [runtimeSessionSecret]),
  };
  const workspaceProfilePaths = createDesktopProfilePaths(
    activeWorkspace.workspaceRoot,
  );
  const {
    databaseFilePath,
    invoiceDocumentStorageRoot,
    runtimeRoot: workspaceRuntimeRoot,
  } = workspaceProfilePaths;
  const profileSnapshotPaths = createProfileSnapshotRuntimePaths(
    workspaceRuntimeRoot,
  );
  const backendRequestQuiescence = new BackendRequestQuiescence();
  const workspaceRuntimeRelaunch = new DeferredWorkspaceRuntimeRelaunch(
    options.relaunchApplication,
  );
  const w6b2PackagedFaultInjection =
    options.w6b2PackagedProof === undefined
      ? undefined
      : createW6b2PackagedFaultInjection({
          configuration: options.w6b2PackagedProof.configuration,
          interruptProcess: options.w6b2PackagedProof.interruptProcess,
        });
  const {
    acceptedBuildMetadataStore,
    directSetupMigrationRecoveryStore,
    localUpdateRuntimePaths,
    updateJournalStore,
  } = installationUpdateState;
  const profileRecoveryOperationalObserver =
    createProfileRecoveryOperationalObserver({
      operationalIdentity: desktopOperationalIdentity,
      operationalLogger: desktopOperationalLogger,
    });
  const profileRestoreActivationJournalStore =
    new ProfileRestoreActivationJournalStore(
      profileSnapshotPaths.restoreActivationJournalPath,
    );
  const profileRestoreActivationTransaction =
    new ProfileRestoreActivationTransaction({
      journalStore: profileRestoreActivationJournalStore,
      paths: {
        activeDatabasePath: databaseFilePath,
        activeDocumentsRoot: invoiceDocumentStorageRoot,
        failedRoot: profileSnapshotPaths.restoreFailedRoot,
        rollbackRoot: profileSnapshotPaths.restoreRollbackRoot,
        stagingRoot: profileSnapshotPaths.stagingRoot,
      },
    });
  const profileRestoreStartupRecovery =
    new ProfileRestoreStartupRecovery({
      journalStore: profileRestoreActivationJournalStore,
      observer: profileRecoveryOperationalObserver,
      transaction: profileRestoreActivationTransaction,
    });
  const workspaceReplacementStartupRecovery =
    createWorkspaceBackupReplacementStartupRecovery({
      observer: profileRecoveryOperationalObserver,
      paths: deriveWorkspaceBackupReplacementRuntimePaths(
        options.userDataPath,
        activeWorkspace.workspaceId,
      ),
    });
  const secretFilePath = join(
    workspaceRuntimeRoot,
    'secrets',
    'company-email-smtp-v1.dat',
  );
  const encryptedSecretFile = createPackagedSmokeSecretFileStore(
    secretFilePath,
    smokeMode,
  );
  const smokePdfPath = join(
    installationRuntimeRoot,
    'smoke',
    'approved-invoice-smoke.pdf',
  );
  const smokeSupportBundlePath =
    smokeMode && options.smokeConfiguration.root !== undefined
      ? join(
          options.smokeConfiguration.root,
          'support-bundle',
          'packaged-smoke.json.gz',
        )
      : undefined;
  const secretBrokerChannel = new MessageChannelMain();
  const invoicePdfArchiveBrokerChannel = new MessageChannelMain();
  const profileSnapshotBrokerChannel = new MessageChannelMain();
  const profileSnapshotBrokerClient = new ProfileSnapshotBrokerClient(
    createProfileSnapshotBrokerTransport(profileSnapshotBrokerChannel.port1),
  );
  const safeStorageStringProtector = new SafeStorageStringProtector(
    safeStorage,
  );
  const recoveryPointStore = new RecoveryPointStore({
    keyProtector: new RecoveryPointKeyProtector(
      safeStorageStringProtector,
    ),
    quarantineRoot: profileSnapshotPaths.quarantineRoot,
    recoveryRoot: profileSnapshotPaths.recoveryPointsRoot,
    stagingRoot: profileSnapshotPaths.stagingRoot,
    validator: profileSnapshotBrokerClient,
  });
  const recoveryPointRotation = new RecoveryPointRotationService({
    readDurableProtectedArtifactIds: () =>
      readUpdateProtectedRecoveryPointReferences(
        updateJournalStore,
        directSetupMigrationRecoveryStore,
      ),
    recoveryRoot: profileSnapshotPaths.recoveryPointsRoot,
    store: recoveryPointStore,
  });
  const recoveryPointService = new RecoveryPointService({
    appVersion: desktopAppVersion,
    observer: profileRecoveryOperationalObserver,
    profileSnapshotClient: profileSnapshotBrokerClient,
    rotation: recoveryPointRotation,
    stagingRoot: profileSnapshotPaths.stagingRoot,
    store: recoveryPointStore,
  });
  const recoveryPointScheduler = new RecoveryPointScheduler({
    cleanShutdownMarker: new RecoveryPointCleanShutdownMarker(
      profileSnapshotPaths.recoveryPointCleanShutdownMarkerPath,
    ),
    observer: profileRecoveryOperationalObserver,
    recoveryPointService,
    maintenanceLease: workspaceMaintenanceLease,
  });
  let backendStartupControl: DesktopBackendStartupControl | undefined;
  let updateRecoveryRelaunchRequested = false;
  let updateBinaryRollbackHandoffRequested = false;
  let workspaceActivationMigrationRelaunchRequested = false;
  const recoveryPointRestoreStagingService =
    new RecoveryPointRestoreStagingService({
      store: recoveryPointStore,
    });
  const updateRestoreActivationService =
    new ProfileRestoreActivationService({
      observer: profileRecoveryOperationalObserver,
      profileSnapshotClient: profileSnapshotBrokerClient,
      relaunchApplication() {
        updateRecoveryRelaunchRequested = true;
        options.relaunchApplication();
      },
      stagingService: recoveryPointRestoreStagingService,
      async stopBusinessRuntime() {
        if (backendStartupControl === undefined) {
          throw new Error('UPDATE_ROLLBACK_RUNTIME_UNAVAILABLE');
        }
        await backendStartupControl.stopStartupRuntime();
      },
      transaction: profileRestoreActivationTransaction,
    });
  const updateProfileProtection = createProfileProtectionComposition({
    directSetupRecoveryStore: directSetupMigrationRecoveryStore,
    profileSnapshotClient: profileSnapshotBrokerClient,
    recoveryPointService,
    async restoreRecoveryPoint(input) {
      await recoveryPointRestoreStagingService.stage({
        artifactId: input.recoveryPointReference,
        expectedMigrationChainIdentity:
          input.expectedMigrationChainIdentity,
        operationId: input.operationId,
      });
      return updateRestoreActivationService.activate(input.operationId);
    },
    updateJournalStore,
  });
  const handoffProfileProtection =
    createW6b2PackagedHandoffProfileProtection(
      updateProfileProtection,
      w6b2PackagedFaultInjection,
    );
  const localUpdatePackageCache =
    options.releaseInfo === undefined
      ? undefined
      : createLocalUpdatePackageCacheComposition({
          releaseInfo: options.releaseInfo,
          resourcesPath: options.resourcesPath,
          systemRoot: process.env.SystemRoot,
          userDataPath: options.userDataPath,
        });
  const updateObserver = createUpdateOperationalObserver({
    identity: desktopOperationalIdentity,
    logger: desktopOperationalLogger,
  });
  const firstStartUpdateCoordinator =
    options.releaseInfo === undefined || localUpdatePackageCache === undefined
      ? undefined
      : new FirstStartUpdateCoordinator({
          acceptedBuildStore: acceptedBuildMetadataStore,
          buildInfo: options.buildInfo,
          cache: localUpdatePackageCache,
          directSetupRecoveryStore: directSetupMigrationRecoveryStore,
          journalStore: updateJournalStore,
          observer: updateObserver,
          ...startupExceptionObservation,
          profileProtection: updateProfileProtection,
          readSecretStorageIdentity: () =>
            readEncryptedSecretStorageIdentity(encryptedSecretFile),
          releaseInfo: options.releaseInfo,
        });
  const updateBusinessRollbackCoordinator =
    options.releaseInfo === undefined
      ? undefined
      : new UpdateBusinessRollbackCoordinator({
          journalStore: updateJournalStore,
          observer: updateObserver,
          profileProtection: updateProfileProtection,
          releaseInfo: options.releaseInfo,
        });
  const updateBinaryRollbackCoordinator =
    options.releaseInfo === undefined || localUpdatePackageCache === undefined
      ? undefined
      : new UpdateBinaryRollbackCoordinator({
          cache: localUpdatePackageCache,
          journalStore: updateJournalStore,
          launchInstaller: ({ failedPackage, rollbackPackage }) =>
            Promise.resolve().then(() => {
              w6b2PackagedFaultInjection?.failBinaryRollbackLaunchIfRequested();
              const progressFilePath =
                resolveW6b2PackagedRollbackProgressPath(
                  options.w6b2PackagedProof?.configuration,
                );
              return launchWindowsInstallerRollback({
                failedPackagePath: failedPackage.packagePath,
                failedProductCode: failedPackage.productCode,
                launcherProcessId: process.pid,
                ...(progressFilePath === undefined
                  ? {}
                  : { progressFilePath }),
                rollbackPackagePath: rollbackPackage.packagePath,
                rollbackScriptPath: join(
                  options.resourcesPath,
                  'update-runtime',
                  'rollbackWindowsInstaller.ps1',
                ),
                systemRoot: process.env.SystemRoot,
              });
            }),
          observer: updateObserver,
          releaseInfo: options.releaseInfo,
        });
  let applicationWindow: BrowserWindow | undefined;
  let pdfPreviewController: InvoicePdfPreviewWindowController | undefined;
  let operationalLogFolderCapability:
    | OperationalLogFolderCapability
    | undefined;
  let invoicePdfArchiveCapability:
    | InvoicePdfArchiveCapability
    | undefined;
  let supportBundleCapability: SupportBundleCapability | undefined;
  let localUpdateSelectionCapability:
    | LocalUpdateSelectionCapability
    | undefined;
  let backupPasswordWindowController:
    | BackupPasswordWindowController
    | undefined;
  let profileBackupCapability: ProfileBackupCapability | undefined;
  let workspaceManagementCapability:
    | WorkspaceManagementCapability
    | undefined;
  let shutdownStarted = false;
  let shutdownTask: Promise<void> | undefined;
  let workspaceStartupAccepted = false;
  let targetBuildAccepted = false;
  let restoredProfileAwaitingDecision = false;
  let restoredProfileTransactionCommitted = false;
  let workspaceReplacementRecoveryAmbiguous = false;

  await Promise.all(
    [
      profileSnapshotPaths.quarantineRoot,
      profileSnapshotPaths.stagingRoot,
    ].map((path) =>
      mkdir(path, {
        mode: 0o700,
        recursive: true,
      }),
    ),
  );
  const [
    pendingProfileRestoreJournal,
    pendingUpdateJournal,
    pendingWorkspaceReplacementJournal,
  ] =
    await Promise.all([
      profileRestoreActivationJournalStore.read(),
      updateJournalStore.read(),
      workspaceReplacementStartupRecovery.journalStore.read(),
    ]);
  let startupRecoveryAuthority;
  try {
    startupRecoveryAuthority = resolveStartupRecoveryAuthority({
      profileRestoreJournal: pendingProfileRestoreJournal,
      updateJournal: pendingUpdateJournal,
      workspaceReplacementRecoveryPending:
        pendingWorkspaceReplacementJournal !== undefined,
    });
  } catch (error) {
    if (!(error instanceof StartupRecoveryAuthorityConflictError)) {
      throw error;
    }
    return createUpdateRecoveryComposition({
      applicationPath: options.applicationPath,
      architecture: process.arch,
      createWindow: (windowOptions) => new BrowserWindow(windowOptions),
      electronVersion: process.versions.electron,
      input: {
        appVersion: desktopAppVersion,
        buildRevision: options.buildInfo.buildRevision,
        errorCode: 'UPDATE_RECOVERY_AUTHORITY_CONFLICT',
        rollbackPackageSelectionAllowed: false,
      },
      ipcMain,
      logsRoot: operationalLogsRoot,
      openPath: dependencies.openPath,
      quitApplication: options.quitApplication,
      showOpenDialog: dependencies.showOpenDialog,
      showSaveDialog: dependencies.showSaveDialog,
    });
  }
  if (
    pendingUpdateJournal?.state === 'failedSafe' ||
    pendingUpdateJournal?.state === 'recoveryRequired' ||
    pendingUpdateJournal?.state === 'rollbackPackageRequired'
  ) {
    const recoveryLifecycle = createUpdateRecoveryComposition({
      applicationPath: options.applicationPath,
      architecture: process.arch,
      createWindow: (windowOptions) => new BrowserWindow(windowOptions),
      electronVersion: process.versions.electron,
      input: {
        appVersion: desktopAppVersion,
        buildRevision: options.buildInfo.buildRevision,
        errorCode:
          pendingUpdateJournal.state === 'rollbackPackageRequired'
            ? 'UPDATE_ROLLBACK_PACKAGE_REQUIRED'
            : 'UPDATE_RECOVERY_REQUIRED',
        rollbackPackageSelectionAllowed:
          pendingUpdateJournal.state === 'rollbackPackageRequired',
      },
      ipcMain,
      logsRoot: operationalLogsRoot,
      openPath: dependencies.openPath,
      quitApplication: options.quitApplication,
      ...(pendingUpdateJournal.state === 'rollbackPackageRequired' &&
      updateBinaryRollbackCoordinator !== undefined
        ? { rollbackCoordinator: updateBinaryRollbackCoordinator }
        : {}),
      showOpenDialog: dependencies.showOpenDialog,
      showSaveDialog: dependencies.showSaveDialog,
    });
    const proofConfiguration =
      options.w6b2PackagedProof?.configuration;
    if (
      pendingUpdateJournal.state === 'failedSafe' &&
      proofConfiguration?.controlFormatVersion === 2 &&
      proofConfiguration.faultScenario === 'binaryRollbackFailure' &&
      proofConfiguration.phase === 'failedSafeVerification'
    ) {
      await options.w6b2PackagedProof!.reportResult({
        faultScenario: proofConfiguration.faultScenario,
        formatVersion: 2,
        phase: proofConfiguration.phase,
        status: 'completed',
      });
    }
    return recoveryLifecycle;
  }
  const activeProfileRestoreStartupRecovery =
    startupRecoveryAuthority === 'workspaceReplacement'
      ? workspaceReplacementStartupRecovery.recovery
      : profileRestoreStartupRecovery;
  const profileRestoreStartupMode =
    await activeProfileRestoreStartupRecovery.prepareBeforeBackend();
  const restoredProfileMigrationAuthorized =
    startupRecoveryAuthority === 'profileRestore' &&
    profileRestoreStartupMode === 'validateRestoredProfile';
  const isWorkspaceActivationReplacementRecovery =
    startupRecoveryAuthority === 'workspaceReplacement' &&
    activeWorkspace.mode === 'targetValidation';
  const isLegacyRegisteredWorkspaceRestoreRecovery =
    startupRecoveryAuthority === 'profileRestore' &&
    activeWorkspace.mode === 'normal';
  const shouldDeferRestoredProfileAcceptance =
    profileRestoreStartupMode === 'validateRestoredProfile' &&
    (isWorkspaceActivationReplacementRecovery ||
      isLegacyRegisteredWorkspaceRestoreRecovery);
  if (
    activeWorkspace.mode === 'targetValidation' &&
    startupRecoveryAuthority !== 'none' &&
    startupRecoveryAuthority !== 'workspaceReplacement'
  ) {
    throw new WorkspaceSwitchError('WORKSPACE_SWITCH_RECOVERY_REQUIRED');
  }
  const workspaceActivationMigration =
    activeWorkspace.mode === 'targetValidation' &&
    startupRecoveryAuthority === 'none'
      ? await createWorkspaceActivationMigrationComposition({
          activeWorkspace,
          appVersion: desktopAppVersion,
          buildRevision: options.buildInfo.buildRevision,
          maintenanceLease: workspaceMaintenanceLease,
          recoveryPointService,
          recoveryPointStagingRoot: profileSnapshotPaths.stagingRoot,
          recoveryPointStore,
          requestRelaunch() {
            workspaceActivationMigrationRelaunchRequested = true;
            options.relaunchApplication();
          },
          resourcesPath: options.resourcesPath,
          reservationOwner: startupReservationOwner,
          assertMainReservationOwned: workspaceReservation.assertMainOwned,
          userDataRoot: options.userDataPath,
          ...(w6b2PackagedFaultInjection === undefined
            ? {}
            : {
                beforeCandidateMigration: () =>
                  w6b2PackagedFaultInjection.failPassiveWorkspaceMigrationIfRequested(),
              }),
        })
      : undefined;
  const workspaceActivationMigrationPreparation =
    workspaceActivationMigration === undefined
      ? undefined
      : await workspaceActivationMigration.prepareBeforeBackend();
  if (workspaceActivationMigrationPreparation?.status === 'relaunchRequired') {
    profileSnapshotBrokerClient.close();
    profileSnapshotBrokerChannel.port2.close();
    secretBrokerChannel.port1.close();
    secretBrokerChannel.port2.close();
    invoicePdfArchiveBrokerChannel.port1.close();
    invoicePdfArchiveBrokerChannel.port2.close();
    return undefined;
  }
  const workspaceActivationMigrationAuthorized =
    workspaceActivationMigrationPreparation?.status === 'migrationRequired';
  if (
    smokeMode &&
    options.smokeConfiguration.phase === 'restoredProfile'
  ) {
    if (profileRestoreStartupMode !== 'validateRestoredProfile') {
      throw new Error('DESKTOP_SMOKE_RESTORE_STARTUP_MODE_FAILED');
    }
    if (options.smokeConfiguration.scenario === 'legacyInvoice' &&
        startupRecoveryAuthority !== 'workspaceReplacement') {
      throw new Error('DESKTOP_SMOKE_LEGACY_REPLACEMENT_REQUIRED');
    }
    await verifyPackagedRestoredDatabaseBeforeBackend({
      activeDatabasePath: databaseFilePath,
      smokeRoot: requireSmokeRoot(options.smokeConfiguration.root),
    });
    await options.reportSmokeStage('restoreActivationJournalLoaded');
  }

  const deliveryDialogAdapter: InvoiceDeliveryDialogAdapter = {
    showErrorBox: dependencies.showErrorBox,
    showMessageBox: dependencies.showMessageBox,
  };
  const deliveryConfirmation = createInvoiceDeliveryConfirmation(
    () => applicationWindow,
    deliveryDialogAdapter,
  );

  const secretBrokerHandle = startSecretBrokerMain({
    encryptedSecretFile,
    observer: {
      operationFailed(operation, errorCode) {
        const isReadOperation =
          operation === 'readCompanyEmailSecret' ||
          operation === 'hasCompanyEmailSecret';
        desktopOperationalLogger.write(
          createDesktopOperationalEvent(
            {
              errorCode,
              eventName: isReadOperation
                ? 'secretStorage.decryptFailed'
                : 'secretStorage.writeFailed',
              retryable: false,
              sideEffectState: 'unknown',
              stage: operation,
            },
            desktopOperationalIdentity,
          ),
        );
      },
    },
    protector: safeStorageStringProtector,
    transport: createMainSecretBrokerTransport(secretBrokerChannel.port1),
  });
  const invoicePdfArchivePaths =
    createInvoicePdfArchiveRuntimePaths(workspaceRuntimeRoot);
  let backendHandle: DesktopBackendHandle | undefined;
  let backendStartAttempted = false;
  let activeProfileValidation:
    | Awaited<
        ReturnType<ProfileSnapshotBrokerClient['validateActiveProfile']>
      >
    | undefined;
  const invoicePdfArchiveService = new InvoicePdfArchiveService({
    configStore: new InvoicePdfArchiveConfigStore(
      invoicePdfArchivePaths.configFilePath,
    ),
    journalStore: new InvoicePdfArchiveJournalStore(
      invoicePdfArchivePaths.journalFilePath,
    ),
    resolveArchiveDirectory:
      createWorkspaceInvoicePdfArchiveDirectoryResolver(
        activeWorkspace.workspaceId,
      ),
    observer: {
      copyFailed({ attemptCount, durationMs, errorCode }) {
        desktopOperationalLogger.write(
          createDesktopOperationalEvent(
            {
              attemptCount,
              durationMs,
              errorCode,
              eventName: 'invoicePdfArchive.copyFailed',
              retryable: errorCode !== 'ARCHIVE_FILE_CONFLICT',
              sideEffectState: 'none',
            },
            desktopOperationalIdentity,
          ),
        );
      },
      copySucceeded({ attemptCount, durationMs }) {
        desktopOperationalLogger.write(
          createDesktopOperationalEvent(
            {
              attemptCount,
              durationMs,
              eventName: 'invoicePdfArchive.copySucceeded',
            },
            desktopOperationalIdentity,
          ),
        );
      },
      taskQueued() {
        desktopOperationalLogger.write(
          createDesktopOperationalEvent(
            { eventName: 'invoicePdfArchive.taskQueued' },
            desktopOperationalIdentity,
          ),
        );
      },
    },
    async loadDocument(task) {
      if (backendHandle === undefined) {
        throw new InvoicePdfArchiveError('ARCHIVE_REQUEST_FAILED', true);
      }
      return createInvoicePdfArchiveBackendLoader({
        backendOrigin: `http://127.0.0.1:${backendHandle.port}`,
        fetchImplementation: (url, init) => net.fetch(url, init),
        runtimeSessionSecret,
      })(task);
    },
  });
  const invoicePdfArchiveBrokerHandle =
    startInvoicePdfArchiveBrokerMain({
      service: invoicePdfArchiveService,
      transport: createInvoicePdfArchiveBrokerTransport(
        invoicePdfArchiveBrokerChannel.port1,
      ),
    });

  try {
    await options.reportSmokeStage(
      options.smokeConfiguration.phase === 'restoredProfile'
        ? 'restoredBackend'
        : 'backend',
    );
    backendStartAttempted = true;
    backendHandle = await dependencies.startBackend({
      ...startupExceptionObservation,
      reservationTransfer: workspaceReservation.bind(randomUUID(), assertStartupAuthority),
      async beforeMigrations(inspection, control) {
        backendStartupControl = control;
        await profileSnapshotBrokerClient.waitUntilReady();
        if (workspaceActivationMigrationAuthorized) {
          await workspaceActivationMigration!.beforeMigrations(
            inspection,
            control,
          );
          return;
        }
        if (startupRecoveryAuthority === 'updateBusinessRollback') {
          if (updateBusinessRollbackCoordinator === undefined) {
            throw new Error('UPDATE_BUSINESS_ROLLBACK_RECOVERY_REQUIRED');
          }
          const restoreResult =
            await activeProfileRestoreStartupRecovery.validateAfterBackend({
              mode: profileRestoreStartupMode,
              stopBackend: control.stopStartupRuntime,
              async validateActiveProfile() {
                await updateProfileProtection.validateActiveProfile();
              },
            });
          if (restoreResult === 'relaunchRequired') {
            updateRecoveryRelaunchRequested = true;
            options.relaunchApplication();
            return;
          }
          if (profileRestoreStartupMode === 'validateRolledBackProfile') {
            await updateBusinessRollbackCoordinator
              .requireRecoveryAfterRestoreRollback();
          }
          if (profileRestoreStartupMode !== 'validateRestoredProfile') {
            throw new Error('UPDATE_BUSINESS_ROLLBACK_RECOVERY_REQUIRED');
          }
        }
        if (
          startupRecoveryAuthority !== 'updateBusinessRollback' &&
          updateBusinessRollbackCoordinator !== undefined
        ) {
          const rollback =
            await updateBusinessRollbackCoordinator.startIfRequired(
              inspection,
            );
          if (rollback === 'relaunching') {
            return;
          }
        }
        const rollbackJournal = await updateJournalStore.read();
        if (
          rollbackJournal?.state === 'businessRollbackStarting' ||
          rollbackJournal?.state === 'businessRollbackCompleted'
        ) {
          if (
            updateBusinessRollbackCoordinator === undefined ||
            updateBinaryRollbackCoordinator === undefined
          ) {
            throw new Error('UPDATE_BINARY_ROLLBACK_RECOVERY_REQUIRED');
          }
          await updateBusinessRollbackCoordinator
            .completeAfterProfileValidation({ inspection });
          await control.stopStartupRuntime();
          let binaryRollback: 'launched' | 'notRequired';
          try {
            binaryRollback =
              await updateBinaryRollbackCoordinator.startIfRequired();
          } catch (error) {
            const proofConfiguration =
              options.w6b2PackagedProof?.configuration;
            const journalAfterFailure = await updateJournalStore.read();
            if (
              proofConfiguration?.controlFormatVersion === 2 &&
              proofConfiguration.faultScenario === 'binaryRollbackFailure' &&
              proofConfiguration.phase === 'binaryRollbackFailure' &&
              journalAfterFailure?.state === 'failedSafe'
            ) {
              await options.w6b2PackagedProof!.reportResult({
                faultScenario: proofConfiguration.faultScenario,
                formatVersion: 2,
                phase: proofConfiguration.phase,
                status: 'completed',
              });
              updateBinaryRollbackHandoffRequested = true;
              options.quitApplication();
              return;
            }
            throw error;
          }
          if (binaryRollback !== 'launched') {
            throw new Error('UPDATE_BINARY_ROLLBACK_RECOVERY_REQUIRED');
          }
          updateBinaryRollbackHandoffRequested = true;
          options.quitApplication();
          return;
        }
        if (updateBinaryRollbackCoordinator !== undefined) {
          await updateBinaryRollbackCoordinator.startIfRequired();
        }
        if (firstStartUpdateCoordinator === undefined) {
          return;
        }
        await firstStartUpdateCoordinator.beforeMigrations(inspection, {
          migrationAuthority: restoredProfileMigrationAuthorized
            ? 'profileRestore'
            : 'update',
        });
        w6b2PackagedFaultInjection?.failActiveWorkspaceFirstStartIfRequested();
      },
      config: {
        appVersion: desktopAppVersion,
        architecture: process.arch,
        backendRoot,
        buildCreatedAt: options.buildInfo.buildCreatedAt,
        buildDirty: options.buildInfo.buildDirty,
        buildRevision: options.buildInfo.buildRevision,
        createSmokePdf: smokeMode,
        electronVersion: process.versions.electron,
        databaseFilePath,
        invoiceDocumentStorageRoot,
        migrationsDirectory: join(
          backendRoot,
          'dist',
          'database',
          'migrations',
        ),
        migrationStartupPolicy:
          restoredProfileMigrationAuthorized ||
          workspaceActivationMigrationAuthorized
          ? 'restoreCompatible'
          : 'exactCurrentManifest',
        operationalLogsRoot,
        platform: process.platform,
        profileSnapshotStagingRoot: profileSnapshotPaths.stagingRoot,
        runtimeInstanceId: options.runtimeInstanceId,
        runtimeSessionSecret,
        smokePdfPath,
        verifySmokeSecretBroker:
          smokeMode && options.smokeConfiguration.phase === 'initial',
      },
      operationalIdentity: desktopOperationalIdentity,
      operationalLogger: desktopOperationalLogger,
      invoicePdfArchiveBrokerPort:
        invoicePdfArchiveBrokerChannel.port2,
      profileSnapshotBrokerPort: profileSnapshotBrokerChannel.port2,
      runnerPath: join(
        options.resourcesPath,
        'desktop-runtime',
        'runtime',
        'backendRunner.js',
      ),
      secretBrokerPort: secretBrokerChannel.port2,
    });
    await profileSnapshotBrokerClient.waitUntilReady();
    await profileSnapshotBrokerClient.getStatus();
    const restoreStartupResult =
      await activeProfileRestoreStartupRecovery.validateAfterBackend({
        ...(shouldDeferRestoredProfileAcceptance
          ? { deferRestoredProfileAcceptance: true }
          : {}),
        mode: profileRestoreStartupMode,
        async stopBackend() {
          await backendHandle!.stop();
        },
        async validateActiveProfile() {
          activeProfileValidation =
            await profileSnapshotBrokerClient.validateActiveProfile();
          await assertBackendHealth(
            `http://127.0.0.1:${backendHandle!.port}`,
            runtimeSessionSecret,
          );
        },
      });
    restoredProfileAwaitingDecision =
      shouldDeferRestoredProfileAcceptance &&
      restoreStartupResult === 'restoredProfileReady';
    if (restoreStartupResult === 'relaunchRequired') {
      if (isWorkspaceActivationReplacementRecovery) {
        const workspaceRecovery = await activeWorkspace.recoverFromFailure();
        if (workspaceRecovery !== 'relaunchRequired') {
          throw new WorkspaceSwitchError(
            'WORKSPACE_SWITCH_RECOVERY_REQUIRED',
          );
        }
      }
      profileSnapshotBrokerClient.close();
      invoicePdfArchiveBrokerHandle.close();
      secretBrokerHandle.close();
      options.relaunchApplication();
      return undefined;
    }
    await assertBackendHealth(
      `http://127.0.0.1:${backendHandle.port}`,
      runtimeSessionSecret,
    );
    activeProfileValidation ??=
      await profileSnapshotBrokerClient.validateActiveProfile();
    if (firstStartUpdateCoordinator !== undefined) {
      await assertDifferentRuntimeSessionRejected({
        backendOrigin: `http://127.0.0.1:${backendHandle.port}`,
        createRuntimeSession: dependencies.createRuntimeSession,
        fetchImplementation: (url, init) => net.fetch(url, init),
        runtimeSessionSecret,
      });
    }
    if (restoredProfileAwaitingDecision) {
      const restoredProfileId = activeProfileValidation.profileId;
      try {
        await activeProfileRestoreStartupRecovery
          .acceptValidatedRestoredProfile({
            assertTargetCanAccept: () =>
              activeWorkspace.assertCanAccept(restoredProfileId),
          });
        restoredProfileAwaitingDecision = false;
        restoredProfileTransactionCommitted = true;
      } catch (error) {
        if (isWorkspaceActivationReplacementRecovery) {
          const activationJournal =
            await workspaceReplacementStartupRecovery.journalStore
              .read()
              .catch(() => {
                workspaceReplacementRecoveryAmbiguous = true;
                restoredProfileAwaitingDecision = false;
                return undefined;
              });
          if (activationJournal?.phase === 'accepted') {
            restoredProfileAwaitingDecision = false;
            restoredProfileTransactionCommitted = true;
          } else if (activationJournal === undefined) {
            workspaceReplacementRecoveryAmbiguous = true;
            restoredProfileAwaitingDecision = false;
          }
        }
        throw error;
      }
    }
    await activeWorkspace.accept(activeProfileValidation.profileId);
    workspaceStartupAccepted = true;
    await workspaceFirstStartMigration.transitionRegistryAfterActiveWorkspaceAcceptance();
    await w6b2PackagedFaultInjection?.interruptAfterRegistryTransitionIfRequested();
    if (firstStartUpdateCoordinator !== undefined) {
      await firstStartUpdateCoordinator.acceptAfterBackendReady();
    }
    targetBuildAccepted = true;
    await workspaceFirstStartMigration.completeAfterTargetAcceptance();
    await recoveryPointScheduler.start();
  } catch (error) {
    try { options.observeStartupException?.(error, 'runtimeStartup', [runtimeSessionSecret]); } catch { /* Optional private evidence. */ }
    await recoveryPointScheduler.stopChecks().catch(() => undefined);
    const startedBackend = backendHandle;
    const backendStopped = startedBackend === undefined
      ? !backendStartAttempted || (error instanceof DesktopBackendStartupError &&
          error.ownership.processState === 'absent' && error.ownership.migrationGateSettled &&
          error.ownership.reservationReclaimed)
      : await Promise.resolve().then(() => startedBackend.stop()).then(() => true, () => false);
    // Unsettled startup work must retain ownership even if broker cleanup fails.
    if (!backendStopped) workspaceReservation.invalidate();
    let brokerCleanupFailed = false;
    for (const broker of [
      profileSnapshotBrokerClient,
      invoicePdfArchiveBrokerHandle,
      secretBrokerHandle,
    ]) {
      try {
        broker.close();
      } catch {
        brokerCleanupFailed = true;
      }
    }
    if (brokerCleanupFailed) {
      workspaceReservation.invalidate();
      throw error;
    }
    if (!backendStopped) {
      // No recovery may change profile files or select another live runtime.
      throw error;
    }
    await workspaceReservation.assertMainOwned();
    if (
      error instanceof DesktopBackendStartupStoppedError &&
      (updateRecoveryRelaunchRequested ||
        updateBinaryRollbackHandoffRequested ||
        workspaceActivationMigrationRelaunchRequested)
    ) {
      return undefined;
    }
    if (workspaceReplacementRecoveryAmbiguous) {
      await activeWorkspace.requireRecovery?.().catch(() => undefined);
      throw new WorkspaceSwitchError('WORKSPACE_SWITCH_RECOVERY_REQUIRED');
    }
    if (restoredProfileAwaitingDecision) {
      try {
        await activeProfileRestoreStartupRecovery
          .rollbackValidatedRestoredProfile();
      } catch {
        await activeWorkspace.requireRecovery?.().catch(() => undefined);
        throw new WorkspaceSwitchError(
          'WORKSPACE_SWITCH_RECOVERY_REQUIRED',
        );
      }
      restoredProfileAwaitingDecision = false;
      if (isLegacyRegisteredWorkspaceRestoreRecovery) {
        options.relaunchApplication();
        return undefined;
      }
      const workspaceRecovery = await activeWorkspace.recoverFromFailure();
      if (workspaceRecovery === 'relaunchRequired') {
        options.relaunchApplication();
        return undefined;
      }
      throw new WorkspaceSwitchError('WORKSPACE_SWITCH_RECOVERY_REQUIRED');
    }
    if (!workspaceStartupAccepted && !restoredProfileTransactionCommitted) {
      const workspaceRecovery = await activeWorkspace.recoverFromFailure();
      if (workspaceRecovery === 'relaunchRequired') {
        options.relaunchApplication();
        return undefined;
      }
      if (workspaceRecovery === 'recoveryRequired') {
        throw new WorkspaceSwitchError('WORKSPACE_SWITCH_RECOVERY_REQUIRED');
      }
    }
    if (
      firstStartUpdateCoordinator !== undefined &&
      !targetBuildAccepted &&
      (await firstStartUpdateCoordinator
        .recoverFromStartupFailure()
        .catch(() => false))
    ) {
      options.relaunchApplication();
      return undefined;
    }
    throw error;
  }

  backendHandle.onUnexpectedExit(() => {
    void recoveryPointScheduler.stopChecks();
    if (shutdownStarted) {
      return;
    }
    if (!smokeMode) {
      dependencies.showErrorBox(
        'Eky suljettiin',
        'Paikallinen palvelu pysähtyi odottamatta. Sovellus suljetaan turvallisesti.',
      );
    }
    options.quitApplication();
  });
  void invoicePdfArchiveService.retryPending(true).catch(() => undefined);

  registerApplicationProtocol({
    backendOrigin: `http://127.0.0.1:${backendHandle.port}`,
    backendRequestAdmission: backendRequestQuiescence,
    confirmInvoiceEmailPreparation:
      deliveryConfirmation.confirmInvoiceEmailPreparation,
    confirmSmtpTestPreparation:
      deliveryConfirmation.confirmSmtpTestPreparation,
    runtimeSessionSecret,
    webRoot: join(options.applicationPath, 'web'),
  });

  registerElectronPermissionPolicy({
    operationalIdentity: desktopOperationalIdentity,
    operationalLogger: desktopOperationalLogger,
    permissionSession: session.defaultSession,
  });

  applicationWindow = createApplicationWindow(
    options.applicationPath,
    !smokeMode,
    {
      loadFailed() {
        desktopOperationalLogger.write(
          createDesktopOperationalEvent(
            {
              errorCode: 'APPLICATION_WINDOW_LOAD_FAILED',
              eventName: 'applicationWindow.loadFailed',
              retryable: true,
              sideEffectState: 'none',
              stage: 'load',
            },
            desktopOperationalIdentity,
          ),
        );
      },
      navigationBlocked() {
        desktopOperationalLogger.write(
          createDesktopOperationalEvent(
            {
              eventName: 'applicationWindow.navigationBlocked',
              stage: 'will-navigate',
            },
            desktopOperationalIdentity,
          ),
        );
      },
      newWindowBlocked() {
        desktopOperationalLogger.write(
          createDesktopOperationalEvent(
            {
              eventName: 'applicationWindow.newWindowBlocked',
              stage: 'window-open',
            },
            desktopOperationalIdentity,
          ),
        );
      },
      renderProcessGone() {
        desktopOperationalLogger.write(
          createDesktopOperationalEvent(
            {
              errorCode: 'RENDER_PROCESS_GONE',
              eventName: 'applicationWindow.renderProcessGone',
              retryable: true,
              sideEffectState: 'unknown',
              stage: 'runtime',
            },
            desktopOperationalIdentity,
          ),
        );
      },
    },
  );
  const mainWindow = applicationWindow;
  operationalLogFolderCapability = createOperationalLogFolderCapability({
    ipcMain,
    mainWindow,
    openPath: smokeMode
      ? async (path) =>
          path === operationalLogsRoot
            ? ''
            : 'OPERATIONAL_LOG_FOLDER_SMOKE_ROOT_INVALID'
      : dependencies.openPath,
    operationalLogger: desktopOperationalLogger,
    operationalIdentity: desktopOperationalIdentity,
    runtimeRoot: installationRuntimeRoot,
    showSafeError() {
      deliveryConfirmation.showApplicationError(
        'Lokikansiota ei voitu avata',
        'Eky-lokikansiota ei voitu avata turvallisesti.',
      );
    },
  });
  invoicePdfArchiveCapability = createInvoicePdfArchiveCapability({
    async confirmChange() {
      if (smokeMode) {
        return true;
      }
      const result = await dependencies.showMessageBox(mainWindow, {
        buttons: ['Peruuta', 'Vaihda kansio'],
        cancelId: 0,
        defaultId: 0,
        detail:
          'Uusi kansio koskee vain tämän jälkeen arkistoitavia laskuja ja odottavia kopioita. Aiemmin kopioituja PDF-tiedostoja ei siirretä.',
        message: 'Vaihdatko laskujen PDF-kopiokansion?',
        noLink: true,
        title: 'Vaihda PDF-kopiokansio',
        type: 'warning',
      });
      return result.response === 1;
    },
    async confirmDisable() {
      if (smokeMode) {
        return true;
      }
      const result = await dependencies.showMessageBox(mainWindow, {
        buttons: ['Peruuta', 'Poista käytöstä'],
        cancelId: 0,
        defaultId: 0,
        detail:
          'Jo tallennetut PDF-kopiot säilyvät valitussa kansiossa. Odottavat kopiot säilyvät Ekyssä ja niitä voidaan yrittää uudelleen, kun ominaisuus otetaan myöhemmin käyttöön.',
        message: 'Poistetaanko laskujen paikallinen PDF-kopiointi käytöstä?',
        noLink: true,
        title: 'Poista PDF-kopiointi käytöstä',
        type: 'warning',
      });
      return result.response === 1;
    },
    ipcMain,
    mainWindow,
    onConfigurationChanged(stage) {
      desktopOperationalLogger.write(
        createDesktopOperationalEvent(
          {
            eventName: 'invoicePdfArchive.configurationChanged',
            stage,
          },
          desktopOperationalIdentity,
        ),
      );
    },
    openPath: dependencies.openPath,
    async selectDirectory() {
      const result = await dependencies.showOpenDialog(mainWindow, {
        message: 'Valitse kansio toimitettujen laskujen PDF-kopioille',
        properties: ['openDirectory', 'createDirectory'],
        title: 'Valitse PDF-kopiokansio',
      });
      return result.canceled || result.filePaths.length !== 1
        ? null
        : result.filePaths[0] ?? null;
    },
    service: invoicePdfArchiveService,
    showSafeError() {
      deliveryConfirmation.showApplicationError(
        'PDF-kopiota ei voitu käsitellä',
        'Laskujen paikallista PDF-kopiota ei voitu käsitellä turvallisesti.',
      );
    },
  });
  supportBundleCapability = createSupportBundleCapability({
    appVersion: desktopAppVersion,
    architecture: process.arch,
    async confirmCreation() {
      if (smokeMode) {
        return true;
      }
      const result = await dependencies.showMessageBox(mainWindow, {
        buttons: ['Peruuta', 'Jatka'],
        cancelId: 0,
        defaultId: 0,
        detail:
          'Tukipaketti ei ole salattu. Tallenna ja lähetä se vain luotetulle tukihenkilölle.\n\nPaketti sisältää vain sanitoituja teknisiä tapahtumia, sovellusversiot sekä tietokannan health- ja migraatioyhteenvedon. Se ei sisällä asiakas- tai laskudataa, PDF:iä eikä salaisuuksia.',
        message: 'Luodaanko Eky-tukipaketti?',
        noLink: true,
        title: 'Luo tukipaketti',
        type: 'warning',
      });
      return result.response === 1;
    },
    ipcMain,
    loadBackendData: () =>
      loadSupportBundleBackendData(
        `http://127.0.0.1:${backendHandle.port}`,
        runtimeSessionSecret,
      ),
    mainWindow,
    operationalIdentity: desktopOperationalIdentity,
    operationalLogger: desktopOperationalLogger,
    platform: process.platform,
    runtimeRoot: installationRuntimeRoot,
    async selectTargetPath(defaultFileName) {
      if (smokeSupportBundlePath !== undefined) {
        return smokeSupportBundlePath;
      }
      const result = await dependencies.showSaveDialog(mainWindow, {
        defaultPath: defaultFileName,
        filters: [
          {
            extensions: ['json.gz'],
            name: 'Eky-tukipaketti, GZip-pakattu JSON',
          },
        ],
        title: 'Tallenna Eky-tukipaketti',
      });
      return result.canceled || result.filePath === ''
        ? null
        : result.filePath;
    },
    showSafeError() {
      deliveryConfirmation.showApplicationError(
        'Tukipakettia ei voitu luoda',
        'Eky-tukipakettia ei voitu luoda turvallisesti.',
      );
    },
  });
  const profileBackupComposition =
    await createProfileBackupComposition({
      appVersion: desktopAppVersion,
      createWindow: (windowOptions) => new BrowserWindow(windowOptions),
      forbiddenRoots: [
        installationRuntimeRoot,
        workspaceRuntimeRoot,
        options.applicationPath,
        options.resourcesPath,
      ],
      ipcMain,
      mainWindow,
      maintenanceLease: workspaceMaintenanceLease,
      operationalIdentity: desktopOperationalIdentity,
      operationalLogger: desktopOperationalLogger,
      passwordPreloadPath: join(
        options.applicationPath,
        'dist',
        'profileBackup',
        'passwordWindow',
        'backupPasswordPreload.cjs',
      ),
      paths: profileSnapshotPaths,
      profileRecoveryOperationalObserver,
      profileSnapshotClient: profileSnapshotBrokerClient,
      recoveryPointService,
      relaunchApplication: options.relaunchApplication,
      restoreActivationTransaction: profileRestoreActivationTransaction,
      showOpenDialog: dependencies.showOpenDialog,
      showSaveDialog: dependencies.showSaveDialog,
      showSafeError(kind) {
        if (kind === 'recoveryPoint') {
          deliveryConfirmation.showApplicationError(
            'Palautuspistettä ei voitu luoda',
            'Konekohtaista palautuspistettä ei voitu luoda turvallisesti.',
          );
          return;
        }
        deliveryConfirmation.showApplicationError(
          kind === 'create'
            ? 'Varmuuskopiota ei voitu luoda'
            : 'Varmuuskopiota ei voitu tarkistaa',
          kind === 'create'
            ? 'Salattua varmuuskopiota ei voitu luoda turvallisesti.'
            : 'Varmuuskopion salasana, eheys tai sisältö ei läpäissyt tarkistusta.',
        );
      },
      async stopBusinessRuntime() {
        await recoveryPointScheduler.stopChecks();
        await backendHandle!.stop();
      },
    });
  backupPasswordWindowController =
    profileBackupComposition.backupPasswordWindowController;
  profileBackupCapability =
    profileBackupComposition.profileBackupCapability;
  const {
    portableProfileBackupService,
    profileRestoreActivationService,
    profileRestoreStagingService,
  } = profileBackupComposition;
  try {
    removeExpiredSupportBundleTemporaryFiles(installationRuntimeRoot);
  } catch {
    desktopOperationalLogger.write(
      createDesktopOperationalEvent(
        {
          correlationId: randomUUID(),
          errorCode: 'SUPPORT_BUNDLE_RETENTION_FAILED',
          eventName: 'supportBundle.creationFailed',
          retryable: true,
          sideEffectState: 'none',
          stage: 'retention',
        },
        desktopOperationalIdentity,
      ),
    );
  }
  pdfPreviewController = createInvoicePdfPreviewController(
    desktopOperationalIdentity,
    desktopOperationalLogger,
    mainWindow,
    smokeMode,
    deliveryConfirmation.showApplicationError,
  );

  let disposeCapabilitiesTask: Promise<void> | undefined;
  const disposeWorkspaceRuntimeCapabilities = (): Promise<void> => {
    disposeCapabilitiesTask ??= Promise.resolve().then(() => {
      const capabilities = [
        workspaceManagementCapability,
        pdfPreviewController,
        operationalLogFolderCapability,
        invoicePdfArchiveCapability,
        supportBundleCapability,
        localUpdateSelectionCapability,
        profileBackupCapability,
        backupPasswordWindowController,
        workspaceManagementComposition,
      ];
      workspaceManagementCapability = undefined;
      pdfPreviewController = undefined;
      operationalLogFolderCapability = undefined;
      invoicePdfArchiveCapability = undefined;
      supportBundleCapability = undefined;
      localUpdateSelectionCapability = undefined;
      profileBackupCapability = undefined;
      backupPasswordWindowController = undefined;
      let failed = false;
      for (const capability of capabilities) {
        try {
          capability?.dispose();
        } catch {
          failed = true;
        }
      }
      if (failed) throw new Error('WORKSPACE_RUNTIME_STOP_FAILED');
    });
    return disposeCapabilitiesTask;
  };
  let closeBrokersTask: Promise<void> | undefined;
  const closeWorkspaceRuntimeBrokers = (): Promise<void> => {
    closeBrokersTask ??= Promise.resolve().then(() => {
      let failed = false;
      for (const broker of [
        profileSnapshotBrokerClient,
        invoicePdfArchiveBrokerHandle,
        secretBrokerHandle,
      ]) {
        try {
          broker.close();
        } catch {
          failed = true;
        }
      }
      if (failed) throw new Error('WORKSPACE_RUNTIME_STOP_FAILED');
    });
    return closeBrokersTask;
  };
  let backendStopAttempted = false;
  const activeWorkspaceLifecycle = new MainOwnedActiveWorkspaceLifecycle(
    activeWorkspace.workspaceId,
    backendRequestQuiescence,
    {
      closeBrokers: closeWorkspaceRuntimeBrokers,
      disposeCapabilities: disposeWorkspaceRuntimeCapabilities,
      markCleanShutdown: () => recoveryPointScheduler.markCleanShutdown(),
      async stopBackend() {
        backendStopAttempted = true;
        return backendHandle.stop();
      },
      async stopBackendForUpdate(operationId) {
        backendStopAttempted = true;
        await backendHandle.stopForUpdate(operationId);
      },
      stopRecoveryPointScheduler: () => recoveryPointScheduler.stopChecks(),
    },
    workspaceRuntimeRelaunch,
  );
  const workspaceManagementComposition =
    await createWorkspaceManagementComposition({
      activeWorkspaceId: activeWorkspace.workspaceId,
      activeWorkspaceLifecycle: {
        quiesceWrites: (workspaceId) => activeWorkspaceLifecycle.quiesceWrites(workspaceId),
        async stopAndProveHandlesClosed(workspaceId) {
          const stopped = await activeWorkspaceLifecycle.stopAndProveHandlesClosed(workspaceId);
          await workspaceReservation.assertMainOwned();
          return stopped;
        },
        async ensurePreviousWorkspaceRunning(workspaceId) {
          if (activeWorkspaceLifecycle.readState() === 'stopped') {
            await workspaceReservation.assertMainOwned();
          }
          await activeWorkspaceLifecycle.ensurePreviousWorkspaceRunning(workspaceId);
        },
        async assertNoActiveWorkspaceRuntime() {
          await activeWorkspaceLifecycle.assertNoActiveWorkspaceRuntime();
          await workspaceReservation.assertMainOwned();
        },
      },
      appVersion: desktopAppVersion,
      buildRevision: options.buildInfo.buildRevision,
      localUpdateRuntimePaths,
      maintenanceLease: workspaceMaintenanceLease,
      profileRestoreActivationJournalPath:
        profileSnapshotPaths.restoreActivationJournalPath,
      recoveryPointService,
      resourcesPath: options.resourcesPath,
      reservationOwner: {
        bindCandidate: ({ generationId }) => workspaceReservation.bind(
          generationId,
          workspaceMaintenanceLease.captureCurrentOwner(['create', 'import', 'replace']),
        ),
      },
      runtimeRelaunch: workspaceRuntimeRelaunch,
      userDataRoot: options.userDataPath,
    });
  if (backupPasswordWindowController === undefined) {
    throw new Error('WORKSPACE_MANAGEMENT_CAPABILITY_UNAVAILABLE');
  }
  workspaceManagementCapability = createWorkspaceManagementCapability({
    ipcMain,
    mainWindow,
    passwordWindow: backupPasswordWindowController,
    service: workspaceManagementComposition.service,
    confirmActiveWorkspaceReplacement(workspaceLabel) {
      return confirmActiveWorkspaceReplacement({
        mainWindow,
        showMessageBox: dependencies.showMessageBox,
        workspaceLabel,
      });
    },
    async selectBackupSource() {
      const result = await dependencies.showOpenDialog(mainWindow, {
        filters: [
          {
            extensions: ['ekybackup'],
            name: 'Eky-varmuuskopio',
          },
        ],
        properties: ['openFile'],
        title: 'Tuo yritys Eky-varmuuskopiosta',
      });
      return result.canceled || result.filePaths.length !== 1
        ? null
        : result.filePaths[0] ?? null;
    },
    async selectReplacementBackupSource() {
      const result = await dependencies.showOpenDialog(mainWindow, {
        filters: [
          {
            extensions: ['ekybackup'],
            name: 'Eky-varmuuskopio',
          },
        ],
        properties: ['openFile'],
        title: 'Valitse saman yrityksen Eky-varmuuskopio',
      });
      return result.canceled || result.filePaths.length !== 1
        ? null
        : result.filePaths[0] ?? null;
    },
    showSafeError() {
      deliveryConfirmation.showApplicationError(
        'Yritystä ei voitu käsitellä',
        'Yrityksen tietoja ei voitu käsitellä turvallisesti.',
      );
    },
  });

  const shutdownRuntime = (request: { mode: 'ordinary' } | { mode: 'update'; operationId: string }): Promise<void> => {
    if (shutdownTask !== undefined) {
      return request.mode === 'ordinary'
        ? shutdownTask
        : shutdownTask.then(async () => {
            try {
              await activeWorkspaceLifecycle.stopForUpdate(activeWorkspace.workspaceId, request.operationId);
            } catch (error) {
              throw new Error('DESKTOP_SHUTDOWN_FAILED', {
                cause: error instanceof WorkspaceRuntimeStopError ? error : undefined,
              });
            }
          });
    }

    shutdownStarted = true;
    // Publish the shared task before any shutdown callback can re-enter.
    shutdownTask = Promise.resolve().then(async () => {
      const shutdownStartedAt = Date.now();
      desktopOperationalLogger.write(
        createDesktopOperationalEvent(
          { eventName: 'desktop.shutdownStarted' },
          desktopOperationalIdentity,
        ),
      );
      try {
        if (request.mode === 'update') {
          await activeWorkspaceLifecycle.stopForUpdate(
            activeWorkspace.workspaceId,
            request.operationId,
          );
        } else {
          if (activeWorkspaceLifecycle.readState() === 'active') {
            await activeWorkspaceLifecycle.quiesceWrites(
              activeWorkspace.workspaceId,
            );
          }
          await activeWorkspaceLifecycle.stopAndProveHandlesClosed(
            activeWorkspace.workspaceId,
          );
        }
        desktopOperationalLogger.write(
          createDesktopOperationalEvent(
            {
              durationMs: Date.now() - shutdownStartedAt,
              eventName: 'desktop.shutdownCompleted',
            },
            desktopOperationalIdentity,
          ),
        );
      } catch (error) {
        backendRequestQuiescence.stop();
        const cleanupFailures: string[] = [];
        for (const [phase, close] of [
          ['scheduler', () => recoveryPointScheduler.stopChecks()],
          ['capabilities', disposeWorkspaceRuntimeCapabilities],
          ['backend', async () => {
            if (request.mode === 'ordinary' && !backendStopAttempted) {
              backendStopAttempted = true;
              await backendHandle.stop();
            }
          }],
          ['brokers', closeWorkspaceRuntimeBrokers],
        ] as const) {
          try {
            await close();
          } catch {
            cleanupFailures.push(phase);
          }
        }
        desktopOperationalLogger.write(
          createDesktopOperationalEvent(
            {
              durationMs: Date.now() - shutdownStartedAt,
              errorCode: 'DESKTOP_SHUTDOWN_FAILED',
              eventName: 'desktop.shutdownFailed',
              retryable: false,
              sideEffectState: 'unknown',
              stage: 'shutdown',
            },
            desktopOperationalIdentity,
          ),
        );
        throw new Error('DESKTOP_SHUTDOWN_FAILED', {
          cause: Object.freeze({
            runtimeFailure: error instanceof WorkspaceRuntimeStopError ? error : undefined,
            cleanupFailures: Object.freeze(cleanupFailures),
          }),
        });
      }
    });
    return shutdownTask;
  };
  const lifecycleHandle: DesktopLifecycleHandle = {
    applicationWindow: mainWindow,
    focusApplicationWindow() {
      restoreWindowInputFocus(mainWindow);
    },
    shutdown: () => shutdownRuntime({ mode: 'ordinary' }),
  };

  let handoffCoordinator: LocalUpdateHandoffCoordinator | undefined;
  if (
    options.releaseInfo !== undefined &&
    localUpdatePackageCache !== undefined
  ) {
    handoffCoordinator = new LocalUpdateHandoffCoordinator({
      cache: localUpdatePackageCache,
      journalStore: updateJournalStore,
      maintenanceLease: workspaceMaintenanceLease,
      async launchInstaller(candidate) {
        await launchWindowsInstallerForUpdate({
          packagePath: candidate.packagePath,
          systemRoot: process.env.SystemRoot,
        });
        options.quitApplication();
      },
      observer: updateObserver,
      profileProtection: handoffProfileProtection,
      shutdownRuntime: (operationId) => shutdownRuntime({ mode: 'update', operationId }),
    });
    if (options.w6b2PackagedProof === undefined) {
      localUpdateSelectionCapability =
        createLocalUpdateFoundationComposition({
          cache: localUpdatePackageCache,
          confirmUpdate: (status) =>
            confirmLocalUpdateWithNativeDialog({
              mainWindow,
              showMessageBox: (owner, dialogOptions) =>
                dependencies.showMessageBox(owner, dialogOptions),
              status,
            }),
          handoffCoordinator,
          ipcMain,
          journalStore: updateJournalStore,
          mainWindow,
          observer: updateObserver,
          releaseInfo: options.releaseInfo,
          resourcesPath: options.resourcesPath,
          async selectManifestPath() {
            const result = await dependencies.showOpenDialog(mainWindow, {
              filters: [
                {
                  extensions: ['json'],
                  name: 'Eky-päivityksen manifesti',
                },
              ],
              properties: ['openFile'],
              title: 'Valitse paikallinen Eky-päivitys',
            });
            return result.canceled || result.filePaths.length !== 1
              ? null
              : result.filePaths[0] ?? null;
          },
          showSafeError() {
            deliveryConfirmation.showApplicationError(
              'Päivitystä ei voitu käsitellä',
              'Paikallista Eky-päivitystä ei voitu käsitellä turvallisesti.',
            );
          },
          systemRoot: process.env.SystemRoot,
          userDataPath: options.userDataPath,
        });
    }
  }

  if (options.w6b2PackagedProof !== undefined) {
    const proof = options.w6b2PackagedProof;
    const result = await runPackagedDesktopStartupProof({
      configuration: proof.configuration,
      controllerAvailable:
        localUpdatePackageCache !== undefined &&
        handoffCoordinator !== undefined,
      identity: desktopOperationalIdentity,
      logger: desktopOperationalLogger,
      startedAt: desktopStartedAt,
      validateSession: (configuration) =>
        runW6b2PackagedSessionProbe({
          configuration,
          backendPort: backendHandle.port,
          runtimeInstanceId: options.runtimeInstanceId,
          runtimeSessionSecret,
        }),
      runController: async () =>
        localUpdatePackageCache === undefined || handoffCoordinator === undefined
          ? proof.configuration.controlFormatVersion === 1
            ? {
                errorCode: 'W6B2_PROOF_CONFIGURATION_INVALID' as const,
                formatVersion: 1 as const,
                phase: proof.configuration.phase,
                status: 'failed' as const,
              }
            : {
                errorCode: 'W6B2_FAULT_PROOF_UNEXPECTED' as const,
                faultScenario: proof.configuration.faultScenario,
                formatVersion: 2 as const,
                phase: proof.configuration.phase,
                status: 'failed' as const,
              }
          : proof.configuration.controlFormatVersion === 1
            ? await runW6b2PackagedProofController({
                assertUpdateWriteState: (state) => assertW6b2PackagedUpdateWriteState({
                  backendPort: backendHandle.port,
                  runtimeSessionSecret,
                  state,
                  fetchImplementation: (url, init) => net.fetch(url, init),
                }),
                cache: localUpdatePackageCache,
                configuration: proof.configuration,
                handoff: handoffCoordinator,
                isQuitRequested: proof.isQuitRequested,
                isRelaunchRequested: proof.isRelaunchRequested,
                lifecycle: lifecycleHandle,
                readRecoveryPointFailureCode: () =>
                  recoveryPointService.getStatus().lastSafeErrorCode,
                workspaceManagement: workspaceManagementComposition.service,
              })
            : await runW6b2PackagedFaultProofController({
                cache: localUpdatePackageCache,
                configuration: proof.configuration,
                handoff: handoffCoordinator,
                isQuitRequested: proof.isQuitRequested,
                isRelaunchRequested: proof.isRelaunchRequested,
                journalStore: updateJournalStore,
                lifecycle: lifecycleHandle,
                workspaceManagement: workspaceManagementComposition.service,
              }),
    });
    await proof.reportResult(result);
    return lifecycleHandle;
  }

  if (smokeMode) {
    const smokeStartedAt = Date.now();
    desktopOperationalLogger.write(
      createDesktopOperationalEvent(
        { eventName: 'packagedSmoke.started' },
        desktopOperationalIdentity,
      ),
    );
    try {
      const smokeRoot = requireSmokeRoot(
        options.smokeConfiguration.root,
      );

      if (options.smokeConfiguration.phase === 'initial') {
        await loadApplicationWindow(mainWindow);
        if (options.smokeConfiguration.scenario === 'legacyInvoice') {
          await runPackagedLegacyProfileBeforeRestore({
            smokeRoot, backendPort: backendHandle.port, runtimeSessionSecret,
            runtimeInstanceId: options.runtimeInstanceId,
            backupService: portableProfileBackupService,
            profileSnapshotClient: profileSnapshotBrokerClient,
            stagingRoot: profileSnapshotPaths.stagingRoot,
            management: workspaceManagementComposition.service,
            reportStage: options.reportSmokeStage,
          });
          return undefined;
        }
        await runPackagedEmptyArtifactSnapshotSmoke({
          profileSnapshotClient: profileSnapshotBrokerClient,
          reportStage: options.reportSmokeStage,
          stagingRoot: profileSnapshotPaths.stagingRoot,
        });
        await runPackagedSmokeCheck({
          acceptedBuildMetadataPath:
            localUpdateRuntimePaths.acceptedBuildMetadataPath,
          appVersion: desktopAppVersion,
          backend: backendHandle,
          buildRevision: options.buildInfo.buildRevision,
          databaseFilePath,
          invoicePdfArchiveDirectoryPath: join(
            smokeRoot,
            'invoice-pdf-archive',
          ),
          invoicePdfArchiveService,
          mainWindow,
          pdfPreviewController,
          requiresPilotAcceptance: options.releaseInfo !== undefined,
          runtimeSessionSecret,
          runtimeInstanceId: options.runtimeInstanceId,
          secretFilePath,
          smokePdfPath,
          supportBundlePath: requireSmokeSupportBundlePath(
            smokeSupportBundlePath,
          ),
          writeBackupDiagnosticFixture() {
            desktopOperationalLogger.write(
              createDesktopOperationalEvent(
                {
                  correlationId: randomUUID(),
                  durationMs: 1,
                  eventName: 'backup.completed',
                  stage: 'portable',
                },
                desktopOperationalIdentity,
              ),
            );
          },
          reportStage: options.reportSmokeStage,
        });
        await runPackagedProfileBackupBeforeRestore({
          backupService: portableProfileBackupService,
          backendPort: backendHandle.port,
          profileSnapshotClient: profileSnapshotBrokerClient,
          reportStage: options.reportSmokeStage,
          restoreActivationService: profileRestoreActivationService,
          restoreStagingService: profileRestoreStagingService,
          runtimeInstanceId: options.runtimeInstanceId,
          runtimeSessionSecret,
          smokeRoot,
          stagingRoot: profileSnapshotPaths.stagingRoot,
        });
        return undefined;
      }

      await runPackagedProfileBackupAfterRestore({
        backupService: portableProfileBackupService,
        backendPort: backendHandle.port,
        profileSnapshotClient: profileSnapshotBrokerClient,
        reportStage: options.reportSmokeStage,
        runtimeInstanceId: options.runtimeInstanceId,
        runtimeSessionSecret,
        smokeRoot,
        stagingRoot: profileSnapshotPaths.stagingRoot,
      });
      if (options.smokeConfiguration.scenario === 'legacyInvoice') {
        await verifyPackagedLegacyInvoice({ smokeRoot,
          backendPort: backendHandle.port, runtimeSessionSecret });
      }
      desktopOperationalLogger.write(
        createDesktopOperationalEvent(
          {
            durationMs: Date.now() - smokeStartedAt,
            eventName: 'packagedSmoke.completed',
          },
          desktopOperationalIdentity,
        ),
      );
      await options.reportSmokeStage('shutdown');
      await lifecycleHandle.shutdown();
      await writePackagedSmokeResult(options.smokeConfiguration, {
        electronVersion: process.versions.electron,
        stage: 'shutdown',
        status: 'ok',
      });
      mainWindow.destroy();
      options.quitApplication();
      return undefined;
    } catch (error) {
      const errorCode =
        error instanceof ProfileSnapshotBrokerError
          ? error.code
          : error instanceof Error &&
              /^DESKTOP_SMOKE_[A-Z0-9_]{1,80}$/.test(error.message)
            ? error.message
          : 'PACKAGED_SMOKE_FAILED';
      desktopOperationalLogger.write(
        createDesktopOperationalEvent(
          {
            durationMs: Date.now() - smokeStartedAt,
            errorCode,
            eventName: 'packagedSmoke.failed',
            retryable: false,
            sideEffectState: 'unknown',
            stage: 'smoke',
          },
          desktopOperationalIdentity,
        ),
      );
      throw new Error(errorCode);
    }
  }

  reportDesktopStarted({
    identity: desktopOperationalIdentity,
    logger: desktopOperationalLogger,
    startedAt: desktopStartedAt,
  });

  void loadApplicationWindow(mainWindow).catch(() => {
    dependencies.showErrorBox(
      'Eky ei käynnistynyt',
      'Käyttöliittymää ei voitu ladata turvallisesti.',
    );
    options.quitApplication();
  });

  return lifecycleHandle;
}

const maximumSupportBundleBackendBytes = 8 * 1024 * 1024;
const maximumHealthResponseBytes = 1_024;

async function assertBackendHealth(
  backendOrigin: string,
  runtimeSessionSecret: string,
): Promise<void> {
  const response = await net.fetch(`${backendOrigin}/health`, {
    headers: createBackendRequestHeaders(
      new Headers(),
      runtimeSessionSecret,
    ),
    method: 'GET',
  });
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error('PROFILE_RESTORE_HEALTH_FAILED');
  }
  const declaredLength = Number(
    response.headers.get('content-length') ?? '0',
  );
  if (
    !Number.isFinite(declaredLength) ||
    declaredLength < 0 ||
    declaredLength > maximumHealthResponseBytes
  ) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error('PROFILE_RESTORE_HEALTH_FAILED');
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.byteLength > maximumHealthResponseBytes) {
    throw new Error('PROFILE_RESTORE_HEALTH_FAILED');
  }
  try {
    const value = JSON.parse(bytes.toString('utf8')) as unknown;
    if (
      typeof value !== 'object' ||
      value === null ||
      Array.isArray(value) ||
      Object.keys(value).length !== 1 ||
      !('status' in value) ||
      value.status !== 'ok'
    ) {
      throw new Error('PROFILE_RESTORE_HEALTH_FAILED');
    }
  } catch {
    throw new Error('PROFILE_RESTORE_HEALTH_FAILED');
  }
}

async function loadSupportBundleBackendData(
  backendOrigin: string,
  runtimeSessionSecret: string,
): Promise<unknown> {
  const response = await net.fetch(
    `${backendOrigin}/diagnostics/support-bundle-data`,
    {
      headers: createBackendRequestHeaders(
        new Headers(),
        runtimeSessionSecret,
      ),
      method: 'GET',
    },
  );
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error('SUPPORT_BUNDLE_BACKEND_REQUEST_FAILED');
  }
  const declaredLength = Number(
    response.headers.get('content-length') ?? '0',
  );
  if (
    !Number.isFinite(declaredLength) ||
    declaredLength < 0 ||
    declaredLength > maximumSupportBundleBackendBytes
  ) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error('SUPPORT_BUNDLE_BACKEND_RESPONSE_TOO_LARGE');
  }

  const responseBytes = Buffer.from(await response.arrayBuffer());
  if (responseBytes.byteLength > maximumSupportBundleBackendBytes) {
    throw new Error('SUPPORT_BUNDLE_BACKEND_RESPONSE_TOO_LARGE');
  }

  try {
    return JSON.parse(responseBytes.toString('utf8')) as unknown;
  } catch {
    throw new Error('SUPPORT_BUNDLE_BACKEND_RESPONSE_INVALID');
  }
}

function requireSmokeSupportBundlePath(
  value: string | undefined,
): string {
  if (value === undefined) {
    throw new Error('DESKTOP_SMOKE_SUPPORT_BUNDLE_PATH_MISSING');
  }
  return value;
}

function requireSmokeRoot(root: string | undefined): string {
  if (root === undefined) {
    throw new Error('DESKTOP_SMOKE_ROOT_MISSING');
  }

  return root;
}

function createInvoicePdfPreviewController(
  operationalIdentity: DesktopOperationalIdentity,
  operationalLogger: DesktopOperationalLogger,
  mainWindow: BrowserWindow,
  smokeMode: boolean,
  showApplicationError: (title: string, message: string) => void,
): InvoicePdfPreviewWindowController {
  return createInvoicePdfPreviewWindowController({
    createWindow: (windowOptions) => new BrowserWindow(windowOptions),
    ipcMain,
    mainWindow,
    restoreMainWindowFocus() {
      if (!smokeMode) {
        restoreWindowInputFocus(mainWindow);
      }
    },
    showSafeError() {
      operationalLogger.write(
        createDesktopOperationalEvent(
          {
            errorCode: 'PDF_PREVIEW_OPEN_FAILED',
            eventName: 'pdfPreview.openFailed',
            retryable: true,
            sideEffectState: 'none',
            stage: 'open',
          },
          operationalIdentity,
        ),
      );
      showApplicationError(
        'Laskua ei voitu avata',
        'Laskun PDF-esikatselua ei voitu avata turvallisesti.',
      );
    },
    async verifyPdfAvailable(url) {
      const response = await net.fetch(url);
      const contentType = response.headers.get('content-type') ?? '';
      const available =
        response.ok &&
        contentType.toLowerCase().startsWith('application/pdf');

      await response.body?.cancel().catch(() => undefined);

      return available;
    },
  });
}
