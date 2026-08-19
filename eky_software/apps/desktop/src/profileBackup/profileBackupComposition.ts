import type {
  BrowserWindow,
  IpcMain,
  MessageBoxOptions,
  MessageBoxReturnValue,
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
import type { ProfileBackupInspectionSummary } from './profileBackupInspectionTypes.js';
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
  showMessageBox(
    owner: BrowserWindow | undefined,
    options: MessageBoxOptions,
  ): Promise<MessageBoxReturnValue>;
  showOpenDialog(
    owner: BrowserWindow,
    options: OpenDialogOptions,
  ): Promise<OpenDialogReturnValue>;
  showSafeError(
    kind: 'create' | 'inspect' | 'recoveryPoint' | 'restore',
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
    confirmRestoreActivation: (restore) =>
      confirmRestoreActivation(options, restore),
    confirmRestoreReplacement: (summary) =>
      confirmRestoreReplacement(options, summary),
    ipcMain: options.ipcMain,
    mainWindow: options.mainWindow,
    maintenanceLease: options.maintenanceLease,
    operationalIdentity: options.operationalIdentity,
    operationalLogger: options.operationalLogger,
    passwordWindow,
    recoveryPointService: options.recoveryPointService,
    restoreActivationService,
    restoreStagingService,
    selectBackupSource: () => selectBackupSource(options),
    selectBackupTarget: (defaultFileName) =>
      selectBackupTarget(options, defaultFileName),
    selectRestoreSource: () => selectRestoreSource(options),
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

async function confirmRestoreActivation(
  options: ProfileBackupCompositionOptions,
  restore: { summary: ProfileBackupInspectionSummary },
): Promise<boolean> {
  const result = await options.showMessageBox(options.mainWindow, {
    buttons: ['Peruuta', 'Korvaa tiedot ja käynnistä Eky uudelleen'],
    cancelId: 0,
    defaultId: 0,
    detail: [
      formatProfileBackupSummary(restore.summary),
      '',
      'Palautusta edeltävä konekohtainen palautuspiste on luotu.',
      'Eky sulkee nykyisen työtilan ja käynnistyy uudelleen.',
    ].join('\n'),
    message: 'Vahvista vielä tietojen korvaaminen ja uudelleenkäynnistys.',
    noLink: true,
    title: 'Palauta Eky-varmuuskopio',
    type: 'warning',
  });
  return result.response === 1;
}

async function confirmRestoreReplacement(
  options: ProfileBackupCompositionOptions,
  summary: ProfileBackupInspectionSummary,
): Promise<boolean> {
  const result = await options.showMessageBox(options.mainWindow, {
    buttons: ['Peruuta', 'Jatka palautuksen valmisteluun'],
    cancelId: 0,
    defaultId: 0,
    detail: [
      formatProfileBackupSummary(summary),
      '',
      'Nykyinen paikallinen yritystyötila korvataan varmuuskopion tiedoilla.',
      'Ennen korvaamista Eky luo konekohtaisen palautuspisteen.',
    ].join('\n'),
    message: 'Haluatko valmistella varmuuskopion palautuksen?',
    noLink: true,
    title: 'Palauta Eky-varmuuskopio',
    type: 'warning',
  });
  return result.response === 1;
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

async function selectRestoreSource(
  options: ProfileBackupCompositionOptions,
): Promise<string | null> {
  const result = await options.showOpenDialog(options.mainWindow, {
    filters: [
      { extensions: ['ekybackup'], name: 'Salattu Eky-varmuuskopio' },
    ],
    message: 'Valitse palautettava Eky-varmuuskopio',
    properties: ['openFile'],
    title: 'Palauta Eky-varmuuskopiosta',
  });
  return readSingleSelectedPath(result);
}

function readSingleSelectedPath(result: OpenDialogReturnValue): string | null {
  return result.canceled || result.filePaths.length !== 1
    ? null
    : result.filePaths[0] ?? null;
}

function formatProfileBackupSummary(
  summary: ProfileBackupInspectionSummary,
): string {
  const createdAt = new Intl.DateTimeFormat('fi-FI', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(summary.createdAt));
  const sizeInMegabytes = (
    summary.totalBusinessByteSize /
    (1024 * 1024)
  ).toLocaleString('fi-FI', {
    maximumFractionDigits: 1,
    minimumFractionDigits: 1,
  });

  return [
    `Varmuuskopio luotu: ${createdAt}`,
    `Eky-versio: ${summary.appVersion}`,
    `Laskuasiakirjoja: ${summary.documentCount}`,
    `Tietojen koko: ${sizeInMegabytes} Mt`,
  ].join('\n');
}
