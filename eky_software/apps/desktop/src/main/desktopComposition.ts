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
import { restoreWindowInputFocus } from './windowInputFocus.js';
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
import { DirectSetupBusinessRollbackCoordinator } from '../update/directSetupBusinessRollbackCoordinator.js';
import { migrateLegacyLocalUpdateState } from '../update/migrateLegacyLocalUpdateState.js';
import { AcceptedBuildMetadataStore } from '../update/acceptedBuildMetadataStore.js';
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
import type { PackagedUpdateSmokeConfiguration } from '../update/packagedUpdateSmokeConfiguration.js';
import {
  runPackagedUpdateSmoke,
  writePackagedUpdateSmokeHandoffResult,
} from '../update/packagedUpdateSmoke.js';

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
  updateSmokeConfiguration: PackagedUpdateSmokeConfiguration;
  userDataPath: string;
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
};

export async function startDesktopComposition(
  options: StartDesktopCompositionOptions,
): Promise<DesktopLifecycleHandle | undefined> {
  const dependencies = {
    ...defaultDesktopCompositionDependencies,
    ...options.dependencies,
  };
  const smokeMode = options.smokeConfiguration.enabled;
  const automationMode =
    smokeMode || options.updateSmokeConfiguration.enabled;
  const runtimeSessionSecret = dependencies.createRuntimeSession();
  const backendRoot = join(options.resourcesPath, 'backend');
  const profilePaths = createDesktopProfilePaths(options.userDataPath);
  const dataRoot = profilePaths.runtimeRoot;
  const operationalLogsRoot = join(dataRoot, 'logs');
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
    return await startDesktopCompositionRuntime({
      backendRoot,
      dataRoot,
      desktopAppVersion,
      desktopOperationalIdentity,
      desktopOperationalLogger,
      desktopStartedAt,
      operationalLogsRoot,
      options,
      dependencies,
      runtimeSessionSecret,
      automationMode,
      smokeMode,
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
            sideEffectState: 'unknown',
            stage: 'startup',
          },
          desktopOperationalIdentity,
        ),
      );
    } catch {
      // The safe outer bootstrap boundary remains authoritative.
    }
    throw new Error(errorCode);
  }
}

interface DesktopCompositionRuntimeOptions {
  automationMode: boolean;
  backendRoot: string;
  dataRoot: string;
  desktopAppVersion: string;
  desktopOperationalIdentity: DesktopOperationalIdentity;
  desktopOperationalLogger: DesktopOperationalLogger;
  desktopStartedAt: number;
  dependencies: DesktopCompositionDependencies;
  operationalLogsRoot: string;
  options: StartDesktopCompositionOptions;
  runtimeSessionSecret: string;
  smokeMode: boolean;
}

async function startDesktopCompositionRuntime({
  automationMode,
  backendRoot,
  dataRoot,
  desktopAppVersion,
  desktopOperationalIdentity,
  desktopOperationalLogger,
  desktopStartedAt,
  dependencies,
  operationalLogsRoot,
  options,
  runtimeSessionSecret,
  smokeMode,
}: DesktopCompositionRuntimeOptions): Promise<
  DesktopLifecycleHandle | undefined
