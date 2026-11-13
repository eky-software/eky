import type {
  BrowserWindow,
  IpcMain,
  IpcMainInvokeEvent,
} from 'electron';

import type { BackupPasswordWindowController } from '../../profileBackup/passwordWindow/backupPasswordWindow.js';
import type { WorkspaceManagementService } from './workspaceManagementService.js';
import type { WorkspaceDeletionCompletion, WorkspaceDeletionFailureOutcome } from './workspaceManagementService.js';
import { mapWorkspaceManagementError, WorkspaceManagementError } from './workspaceManagementError.js';
import type {
  WorkspaceDeletionPreparationLifetime,
  WorkspaceDeletionPreparationOutcome,
  WorkspaceManagementOperationKind,
} from './workspaceManagementTypes.js';
import {
  createEmptyWorkspaceIpcChannel,
  createWorkspaceOperationResult,
  deleteWorkspaceIpcChannel,
  getWorkspaceManagementStatusIpcChannel,
  importWorkspaceBackupAsNewIpcChannel,
  parseWorkspaceIdRequest,
  parseWorkspaceDeletionRequest,
  parseWorkspaceDeletionOperationResult,
  type WorkspaceDeletionRequest,
  type WorkspaceDeletionOperationResult,
  parseWorkspaceLabelRequest,
  parseWorkspaceRenameRequest,
  parseWorkspaceRecoveryStatusResult,
  parseWorkspaceStatusResult,
  replaceActiveWorkspaceFromBackupIpcChannel,
  renameWorkspaceIpcChannel,
  switchWorkspaceIpcChannel,
  workspaceManagementIpcChannels,
  workspaceManagementCapabilityProtocolVersion,
} from './workspaceManagementCapabilityProtocol.js';
import { hasExactDataKeys, isPlainDataRecord } from '../registry/workspaceRegistryValueShape.js';
import { isWorkspaceDeletionFailureCode } from '../../observability/workspaceManagementFailureContext.js';
import { assertUpdateJournalAuthority } from '../../update/updateJournalStore.js';

export interface WorkspaceDeletionResultRuntime {
  readNextAction(): Extract<WorkspaceDeletionOperationResult, { status: 'cancelled' }>['nextAction'];
  complete(completion: Readonly<WorkspaceDeletionCompletion>): Promise<void>;
  projectFailure(outcome: Readonly<WorkspaceDeletionFailureOutcome>): WorkspaceDeletionOperationResult;
}

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
  > & Partial<Pick<WorkspaceManagementService, 'prepareDeletion' | 'deleteWorkspace' | 'getRecoveryManagementStatus'>>;
  readonly statusMode?: 'ordinary' | 'recoveryManagement';
  readonly captureStatusPublication?: () => Readonly<{ assertCurrent(): void }>;
  readonly deletionRuntime?: Readonly<WorkspaceDeletionResultRuntime>;
  confirmActiveWorkspaceReplacement(workspaceLabel: string): Promise<boolean>;
  selectBackupSource(): Promise<string | null>;
  selectReplacementBackupSource(): Promise<string | null>;
  showSafeError(): void;
}

export interface WorkspaceManagementCapability {
  // Preparation remains main-only. The command has a separate safe IPC wrapper.
  prepareDeletion(
    event: IpcMainInvokeEvent,
    ...args: unknown[]
  ): Promise<WorkspaceDeletionPreparationOutcome>;
  deleteWorkspace(
    event: IpcMainInvokeEvent,
    ...args: unknown[]
  ): Promise<WorkspaceDeletionOperationResult>;
  closeAdmission(): void;
  dispose(): void;
  shutdown(): Promise<void>;
}

interface WorkspaceManagementCapabilityState {
  disposed: boolean;
  admissionClosed: boolean;
  documentEpoch: number;
  retainedDeletion?: WorkspaceDeletionPreparationLifetime;
  mutationInFlight: boolean;
  readonly pendingWork: Set<Promise<void>>;
}

