import { expect, test } from '../../src/fixtures/isolatedWebTest.js';
import { uiText } from '../../../web/src/i18n/fi.js';
import { mountWorkspaceDeletionController } from './workspaceDeletionControllerMount.js';

const text = uiText.workspaces;
type Probe = Awaited<ReturnType<typeof mountWorkspaceDeletionController>>;

async function open(probe: Probe) {
  await probe.view.getByRole('button', { name: 'Open synthetic company menu', exact: true }).click();
  await expect(probe.view.getByRole('dialog')).toBeVisible();
}

async function selectTarget(probe: Probe, label: string) {
  await probe.view.getByRole('listitem').filter({ hasText: label })
    .getByRole('button', { name: text.deleteWorkspace, exact: true }).click();
  await expect(probe.view.getByRole('textbox', { name: text.deleteTypedLabel, exact: true })).toBeFocused();
}

async function confirm(probe: Probe, label: string) {
  await selectTarget(probe, label);
  await probe.view.getByRole('textbox', { name: text.deleteTypedLabel, exact: true }).fill(label);
  await probe.view.getByRole('radio', { name: text.deleteWithoutBackup, exact: true }).check();
  await expect(probe.view.getByRole('button', { name: text.deleteContinue, exact: true })).toBeEnabled();
}

