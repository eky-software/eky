import type {
  BrowserWindow,
  IpcMain,
  IpcMainInvokeEvent,
} from 'electron';

import type { BackupPasswordWindowController } from '../../profileBackup/passwordWindow/backupPasswordWindow.js';
import type { WorkspaceManagementService } from './workspaceManagementService.js';
import { WorkspaceManagementError } from './workspaceManagementError.js';
import {
  createEmptyWorkspaceIpcChannel,
  createWorkspaceOperationResult,
  getWorkspaceManagementStatusIpcChannel,
  importWorkspaceBackupAsNewIpcChannel,
  parseWorkspaceIdRequest,
  parseWorkspaceLabelRequest,
  parseWorkspaceRenameRequest,
  parseWorkspaceStatusResult,
  renameWorkspaceIpcChannel,
  switchWorkspaceIpcChannel,
  workspaceManagementIpcChannels,
} from './workspaceManagementCapabilityProtocol.js';

interface WorkspaceManagementCapabilityOptions {
  readonly ipcMain: Pick<IpcMain, 'handle' | 'removeHandler'>;
  readonly mainWindow: BrowserWindow;
  readonly passwordWindow: Pick<BackupPasswordWindowController, 'requestPassword'>;
  readonly service: Pick<
    WorkspaceManagementService,
    'createEmpty' | 'getStatus' | 'importBackupAsNew' | 'rename' | 'switchTo'
  >;
  selectBackupSource(): Promise<string | null>;
  showSafeError(): void;
}

export interface WorkspaceManagementCapability {
  dispose(): void;
}

export function createWorkspaceManagementCapability(
  options: Readonly<WorkspaceManagementCapabilityOptions>,
): WorkspaceManagementCapability {
  for (const channel of workspaceManagementIpcChannels) {
    options.ipcMain.removeHandler(channel);
  }

  options.ipcMain.handle(
    getWorkspaceManagementStatusIpcChannel,
    (event, ...args: unknown[]) =>
      runCapability(options, event, args, 0, async () =>
        parseWorkspaceStatusResult(await options.service.getStatus()),
      ),
  );
  options.ipcMain.handle(
    createEmptyWorkspaceIpcChannel,
    (event, ...args: unknown[]) =>
      runCapability(options, event, args, 1, async () => {
        const request = parseWorkspaceLabelRequest(args[0]);
        await options.service.createEmpty(request.workspaceLabel);
        return createWorkspaceOperationResult('relaunching');
      }),
  );
  options.ipcMain.handle(
    importWorkspaceBackupAsNewIpcChannel,
    (event, ...args: unknown[]) =>
      runCapability(options, event, args, 1, async () => {
        const request = parseWorkspaceLabelRequest(args[0]);
        const containerPath = await options.selectBackupSource();
        if (containerPath === null) {
          return createWorkspaceOperationResult('cancelled');
        }
        const password = await options.passwordWindow.requestPassword('enter');
        if (password === null) {
          return createWorkspaceOperationResult('cancelled');
        }
        await options.service.importBackupAsNew({
          containerPath,
          password,
          workspaceLabel: request.workspaceLabel,
        });
        return createWorkspaceOperationResult('relaunching');
      }),
  );
  options.ipcMain.handle(
    switchWorkspaceIpcChannel,
    (event, ...args: unknown[]) =>
      runCapability(options, event, args, 1, async () => {
        const request = parseWorkspaceIdRequest(args[0]);
        const before = parseWorkspaceStatusResult(
          await options.service.getStatus(),
        );
        if (before.activeWorkspaceId === request.workspaceId) {
          return createWorkspaceOperationResult('completed');
        }
        await options.service.switchTo(request.workspaceId);
        return createWorkspaceOperationResult('relaunching');
      }),
  );
  options.ipcMain.handle(
    renameWorkspaceIpcChannel,
    (event, ...args: unknown[]) =>
      runCapability(options, event, args, 1, async () => {
        const request = parseWorkspaceRenameRequest(args[0]);
        const result = await options.service.rename(
          request.workspaceId,
          request.workspaceLabel,
        );
        void result;
        return createWorkspaceOperationResult('completed');
      }),
  );

  return Object.freeze({
    dispose() {
      for (const channel of workspaceManagementIpcChannels) {
        options.ipcMain.removeHandler(channel);
      }
    },
  });
}

async function runCapability<Result>(
  options: Readonly<WorkspaceManagementCapabilityOptions>,
  event: IpcMainInvokeEvent,
  args: readonly unknown[],
  expectedArgumentCount: number,
  operation: () => Promise<Result>,
): Promise<Result> {
  if (
    options.mainWindow.isDestroyed() ||
    event.sender !== options.mainWindow.webContents ||
    event.senderFrame !== options.mainWindow.webContents.mainFrame ||
    args.length !== expectedArgumentCount
  ) {
    throw new Error('WORKSPACE_MANAGEMENT_CAPABILITY_FORBIDDEN');
  }

  try {
    return await operation();
  } catch (error) {
    if (
      error instanceof WorkspaceManagementError ||
      (error instanceof Error &&
        (error.message === 'WORKSPACE_MANAGEMENT_CAPABILITY_INVALID' ||
          error.message === 'WORKSPACE_REGISTRY_INVALID'))
    ) {
      throw new Error(
        error instanceof WorkspaceManagementError
          ? error.code
          : 'WORKSPACE_MANAGEMENT_CAPABILITY_INVALID',
      );
    }
    options.showSafeError();
    throw new Error('WORKSPACE_MANAGEMENT_CAPABILITY_FAILED');
  }
}
