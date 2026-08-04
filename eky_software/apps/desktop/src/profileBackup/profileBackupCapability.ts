import { randomUUID } from 'node:crypto';

import type {
  BrowserWindow,
  IpcMain,
  IpcMainInvokeEvent,
} from 'electron';

import { createDesktopOperationalEvent } from '../observability/createDesktopOperationalEvent.js';
import type { DesktopOperationalIdentity } from '../observability/desktopOperationalEvent.js';
import type { DesktopOperationalLogger } from '../observability/desktopOperationalLogger.js';
import type { BackupPasswordWindowController } from './passwordWindow/backupPasswordWindow.js';
import type { RecoveryPointService } from './recoveryPoint/recoveryPointService.js';
import {
  createPortableProfileBackupFileName,
  type PortableProfileBackupService,
} from './portableProfileBackup.js';
import {
  activatePreparedProfileRestoreIpcChannel,
  createManualRecoveryPointIpcChannel,
  createProfileBackupIpcChannel,
  getProfileBackupStatusIpcChannel,
  inspectProfileBackupIpcChannel,
  prepareProfileRestoreIpcChannel,
  type CreateProfileBackupResult,
  type InspectProfileBackupResult,
  type ProfileProtectionStatus,
} from './portableProfileBackupTypes.js';
import { createProfileProtectionStatus } from './profileProtectionStatus.js';
import { createProfileRestoreCapabilityController } from './profileRestoreCapabilityController.js';
import type { ProfileRestoreActivationService } from './restore/profileRestoreActivationService.js';
import type {
  PreparedProfileRestore,
  ProfileRestoreStagingService,
} from './restore/profileRestoreStagingService.js';

interface ProfileBackupCapabilityOptions {
  backupService: Pick<
    PortableProfileBackupService,
    'create' | 'getStatus' | 'inspect'
  >;
  ipcMain: Pick<IpcMain, 'handle' | 'removeHandler'>;
  mainWindow: BrowserWindow;
  now?(): Date;
  operationalIdentity: DesktopOperationalIdentity;
  operationalLogger: DesktopOperationalLogger;
  passwordWindow: BackupPasswordWindowController;
  recoveryPointService: Pick<
    RecoveryPointService,
    'createManual' | 'getStatus'
  >;
  restoreActivationService: Pick<
    ProfileRestoreActivationService,
    'activate'
  >;
  restoreStagingService: Pick<
    ProfileRestoreStagingService,
    'discardPreparedRestore' | 'inspect' | 'stage'
  >;
  confirmRestoreActivation(
    restore: Pick<
      PreparedProfileRestore,
      'summary' | 'targetDisposition'
    >,
  ): Promise<boolean>;
  confirmRestoreReplacement(
    summary: PreparedProfileRestore['summary'],
  ): Promise<boolean>;
  selectBackupSource(): Promise<string | null>;
  selectBackupTarget(defaultFileName: string): Promise<string | null>;
  selectRestoreSource(): Promise<string | null>;
  showSafeError(
    kind: 'create' | 'inspect' | 'recoveryPoint' | 'restore',
  ): void;
}

export interface ProfileBackupCapability {
  dispose(): void;
}

