import type { APIResponse, Page, Route } from '@playwright/test';

import { readE2eSqliteRows } from '../../src/assertions/readE2eSqliteRows.js';
import { expect, test } from '../../src/fixtures/isolatedWebTest.js';

test('COMPANY-SAVE-001 @critical retains newer edits after a delayed committed response', async ({ e2eWeb }) => {
  const { page, api, paths } = e2eWeb;
  await page.getByRole('button', { name: 'Oma yritys' }).click();
  const name = page.getByLabel('Yrityksen nimi');
  const sender = page.getByLabel('Lähettäjän sähköpostiosoite');
  await name.fill('Synthetic saved A');
  const hold = await holdCompanySettingsSave(page, true);
  try {
    await page.getByRole('button', { name: 'Tallenna', exact: true }).click();
    await hold.waitUntilHeld();
    const stored = await api.get('/company-settings');
    expect((await stored.json()).companySettings.companyName).toBe('Synthetic saved A');
    await name.fill('Synthetic newer B');
    await sender.fill('newer@example.invalid');
    await expect(page.getByLabel('SMTP-käyttäjätunnus')).toHaveValue('newer@example.invalid');
    await expect(page.getByRole('button', { name: 'Tallennetaan', exact: true })).toBeDisabled();
    // A second form submission must not issue another write while the first is pending.
    await name.press('Enter');
    await hold.release();
    await expect(page.getByRole('button', { name: 'Tallenna', exact: true })).toBeEnabled();
    await expect(name).toHaveValue('Synthetic newer B');
    await expect(sender).toHaveValue('newer@example.invalid');
    await expect(page.getByText('Oman yrityksen tiedot tallennettu.')).toHaveCount(0);
    expect(hold.putCount()).toBe(1);
    expect(readE2eSqliteRows(paths.databaseFilePath, 'SELECT company_name FROM company_settings'))
      .toEqual([{ company_name: 'Synthetic saved A' }]);
    expect(readE2eSqliteRows(paths.databaseFilePath, 'SELECT action FROM company_settings_audit_events'))
      .toHaveLength(1);
  } finally {
    await hold.close();
  }

  const saved = page.waitForResponse((response) =>
    response.request().method() === 'PUT' && new URL(response.url()).pathname === '/company-settings');
  await page.getByRole('button', { name: 'Tallenna', exact: true }).click();
  expect((await saved).status()).toBe(200);
  await expect(page.getByText('Oman yrityksen tiedot tallennettu.')).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Oma yritys' }).click();
  await expect(name).toHaveValue('Synthetic newer B');
  await expect(sender).toHaveValue('newer@example.invalid');
  expect(readE2eSqliteRows(paths.databaseFilePath, 'SELECT action FROM company_settings_audit_events'))
    .toHaveLength(2);
});

test('COMPANY-SAVE-002 @critical @fault retains edits on a failed save and allows a manual retry', async ({ e2eWeb }) => {
  const { page, api, paths } = e2eWeb;
  const before = await (await api.get('/company-settings')).json();
  await page.getByRole('button', { name: 'Oma yritys' }).click();
  const name = page.getByLabel('Yrityksen nimi');
  await name.fill('Synthetic rejected A');
  const hold = await holdCompanySettingsSave(page, false);
  try {
    await page.getByRole('button', { name: 'Tallenna', exact: true }).click();
    await hold.waitUntilHeld();
    await name.fill('Synthetic retry B');
    await hold.release();
    await expect(page.getByRole('button', { name: 'Tallenna', exact: true })).toBeEnabled();
    await expect(page.getByText('Jotain meni vikaan.', { exact: true })).toBeVisible();
    await expect(name).toHaveValue('Synthetic retry B');
    await expect(page.getByText('Oman yrityksen tiedot tallennettu.')).toHaveCount(0);
    expect(await (await api.get('/company-settings')).json()).toEqual(before);
    expect(readE2eSqliteRows(paths.databaseFilePath, 'SELECT action FROM company_settings_audit_events'))
      .toHaveLength(0);
  } finally {
    await hold.close();
  }
  await page.getByRole('button', { name: 'Tallenna', exact: true }).click();
  await expect(page.getByText('Oman yrityksen tiedot tallennettu.')).toBeVisible();
  await expect(page.getByText('Jotain meni vikaan.', { exact: true })).toHaveCount(0);
  expect((await (await api.get('/company-settings')).json()).companySettings.companyName)
    .toBe('Synthetic retry B');
});

test('COMPANY-SAVE-003 @critical ignores a previous view save after returning to the form', async ({ e2eWeb }) => {
  const { page } = e2eWeb;
  await page.getByRole('button', { name: 'Oma yritys' }).click();
  const name = page.getByLabel('Yrityksen nimi');
  await name.fill('Synthetic previous view');
  const hold = await holdCompanySettingsSave(page, true);
  try {
    await page.getByRole('button', { name: 'Tallenna', exact: true }).click();
    await hold.waitUntilHeld();
    await page.getByRole('button', { name: 'Asiakkaat', exact: true }).click();
    await page.getByRole('button', { name: 'Oma yritys' }).click();
    await expect(name).toHaveValue('Synthetic previous view');
    await name.fill('Synthetic current view');
    await hold.release();
    await expect(name).toHaveValue('Synthetic current view');
    await expect(page.getByText('Oman yrityksen tiedot tallennettu.')).toHaveCount(0);
  } finally {
    await hold.close();
  }
  await page.getByRole('button', { name: 'Tallenna', exact: true }).click();
  await expect(page.getByText('Oman yrityksen tiedot tallennettu.')).toBeVisible();
  await expect(name).toHaveValue('Synthetic current view');
});

async function holdCompanySettingsSave(page: Page, commit: boolean) {
  let held: { route: Route; response?: APIResponse } | undefined;
  let routeError: unknown;
  let count = 0;
  const pattern = '**/company-settings';
  const handler = async (route: Route) => {
    if (route.request().method() !== 'PUT') {
      await route.fallback();
      return;
    }
    count += 1;
    if (count > 1) {
      routeError = new Error('Unexpected concurrent company settings save.');
      await route.abort();
      return;
    }
    try {
      if (commit) {
        const response = await route.fetch();
        held = { route, response };
        expect(response.status()).toBe(200);
      } else {
        held = { route };
      }
    } catch (error) {
      routeError = error;
      await route.abort();
    }
  };
  await page.route(pattern, handler);
  return {
    putCount: () => count,
    async waitUntilHeld() {
      await expect.poll(() => held !== undefined || routeError !== undefined).toBe(true);
      if (routeError !== undefined) throw routeError;
    },
    async release() {
      expect(held).toBeDefined();
      const current = held!;
      try {
        if (current.response) {
          await current.route.fulfill({ response: current.response });
        } else {
          await current.route.fulfill({ status: 500, json: { error: 'Internal server error.' } });
        }
      } finally {
        await current.response?.dispose();
        held = undefined;
      }
    },
    async close() {
      try {
        if (held) await held.route.abort();
      } finally {
        await held?.response?.dispose();
        await page.unroute(pattern, handler);
      }
    },
  };
}
