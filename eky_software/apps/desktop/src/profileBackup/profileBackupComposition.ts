import type {
  BrowserWindow,
  IpcMain,
  OpenDialogOptions,
  OpenDialogReturnValue,
  SaveDialogOptions,
  SaveDialogReturnValue,
} from 'electron';

import type { DesktopOperationalIdentity } from '../observability/desktopOperationalEvent.js';
import type { DesktopOperationalLogger } from '../observability/desktopOperationalLogger.js';
import type { WorkspaceMaintenanceLease } from '../workspaces/maintenance/workspaceMaintenanceLease.js';
import type { BackupPasswordWindowController } from './passwordWindow/backupPasswordWindow.js';
import { createBackupPasswordWindowController } from './passwordWindow/backupPasswordWindow.js';
import { PortableProfileBackupService } from './portableProfileBackup.js';
import type { ProfileBackupCapability } from './profileBackupCapability.js';
import { createProfileBackupCapability } from './profileBackupCapability.js';
import type { ProfileRecoveryOperationalObserver } from './profileRecoveryOperationalObserver.js';
import { PortableProfileBackupStatusStore } from './portableProfileBackupStatusStore.js';
import type { ProfileSnapshotBrokerClient } from './profileSnapshotBrokerClient.js';
import type { ProfileSnapshotRuntimePaths } from './profileSnapshotRuntimePaths.js';
import type { RecoveryPointService } from './recoveryPoint/recoveryPointService.js';
import { ProfileRestoreActivationService } from './restore/profileRestoreActivationService.js';
import type { ProfileRestoreActivationTransaction } from './restore/profileRestoreActivationTransaction.js';
import { ProfileRestoreStagingService } from './restore/profileRestoreStagingService.js';

interface ProfileBackupCompositionOptions {
  appVersion: string;
  createWindow: Parameters<
    typeof createBackupPasswordWindowController
  >[0]['createWindow'];
  forbiddenRoots: readonly string[];
  ipcMain: Pick<IpcMain, 'handle' | 'removeHandler'>;
  mainWindow: BrowserWindow;
  maintenanceLease: WorkspaceMaintenanceLease;
  operationalIdentity: DesktopOperationalIdentity;
  operationalLogger: DesktopOperationalLogger;
  passwordPreloadPath: string;
  paths: ProfileSnapshotRuntimePaths;
  profileRecoveryOperationalObserver: ProfileRecoveryOperationalObserver;
  profileSnapshotClient: ProfileSnapshotBrokerClient;
  recoveryPointService: RecoveryPointService;
  relaunchApplication(): void;
  showOpenDialog(
    owner: BrowserWindow,
    options: OpenDialogOptions,
  ): Promise<OpenDialogReturnValue>;
  showSafeError(
    kind: 'create' | 'inspect' | 'recoveryPoint',
  ): void;
  showSaveDialog(
    owner: BrowserWindow,
    options: SaveDialogOptions,
  ): Promise<SaveDialogReturnValue>;
  stopBusinessRuntime(): Promise<void>;
  restoreActivationTransaction: ProfileRestoreActivationTransaction;
}

export interface ProfileBackupComposition {
  backupPasswordWindowController: BackupPasswordWindowController;
  portableProfileBackupService: PortableProfileBackupService;
  profileBackupCapability: ProfileBackupCapability;
  profileRestoreActivationService: ProfileRestoreActivationService;
  profileRestoreStagingService: ProfileRestoreStagingService;
}

export async function createProfileBackupComposition(
  options: ProfileBackupCompositionOptions,
): Promise<ProfileBackupComposition> {
  const passwordWindow = createBackupPasswordWindowController({
    createWindow: options.createWindow,
    ipcMain: options.ipcMain,
    parentWindow: options.mainWindow,
    preloadPath: options.passwordPreloadPath,
  });
  const statusStore = new PortableProfileBackupStatusStore(
    options.paths.portableBackupStatusPath,
  );
  const persistedStatus = await statusStore.read().catch(() => undefined);
  const backupService = new PortableProfileBackupService({
    appVersion: options.appVersion,
    forbiddenRoots: options.forbiddenRoots,
    ...(persistedStatus === undefined
      ? {}
      : {
          initialLatestSuccessfulPortableBackupAt:
            persistedStatus.completedAt,
        }),
    profileSnapshotClient: options.profileSnapshotClient,
    quarantineRoot: options.paths.quarantineRoot,
    recordSuccessfulBackup: (record) => statusStore.write(record),
    stagingRoot: options.paths.stagingRoot,
  });
  const restoreStagingService = new ProfileRestoreStagingService({
    observer: options.profileRecoveryOperationalObserver,
    profileSnapshotClient: options.profileSnapshotClient,
    quarantineRoot: options.paths.quarantineRoot,
    recoveryPointService: options.recoveryPointService,
    stagingRoot: options.paths.stagingRoot,
  });
  const restoreActivationService = new ProfileRestoreActivationService({
    observer: options.profileRecoveryOperationalObserver,
    profileSnapshotClient: options.profileSnapshotClient,
    relaunchApplication: options.relaunchApplication,
    stagingService: restoreStagingService,
    stopBusinessRuntime: options.stopBusinessRuntime,
    transaction: options.restoreActivationTransaction,
  });
  const capability = createProfileBackupCapability({
    backupService,
    ipcMain: options.ipcMain,
    mainWindow: options.mainWindow,
    maintenanceLease: options.maintenanceLease,
    operationalIdentity: options.operationalIdentity,
    operationalLogger: options.operationalLogger,
    passwordWindow,
    recoveryPointService: options.recoveryPointService,
    selectBackupSource: () => selectBackupSource(options),
    selectBackupTarget: (defaultFileName) =>
      selectBackupTarget(options, defaultFileName),
    showSafeError: options.showSafeError,
  });

  return {
    backupPasswordWindowController: passwordWindow,
    portableProfileBackupService: backupService,
    profileBackupCapability: capability,
    profileRestoreActivationService: restoreActivationService,
    profileRestoreStagingService: restoreStagingService,
  };
}

async function selectBackupSource(
  options: ProfileBackupCompositionOptions,
): Promise<string | null> {
  const result = await options.showOpenDialog(options.mainWindow, {
    filters: [{ extensions: ['ekybackup'], name: 'Eky-varmuuskopio' }],
    message: 'Valitse tarkistettava Eky-varmuuskopio',
    properties: ['openFile'],
    title: 'Tarkista Eky-varmuuskopio',
  });
  return readSingleSelectedPath(result);
}

async function selectBackupTarget(
  options: ProfileBackupCompositionOptions,
  defaultFileName: string,
): Promise<string | null> {
  const result = await options.showSaveDialog(options.mainWindow, {
    defaultPath: defaultFileName,
    filters: [
      { extensions: ['ekybackup'], name: 'Salattu Eky-varmuuskopio' },
    ],
    title: 'Tallenna salattu Eky-varmuuskopio',
  });
  return result.canceled || result.filePath === ''
    ? null
    : result.filePath;
}

function readSingleSelectedPath(result: OpenDialogReturnValue): string | null {
  return result.canceled || result.filePaths.length !== 1
    ? null
    : result.filePaths[0] ?? null;
}