export function createProfileBackupCapability(
  options: ProfileBackupCapabilityOptions,
): ProfileBackupCapability {
  let activeOperation = false;
  const restoreController = createProfileRestoreCapabilityController({
    confirmActivation: options.confirmRestoreActivation,
    confirmReplacement: options.confirmRestoreReplacement,
    passwordWindow: options.passwordWindow,
    restoreActivationService: options.restoreActivationService,
    restoreStagingService: options.restoreStagingService,
    selectSource: options.selectRestoreSource,
    showSafeError: () => options.showSafeError('restore'),
  });

  registerNoArgumentHandler(
    options,
    getProfileBackupStatusIpcChannel,
    (): ProfileProtectionStatus =>
      createProfileProtectionStatus(
        options.backupService.getStatus(),
        options.recoveryPointService.getStatus(),
        restoreController.getOperationState(),
      ),
  );
  registerNoArgumentHandler(
    options,
    createProfileBackupIpcChannel,
    () =>
      runExclusive(async (): Promise<CreateProfileBackupResult> => {
        const targetPath = await options.selectBackupTarget(
          createPortableProfileBackupFileName(
            options.now?.() ?? new Date(),
          ),
        );
        if (targetPath === null) {
          return 'cancelled';
        }
        const password = await options.passwordWindow.requestPassword(
          'create',
        );
        if (password === null) {
          return 'cancelled';
        }

        const correlationId = randomUUID();
        const startedAt = Date.now();
        options.operationalLogger.write(
          createDesktopOperationalEvent(
            {
              correlationId,
              eventName: 'backup.started',
              stage: 'portable',
            },
            options.operationalIdentity,
          ),
        );
        try {
          await options.backupService.create({
            destinationPath: targetPath,
            password,
          });
          options.operationalLogger.write(
            createDesktopOperationalEvent(
              {
                correlationId,
                durationMs: Date.now() - startedAt,
                eventName: 'backup.completed',
                stage: 'portable',
              },
              options.operationalIdentity,
            ),
          );
          return 'created';
        } catch {
          options.operationalLogger.write(
            createDesktopOperationalEvent(
              {
                correlationId,
                durationMs: Date.now() - startedAt,
                errorCode: 'PROFILE_BACKUP_CREATE_FAILED',
                eventName: 'backup.failed',
                retryable: true,
                sideEffectState: 'unknown',
                stage: 'portable',
              },
              options.operationalIdentity,
            ),
          );
          options.showSafeError('create');
          throw new Error('PROFILE_BACKUP_CREATE_FAILED');
        }
      }),
  );
  registerNoArgumentHandler(
    options,
    inspectProfileBackupIpcChannel,
    () =>
      runExclusive(async (): Promise<InspectProfileBackupResult> => {
        const sourcePath = await options.selectBackupSource();
        if (sourcePath === null) {
          return { status: 'cancelled' };
        }
        const password = await options.passwordWindow.requestPassword(
          'enter',
        );
        if (password === null) {
          return { status: 'cancelled' };
        }

        const correlationId = randomUUID();
        const startedAt = Date.now();
        try {
          const summary = await options.backupService.inspect({
            containerPath: sourcePath,
            password,
          });
          options.operationalLogger.write(
            createDesktopOperationalEvent(
              {
                correlationId,
                durationMs: Date.now() - startedAt,
                eventName: 'backup.inspectionCompleted',
                stage: 'portable',
              },
              options.operationalIdentity,
            ),
          );
          return { status: 'inspected', summary };
        } catch {
          options.operationalLogger.write(
            createDesktopOperationalEvent(
              {
                correlationId,
                durationMs: Date.now() - startedAt,
                errorCode: 'PROFILE_BACKUP_INSPECTION_FAILED',
                eventName: 'backup.inspectionFailed',
                retryable: false,
                sideEffectState: 'none',
                stage: 'portable',
              },
              options.operationalIdentity,
            ),
          );
          options.showSafeError('inspect');
          throw new Error('PROFILE_BACKUP_INSPECTION_FAILED');
        }
      }),
  );
  registerNoArgumentHandler(
    options,
    prepareProfileRestoreIpcChannel,
    () => runExclusive(() => restoreController.prepare()),
  );
  registerNoArgumentHandler(
    options,
    activatePreparedProfileRestoreIpcChannel,
    () => runExclusive(() => restoreController.activate()),
  );
  registerNoArgumentHandler(
    options,
    createManualRecoveryPointIpcChannel,
    () =>
      runExclusive(async (): Promise<ProfileProtectionStatus> => {
        try {
          await options.recoveryPointService.createManual();
          return createProfileProtectionStatus(
            options.backupService.getStatus(),
            options.recoveryPointService.getStatus(),
            restoreController.getOperationState(),
          );
        } catch {
          options.showSafeError('recoveryPoint');
          throw new Error('PROFILE_RECOVERY_POINT_CREATE_FAILED');
        }
      }),
  );

  return {
    dispose() {
      options.ipcMain.removeHandler(getProfileBackupStatusIpcChannel);
      options.ipcMain.removeHandler(createProfileBackupIpcChannel);
      options.ipcMain.removeHandler(inspectProfileBackupIpcChannel);
      options.ipcMain.removeHandler(prepareProfileRestoreIpcChannel);
      options.ipcMain.removeHandler(
        activatePreparedProfileRestoreIpcChannel,
      );
      options.ipcMain.removeHandler(
        createManualRecoveryPointIpcChannel,
      );
    },
  };

  async function runExclusive<T>(
    operation: () => Promise<T>,
  ): Promise<T> {
    if (activeOperation) {
      throw new Error('PROFILE_PROTECTION_OPERATION_BUSY');
    }
    activeOperation = true;
    try {
      return await operation();
    } finally {
      activeOperation = false;
    }
  }
}

function registerNoArgumentHandler<T>(
  options: Pick<
    ProfileBackupCapabilityOptions,
    'ipcMain' | 'mainWindow'
  >,
  channel: string,
  operation: () => Promise<T> | T,
): void {
  options.ipcMain.removeHandler(channel);
  options.ipcMain.handle(
    channel,
    (event: IpcMainInvokeEvent, ...args: unknown[]): Promise<T> | T => {
      if (
        !isTrustedMainWindowRequest(event, options.mainWindow) ||
        args.length !== 0
      ) {
        throw new Error('PROFILE_BACKUP_CAPABILITY_FORBIDDEN');
      }
      return operation();
    },
  );
}

function isTrustedMainWindowRequest(
  event: IpcMainInvokeEvent,
  mainWindow: BrowserWindow,
): boolean {
  return (
    !mainWindow.isDestroyed() &&
    event.sender === mainWindow.webContents &&
    event.senderFrame === mainWindow.webContents.mainFrame
  );
}
