import { uiText } from '../../../web/src/i18n/fi.js';
import { expect, test } from '../../src/fixtures/isolatedWebTest.js';
import { mountWorkspaceSupportBundle } from './workspaceSupportBundleMount.js';

const text = uiText.diagnostics;

test('WORKSPACE-SUPPORT-001 @critical @security joins one export and distinguishes cancellation, safe failure and creation', async ({ e2eWeb }) => {
  const probe = await mountWorkspaceSupportBundle(e2eWeb.page);
  let failure: { error: unknown } | undefined;
  try {
    const button = probe.view.getByRole('button', { name: text.createSupportBundle, exact: true });
    await probe.rememberHandler();
    await probe.configure({ disabled: true });
    await expect(button).toBeDisabled();
    await probe.invokeRetained();
    expect(await probe.read()).toEqual([]);
    await probe.configure({ disabled: false });
    await probe.rememberHandler();
    await probe.invokeRetained(true);
    expect(await probe.read()).toEqual([0]);
    await expect(button).toBeDisabled();
    await expect(probe.view.getByRole('status')).toHaveText(text.creatingSupportBundle);
    await probe.release(0, 'cancelled');
    await expect(button).toBeEnabled();
    await expect(probe.view.getByRole('status')).toHaveText('');
    await expect(probe.view.getByRole('alert')).toHaveCount(0);
    await button.click();
    await probe.release(1, 'reject');
    await expect(probe.view.getByRole('alert')).toHaveText(text.createSupportBundleError);
    await expect(probe.view).not.toContainText('SYNTHETIC_PRIVATE_SUPPORT_ERROR');
    await expect(button).toBeEnabled();
    expect(await probe.read()).toEqual([0, 0]);
    await button.click();
    await expect(probe.view.getByRole('alert')).toHaveCount(0);
    await probe.configure({ disabled: true });
    await probe.release(2, 'created');
    await expect(probe.view.getByRole('status').filter({ hasText: text.supportBundleCreated })).toBeVisible();
    await expect(button).toBeDisabled();
    await probe.configure({ disabled: false });
    await expect(button).toBeEnabled();
    expect(await probe.read()).toEqual([0, 0, 0]);
  } catch (error) { failure = { error }; }
  finally { try { await probe.close(); } catch (error) { failure ??= { error }; } }
  if (failure !== undefined) throw failure.error;
});

test('WORKSPACE-SUPPORT-STRICT-001 @critical @security expires the first setup request before the same owner is reactivated', async ({ e2eWeb }) => {
  const probe = await mountWorkspaceSupportBundle(e2eWeb.page, true);
  let failure: { error: unknown } | undefined;
  try {
    const button = probe.view.getByRole('button', { name: text.createSupportBundle, exact: true });
    expect(await probe.read()).toEqual([0, 0]);
    await expect(button).toBeDisabled();
    await probe.release(0, 'created');
    await expect(button).toBeDisabled();
    await expect(probe.view.getByRole('status')).toHaveText(text.creatingSupportBundle);
    await probe.rememberHandler();
    await probe.invokeRetained(true);
    expect(await probe.read()).toEqual([0, 0]);
    await probe.release(1, 'created');
    await expect(button).toBeEnabled();
    await expect(probe.view.getByRole('status').filter({ hasText: text.supportBundleCreated })).toBeVisible();
  } catch (error) { failure = { error }; }
  finally { try { await probe.close(); } catch (error) { failure ??= { error }; } }
  if (failure !== undefined) throw failure.error;
});

for (const [scenario, outcome] of [['001', 'created'], ['002', 'cancelled'], ['003', 'reject']] as const) {
  test(`WORKSPACE-SUPPORT-STALE-${scenario} @critical @security ignores an old ${outcome} reply after creator A-B-A`, async ({ e2eWeb }) => {
    const probe = await mountWorkspaceSupportBundle(e2eWeb.page);
    let failure: { error: unknown } | undefined;
    try {
      const button = probe.view.getByRole('button', { name: text.createSupportBundle, exact: true });
      await button.click();
      await probe.configure({ creator: 1 });
      await expect(button).toBeEnabled();
      await probe.configure({ creator: 0 });
      await expect(probe.view.getByRole('status')).toHaveText('');
      await button.click();
      await probe.release(0, outcome);
      await expect(button).toBeDisabled();
      await expect(probe.view.getByRole('status')).toHaveText(text.creatingSupportBundle);
      await expect(probe.view.getByRole('alert')).toHaveCount(0);
      expect(await probe.read()).toEqual([0, 0]);
      await probe.release(1, 'created');
      await expect(button).toBeEnabled();
      await expect(probe.view.getByRole('status').filter({ hasText: text.supportBundleCreated })).toBeVisible();
    } catch (error) { failure = { error }; }
    finally { try { await probe.close(); } catch (error) { failure ??= { error }; } }
    if (failure !== undefined) throw failure.error;
  });
}

test('WORKSPACE-SUPPORT-UNMOUNT-001 @critical @security does not revive a reply after unmount and fits desktop and mobile', async ({ e2eWeb }) => {
  const { page } = e2eWeb;
  const probe = await mountWorkspaceSupportBundle(page);
  let failure: { error: unknown } | undefined;
  try {
    const button = probe.view.getByRole('button', { name: text.createSupportBundle, exact: true });
    await button.click();
    await probe.configure({ mounted: false });
    await expect(button).toHaveCount(0);
    await probe.configure({ mounted: true });
    await button.click();
    await probe.release(0, 'reject');
    await expect(button).toBeDisabled();
    await expect(probe.view.getByRole('alert')).toHaveCount(0);
    await probe.release(1, 'created');
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.evaluate(() => { document.documentElement.style.fontSize = '125%'; });
      await expect(button).toBeVisible();
      await expect(probe.view.getByRole('status').filter({ hasText: text.supportBundleCreated })).toBeVisible();
      expect(await probe.view.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
      expect(await button.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
      await test.info().attach(`workspace-support-control-${width}`, {
        body: await probe.view.screenshot(), contentType: 'image/png',
      });
    }
    expect(await probe.read()).toEqual([0, 0]);
  } catch (error) { failure = { error }; }
  finally { try { await probe.close(); } catch (error) { failure ??= { error }; } }
  if (failure !== undefined) throw failure.error;
});
