import { randomUUID } from 'node:crypto';

import type {
  BrowserWindow,
  IpcMain,
  IpcMainInvokeEvent,
} from 'electron';

import type { DesktopOperationalIdentity } from '../observability/desktopOperationalEvent.js';
import type { DesktopOperationalLogger } from '../observability/desktopOperationalLogger.js';
import type { WorkspaceMaintenanceLease } from '../workspaces/maintenance/workspaceMaintenanceLease.js';
import type { BackupPasswordWindowController } from './passwordWindow/backupPasswordWindow.js';
import type { RecoveryPointService } from './recoveryPoint/recoveryPointService.js';
import {
  createPortableProfileBackupFileName,
  type PortableProfileBackupService,
} from './portableProfileBackup.js';
import {
  createManualRecoveryPointIpcChannel,
  createProfileBackupIpcChannel,
  getProfileBackupStatusIpcChannel,
  inspectProfileBackupIpcChannel,
  legacyProfileRestoreIpcChannels,
  type CreateProfileBackupResult,
  type InspectProfileBackupResult,
  type ProfileProtectionStatus,
} from './portableProfileBackupTypes.js';
import { createProfileProtectionStatus } from './profileProtectionStatus.js';
import { createProfileBackupOperationalObserver } from './profileBackupOperationalObserver.js';

interface ProfileBackupCapabilityOptions {
  backupService: Pick<
    PortableProfileBackupService,
    'create' | 'getStatus' | 'inspect'
  >;
  ipcMain: Pick<IpcMain, 'handle' | 'removeHandler'>;
  mainWindow: BrowserWindow;
  maintenanceLease: WorkspaceMaintenanceLease;
  now?(): Date;
  operationalIdentity: DesktopOperationalIdentity;
  operationalLogger: DesktopOperationalLogger;
  passwordWindow: BackupPasswordWindowController;
  recoveryPointService: Pick<
    RecoveryPointService,
    'createManual' | 'getStatus'
  >;
  selectBackupSource(): Promise<string | null>;
  selectBackupTarget(defaultFileName: string): Promise<string | null>;
  showSafeError(
    kind: 'create' | 'inspect' | 'recoveryPoint',
  ): void;
}

export interface ProfileBackupCapability {
  dispose(): void;
}

export function createProfileBackupCapability(
  options: ProfileBackupCapabilityOptions,
): ProfileBackupCapability {
  let activeOperation = false;
  const operationalObserver = createProfileBackupOperationalObserver({
    operationalIdentity: options.operationalIdentity,
    operationalLogger: options.operationalLogger,
  });
  removeLegacyProfileRestoreHandlers(options.ipcMain);

  registerNoArgumentHandler(
    options,
    getProfileBackupStatusIpcChannel,
    (): ProfileProtectionStatus =>
      createProfileProtectionStatus(
        options.backupService.getStatus(),
        options.recoveryPointService.getStatus(),
      ),
  );
  registerNoArgumentHandler(
    options,
    createProfileBackupIpcChannel,
    () =>
      runExclusive('backup', async (): Promise<CreateProfileBackupResult> => {
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
        operationalObserver.observe({
          correlationId,
          eventName: 'backup.started',
          stage: 'portable',
        });
        try {
          await options.backupService.create({
            destinationPath: targetPath,
            password,
          });
          operationalObserver.observe({
            correlationId,
            durationMs: Date.now() - startedAt,
            eventName: 'backup.completed',
            stage: 'portable',
          });
          return 'created';
        } catch {
          operationalObserver.observe({
            correlationId,
            durationMs: Date.now() - startedAt,
            errorCode: 'PROFILE_BACKUP_CREATE_FAILED',
            eventName: 'backup.failed',
            retryable: true,
            sideEffectState: 'unknown',
            stage: 'portable',
          });
          options.showSafeError('create');
          throw new Error('PROFILE_BACKUP_CREATE_FAILED');
        }
      }),
  );
  registerNoArgumentHandler(
    options,
    inspectProfileBackupIpcChannel,
    () =>
      runExclusive(undefined, async (): Promise<InspectProfileBackupResult> => {
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
          operationalObserver.observe({
            correlationId,
            durationMs: Date.now() - startedAt,
            eventName: 'backup.inspectionCompleted',
            stage: 'portable',
          });
          return { status: 'inspected', summary };
        } catch {
          operationalObserver.observe({
            correlationId,
            durationMs: Date.now() - startedAt,
            errorCode: 'PROFILE_BACKUP_INSPECTION_FAILED',
            eventName: 'backup.inspectionFailed',
            retryable: false,
            sideEffectState: 'none',
            stage: 'portable',
          });
          options.showSafeError('inspect');
          throw new Error('PROFILE_BACKUP_INSPECTION_FAILED');
        }
      }),
  );
  registerNoArgumentHandler(
    options,
    createManualRecoveryPointIpcChannel,
    () =>
      runExclusive('backup', async (): Promise<ProfileProtectionStatus> => {
        try {
          await options.recoveryPointService.createManual();
          return createProfileProtectionStatus(
            options.backupService.getStatus(),
            options.recoveryPointService.getStatus(),
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
      removeLegacyProfileRestoreHandlers(options.ipcMain);
      options.ipcMain.removeHandler(
        createManualRecoveryPointIpcChannel,
      );
    },
  };

  async function runExclusive<T>(
    purpose: 'backup' | undefined,
    operation: () => Promise<T>,
  ): Promise<T> {
    if (activeOperation) {
      throw new Error('PROFILE_PROTECTION_OPERATION_BUSY');
    }
    activeOperation = true;
    let maintenanceLease:
      | Awaited<ReturnType<WorkspaceMaintenanceLease['acquire']>>
      | undefined;
    try {
      if (purpose !== undefined) {
        maintenanceLease = await options.maintenanceLease
          .acquire(purpose)
          .catch(() => {
            throw new Error('PROFILE_PROTECTION_OPERATION_BUSY');
          });
      }
      return await operation();
    } finally {
      try {
        await maintenanceLease?.release();
      } finally {
        activeOperation = false;
      }
    }
  }
}

function removeLegacyProfileRestoreHandlers(
  ipcMain: Pick<IpcMain, 'removeHandler'>,
): void {
  for (const channel of legacyProfileRestoreIpcChannels) {
    ipcMain.removeHandler(channel);
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