export function createWorkspaceManagementCapability(
  options: Readonly<WorkspaceManagementCapabilityOptions>,
): WorkspaceManagementCapability {
  if (options.statusMode !== undefined && options.statusMode !== 'ordinary' &&
      options.statusMode !== 'recoveryManagement') {
    throw new Error('WORKSPACE_MANAGEMENT_CAPABILITY_INVALID');
  }
  const recoveryStatus = options.statusMode === 'recoveryManagement';
  if (recoveryStatus && (options.service.getRecoveryManagementStatus === undefined ||
      options.captureStatusPublication === undefined)) {
    throw new Error('WORKSPACE_MANAGEMENT_CAPABILITY_INVALID');
  }
  const state: WorkspaceManagementCapabilityState = {
    disposed: false,
    admissionClosed: false,
    documentEpoch: 0,
    mutationInFlight: false,
    pendingWork: new Set(),
  };
  let shutdownTask: Promise<void> | undefined;
  const deletionRuntime = options.deletionRuntime === undefined ? undefined : Object.freeze({
    readNextAction: options.deletionRuntime.readNextAction.bind(options.deletionRuntime),
    complete: options.deletionRuntime.complete.bind(options.deletionRuntime),
    projectFailure: options.deletionRuntime.projectFailure.bind(options.deletionRuntime),
  });
  for (const channel of workspaceManagementIpcChannels) {
    options.ipcMain.removeHandler(channel);
  }

  options.ipcMain.handle(
    getWorkspaceManagementStatusIpcChannel,
    (event, ...args: unknown[]) => {
      let publication: Readonly<{ assertCurrent(): void }> | undefined;
      let servicePublication: Readonly<{ assertCurrent(): void }> | undefined;
      return runCapability(options, state, event, args, 0, async assertCurrent => {
        publication = options.captureStatusPublication?.();
        if (recoveryStatus) {
          const observed = await options.service.getRecoveryManagementStatus!();
          servicePublication = observed;
          assertCurrent();
          observed.assertCurrent();
          return parseWorkspaceRecoveryStatusResult(observed.value);
        }
        const result = await options.service.getStatus();
        assertCurrent();
        return parseWorkspaceStatusResult(result);
      }, options.captureStatusPublication === undefined ? undefined : () => {
        if (publication === undefined) {
          throw new WorkspaceManagementError('WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED', 'status');
        }
        assertUpdateJournalAuthority(publication.assertCurrent.bind(publication));
        if (recoveryStatus) {
          if (servicePublication === undefined) {
            throw new WorkspaceManagementError('WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED', 'status');
          }
          assertUpdateJournalAuthority(servicePublication.assertCurrent.bind(servicePublication));
        }
      });
    },
  );
  if (!recoveryStatus) {
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
  }

  const sealAdmission = () => {
    if (state.admissionClosed) return;
    state.admissionClosed = true;
    for (const channel of workspaceManagementIpcChannels) {
      options.ipcMain.removeHandler(channel);
    }
  };
  const closeAdmission = () => {
    // An external close revokes even an already retained own-stop request.
    delete state.retainedDeletion;
    sealAdmission();
  };
  const invalidateDocument = () => { state.documentEpoch += 1; };
  const navigationStarted = (details: { isMainFrame: boolean }) => {
    if (details.isMainFrame) invalidateDocument();
  };
  // Retain the subscribed emitter: native window access is invalid after close.
  const documentEvents = options.mainWindow.webContents;
  documentEvents.on('did-start-navigation', navigationStarted);
  documentEvents.on('did-start-loading', invalidateDocument);
  documentEvents.on('render-process-gone', invalidateDocument);
  documentEvents.on('destroyed', invalidateDocument);
  options.mainWindow.on('close', invalidateDocument);

  const dispose = () => {
    if (state.disposed) return;
    state.disposed = true;
    closeAdmission();
    invalidateDocument();
    documentEvents.off('did-start-navigation', navigationStarted);
    documentEvents.off('did-start-loading', invalidateDocument);
    documentEvents.off('render-process-gone', invalidateDocument);
    documentEvents.off('destroyed', invalidateDocument);
    options.mainWindow.off('close', invalidateDocument);
  };
  const runDeletionRequest = <Result>(
    event: IpcMainInvokeEvent,
    args: readonly unknown[],
    execute: (request: Readonly<WorkspaceDeletionRequest>, lifetime: WorkspaceDeletionPreparationLifetime) => Promise<unknown>,
    validate: (result: unknown, assertCurrent: () => void) => Result | Promise<Result>,
  ): Promise<Result> => {
    let privateFailure: { cause: unknown } | undefined;
    const work = runCapability(options, state, event, args, 1, () =>
      runMutation(state, 'delete', async () => {
        const request = parseWorkspaceDeletionRequest(args[0]);
        const epoch = state.documentEpoch;
        let active = true;
        const lifetime: WorkspaceDeletionPreparationLifetime = Object.freeze({
          assertCurrent() {
            if (
              !active || state.disposed || state.documentEpoch !== epoch ||
              options.mainWindow.isDestroyed() || options.mainWindow.webContents.isDestroyed() ||
              event.sender !== options.mainWindow.webContents ||
              event.senderFrame !== options.mainWindow.webContents.mainFrame ||
              (state.admissionClosed && state.retainedDeletion !== lifetime)
            ) {
              active = false;
              throw new Error('WORKSPACE_MANAGEMENT_CAPABILITY_FORBIDDEN');
            }
          },
          closeAdmissionForOwnStop() {
            lifetime.assertCurrent();
            state.retainedDeletion = lifetime;
            sealAdmission();
            lifetime.assertCurrent();
          }
        });
        try {
          lifetime.assertCurrent();
          const outcome = await execute(request, lifetime);
          lifetime.assertCurrent();
          return await validate(outcome, lifetime.assertCurrent.bind(lifetime));
        } finally {
          active = false;
          if (state.retainedDeletion === lifetime) delete state.retainedDeletion;
        }
      }).catch((cause: unknown) => {
        privateFailure = { cause };
        throw cause;
      }),
    );
    // These entries stay in main; renderer handlers retain their safe-only errors.
    return work.catch((error: unknown) => {
      if (privateFailure !== undefined && error instanceof Error) {
        throw new Error(error.message, { cause: privateFailure.cause });
      }
      throw error;
    });
  };
  const capability: WorkspaceManagementCapability = Object.freeze({
    closeAdmission,
    prepareDeletion(event: IpcMainInvokeEvent, ...args: unknown[]) {
      return runDeletionRequest(event, args, async (request, lifetime) => {
        if (options.service.prepareDeletion === undefined) {
          throw new WorkspaceManagementError('WORKSPACE_MANAGEMENT_INVALID', 'delete');
        }
        return options.service.prepareDeletion(request, lifetime);
      }, outcome => {
        if (outcome !== 'prepared' && outcome !== 'cancelled' && outcome !== 'returnRequested') {
          throw new Error('WORKSPACE_DELETION_PREPARATION_RESULT_INVALID');
        }
        return outcome;
      });
    },
    deleteWorkspace(event: IpcMainInvokeEvent, ...args: unknown[]) {
      return runDeletionRequest(event, args, async (request, lifetime) => {
        if (options.service.deleteWorkspace === undefined || deletionRuntime === undefined) {
          throw new WorkspaceManagementError('WORKSPACE_MANAGEMENT_INVALID', 'delete');
        }
        let reports = 0;
        let acceptingProof = true;
        let proof: Readonly<WorkspaceDeletionFailureOutcome> | undefined;
        try {
          const outcome = await options.service.deleteWorkspace(request, lifetime, value => {
            if (!acceptingProof) return;
            reports += 1;
            if (reports === 1 && isPlainDataRecord(value) && hasExactDataKeys(value, ['cause', 'sideEffectState']) &&
                (value.sideEffectState === 'none' || value.sideEffectState === 'unknown')) {
              proof = Object.freeze({ cause: value.cause, sideEffectState: value.sideEffectState });
            }
          });
          acceptingProof = false;
          proof = undefined;
          if (isPlainDataRecord(outcome) && hasExactDataKeys(outcome, ['formatVersion', 'status']) &&
              outcome.formatVersion === workspaceManagementCapabilityProtocolVersion && outcome.status === 'cancelled') {
            return outcome;
          }
          const completed = parseWorkspaceDeletionOperationResult(outcome);
          if (completed.status !== 'completed') throw new Error('WORKSPACE_MANAGEMENT_CAPABILITY_INVALID');
          // Main completion outlives the reply document. Service fulfillment joins
          // the durable command and lease release; the main owner rechecks runtime.
          await deletionRuntime.complete(completed);
          return completed;
        } catch (cause) {
          // Only one report bound to this exact rejection proves no effect.
          const sideEffectState = acceptingProof && reports === 1 && proof !== undefined &&
            proof.cause === cause && proof.sideEffectState === 'none' ? 'none' : 'unknown';
          acceptingProof = false;
          proof = undefined;
          try {
            const projected = parseWorkspaceDeletionOperationResult(
              deletionRuntime.projectFailure(Object.freeze({ cause, sideEffectState })),
            );
            if ((projected.status !== 'failed' && projected.status !== 'recoveryRequired') ||
                (sideEffectState === 'unknown' && projected.status !== 'recoveryRequired')) {
              throw new Error('WORKSPACE_MANAGEMENT_CAPABILITY_INVALID');
            }
            return projected;
          } catch (projectionFailure) {
            const first = mapWorkspaceManagementError(cause, 'delete');
            throw new WorkspaceManagementError(first.code, 'delete', { cause: new AggregateError(
              [cause, projectionFailure], 'WORKSPACE_DELETE_RESULT_UNCERTAIN', { cause },
            ) });
          }
        }
      }, (outcome, assertCurrent) => {
        if (isPlainDataRecord(outcome) && hasExactDataKeys(outcome, ['formatVersion', 'status']) &&
            outcome.formatVersion === workspaceManagementCapabilityProtocolVersion && outcome.status === 'cancelled') {
          assertCurrent();
          const nextAction = deletionRuntime!.readNextAction();
          assertCurrent();
          return parseWorkspaceDeletionOperationResult({ formatVersion: workspaceManagementCapabilityProtocolVersion,
            status: 'cancelled', nextAction });
        }
        const parsed = parseWorkspaceDeletionOperationResult(outcome);
        return parsed;
      });
    },
    dispose,
    shutdown() {
      dispose();
      shutdownTask ??= Promise.all([...state.pendingWork]).then(() => undefined);
      return shutdownTask;
    },
  });
  if (options.service.deleteWorkspace !== undefined && deletionRuntime !== undefined) {
    options.ipcMain.handle(deleteWorkspaceIpcChannel, async (event, ...args: unknown[]) => {
      try { return await capability.deleteWorkspace(event, ...args); }
      catch (error) {
        // Keep main's cause/stack private and reject an unexpected inner code.
        const code = error instanceof Error ? error.message : undefined;
        throw new Error(code === 'WORKSPACE_MANAGEMENT_CAPABILITY_FORBIDDEN' ||
          code === 'WORKSPACE_MANAGEMENT_CAPABILITY_INVALID' || isWorkspaceDeletionFailureCode(code)
          ? code : 'WORKSPACE_MANAGEMENT_CAPABILITY_FAILED');
      }
    });
  }
  return capability;
}

