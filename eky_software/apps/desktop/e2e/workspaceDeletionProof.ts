import type { IpcMain } from 'electron';

import type { DesktopCompositionDependencies, DesktopLifecycleHandle } from '../src/main/desktopComposition.js';
import { projectExceptionChain } from '../src/main/startupExceptionEvidence.js';
import type { WorkspaceDeletionPreparationOptions } from '../src/workspaces/management/workspaceDeletionPreparation.js';
import { createWorkspaceManagementCapability, type WorkspaceManagementCapability } from '../src/workspaces/management/workspaceManagementCapability.js';
import { isWorkspaceDeletionProofScenario, workspaceDeletionProofChannel } from './workspaceDeletionProofProtocol.js';

type HoldPhase = 'confirmation' | 'publication';
type Settlement = 'notStarted' | 'pending' | 'completed' | 'failed';

// Test assembly only. Production owners still admit, validate and settle work.
export function createWorkspaceDeletionProof(input: Readonly<{
  scenarioId: string;
  ipcMain: Pick<IpcMain, 'handle' | 'removeHandler'>;
  showMessageBox: DesktopCompositionDependencies['showMessageBox'];
  sessionSecret: string;
}>) {
  if (!isWorkspaceDeletionProofScenario(input.scenarioId)) {
    throw new Error('E2E_WORKSPACE_DELETION_SCENARIO_INVALID');
  }
  let capability: WorkspaceManagementCapability | undefined;
  let registered = false;
  let sealed = false;
  let requestState: Settlement = 'notStarted';
  let shutdownState: Settlement = 'notStarted';
  let shutdown: Promise<void> | undefined;
  let published = false;
  let requestFailure: { error: unknown } | undefined;
  let shutdownFailure: { error: unknown } | undefined;
  let hold: { phase: HoldPhase; entered: boolean; promise: Promise<void>; release(): void } | undefined;
  const waitAt = async (phase: HoldPhase) => {
    if (hold?.phase !== phase) return;
    hold.entered = true;
    await hold.promise;
  };
  const closeChannel = () => {
    sealed = true;
    if (registered) input.ipcMain.removeHandler(workspaceDeletionProofChannel);
    registered = false;
    capability = undefined;
  };
  const createCapability: DesktopCompositionDependencies['createWorkspaceManagementCapability'] = options => {
    if (capability !== undefined || sealed) throw new Error('E2E_WORKSPACE_DELETION_CAPABILITY_REUSED');
    capability = createWorkspaceManagementCapability(options);
    return capability;
  };
  const publish: WorkspaceDeletionPreparationOptions['publish'] = async (assertAuthority, assertSelection) => {
    assertAuthority();
    await assertSelection();
    assertAuthority();
    await waitAt('publication');
    assertAuthority();
    await assertSelection();
    assertAuthority();
    published = true;
  };
  return {
    createCapability,
    publish,
    closeChannel,
    async showMessageBox(...args: Parameters<DesktopCompositionDependencies['showMessageBox']>) {
      if (args[1].title === 'Poisto ilman varmuuskopiota') await waitAt('confirmation');
      return input.showMessageBox(...args);
    },
    register() {
      if (sealed || registered || capability === undefined) throw new Error('E2E_WORKSPACE_DELETION_REGISTRATION_INVALID');
      input.ipcMain.handle(workspaceDeletionProofChannel, async (event, ...args: unknown[]) => {
        const owner = capability;
        if (sealed || owner === undefined) throw new Error('E2E_WORKSPACE_DELETION_UNAVAILABLE');
        requestState = 'pending';
        try {
          const result = await owner.prepareDeletion(event, ...args);
          requestState = 'completed';
          return result;
        } catch (error) {
          requestFailure ??= { error };
          requestState = 'failed';
          // Capture before Electron's IPC error serialization discards cause.
          throw new Error('E2E_WORKSPACE_DELETION_PREPARATION_FAILED');
        }
      });
      registered = true;
    },
    arm(phase: HoldPhase) {
      if (hold !== undefined || sealed || (phase !== 'confirmation' && phase !== 'publication')) {
        throw new Error('E2E_WORKSPACE_DELETION_HOLD_INVALID');
      }
      let release!: () => void;
      const promise = new Promise<void>(resolve => { release = resolve; });
      hold = { phase, entered: false, promise, release };
    },
    release() { hold?.release(); },
    snapshot() {
      return { hold: hold?.phase ?? null, entered: hold?.entered ?? false,
        request: requestState, shutdown: shutdownState, published, registered };
    },
    beginShutdown(lifecycle: Pick<DesktopLifecycleHandle, 'shutdown'>) {
      if (shutdown !== undefined) throw new Error('E2E_WORKSPACE_DELETION_SHUTDOWN_REUSED');
      closeChannel();
      shutdownState = 'pending';
      shutdown = Promise.resolve().then(() => lifecycle.shutdown()).then(() => { shutdownState = 'completed'; }, error => {
        shutdownFailure ??= { error }; shutdownState = 'failed'; throw error;
      });
      void shutdown.catch(() => undefined);
    },
    async waitForShutdown() {
      if (shutdown === undefined) throw new Error('E2E_WORKSPACE_DELETION_SHUTDOWN_MISSING');
      await shutdown;
    },
    readFailures() {
      return {
        request: requestFailure === undefined ? undefined : projectExceptionChain(requestFailure.error, [input.sessionSecret]),
        shutdown: shutdownFailure === undefined ? undefined : projectExceptionChain(shutdownFailure.error, [input.sessionSecret]),
      };
    },
  };
}
