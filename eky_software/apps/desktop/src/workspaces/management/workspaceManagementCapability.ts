import type {
  BrowserWindow,
  IpcMain,
  IpcMainInvokeEvent,
} from 'electron';

import type { BackupPasswordWindowController } from '../../profileBackup/passwordWindow/backupPasswordWindow.js';
import type { WorkspaceManagementService } from './workspaceManagementService.js';
import { WorkspaceManagementError } from './workspaceManagementError.js';
import type { WorkspaceManagementOperationKind } from './workspaceManagementTypes.js';
import {
  createEmptyWorkspaceIpcChannel,
  createWorkspaceOperationResult,
  getWorkspaceManagementStatusIpcChannel,
  importWorkspaceBackupAsNewIpcChannel,
  parseWorkspaceIdRequest,
  parseWorkspaceLabelRequest,
  parseWorkspaceRenameRequest,
  parseWorkspaceStatusResult,
  replaceActiveWorkspaceFromBackupIpcChannel,
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
    | 'createEmpty'
    | 'getStatus'
    | 'importBackupAsNew'
    | 'rename'
    | 'replaceActiveFromBackup'
    | 'switchTo'
  >;
  confirmActiveWorkspaceReplacement(workspaceLabel: string): Promise<boolean>;
  selectBackupSource(): Promise<string | null>;
  selectReplacementBackupSource(): Promise<string | null>;
  showSafeError(): void;
}

export interface WorkspaceManagementCapability {
  dispose(): void;
  shutdown(): Promise<void>;
}

interface WorkspaceManagementCapabilityState {
  disposed: boolean;
  mutationInFlight: boolean;
  readonly pendingWork: Set<Promise<void>>;
}

