import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

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
import type {
  W6b2PackagedProofConfiguration,
  W6b2PackagedProofResult,
} from './w6b2PackagedProof.js';
import { runW6b2PackagedProofController } from './w6b2PackagedProofController.js';
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
import { createWorkspaceManagementComposition } from '../workspaces/management/workspaceManagementComposition.js';
import {
  createWorkspaceManagementCapability,
  type WorkspaceManagementCapability,
} from '../workspaces/management/workspaceManagementCapability.js';
import { confirmActiveWorkspaceReplacement } from '../workspaces/management/workspaceReplacementConfirmation.js';
import { DeferredWorkspaceRuntimeRelaunch } from '../workspaces/runtime/deferredWorkspaceRuntimeRelaunch.js';
import { MainOwnedActiveWorkspaceLifecycle } from '../workspaces/runtime/mainOwnedActiveWorkspaceLifecycle.js';
import { createWorkspaceFirstStartMigrationComposition } from '../workspaces/update/workspaceFirstStartMigrationComposition.js';
import { WorkspaceFirstStartMigrationOrchestratorError } from '../workspaces/update/workspaceFirstStartMigrationOrchestratorError.js';
import type { WorkspaceFirstStartMigrationOrchestration } from '../workspaces/update/workspaceFirstStartMigrationOrchestratorTypes.js';
import { createWorkspaceActivationMigrationComposition } from '../workspaces/update/workspaceActivationMigrationComposition.js';

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
  w6b2PackagedProof?: Readonly<{
    configuration: Readonly<W6b2PackagedProofConfiguration>;
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

  try {
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
    if (workspaceStartup.status === 'relaunching') return undefined;
    const { activeWorkspace, runtimeSessionSecret } = workspaceStartup;
    await workspaceFirstStartMigration.prepareBeforeBackend({
      activeWorkspaceId: activeWorkspace.workspaceId,
      workspaceState:
        activeWorkspace.mode === 'adoption'
          ? 'legacyAdoptionPendingAcceptance'
          : 'publishedRegistry',
    });
    return await startDesktopCompositionRuntime({
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
    });
  } catch (error) {
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
}: DesktopCompositionRuntimeOptions): Promise<
  DesktopLifecycleHandle | undefined
