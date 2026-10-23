import { expect, test } from '../../src/fixtures/isolatedWebTest.js';
import { uiText } from '../../../web/src/i18n/fi.js';
import { mountProfileBackupFeedbackProbe } from './profileBackupFeedbackMount.js';

const text = uiText.companySettings;

test('UI-WAIT-001 @critical shows actual backup work, prevents a duplicate and clears after success or cancellation', async ({ e2eWeb }) => {
  const probe = await mountProfileBackupFeedbackProbe(e2eWeb.page);
  let failure: { error: unknown } | undefined;
  try {
    const { view } = probe;
    const progress = view.getByRole('status').and(view.locator('[aria-live="polite"]'));
    const create = view.getByRole('button', { name: 'Luo varmuuskopio', exact: true });
    const inspect = view.getByRole('button', { name: 'Tarkista varmuuskopio', exact: true });
    await probe.expectCalls(['status']);
    await expect(progress).toHaveText(text.profileBackupLoading);
    await expect(progress).toHaveAttribute('aria-live', 'polite');
    await expect(progress).toHaveAttribute('aria-atomic', 'true');
    await expect(progress.locator('[aria-hidden="true"]')).toHaveCount(1);
    await expect(create).toBeDisabled();
    await probe.release(0);
    await expect(progress).toBeEmpty();
    await create.focus();
    await create.press('Enter');
    await probe.expectCalls(['status', 'backup']);
    await expect(progress).toHaveText('Luodaan varmuuskopiota...');
    await expect(create).toBeDisabled();
    await expect(inspect).toBeDisabled();
    await create.dispatchEvent('click');
    await probe.expectCalls(['status', 'backup']);
    await probe.release(1);
    await probe.expectCalls(['status', 'backup', 'status']);
    await expect(progress).toHaveText('Luodaan varmuuskopiota...');
    await probe.release(2);
    await expect(progress).toBeEmpty();
    await expect(view.getByText(text.profileBackupCreateSuccess, { exact: true })).toBeVisible();
    await inspect.click();
    await probe.expectCalls(['status', 'backup', 'status', 'inspection']);
    await expect(progress).toHaveText('Valitaan ja tarkistetaan varmuuskopiota...');
    await probe.release(3, 'cancelled');
    await expect(progress).toBeEmpty();
    await expect(inspect).toBeEnabled();
    await expect(view.getByText(text.profileBackupCreateSuccess, { exact: true })).toHaveCount(0);
  } catch (error) { failure = { error }; }
  finally {
    try { await probe.close(); }
    catch (error) { failure ??= { error }; }
  }
  if (failure) throw failure.error;
});

test('UI-WAIT-002 @critical @fault ignores an old panel completion and preserves safe failure feedback', async ({ e2eWeb }) => {
  const probe = await mountProfileBackupFeedbackProbe(e2eWeb.page);
  let failure: { error: unknown } | undefined;
  try {
    const { view } = probe;
    const progress = view.getByRole('status').and(view.locator('[aria-live="polite"]'));
    await probe.expectCalls(['status']);
    await probe.release(0);
    await view.getByRole('button', { name: 'Tarkista varmuuskopio', exact: true }).click();
    await probe.expectCalls(['status', 'inspection']);
    await probe.remount();
    await probe.expectCalls(['status', 'inspection', 'status']);
    await probe.release(1, 'failure');
    await expect(progress).toHaveText(text.profileBackupLoading);
    await expect(view.getByText('Synthetic private backup failure.', { exact: false })).toHaveCount(0);
    await probe.release(2);
    const recovery = view.getByRole('button', { name: 'Luo palautuspiste nyt', exact: true });
    await recovery.click();
    await probe.expectCalls(['status', 'inspection', 'status', 'recoveryPoint']);
    await expect(progress).toHaveText('Luodaan palautuspistettä...');
    await probe.release(3, 'failure');
    await expect(progress).toBeEmpty();
    await expect(recovery).toBeEnabled();
    await expect(view.getByText(text.profileBackupOperationError, { exact: true })).toBeVisible();
    await expect(view.getByText('Synthetic private backup failure.', { exact: false })).toHaveCount(0);
    await recovery.click();
    await probe.expectCalls(['status', 'inspection', 'status', 'recoveryPoint', 'recoveryPoint']);
    await probe.release(4);
    await expect(progress).toBeEmpty();
    await expect(view.getByText(text.profileBackupOperationError, { exact: true })).toHaveCount(0);
  } catch (error) { failure = { error }; }
  finally {
    try { await probe.close(); }
    catch (error) { failure ??= { error }; }
  }
  if (failure) throw failure.error;
});

test('UI-WAIT-003 @critical keeps backup controls stable and feedback readable on desktop and mobile with reduced motion', async ({ e2eWeb }) => {
  const { page } = e2eWeb;
  const probe = await mountProfileBackupFeedbackProbe(page);
  let failure: { error: unknown } | undefined;
  try {
    await probe.expectCalls(['status']);
    await probe.release(0);
    for (const [index, width] of [1280, 390].entries()) {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: index === 0 ? 'no-preference' : 'reduce' });
      await page.evaluate((scale) => { document.documentElement.style.fontSize = scale; },
        index === 0 ? '150%' : '125%');
      const create = probe.view.getByRole('button', { name: 'Luo varmuuskopio', exact: true });
      await create.scrollIntoViewIfNeeded();
      const before = await create.boundingBox();
      await create.click();
      await probe.expectCalls(['status', ...Array.from({ length: index + 1 }, () => 'backup')]);
      const progress = probe.view.getByRole('status').and(probe.view.locator('[aria-live="polite"]'));
      await expect(progress).toHaveText('Luodaan varmuuskopiota...');
      expect(await create.boundingBox()).toEqual(before);
      const mark = progress.locator('[aria-hidden="true"]');
      await expect(mark).toHaveCSS('animation-name', index === 0 ? /spin/ : 'none');
      const bounds = await progress.boundingBox();
      expect(bounds).not.toBeNull();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
      expect(await progress.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
      await test.info().attach(`backup-wait-${width}`, {
        body: await probe.view.screenshot(), contentType: 'image/png',
      });
      await probe.release(index + 1, 'cancelled');
      await expect(progress).toBeEmpty();
    }
  } catch (error) { failure = { error }; }
  finally {
    try { await probe.close(); }
    catch (error) { failure ??= { error }; }
  }
  if (failure) throw failure.error;
});