test('WORKSPACE-DELETE-RECOVERY-UI-001 @critical @security keeps recovery commands restricted and completion manual', async ({ e2eWeb }) => {
  const probe = await mountWorkspaceDeletionController(e2eWeb.page, false, 'recovery');
  let failure: { error: unknown } | undefined;
  try {
    await expect(probe.view.getByRole('heading', { name: text.recoveryManagementHeading, exact: true })).toBeVisible();
    for (const mode of ['create', 'import', 'rename', 'confirmSwitch', 'confirmReplace'] as const) await probe.selectMode(mode);
    await probe.selectMode('confirmDelete', true);
    expect((await probe.read()).state).toMatchObject({ mode: 'list', selectedWorkspaceId: null });
    expect((await probe.read()).requests).toHaveLength(0);
    for (const name of [text.addWorkspace, text.importBackup, text.rename, text.openWorkspace, text.replaceActiveButton]) {
      await expect(probe.view.getByRole('button', { name, exact: true })).toHaveCount(0);
    }
    await probe.view.getByRole('button', { name: text.deleteWorkspace, exact: true }).click();
    await probe.view.getByRole('textbox', { name: text.deleteTypedLabel, exact: true }).fill('Company A');
    await probe.view.getByRole('radio', { name: text.deleteWithoutBackup, exact: true }).check();
    await expect(probe.view.getByRole('radio', { name: text.deleteCreateBackup, exact: true })).toHaveCount(0);
    await probe.rememberView();
    await probe.setBusinessContext(true);
    await probe.submitRetained();
    expect((await probe.read()).requests).toHaveLength(0);
    await probe.setBusinessContext(false);
    await probe.submitRetained();
    expect((await probe.read()).requests).toHaveLength(0);
    await probe.view.getByRole('radio', { name: text.deleteWithoutBackup, exact: true }).check();
    for (const width of [1280, 390]) {
      await e2eWeb.page.setViewportSize({ width, height: 1000 });
      await e2eWeb.page.evaluate(() => { document.documentElement.style.fontSize = '125%'; });
      const surface = probe.view.getByRole('main');
      expect(await surface.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
      for (const button of await surface.getByRole('button').all()) {
        expect(await button.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
      }
      await test.info().attach(`workspace-recovery-deletion-${width}`, { body: await surface.screenshot(), contentType: 'image/png' });
    }
    const reads = (await probe.read()).statusReads;
    await probe.view.getByRole('button', { name: text.deleteContinue, exact: true }).click();
    expect((await probe.read()).requests).toMatchObject([{ request: { workspaceId: '11111111-1111-4111-8111-111111111111',
      typedLabel: 'Company A', backupChoice: 'explicitDataLoss' } }]);
    await probe.setBusinessContext(true);
    await probe.release(0, { formatVersion: 1, status: 'completed', navigation: 'reopenPrevious' });
    await expect(probe.view.getByRole('status')).toHaveText(text.deleteCompletedClose);
    expect((await probe.read()).state).toMatchObject({ deletionCompleted: true, requiresRestart: false,
      isSubmitting: false, isRelaunching: false });
    await probe.setBusinessContext(false);
    await probe.retryStatus();
    await probe.selectMode('confirmDelete');
    await probe.submitRetained();
    expect((await probe.read()).requests).toHaveLength(1);
    expect((await probe.read()).statusReads).toEqual(reads);
    await expect(probe.view.getByRole('button', { name: text.deleteWorkspace, exact: true })).toHaveCount(0);
    await expect(probe.view.getByRole('button', { name: text.retry, exact: true })).toHaveCount(0);
  } catch (error) { failure = { error }; }
  finally { try { await probe.close(); } catch (error) { failure ??= { error }; } }
  if (failure !== undefined) throw failure.error;
});

test('WORKSPACE-DELETE-RECOVERY-UI-002 @critical @security expires target-free status and old session receipts without a fallback', async ({ e2eWeb }) => {
  const probe = await mountWorkspaceDeletionController(e2eWeb.page, false, 'recovery');
  let failure: { error: unknown } | undefined;
  try {
    await expect(probe.view.getByRole('button', { name: text.deleteWorkspace, exact: true })).toBeVisible();
    await probe.view.getByRole('button', { name: text.deleteWorkspace, exact: true }).click();
    await probe.view.getByRole('textbox', { name: text.deleteTypedLabel, exact: true }).fill('Company A');
    await probe.view.getByRole('radio', { name: text.deleteWithoutBackup, exact: true }).check();
    await probe.rememberView();
    for (const phase of ['busy', 'recoveryRequired'] as const) {
      await probe.setRecoveryState(phase);
      await probe.submitRetained();
      const value = await probe.read();
      expect(value.requests).toHaveLength(0);
      expect(value.state).toMatchObject({ selectedWorkspaceId: null, labelInput: '', backupChoice: null });
      expect(value.state.status).not.toHaveProperty('target');
      await expect(probe.view.getByText('Company A', { exact: true })).toHaveCount(0);
      await expect(probe.view.getByRole('button', { name: text.deleteWorkspace, exact: true })).toHaveCount(0);
    }
    await probe.setRecoveryState('idle');
    await probe.submitRetained();
    expect((await probe.read()).requests).toHaveLength(0);
    for (const [index, label] of ['Company A', 'New session A'].entries()) {
      await probe.view.getByRole('button', { name: text.deleteWorkspace, exact: true }).click();
      await probe.view.getByRole('textbox', { name: text.deleteTypedLabel, exact: true }).fill(label);
      await probe.view.getByRole('radio', { name: text.deleteWithoutBackup, exact: true }).check();
      await probe.view.getByRole('button', { name: text.deleteContinue, exact: true }).click();
      if (index === 0) await probe.replaceCapability(false);
    }
    await probe.release(0, { formatVersion: 1, status: 'completed', navigation: 'selector' });
    expect((await probe.read()).state).toMatchObject({ deletionCompleted: false, isSubmitting: true, labelInput: 'New session A' });
    await probe.release(1, { formatVersion: 1, status: 'cancelled', nextAction: 'restartRequired' });
    await expect(probe.view.getByRole('alert')).toHaveText(text.deleteRestartRequired);
    expect((await probe.read()).state).toMatchObject({ deletionCompleted: false, requiresRestart: true, isSubmitting: false, isRelaunching: false });
    const reads = (await probe.read()).statusReads;
    await probe.retryStatus();
    expect((await probe.read()).statusReads).toEqual(reads);
    expect((await probe.read()).requests).toHaveLength(2);
    await expect(probe.view.getByRole('status')).toHaveCount(0);
  } catch (error) { failure = { error }; }
  finally { try { await probe.close(); } catch (error) { failure ??= { error }; } }
  if (failure !== undefined) throw failure.error;
});

test('WORKSPACE-DELETE-UI-001 @critical @security separates cancellation, proven no effect and transport uncertainty', async ({ e2eWeb }) => {
  const probe = await mountWorkspaceDeletionController(e2eWeb.page);
  let failure: { error: unknown } | undefined;
  try {
    await open(probe);
    await confirm(probe, 'Company A');
    await probe.rememberView();
    await probe.retryStatus();
    await probe.submitRetained();
    expect((await probe.read()).requests).toHaveLength(0);
    await confirm(probe, 'Company A');
    await probe.view.getByRole('button', { name: text.deleteContinue, exact: true }).click();
    await expect(probe.view.getByRole('status')).toHaveText(text.deleteProcessing);
    await probe.release(0, { formatVersion: 1, status: 'cancelled', nextAction: 'continue' });
    await expect(probe.view.getByRole('list')).toBeVisible();
    expect((await probe.read()).state).toMatchObject({ labelInput: '', backupChoice: null, isSubmitting: false });
    await confirm(probe, 'Company A');
    await probe.view.getByRole('button', { name: text.deleteContinue, exact: true }).click();
    await probe.release(1, { formatVersion: 1, status: 'failed', errorCode: 'WORKSPACE_DELETE_BACKUP_UNAVAILABLE',
      sideEffectState: 'none', nextAction: 'continue' });
    await expect(probe.view.getByRole('alert')).toHaveText(text.deleteFailedNoChange);
    await expect(probe.view.getByRole('button', { name: text.deleteContinue, exact: true })).toBeEnabled();
    await probe.view.getByRole('button', { name: text.back, exact: true }).click();
    const faultedTarget = probe.view.getByRole('listitem').filter({ hasText: 'Company B' });
    await expect(faultedTarget.getByRole('button', { name: text.deleteWorkspace, exact: true })).toBeEnabled();
    await expect(faultedTarget.getByRole('button', { name: text.openWorkspace, exact: true })).toBeDisabled();
    await expect(faultedTarget.getByRole('button', { name: text.rename, exact: true })).toBeDisabled();
    await confirm(probe, 'Company B');
    await expect(probe.view.getByRole('radio', { name: text.deleteCreateBackup, exact: true })).toHaveCount(0);
    await probe.view.getByRole('button', { name: text.deleteContinue, exact: true }).click();
    await probe.release(2, 'reject');
    await expect(probe.view.getByRole('alert')).toHaveText(text.deleteOutcomeUnknown);
    await expect(probe.view.getByRole('status')).toHaveCount(0);
    const before = await probe.read();
    expect(before.state).toMatchObject({ requiresRestart: true, isSubmitting: false, isRelaunching: false });
    await probe.setBusinessContext(false);
    expect((await probe.read()).state.requiresRestart).toBe(true);
    await probe.retryStatus();
    expect((await probe.read()).statusReads).toEqual(before.statusReads);
    await probe.view.getByRole('button', { name: text.close, exact: true }).click();
    await open(probe);
    await expect(probe.view.getByRole('alert')).toHaveText(text.deleteOutcomeUnknown);
    await expect(probe.view.getByRole('button', { name: text.deleteWorkspace, exact: true })).toHaveCount(0);
    expect((await probe.read()).requests).toHaveLength(3);
    await expect(probe.view.getByText('SYNTHETIC_PRIVATE_DELETE_RESPONSE', { exact: false })).toHaveCount(0);
  } catch (error) { failure = { error }; }
  finally { try { await probe.close(); } catch (error) { failure ??= { error }; } }
  if (failure !== undefined) throw failure.error;
});

for (const [id, outcome] of [['002', 'completed'], ['003', 'reject']] as const) {
  test(`WORKSPACE-DELETE-UI-${id} @critical @security keeps an old ${outcome} response outside a new session's pending command`, async ({ e2eWeb }) => {
    const probe = await mountWorkspaceDeletionController(e2eWeb.page);
    let failure: { error: unknown } | undefined;
    try {
      await open(probe);
      await confirm(probe, 'Company A');
      await probe.rememberView();
      await probe.view.getByRole('button', { name: text.back, exact: true }).click();
      await probe.submitRetained();
      expect((await probe.read()).requests).toHaveLength(0);
      await confirm(probe, 'Company A');
      await probe.rememberView();
      await probe.view.getByRole('button', { name: text.deleteContinue, exact: true }).click();
      await probe.replaceCapability(false);
      await open(probe);
      await selectTarget(probe, 'New session B');
      await probe.editRetained();
      await expect(probe.view.getByRole('textbox', { name: text.deleteTypedLabel, exact: true })).toHaveValue('');
      await expect(probe.view.getByRole('radio', { name: text.deleteWithoutBackup, exact: true })).not.toBeChecked();
      await probe.view.getByRole('textbox', { name: text.deleteTypedLabel, exact: true }).fill('New session B');
      await probe.view.getByRole('radio', { name: text.deleteWithoutBackup, exact: true }).check();
      await expect(probe.view.getByRole('radio', { name: text.deleteCreateBackup, exact: true })).toHaveCount(0);
      await probe.view.getByRole('button', { name: text.deleteContinue, exact: true }).click();
      await probe.submitRetained();
      expect((await probe.read()).requests).toHaveLength(2);
      await probe.release(0, outcome === 'reject' ? 'reject'
        : { formatVersion: 1, status: 'completed', navigation: 'selector' });
      expect((await probe.read()).state).toMatchObject({ isSubmitting: true, requiresRestart: false,
        labelInput: 'New session B', backupChoice: 'explicitDataLoss' });
      await expect(probe.view.getByRole('status')).toHaveText(text.deleteProcessing);
      await expect(probe.view.getByRole('button', { name: text.deleteContinue, exact: true })).toBeDisabled();
      await probe.setBusinessContext(true);
      await probe.release(1, { formatVersion: 1, status: 'completed', navigation: 'selector' });
      await expect(probe.view.getByRole('status')).toHaveText(text.deleteCompletedSelector);
      expect((await probe.read()).state).toMatchObject({ isSubmitting: true, isRelaunching: true, requiresRestart: false });
      expect((await probe.read()).requests.map(entry => entry.generation)).toEqual([1, 2]);
    } catch (error) { failure = { error }; }
    finally { try { await probe.close(); } catch (error) { failure ??= { error }; } }
    if (failure !== undefined) throw failure.error;
  });
}

test('WORKSPACE-DELETE-UI-004 @critical @security ignores an old status read after a capability change', async ({ e2eWeb }) => {
  const probe = await mountWorkspaceDeletionController(e2eWeb.page, true);
  let failure: { error: unknown } | undefined;
  try {
    await probe.replaceCapability(false);
    await open(probe);
    await confirm(probe, 'New session A');
    await expect(probe.view.getByRole('radio', { name: text.deleteCreateBackup, exact: true })).toHaveCount(0);
    await probe.releaseStatus();
    expect((await probe.read()).state).toMatchObject({ mode: 'confirmDelete', labelInput: 'New session A',
      backupChoice: 'explicitDataLoss', requiresRestart: false });
    await expect(probe.view.getByRole('textbox', { name: text.deleteTypedLabel, exact: true })).toHaveValue('New session A');
    expect((await probe.read()).requests).toHaveLength(0);
  } catch (error) { failure = { error }; }
  finally { try { await probe.close(); } catch (error) { failure ??= { error }; } }
  if (failure !== undefined) throw failure.error;
});

test('WORKSPACE-DELETE-UI-005 @critical @security expires old backup confirmation across presentation changes without replacing the capability', async ({ e2eWeb }) => {
  const probe = await mountWorkspaceDeletionController(e2eWeb.page);
  let failure: { error: unknown } | undefined;
  try {
    await open(probe);
    await selectTarget(probe, 'Company A');
    await probe.view.getByRole('textbox', { name: text.deleteTypedLabel, exact: true }).fill('Company A');
    await probe.view.getByRole('radio', { name: text.deleteCreateBackup, exact: true }).check();
    await expect(probe.view.getByRole('button', { name: text.deleteContinue, exact: true })).toBeEnabled();
    for (const width of [1280, 390]) {
      await e2eWeb.page.setViewportSize({ width, height: 1000 });
      await e2eWeb.page.evaluate(() => { document.documentElement.style.fontSize = '125%'; });
      const dialog = probe.view.getByRole('dialog');
      expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
      for (const button of await dialog.getByRole('button').all()) {
        expect(await button.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
      }
      await test.info().attach(`workspace-deletion-controller-${width}`, {
        body: await dialog.screenshot(), contentType: 'image/png',
      });
    }
    await probe.rememberView();
    await probe.setBusinessContext(false);
    await probe.submitRetained();
    await probe.editRetained();
    expect((await probe.read()).requests).toHaveLength(0);
    expect((await probe.read()).state).toMatchObject({ backupChoice: null, labelInput: 'Company A' });
    await expect(probe.view.getByRole('radio', { name: text.deleteCreateBackup, exact: true })).toHaveCount(0);
    await probe.setBusinessContext(true);
    await probe.submitRetained();
    await probe.editRetained();
    expect((await probe.read()).requests).toHaveLength(0);
    await expect(probe.view.getByRole('radio', { name: text.deleteCreateBackup, exact: true })).not.toBeChecked();
    await expect(probe.view.getByRole('button', { name: text.deleteContinue, exact: true })).toBeDisabled();
    await probe.view.getByRole('radio', { name: text.deleteCreateBackup, exact: true }).check();
    await probe.view.getByRole('button', { name: text.deleteContinue, exact: true }).click();
    expect((await probe.read()).requests).toMatchObject([{ request: { backupChoice: 'createBackup' } }]);
    await probe.setBusinessContext(false);
    await probe.release(0, { formatVersion: 1, status: 'cancelled', nextAction: 'continue' });
    await expect(probe.view.getByRole('list')).toBeVisible();
    expect((await probe.read()).state).toMatchObject({ isSubmitting: false, requiresRestart: false, backupChoice: null });
  } catch (error) { failure = { error }; }
  finally { try { await probe.close(); } catch (error) { failure ??= { error }; } }
  if (failure !== undefined) throw failure.error;
});
