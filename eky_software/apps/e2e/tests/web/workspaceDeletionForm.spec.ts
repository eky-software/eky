import { expect, test } from '../../src/fixtures/isolatedWebTest.js';
import { uiText } from '../../../web/src/i18n/fi.js';
import { mountWorkspaceDeletionForm } from './workspaceDeletionFormMount.js';

const text = uiText.workspaces;

test('WORKSPACE-DELETE-FORM-001 @critical @security validates the real form before its callback and blocks pending controls', async ({ e2eWeb }) => {
  const probe = await mountWorkspaceDeletionForm(e2eWeb.page);
  let failure: { error: unknown } | undefined;
  try {
    const name = probe.view.getByRole('textbox', { name: text.deleteTypedLabel, exact: true });
    const proceed = probe.view.getByRole('button', { name: text.deleteContinue, exact: true });
    const loss = probe.view.getByRole('radio', { name: text.deleteWithoutBackup, exact: true });
    await expect(proceed).toBeDisabled();
    await expect(loss).not.toBeChecked();
    await expect(probe.view.getByRole('radio', { name: text.deleteCreateBackup, exact: true })).not.toBeChecked();
    await name.fill('synthetic company');
    await loss.check();
    await expect(proceed).toBeDisabled();
    await name.fill('Synthetic company ');
    await expect(proceed).toBeDisabled();
    await name.fill('Synthetic company');
    await expect(proceed).toBeEnabled();
    await name.press('Enter');
    await expect(proceed).toBeDisabled();
    await expect(name).toBeDisabled();
    await expect(loss).toBeDisabled();
    await expect(probe.view.getByRole('button', { name: text.back, exact: true })).toBeDisabled();
    await expect(probe.view.getByRole('status')).toHaveText(text.deleteProcessing);
    await probe.view.locator('form').evaluate((form: HTMLFormElement) => form.requestSubmit());
    expect(await probe.read()).toEqual({ backs: 0, requests: [{ formatVersion: 1,
      workspaceId: '11111111-1111-4111-8111-111111111111', typedLabel: 'Synthetic company',
      backupChoice: 'explicitDataLoss' }] });
    await probe.configure({ busy: false, backupAvailable: false, label: 'Another synthetic company' });
    await expect(probe.view.getByRole('radio', { name: text.deleteCreateBackup, exact: true })).toHaveCount(0);
    await expect(loss).not.toBeChecked();
    await expect(name).toHaveValue('');
    await expect(proceed).toBeDisabled();
    await expect(probe.view.getByText(text.deleteBackupUnavailable, { exact: true })).toBeVisible();
    await probe.view.getByRole('button', { name: text.back, exact: true }).click();
    expect((await probe.read()).backs).toBe(1);
    await probe.configure({ label: 'Synthetic  company' });
    const displayedName = probe.view.getByText('Synthetic company', { exact: true });
    await expect(displayedName).toHaveCSS('white-space', 'pre-wrap');
    expect(await displayedName.textContent()).toBe('Synthetic  company');
    await name.fill('Synthetic company');
    await loss.check();
    await expect(proceed).toBeDisabled();
    await name.fill('Synthetic  company');
    await expect(proceed).toBeEnabled();
    expect((await probe.read()).requests).toHaveLength(1);
  } catch (error) { failure = { error }; }
  finally {
    try { await probe.close(); }
    catch (error) { failure ??= { error }; }
  }
  if (failure !== undefined) throw failure.error;
});

test('WORKSPACE-DELETE-FORM-002 @critical fits long labels and Unicode confirmation on desktop and mobile', async ({ e2eWeb }) => {
  const { page } = e2eWeb;
  await expect(page.getByRole('heading', { name: 'Asiakkaat', exact: true })).toBeVisible();
  await page.evaluate(() => performance.clearResourceTimings());
  const probe = await mountWorkspaceDeletionForm(page);
  let failure: { error: unknown } | undefined;
  try {
    const label = '\u{10400}'.repeat(80);
    await probe.configure({ label, showIdentifier: true });
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.evaluate(() => { document.documentElement.style.fontSize = '125%'; });
      await expect(probe.view.getByRole('heading', { name: text.deleteHeading, exact: true })).toBeVisible();
      await expect(probe.view.getByText(label, { exact: true })).toBeVisible();
      expect(await probe.view.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
      for (const button of await probe.view.getByRole('button').all()) {
        expect(await button.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
      }
      await test.info().attach(`workspace-deletion-form-${width}`, {
        body: await probe.view.screenshot(), contentType: 'image/png',
      });
    }
    const name = probe.view.getByRole('textbox', { name: text.deleteTypedLabel, exact: true });
    await name.fill(label);
    await expect(name).toHaveValue(label);
    await probe.view.getByRole('radio', { name: text.deleteCreateBackup, exact: true }).check();
    await expect(probe.view.getByRole('button', { name: text.deleteContinue, exact: true })).toBeEnabled();
    expect((await probe.read()).requests).toHaveLength(0);
  } catch (error) { failure = { error }; }
  finally {
    try { await probe.close(); }
    catch (error) { failure ??= { error }; }
  }
  if (failure !== undefined) throw failure.error;
});