> {
  const { databaseFilePath, invoiceDocumentStorageRoot } =
    createDesktopProfilePaths(options.userDataPath);
  const profileSnapshotPaths = createProfileSnapshotRuntimePaths(dataRoot);
  const localUpdateRuntimePaths = createLocalUpdateRuntimePaths({
    legacyRuntimeRoot: dataRoot,
    userDataPath: options.userDataPath,
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
  const secretFilePath = join(
    dataRoot,
    'secrets',
    'company-email-smtp-v1.dat',
  );
  const encryptedSecretFile = createPackagedSmokeSecretFileStore(
    secretFilePath,
    smokeMode,
  );
  const smokePdfPath = join(dataRoot, 'smoke', 'approved-invoice-smoke.pdf');
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
  });
  let backendStartupControl: DesktopBackendStartupControl | undefined;
  let updateRecoveryRelaunchRequested = false;
  let updateBinaryRollbackHandoffRequested = false;
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
  const directSetupBusinessRollbackCoordinator =
    options.releaseInfo === undefined
      ? undefined
      : new DirectSetupBusinessRollbackCoordinator({
          observer: updateObserver,
          profileProtection: updateProfileProtection,
          recoveryStore: directSetupMigrationRecoveryStore,
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
  let localUpdateHandoffCoordinator:
    | LocalUpdateHandoffCoordinator
    | undefined;
  let backupPasswordWindowController:
    | BackupPasswordWindowController
    | undefined;
  let profileBackupCapability: ProfileBackupCapability | undefined;
  let shutdownStarted = false;

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
    pendingDirectSetupRecovery,
  ] =
    await Promise.all([
      profileRestoreActivationJournalStore.read(),
      updateJournalStore.read(),
      directSetupMigrationRecoveryStore.read(),
    ]);
  let startupRecoveryAuthority;
  try {
    startupRecoveryAuthority = resolveStartupRecoveryAuthority({
      directSetupRecovery: pendingDirectSetupRecovery,
      profileRestoreJournal: pendingProfileRestoreJournal,
      updateJournal: pendingUpdateJournal,
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
    pendingDirectSetupRecovery?.state === 'failedSafe' ||
    (pendingDirectSetupRecovery?.state === 'awaitingPreviousBuild' &&
      options.releaseInfo !== undefined &&
      buildIdentityMatches(
        pendingDirectSetupRecovery.runningTargetBuildIdentity,
        options.releaseInfo,
      ))
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
          pendingDirectSetupRecovery.state === 'awaitingPreviousBuild'
            ? 'UPDATE_DIRECT_SETUP_PREVIOUS_SETUP_REQUIRED'
            : 'UPDATE_DIRECT_SETUP_RECOVERY_REQUIRED',
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
  const profileRestoreStartupMode =
    await profileRestoreStartupRecovery.prepareBeforeBackend();
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
    createInvoicePdfArchiveRuntimePaths(dataRoot);
  let backendHandle: DesktopBackendHandle | undefined;
  const invoicePdfArchiveService = new InvoicePdfArchiveService({
    configStore: new InvoicePdfArchiveConfigStore(
      invoicePdfArchivePaths.configFilePath,
    ),
    journalStore: new InvoicePdfArchiveJournalStore(
      invoicePdfArchivePaths.journalFilePath,
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
        if (startupRecoveryAuthority === 'updateBusinessRollback') {
          if (updateBusinessRollbackCoordinator === undefined) {
            throw new Error('UPDATE_BUSINESS_ROLLBACK_RECOVERY_REQUIRED');
          }
          const restoreResult =
            await profileRestoreStartupRecovery.validateAfterBackend({
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
        if (startupRecoveryAuthority === 'directSetupBusinessRollback') {
          if (directSetupBusinessRollbackCoordinator === undefined) {
            throw new Error('UPDATE_DIRECT_SETUP_RECOVERY_REQUIRED');
          }
          const restoreResult =
            await profileRestoreStartupRecovery.validateAfterBackend({
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
            await directSetupBusinessRollbackCoordinator
              .requireRecoveryAfterRestoreRollback();
          }
          if (profileRestoreStartupMode !== 'validateRestoredProfile') {
            throw new Error('UPDATE_DIRECT_SETUP_RECOVERY_REQUIRED');
          }
          await directSetupBusinessRollbackCoordinator
            .completeAfterProfileValidation({ inspection });
          await control.stopStartupRuntime();
          updateRecoveryRelaunchRequested = true;
          options.relaunchApplication();
          return;
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
        if (directSetupBusinessRollbackCoordinator !== undefined) {
          const rollback =
            await directSetupBusinessRollbackCoordinator.startIfRequired(
              inspection,
            );
          if (rollback === 'relaunching') {
            return;
          }
          if (rollback === 'validationRequired') {
            await directSetupBusinessRollbackCoordinator
              .completeAfterProfileValidation({ inspection });
            await control.stopStartupRuntime();
            updateRecoveryRelaunchRequested = true;
            options.relaunchApplication();
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
        await firstStartUpdateCoordinator.beforeMigrations(inspection);
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
      await profileRestoreStartupRecovery.validateAfterBackend({
        mode: profileRestoreStartupMode,
        stopBackend: () => backendHandle!.stop(),
        async validateActiveProfile() {
          await profileSnapshotBrokerClient.validateActiveProfile();
          await assertBackendHealth(
            `http://127.0.0.1:${backendHandle!.port}`,
            runtimeSessionSecret,
          );
        },
      });
    if (restoreStartupResult === 'relaunchRequired') {
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
    if (firstStartUpdateCoordinator !== undefined) {
      await assertDifferentRuntimeSessionRejected({
        backendOrigin: `http://127.0.0.1:${backendHandle.port}`,
        createRuntimeSession: dependencies.createRuntimeSession,
        fetchImplementation: (url, init) => net.fetch(url, init),
        runtimeSessionSecret,
      });
      await firstStartUpdateCoordinator.acceptAfterBackendReady();
    }
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
        updateBinaryRollbackHandoffRequested)
    ) {
      return undefined;
    }
    if (
      firstStartUpdateCoordinator !== undefined &&
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
    if (!automationMode) {
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
    !automationMode,
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
    openPath: automationMode
      ? async (path) =>
          path === operationalLogsRoot
            ? ''
            : 'OPERATIONAL_LOG_FOLDER_SMOKE_ROOT_INVALID'
      : dependencies.openPath,
    operationalLogger: desktopOperationalLogger,
    operationalIdentity: desktopOperationalIdentity,
    runtimeRoot: dataRoot,
    showSafeError() {
      deliveryConfirmation.showApplicationError(
        'Lokikansiota ei voitu avata',
        'Eky-lokikansiota ei voitu avata turvallisesti.',
      );
    },
  });
  invoicePdfArchiveCapability = createInvoicePdfArchiveCapability({
    async confirmChange() {
      if (automationMode) {
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
      if (automationMode) {
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
      if (automationMode) {
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
    runtimeRoot: dataRoot,
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
        dataRoot,
        options.applicationPath,
        options.resourcesPath,
      ],
      ipcMain,
      mainWindow,
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
      relaunchApplication: options.updateSmokeConfiguration.enabled
        ? () => undefined
        : options.relaunchApplication,
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
    removeExpiredSupportBundleTemporaryFiles(dataRoot);
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
    automationMode,
    deliveryConfirmation.showApplicationError,
  );

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

      try {
        await recoveryPointScheduler.stopChecks();
        await backendHandle.stop();
        await recoveryPointScheduler.markCleanShutdown();
        profileSnapshotBrokerClient.close();
        invoicePdfArchiveBrokerHandle.close();
        secretBrokerHandle.close();
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
        profileSnapshotBrokerClient.close();
        invoicePdfArchiveBrokerHandle.close();
        secretBrokerHandle.close();
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
      }
    },
  };

  if (
    options.releaseInfo !== undefined &&
    localUpdatePackageCache !== undefined
  ) {
    localUpdateHandoffCoordinator = new LocalUpdateHandoffCoordinator({
      cache: localUpdatePackageCache,
      journalStore: updateJournalStore,
      async launchInstaller(candidate) {
        if (options.updateSmokeConfiguration.enabled) {
          await writePackagedUpdateSmokeHandoffResult(
            options.updateSmokeConfiguration,
            desktopAppVersion,
          );
          options.quitApplication();
          return;
        }
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
        handoffCoordinator: localUpdateHandoffCoordinator,
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

  if (options.updateSmokeConfiguration.enabled) {
    if (
      options.releaseInfo === undefined ||
      localUpdatePackageCache === undefined ||
      localUpdateHandoffCoordinator === undefined
    ) {
      throw new Error('DESKTOP_UPDATE_SMOKE_RELEASE_INFO_MISSING');
    }
    await runPackagedUpdateSmoke({
      acceptedBuildStore: acceptedBuildMetadataStore,
      appVersion: desktopAppVersion,
      backend: backendHandle,
      buildRevision: options.buildInfo.buildRevision,
      cache: localUpdatePackageCache,
      configuration: options.updateSmokeConfiguration,
      directSetupRecoveryStore: directSetupMigrationRecoveryStore,
      handoffCoordinator: localUpdateHandoffCoordinator,
      journalStore: updateJournalStore,
      portableProfileBackupService,
      profileRestoreActivationService,
      profileRestoreStagingService,
      profileSnapshotClient: profileSnapshotBrokerClient,
      releaseInfo: options.releaseInfo,
      runtimeSessionSecret,
      async shutdownAndQuit() {
        await lifecycleHandle.shutdown();
        mainWindow.destroy();
        options.quitApplication();
      },
    });
    return undefined;
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

function buildIdentityMatches(
  identity: Readonly<{ appVersion: string; buildRevision: string }>,
  releaseInfo: Readonly<DesktopReleaseInfo>,
): boolean {
  return (
    identity.appVersion === releaseInfo.appVersion &&
    identity.buildRevision === releaseInfo.buildRevision
  );
}

function createInvoicePdfPreviewController(
  operationalIdentity: DesktopOperationalIdentity,
  operationalLogger: DesktopOperationalLogger,
  mainWindow: BrowserWindow,
  automationMode: boolean,
  showApplicationError: (title: string, message: string) => void,
): InvoicePdfPreviewWindowController {
  return createInvoicePdfPreviewWindowController({
    createWindow: (windowOptions) => new BrowserWindow(windowOptions),
    ipcMain,
    mainWindow,
    restoreMainWindowFocus() {
      if (!automationMode) {
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