async function runCapability<Result>(
  options: Readonly<WorkspaceManagementCapabilityOptions>,
  state: WorkspaceManagementCapabilityState,
  event: IpcMainInvokeEvent,
  args: readonly unknown[],
  expectedArgumentCount: number,
  operation: (assertCurrent: () => void) => Promise<Result>,
  assertPublication?: () => void,
): Promise<Result> {
  const epoch = state.documentEpoch;
  const assertCurrent = () => {
    if (
      state.disposed ||
      state.admissionClosed || state.documentEpoch !== epoch ||
      options.mainWindow.isDestroyed() ||
      options.mainWindow.webContents.isDestroyed() ||
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
    const result = await operation(assertCurrent);
    if (assertPublication !== undefined) {
      assertCurrent();
      assertPublication();
    }
    return result;
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
    try {
      assertCurrent();
      options.showSafeError();
    } catch {
      // A stale document or failed dialog must not replace the safe first result.
    }
    throw new Error('WORKSPACE_MANAGEMENT_CAPABILITY_FAILED');
  } finally {
    state.pendingWork.delete(completion);
    settle();
  }
}

async function runMutation<Result>(
  state: { mutationInFlight: boolean },
  operationKind: Exclude<WorkspaceManagementOperationKind, 'status' | 'deleteResume'>,
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
