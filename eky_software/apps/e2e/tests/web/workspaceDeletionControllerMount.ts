import type { Page } from '@playwright/test';
import type { WorkspaceDeletionRequest, WorkspaceDeletionResult } from '../../../web/src/app/desktopWorkspaceManagement.js';
import type { WorkspaceSelectorMode, WorkspaceSelectorState } from '../../../web/src/features/workspaces/workspaceSelectorState.js';
import { expect } from '../../src/fixtures/isolatedWebTest.js';

interface WorkspaceDeletionControllerProbe {
  read(): { state: WorkspaceSelectorState; requests: Array<{ request: Readonly<WorkspaceDeletionRequest>; generation: number }>; statusReads: number[] };
  replaceCapability(business: boolean): Promise<void>;
  setBusinessContext(business: boolean): Promise<void>;
  rememberView(): void;
  editRetained(): Promise<void>;
  submitRetained(): Promise<void>;
  retryStatus(): Promise<void>;
  selectMode(mode: WorkspaceSelectorMode, foreign: boolean): Promise<void>;
  setRecoveryState(value: 'idle' | 'busy' | 'recoveryRequired'): Promise<void>;
  releaseStatus(): Promise<void>;
  release(index: number, result: WorkspaceDeletionResult | 'reject'): Promise<void>;
  close(): Promise<void>;
}

export async function mountWorkspaceDeletionController(page: Page, holdInitialStatus = false,
  presentation: 'ordinary' | 'recovery' = 'ordinary') {
  await expect(page.getByRole('heading', { name: 'Asiakkaat', exact: true })).toBeVisible();
  const handle = await page.evaluateHandle(async options => {
    const modulePath = '/src/features/workspaces/WorkspaceDeletionController.testMount.ts';
    const { mountWorkspaceDeletionControllerProbe } = await import(modulePath) as {
      mountWorkspaceDeletionControllerProbe(options: { holdInitial: boolean; presentation: 'ordinary' | 'recovery' }): Promise<WorkspaceDeletionControllerProbe>;
    };
    return mountWorkspaceDeletionControllerProbe(options);
  }, { holdInitial: holdInitialStatus, presentation });
  return {
    view: page.getByRole('region', { name: 'Workspace deletion controller probe' }),
    read: () => handle.evaluate(probe => probe.read()),
    replaceCapability: (business = true) => handle.evaluate((probe, value) => probe.replaceCapability(value), business),
    setBusinessContext: (business: boolean) => handle.evaluate((probe, value) => probe.setBusinessContext(value), business),
    rememberView: () => handle.evaluate(probe => probe.rememberView()),
    editRetained: () => handle.evaluate(probe => probe.editRetained()),
    submitRetained: () => handle.evaluate(probe => probe.submitRetained()),
    retryStatus: () => handle.evaluate(probe => probe.retryStatus()),
    selectMode: (mode: WorkspaceSelectorMode, foreign = false) =>
      handle.evaluate((probe, value) => probe.selectMode(value.mode, value.foreign), { mode, foreign }),
    setRecoveryState: (value: 'idle' | 'busy' | 'recoveryRequired') => handle.evaluate((probe, next) => probe.setRecoveryState(next), value),
    releaseStatus: () => handle.evaluate(probe => probe.releaseStatus()),
    release: (index: number, result: WorkspaceDeletionResult | 'reject') =>
      handle.evaluate((probe, value) => probe.release(value.index, value.result), { index, result }),
    async close() {
      let failure: { error: unknown } | undefined;
      try { await handle.evaluate(probe => probe.close()); } catch (error) { failure = { error }; }
      try { await handle.dispose(); } catch (error) { failure ??= { error }; }
      if (failure !== undefined) throw failure.error;
    },
  };
}
