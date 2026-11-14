import { createElement } from 'react';
import { createRoot } from 'react-dom/client';

import type { WorkspaceDeletionRequest, WorkspaceDeletionResult, WorkspaceManagementViewCapability,
  WorkspaceManagementStatus, WorkspaceRecoveryManagementStatus } from '../../app/desktopWorkspaceManagement.js';
import { useWorkspaceManagement, type WorkspaceManagementController } from './useWorkspaceManagement.js';
import { WorkspaceManagementDialog } from './WorkspaceManagementDialog.js';
import type { WorkspaceSelectorMode } from './workspaceSelectorState.js';

// Loaded only by the isolated browser-component fixture, never by the app entry.
export async function mountWorkspaceDeletionControllerProbe({ holdInitial, presentation }: {
  readonly holdInitial: boolean;
  readonly presentation: 'ordinary' | 'recovery';
}) {
  if (import.meta.env.MODE !== 'eky-e2e') throw new Error('Deletion probe requires the E2E runtime.');
  const { act } = await import('react');
  const environment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
  async function flush(callback: () => void | Promise<void>) {
    const previous = environment.IS_REACT_ACT_ENVIRONMENT;
    environment.IS_REACT_ACT_ENVIRONMENT = true;
    try { await act(callback); }
    finally {
      if (previous === undefined) delete environment.IS_REACT_ACT_ENVIRONMENT;
      else environment.IS_REACT_ACT_ENVIRONMENT = previous;
    }
  }
  const ids = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'];
  const requests: Array<{ request: Readonly<WorkspaceDeletionRequest>; generation: number;
    resolve(result: WorkspaceDeletionResult): void; reject(): void; settled: Promise<void> }> = [];
  const heldStatuses: Array<() => void> = [];
  const statusReads: number[] = [];
  let generation = 0, latest: WorkspaceManagementController;
  let retained: Pick<WorkspaceManagementController, 'submitOperation' | 'setLabelInput' | 'setBackupChoice'> | undefined;
  let hasBusinessRuntime = presentation !== 'recovery';
  let recoveryState: 'idle' | 'busy' | 'recoveryRequired' = 'idle';
  function createCapability(prefix: string): WorkspaceManagementViewCapability {
    const ownGeneration = ++generation;
    const status: WorkspaceManagementStatus = { formatVersion: 1, activeWorkspaceId: ids[0]!, operationState: 'idle',
      workspaces: ids.map((workspaceId, index) => ({ workspaceId, workspaceLabel: `${prefix} ${index === 0 ? 'A' : 'B'}`,
        availability: index === 0 ? 'ready' as const : 'recoveryRequired' as const, isActive: index === 0 })) };
    const unexpected = async (): Promise<never> => { throw new Error('SYNTHETIC_UNEXPECTED_WORKSPACE_COMMAND'); };
    const recoveryStatus = (): WorkspaceRecoveryManagementStatus => recoveryState === 'idle'
      ? { formatVersion: 2, mode: 'recoveryManagement', runtimeState: 'absent',
        maintenanceState: 'idle', operationState: 'idle', persistedActiveWorkspaceId: ids[1]!,
        target: { workspaceId: ids[0]!, workspaceLabel: `${prefix} A` } }
      : { formatVersion: 2, mode: 'recoveryManagement', runtimeState: 'absent',
        maintenanceState: 'idle', operationState: recoveryState };
    return {
      createEmpty: unexpected, importBackupAsNew: unexpected, rename: unexpected, switchTo: unexpected,
      async getStatus() {
        statusReads.push(ownGeneration);
        const result = presentation === 'recovery' ? recoveryStatus() : status;
        if (holdInitial && ownGeneration === 1 && heldStatuses.length === 0) {
          return new Promise(resolve => { heldStatuses.push(() => resolve(result)); });
        }
        return result;
      },
      deleteWorkspace(request) {
        let resolve!: (result: WorkspaceDeletionResult) => void, reject!: (cause: unknown) => void;
        const pending = new Promise<WorkspaceDeletionResult>((yes, no) => { resolve = yes; reject = no; });
        requests.push({ request, generation: ownGeneration, resolve,
          reject: () => reject(new Error('SYNTHETIC_PRIVATE_DELETE_RESPONSE')),
          settled: pending.then(() => undefined, () => undefined) });
        return pending;
      },
    };
  }
  let capability = createCapability('Company');
  const container = document.createElement('section');
  container.setAttribute('aria-label', 'Workspace deletion controller probe');
  document.body.append(container);
  const root = createRoot(container);
  function Probe() {
    const controller = useWorkspaceManagement(capability, hasBusinessRuntime);
    latest = controller;
    return createElement('div', {},
      createElement('button', { type: 'button', onClick: controller.openDialog }, 'Open synthetic company menu'),
      presentation === 'recovery' || controller.state.isDialogOpen ? createElement(WorkspaceManagementDialog, {
        canReplaceActiveWorkspace: controller.canReplaceActiveWorkspace,
        canDeleteWorkspace: controller.canDeleteWorkspace,
        backupAvailableForSelectedWorkspace: controller.backupAvailableForSelectedWorkspace,
        onBackupChoiceChange: controller.setBackupChoice,
        ...(presentation === 'recovery' ? {} : { onClose: controller.closeDialog }),
        onLabelChange: controller.setLabelInput,
        onModeChange: controller.selectMode, onRetry: controller.retryStatus,
        onSubmit: controller.submitOperation, state: controller.state,
      }) : null);
  }
  const render = () => root.render(createElement(Probe));
  async function close() {
    try {
      await flush(async () => {
        let failure: { error: unknown } | undefined;
        try { root.unmount(); } catch (error) { failure = { error }; }
        for (const release of heldStatuses) release();
        for (const request of requests) request.resolve({ formatVersion: 1, status: 'cancelled', nextAction: 'continue' });
        await Promise.all(requests.map(request => request.settled));
        if (failure !== undefined) throw failure.error;
      });
    } finally { container.remove(); }
  }
  try { await flush(render); }
  catch (error) {
    try { await close(); }
    catch (cleanupError) { throw new AggregateError([error, cleanupError], 'Deletion probe initialization and cleanup failed.', { cause: error }); }
    throw error;
  }
  return {
    read() { return { state: latest.state, requests: requests.map(({ request, generation }) => ({ request, generation })),
      statusReads: [...statusReads] }; },
    async replaceCapability(business = true) {
      hasBusinessRuntime = business;
      capability = createCapability('New session');
      await flush(render);
    },
    async setBusinessContext(business: boolean) {
      hasBusinessRuntime = business;
      await flush(render);
    },
    rememberView() { retained = { submitOperation: latest.submitOperation,
      setLabelInput: latest.setLabelInput, setBackupChoice: latest.setBackupChoice }; },
    async submitRetained() { await flush(() => retained?.submitOperation()); },
    async editRetained() { await flush(() => {
      retained?.setLabelInput('OLD VIEW INPUT'); retained?.setBackupChoice('explicitDataLoss');
    }); },
    async retryStatus() { await flush(() => latest.retryStatus()); },
    async selectMode(mode: WorkspaceSelectorMode, foreign: boolean) {
      await flush(() => latest.selectMode(mode, foreign ? { workspaceId: ids[1]!, workspaceLabel: 'Foreign target',
        availability: 'ready', isActive: false } : undefined));
    },
    async setRecoveryState(value: 'idle' | 'busy' | 'recoveryRequired') {
      recoveryState = value;
      await flush(() => latest.retryStatus());
    },
    async releaseStatus() { await flush(() => { for (const release of heldStatuses) release(); }); },
    async release(index: number, result: WorkspaceDeletionResult | 'reject') {
      const request = requests[index];
      if (request === undefined) throw new Error('Missing held deletion request.');
      await flush(async () => {
        if (result === 'reject') request.reject(); else request.resolve(result);
        await request.settled;
      });
    },
    close,
  };
}
