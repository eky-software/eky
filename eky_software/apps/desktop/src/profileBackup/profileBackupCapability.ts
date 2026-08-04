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
import {
  createPortableProfileBackupFileName,
  type PortableProfileBackupService,
} from './portableProfileBackup.js';
import {
  createProfileBackupIpcChannel,
  getProfileBackupStatusIpcChannel,
  inspectProfileBackupIpcChannel,
  type CreateProfileBackupResult,
  type InspectProfileBackupResult,
  type ProfileBackupStatus,
} from './portableProfileBackupTypes.js';

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
  selectBackupSource(): Promise<string | null>;
  selectBackupTarget(defaultFileName: string): Promise<string | null>;
  showSafeError(kind: 'create' | 'inspect'): void;
}

export interface ProfileBackupCapability {
  dispose(): void;
}

export function createProfileBackupCapability(
  options: ProfileBackupCapabilityOptions,
): ProfileBackupCapability {
  registerNoArgumentHandler(
    options,
    getProfileBackupStatusIpcChannel,
    () => options.backupService.getStatus(),
  );
  registerNoArgumentHandler(
    options,
    createProfileBackupIpcChannel,
    async (): Promise<CreateProfileBackupResult> => {
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
    },
  );
  registerNoArgumentHandler(
    options,
    inspectProfileBackupIpcChannel,
    async (): Promise<InspectProfileBackupResult> => {
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
    },
  );

  return {
    dispose() {
      options.ipcMain.removeHandler(getProfileBackupStatusIpcChannel);
      options.ipcMain.removeHandler(createProfileBackupIpcChannel);
      options.ipcMain.removeHandler(inspectProfileBackupIpcChannel);
    },
  };
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