> {
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
  const workspaceMaintenanceLease =
    new InMemoryWorkspaceMaintenanceLease();
  const backendRequestQuiescence = new BackendRequestQuiescence();
  const workspaceRuntimeRelaunch = new DeferredWorkspaceRuntimeRelaunch(
    options.relaunchApplication,
  );
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
            launchWindowsInstallerRollback({
              failedPackagePath: failedPackage.packagePath,
              failedProductCode: failedPackage.productCode,
              rollbackPackagePath: rollbackPackage.packagePath,
              rollbackScriptPath: join(
                options.resourcesPath,
                'update-runtime',
                'rollbackWindowsInstaller.ps1',
              ),
              systemRoot: process.env.SystemRoot,
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
  let workspaceStartupAccepted = false;
  let targetBuildAccepted = false;
  let workspaceActivationRestoredProfileAwaitingDecision = false;
  let workspaceActivationTargetCommitted = false;
  let workspaceActivationRecoveryAmbiguous = false;

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
    return createUpdateRecoveryComposition({
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
          userDataRoot: options.userDataPath,
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
    backendHandle = await dependencies.startBackend({
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
          const binaryRollback =
            await updateBinaryRollbackCoordinator.startIfRequired();
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
        ...(isWorkspaceActivationReplacementRecovery &&
        profileRestoreStartupMode === 'validateRestoredProfile'
          ? { deferRestoredProfileAcceptance: true }
          : {}),
        mode: profileRestoreStartupMode,
        stopBackend: () => backendHandle!.stop(),
        async validateActiveProfile() {
          activeProfileValidation =
            await profileSnapshotBrokerClient.validateActiveProfile();
          await assertBackendHealth(
            `http://127.0.0.1:${backendHandle!.port}`,
            runtimeSessionSecret,
          );
        },
      });
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
    if (
      isWorkspaceActivationReplacementRecovery &&
      restoreStartupResult === 'restoredProfileReady'
    ) {
      workspaceActivationRestoredProfileAwaitingDecision = true;
      activeWorkspace.assertCanAccept(activeProfileValidation.profileId);
      try {
        await activeProfileRestoreStartupRecovery
          .acceptValidatedRestoredProfile();
        workspaceActivationRestoredProfileAwaitingDecision = false;
        workspaceActivationTargetCommitted = true;
      } catch (error) {
        const activationJournal = await workspaceReplacementStartupRecovery
          .journalStore.read()
          .catch(() => {
            workspaceActivationRecoveryAmbiguous = true;
            workspaceActivationRestoredProfileAwaitingDecision = false;
            return undefined;
          });
        if (activationJournal?.phase === 'accepted') {
          workspaceActivationRestoredProfileAwaitingDecision = false;
          workspaceActivationTargetCommitted = true;
        } else if (activationJournal === undefined) {
          workspaceActivationRecoveryAmbiguous = true;
          workspaceActivationRestoredProfileAwaitingDecision = false;
        }
        throw error;
      }
    }
    await activeWorkspace.accept(activeProfileValidation.profileId);
    workspaceStartupAccepted = true;
    await workspaceFirstStartMigration.transitionRegistryAfterActiveWorkspaceAcceptance();
    if (firstStartUpdateCoordinator !== undefined) {
      await firstStartUpdateCoordinator.acceptAfterBackendReady();
    }
    targetBuildAccepted = true;
    await workspaceFirstStartMigration.completeAfterTargetAcceptance();
    await recoveryPointScheduler.start();
  } catch (error) {
    await recoveryPointScheduler.stopChecks().catch(() => undefined);
    await backendHandle?.stop().catch(() => undefined);
    profileSnapshotBrokerClient.close();
    invoicePdfArchiveBrokerHandle.close();
    secretBrokerHandle.close();
    if (
      error instanceof DesktopBackendStartupStoppedError &&
      (updateRecoveryRelaunchRequested ||
        updateBinaryRollbackHandoffRequested ||
        workspaceActivationMigrationRelaunchRequested)
    ) {
      return undefined;
    }
    if (workspaceActivationRecoveryAmbiguous) {
      await activeWorkspace.requireRecovery?.().catch(() => undefined);
      throw new WorkspaceSwitchError('WORKSPACE_SWITCH_RECOVERY_REQUIRED');
    }
    if (workspaceActivationRestoredProfileAwaitingDecision) {
      try {
        await activeProfileRestoreStartupRecovery
          .rollbackValidatedRestoredProfile();
      } catch {
        await activeWorkspace.requireRecovery?.().catch(() => undefined);
        throw new WorkspaceSwitchError(
          'WORKSPACE_SWITCH_RECOVERY_REQUIRED',
        );
      }
      workspaceActivationRestoredProfileAwaitingDecision = false;
      const workspaceRecovery = await activeWorkspace.recoverFromFailure();
      if (workspaceRecovery === 'relaunchRequired') {
        options.relaunchApplication();
        return undefined;
      }
      throw new WorkspaceSwitchError('WORKSPACE_SWITCH_RECOVERY_REQUIRED');
    }
    if (!workspaceStartupAccepted && !workspaceActivationTargetCommitted) {
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
      showMessageBox: dependencies.showMessageBox,
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
      if (kind === 'restore') {
        deliveryConfirmation.showApplicationError(
          'Varmuuskopiota ei voitu palauttaa',
          'Palautusta ei voitu valmistella tai käynnistää turvallisesti. Nykyisiä tietoja ei korvattu.',
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

  const disposeWorkspaceRuntimeCapabilities = async (): Promise<void> => {
    workspaceManagementCapability?.dispose();
    pdfPreviewController?.dispose();
    pdfPreviewController = undefined;
    operationalLogFolderCapability?.dispose();
    operationalLogFolderCapability = undefined;
    invoicePdfArchiveCapability?.dispose();
    invoicePdfArchiveCapability = undefined;
    supportBundleCapability?.dispose();
    supportBundleCapability = undefined;
    localUpdateSelectionCapability?.dispose();
    localUpdateSelectionCapability = undefined;
    profileBackupCapability?.dispose();
    profileBackupCapability = undefined;
    backupPasswordWindowController?.dispose();
    backupPasswordWindowController = undefined;
  };
  const closeWorkspaceRuntimeBrokers = async (): Promise<void> => {
    profileSnapshotBrokerClient.close();
    invoicePdfArchiveBrokerHandle.close();
    secretBrokerHandle.close();
  };
  const activeWorkspaceLifecycle = new MainOwnedActiveWorkspaceLifecycle(
    activeWorkspace.workspaceId,
    backendRequestQuiescence,
    {
      closeBrokers: closeWorkspaceRuntimeBrokers,
      disposeCapabilities: disposeWorkspaceRuntimeCapabilities,
      async stopBackend() {
        await backendHandle.stop();
        await recoveryPointScheduler.markCleanShutdown();
      },
      stopRecoveryPointScheduler: () => recoveryPointScheduler.stopChecks(),
    },
    workspaceRuntimeRelaunch,
  );
  const workspaceManagementComposition =
    await createWorkspaceManagementComposition({
      activeWorkspaceId: activeWorkspace.workspaceId,
      activeWorkspaceLifecycle,
      appVersion: desktopAppVersion,
      buildRevision: options.buildInfo.buildRevision,
      localUpdateRuntimePaths,
      maintenanceLease: workspaceMaintenanceLease,
      profileRestoreActivationJournalPath:
        profileSnapshotPaths.restoreActivationJournalPath,
      recoveryPointService,
      resourcesPath: options.resourcesPath,
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

  const lifecycleHandle: DesktopLifecycleHandle = {
    applicationWindow: mainWindow,
    focusApplicationWindow() {
      restoreWindowInputFocus(mainWindow);
    },
    async shutdown() {
      if (shutdownStarted) {
        return;
      }

      shutdownStarted = true;
      const shutdownStartedAt = Date.now();
      desktopOperationalLogger.write(
        createDesktopOperationalEvent(
          { eventName: 'desktop.shutdownStarted' },
          desktopOperationalIdentity,
        ),
      );
      try {
        const runtimeState = activeWorkspaceLifecycle.readState();
        if (runtimeState === 'active') {
          await activeWorkspaceLifecycle.quiesceWrites(
            activeWorkspace.workspaceId,
          );
        }
        if (activeWorkspaceLifecycle.readState() === 'quiesced') {
          await activeWorkspaceLifecycle.stopAndProveHandlesClosed(
            activeWorkspace.workspaceId,
          );
        } else if (activeWorkspaceLifecycle.readState() !== 'stopped') {
          throw new Error('WORKSPACE_RUNTIME_RECOVERY_REQUIRED');
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
      } catch {
        await recoveryPointScheduler.stopChecks().catch(() => undefined);
        await disposeWorkspaceRuntimeCapabilities().catch(() => undefined);
        await backendHandle.stop().catch(() => undefined);
        await closeWorkspaceRuntimeBrokers().catch(() => undefined);
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
        throw new Error('DESKTOP_SHUTDOWN_FAILED');
      } finally {
        workspaceManagementCapability?.dispose();
        workspaceManagementCapability = undefined;
        workspaceManagementComposition.dispose();
      }
    },
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
      profileProtection: updateProfileProtection,
      shutdownRuntime: () => lifecycleHandle.shutdown(),
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
    const result =
      localUpdatePackageCache === undefined || handoffCoordinator === undefined
        ? {
            errorCode: 'W6B2_PROOF_CONFIGURATION_INVALID' as const,
            formatVersion: 1 as const,
            phase: proof.configuration.phase,
            status: 'failed' as const,
          }
        : await runW6b2PackagedProofController({
            cache: localUpdatePackageCache,
            configuration: proof.configuration,
            handoff: handoffCoordinator,
            isQuitRequested: proof.isQuitRequested,
            isRelaunchRequested: proof.isRelaunchRequested,
            lifecycle: lifecycleHandle,
            workspaceManagement: workspaceManagementComposition.service,
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

  desktopOperationalLogger.write(
    createDesktopOperationalEvent(
      {
        durationMs: Date.now() - desktopStartedAt,
        eventName: 'desktop.started',
      },
      desktopOperationalIdentity,
    ),
  );

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