export function createWorkspaceManagementCapability(
  options: Readonly<WorkspaceManagementCapabilityOptions>,
): WorkspaceManagementCapability {
  const state: WorkspaceManagementCapabilityState = {
    disposed: false,
    mutationInFlight: false,
    pendingWork: new Set(),
  };
  let shutdownTask: Promise<void> | undefined;
  for (const channel of workspaceManagementIpcChannels) {
    options.ipcMain.removeHandler(channel);
  }

  options.ipcMain.handle(
    getWorkspaceManagementStatusIpcChannel,
    (event, ...args: unknown[]) =>
      runCapability(options, state, event, args, 0, async assertCurrent => {
        const result = await options.service.getStatus();
        assertCurrent();
        return parseWorkspaceStatusResult(result);
      }),
  );
  options.ipcMain.handle(
    createEmptyWorkspaceIpcChannel,
    (event, ...args: unknown[]) =>
      runCapability(options, state, event, args, 1, () =>
        runMutation(state, 'create', async () => {
          const request = parseWorkspaceLabelRequest(args[0]);
          await options.service.createEmpty(request.workspaceLabel);
          return createWorkspaceOperationResult('relaunching');
        }),
      ),
  );
  options.ipcMain.handle(
    importWorkspaceBackupAsNewIpcChannel,
    (event, ...args: unknown[]) =>
      runCapability(options, state, event, args, 1, assertCurrent =>
        runMutation(state, 'import', async () => {
          const request = parseWorkspaceLabelRequest(args[0]);
          const containerPath = await options.selectBackupSource();
          assertCurrent();
          if (containerPath === null) {
            return createWorkspaceOperationResult('cancelled');
          }
          const password =
            await options.passwordWindow.requestPassword('enter');
          assertCurrent();
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
      ),
  );
  options.ipcMain.handle(
    replaceActiveWorkspaceFromBackupIpcChannel,
    (event, ...args: unknown[]) =>
      runCapability(options, state, event, args, 0, assertCurrent =>
        runMutation(state, 'replace', async () => {
          const status = parseWorkspaceStatusResult(
            await options.service.getStatus(),
          );
          assertCurrent();
          if (status.operationState === 'busy') {
            throw new WorkspaceManagementError(
              'WORKSPACE_MANAGEMENT_BUSY',
              'replace',
            );
          }
          if (status.operationState === 'recoveryRequired') {
            throw new WorkspaceManagementError(
              'WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED',
              'replace',
            );
          }
          const activeWorkspace = status.workspaces.find(
            (workspace) =>
              workspace.isActive &&
              workspace.workspaceId === status.activeWorkspaceId,
          );
          if (
            activeWorkspace === undefined ||
            activeWorkspace.availability !== 'ready'
          ) {
            throw new WorkspaceManagementError(
              'WORKSPACE_MANAGEMENT_INVALID',
              'replace',
            );
          }
          const containerPath =
            await options.selectReplacementBackupSource();
          assertCurrent();
          if (containerPath === null) {
            return createWorkspaceOperationResult('cancelled');
          }
          const password =
            await options.passwordWindow.requestPassword('enter');
          assertCurrent();
          if (password === null) {
            return createWorkspaceOperationResult('cancelled');
          }
          const confirmed = await options.confirmActiveWorkspaceReplacement(
            activeWorkspace.workspaceLabel,
          );
          assertCurrent();
          if (!confirmed) {
            return createWorkspaceOperationResult('cancelled');
          }
          await options.service.replaceActiveFromBackup({
            containerPath,
            password,
            targetWorkspaceId: activeWorkspace.workspaceId,
          });
          return createWorkspaceOperationResult('relaunching');
        }),
      ),
  );
  options.ipcMain.handle(
    switchWorkspaceIpcChannel,
    (event, ...args: unknown[]) =>
      runCapability(options, state, event, args, 1, assertCurrent =>
        runMutation(state, 'switch', async () => {
          const request = parseWorkspaceIdRequest(args[0]);
          const before = parseWorkspaceStatusResult(
            await options.service.getStatus(),
          );
          assertCurrent();
          if (before.activeWorkspaceId === request.workspaceId) {
            return createWorkspaceOperationResult('completed');
          }
          await options.service.switchTo(request.workspaceId);
          return createWorkspaceOperationResult('relaunching');
        }),
      ),
  );
  options.ipcMain.handle(
    renameWorkspaceIpcChannel,
    (event, ...args: unknown[]) =>
      runCapability(options, state, event, args, 1, () =>
        runMutation(state, 'rename', async () => {
          const request = parseWorkspaceRenameRequest(args[0]);
          const result = await options.service.rename(
            request.workspaceId,
            request.workspaceLabel,
          );
          void result;
          return createWorkspaceOperationResult('completed');
        }),
      ),
  );

  const dispose = () => {
    if (state.disposed) return;
    state.disposed = true;
    for (const channel of workspaceManagementIpcChannels) {
      options.ipcMain.removeHandler(channel);
    }
  };
  return Object.freeze({
    dispose,
    shutdown() {
      dispose();
      shutdownTask ??= Promise.all([...state.pendingWork]).then(() => undefined);
      return shutdownTask;
    },
  });
}

async function runCapability<Result>(
  options: Readonly<WorkspaceManagementCapabilityOptions>,
  state: WorkspaceManagementCapabilityState,
  event: IpcMainInvokeEvent,
  args: readonly unknown[],
  expectedArgumentCount: number,
  operation: (assertCurrent: () => void) => Promise<Result>,
): Promise<Result> {
  const assertCurrent = () => {
    if (
      state.disposed ||
      options.mainWindow.isDestroyed() ||
      event.sender !== options.mainWindow.webContents ||
      event.senderFrame !== options.mainWindow.webContents.mainFrame ||
      args.length !== expectedArgumentCount
    ) {
      throw new Error('WORKSPACE_MANAGEMENT_CAPABILITY_FORBIDDEN');
    }
  };
  assertCurrent();

  let settle!: () => void;
  const completion = new Promise<void>(resolve => { settle = resolve; });
  state.pendingWork.add(completion);
  try {
    return await operation(assertCurrent);
  } catch (error) {
    if (error instanceof Error && error.message === 'WORKSPACE_MANAGEMENT_CAPABILITY_FORBIDDEN') {
      throw new Error('WORKSPACE_MANAGEMENT_CAPABILITY_FORBIDDEN');
    }
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
    if (!state.disposed && !options.mainWindow.isDestroyed()) options.showSafeError();
    throw new Error('WORKSPACE_MANAGEMENT_CAPABILITY_FAILED');
  } finally {
    state.pendingWork.delete(completion);
    settle();
  }
}

async function runMutation<Result>(
  state: { mutationInFlight: boolean },
  operationKind: Exclude<WorkspaceManagementOperationKind, 'status'>,
  operation: () => Promise<Result>,
): Promise<Result> {
  if (state.mutationInFlight) {
    throw new WorkspaceManagementError(
      'WORKSPACE_MANAGEMENT_BUSY',
      operationKind,
    );
  }

  state.mutationInFlight = true;
  try {
    return await operation();
  } finally {
    state.mutationInFlight = false;
  }
}
