import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { readElectronMainState } from '../../src/electron/readElectronMainState.js';
import { expect, test } from '../../src/fixtures/isolatedElectronTest.js';

interface NativeRecoveryDialogExperiment {
  controller: AbortController;
  settled: boolean;
  result: Promise<{ response: number; checkboxChecked: boolean }>;
}

test.use({ e2eSelectorProfile: 'empty' });

test('DESK-RECOVERY-DIALOG-001 @security @recovery settles the real parentless native dialog after main-owned abort', async ({ e2eElectron }) => {
  const registryPath = join(e2eElectron.runtime.userDataPath, 'workspace-registry-v1.json');
  const registryBefore = await readFile(registryPath);
  const stateBefore = await readElectronMainState(e2eElectron.electronApp);
  expect(stateBefore).toMatchObject({ backendIsRunning: false, backendStartCount: 0, windowCount: 1 });
  let firstFailure: { cause: unknown } | undefined;
  try {
    const initial = await e2eElectron.electronApp.evaluate(({ dialog }) => {
      const scope = globalThis as typeof globalThis & { __EKY_RECOVERY_DIALOG_EXPERIMENT__?: NativeRecoveryDialogExperiment };
      if (scope.__EKY_RECOVERY_DIALOG_EXPERIMENT__ !== undefined) throw new Error('RECOVERY_DIALOG_EXPERIMENT_ALREADY_STARTED');
      const controller = new AbortController();
      const state: NativeRecoveryDialogExperiment = {
        controller, settled: false,
        result: dialog.showMessageBox({
          type: 'warning', title: 'EKY synthetic recovery dialog',
          message: 'Synthetic recovery choice. No company data is changed.',
          buttons: ['Jatka palautumista', 'Rajattu hallinta', 'Sulje'],
          defaultId: 0, cancelId: 2, noLink: true, signal: controller.signal,
        }),
      };
      state.result = state.result.then(result => { state.settled = true; return result; },
        error => { state.settled = true; throw error; });
      void state.result.catch(() => undefined);
      scope.__EKY_RECOVERY_DIALOG_EXPERIMENT__ = state;
      return { settled: state.settled, aborted: state.controller.signal.aborted };
    });
    expect(initial).toEqual({ settled: false, aborted: false });

    const beforeAbort = await e2eElectron.electronApp.evaluate(() => {
      const state = (globalThis as typeof globalThis & { __EKY_RECOVERY_DIALOG_EXPERIMENT__?: NativeRecoveryDialogExperiment })
        .__EKY_RECOVERY_DIALOG_EXPERIMENT__;
      if (state === undefined) throw new Error('RECOVERY_DIALOG_EXPERIMENT_MISSING');
      return { settled: state.settled, aborted: state.controller.signal.aborted };
    });
    expect(beforeAbort).toEqual({ settled: false, aborted: false });

    const cancelled = await e2eElectron.electronApp.evaluate(async () => {
      const state = (globalThis as typeof globalThis & { __EKY_RECOVERY_DIALOG_EXPERIMENT__?: NativeRecoveryDialogExperiment })
        .__EKY_RECOVERY_DIALOG_EXPERIMENT__;
      if (state === undefined) throw new Error('RECOVERY_DIALOG_EXPERIMENT_MISSING');
      if (state.settled || state.controller.signal.aborted) throw new Error('RECOVERY_DIALOG_EXPERIMENT_NOT_PENDING');
      state.controller.abort();
      const result = await state.result;
      return { response: result.response, settled: state.settled, aborted: state.controller.signal.aborted };
    });
    expect(cancelled).toEqual({ response: 2, settled: true, aborted: true });
    expect(await readFile(registryPath)).toEqual(registryBefore);
    const stateAfter = await readElectronMainState(e2eElectron.electronApp);
    expect(stateAfter).toEqual(stateBefore);
    await expect(e2eElectron.page.getByRole('heading', { name: 'Yritykset', exact: true })).toBeVisible();
  } catch (cause) {
    firstFailure = { cause };
    throw cause;
  } finally {
    try {
      await e2eElectron.electronApp.evaluate(async () => {
        const scope = globalThis as typeof globalThis & { __EKY_RECOVERY_DIALOG_EXPERIMENT__?: NativeRecoveryDialogExperiment };
        const state = scope.__EKY_RECOVERY_DIALOG_EXPERIMENT__;
        if (state === undefined) return;
        state.controller.abort();
        try { await state.result; }
        finally { delete scope.__EKY_RECOVERY_DIALOG_EXPERIMENT__; }
      });
    } catch (cleanupError) {
      if (firstFailure !== undefined) throw new AggregateError([firstFailure.cause, cleanupError],
        'RECOVERY_DIALOG_EXPERIMENT_CLEANUP_FAILED', { cause: firstFailure.cause });
      throw cleanupError;
    }
  }
});
