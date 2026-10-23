import type { APIResponse, Locator, Page, Request, Response, Route } from '@playwright/test';

import { readE2eSqliteRows } from '../../src/assertions/readE2eSqliteRows.js';
import { createSyntheticCompanySettingsInput } from '../../src/data/syntheticBusinessInputs.js';
import { expect, test } from '../../src/fixtures/isolatedWebTest.js';
import { mountCompanySettingsLoadingProbe } from './companySettingsLoadingMount.js';

const loadingMessage = 'Ladataan oman yrityksen tietoja...';
const genericError = 'Jotain meni vikaan.';
const reloadLabel = 'Lataa tiedot uudelleen';
// The application entrypoint mounts under development StrictMode.
const initialReadCount = 2;

test('COMPANY-LOAD-001 @critical admits a delayed validated initial GET without writing automatically', async ({ e2eWeb }) => {
  const { page, api, paths } = e2eWeb;
  expect((await api.put('/company-settings', { data: createSyntheticCompanySettingsInput() })).status()).toBe(200);
  const before = readCompanyState(paths.databaseFilePath);
  const requests = await countCompanyRequests(page);
  const hold = await holdCompanyRead(page);
  let failure: { error: unknown } | undefined;
  try {
    await page.getByRole('button', { name: 'Oma yritys' }).click();
    await hold.waitUntilHeld(initialReadCount);
    await expectPending(page);
    await expectIndependentPanels(page);
    expect(requests.counts()).toEqual({ gets: initialReadCount, puts: 0 });
    expect(readCompanyState(paths.databaseFilePath)).toEqual(before);

    await hold.release('success');
    await expect(page.getByLabel('Yrityksen nimi')).toHaveValue('Synthetic Builder Oy');
    await expect(page.getByLabel('Lähettäjän sähköpostiosoite')).toHaveValue('billing@example.invalid');
    await expect(page.getByRole('button', { name: 'Tallenna', exact: true })).toBeEnabled();
    await expect(page.getByText(loadingMessage, { exact: true })).toHaveCount(0);
    expect(requests.counts()).toEqual({ gets: initialReadCount, puts: 0 });
    expect(readCompanyState(paths.databaseFilePath)).toEqual(before);
  } catch (error) {
    failure = { error };
  } finally {
    try { await hold.close(); }
    catch (error) {
      test.info().annotations.push({ type: 'company-settings-load-cleanup', description: 'Held GET cleanup failed.' });
      failure ??= { error };
    }
    requests.close();
  }
  if (failure) throw failure.error;
});

for (const [id, outcome] of [['002', 'failure'], ['003', 'malformed']] as const) {
  test(`COMPANY-LOAD-${id} @critical @fault @recovery rejects ${outcome} GET and only hydrates after manual reload`, async ({ e2eWeb }) => {
    const { page, api, paths } = e2eWeb;
    expect((await api.put('/company-settings', { data: createSyntheticCompanySettingsInput() })).status()).toBe(200);
    const before = readCompanyState(paths.databaseFilePath);
    const requests = await countCompanyRequests(page);
    const hold = await holdCompanyRead(page);
    const expectedError = outcome === 'malformed'
      ? 'Oman yrityksen tietojen vastaus oli virheellinen.' : genericError;
    let failure: { error: unknown } | undefined;
    try {
      await page.getByRole('button', { name: 'Oma yritys' }).click();
      await hold.waitUntilHeld(initialReadCount);
      await expectPending(page);
      await hold.release(outcome);
      await expect(page.getByText(expectedError, { exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: reloadLabel, exact: true })).toBeEnabled();
      await expectNoMasterForm(page);
      await expectIndependentPanels(page);
      await expect(page.getByText('Synthetic private failure detail', { exact: false })).toHaveCount(0);
      expect(requests.counts()).toEqual({ gets: initialReadCount, puts: 0 });
      expect(readCompanyState(paths.databaseFilePath)).toEqual(before);

      await page.getByRole('button', { name: reloadLabel, exact: true }).click();
      await hold.waitUntilHeld(1);
      await expectPending(page);
      expect(requests.counts()).toEqual({ gets: initialReadCount + 1, puts: 0 });
      expect(readCompanyState(paths.databaseFilePath)).toEqual(before);
      await hold.release('success');
      await expect(page.getByLabel('Yrityksen nimi')).toHaveValue('Synthetic Builder Oy');
      await expect(page.getByLabel('Lähettäjän sähköpostiosoite')).toHaveValue('billing@example.invalid');
      await expect(page.getByLabel('SMTP-käyttäjätunnus')).toHaveValue('billing@example.invalid');
      await expect(page.getByText(expectedError, { exact: true })).toHaveCount(0);
      await expect(page.getByRole('button', { name: reloadLabel, exact: true })).toHaveCount(0);
      expect(requests.counts()).toEqual({ gets: initialReadCount + 1, puts: 0 });
      expect(readCompanyState(paths.databaseFilePath)).toEqual(before);

      await page.getByLabel('Yrityksen nimi').fill('Synthetic explicitly saved after reload');
      await page.getByRole('button', { name: 'Tallenna', exact: true }).click();
      await expect(page.getByText('Oman yrityksen tiedot tallennettu.')).toBeVisible();
      expect(requests.counts()).toEqual({ gets: initialReadCount + 1, puts: 1 });
      expect(readCompanyState(paths.databaseFilePath).audit).toHaveLength(before.audit.length + 1);
      expect((await (await api.get('/company-settings')).json()).companySettings.companyName)
        .toBe('Synthetic explicitly saved after reload');
    } catch (error) {
      failure = { error };
    } finally {
      try { await hold.close(); }
      catch (error) {
        test.info().annotations.push({ type: 'company-settings-load-cleanup', description: 'Held GET cleanup failed.' });
        failure ??= { error };
      }
      requests.close();
    }
    if (failure) throw failure.error;
  });
}

test('COMPANY-LOAD-004 @critical treats a successful empty GET as normal first use', async ({ e2eWeb }) => {
  const { page, api, paths } = e2eWeb;
  const before = readCompanyState(paths.databaseFilePath);
  expect(before.settings).toEqual([]);
  expect(before.audit).toEqual([]);
  const requests = await countCompanyRequests(page);
  try {
    await page.getByRole('button', { name: 'Oma yritys' }).click();
    await expect(page.getByLabel('Yrityksen nimi')).toHaveValue('');
    await expect(page.getByRole('button', { name: 'Tallenna', exact: true })).toBeEnabled();
    await expect(page.getByText(genericError, { exact: true })).toHaveCount(0);
    expect(requests.counts()).toEqual({ gets: initialReadCount, puts: 0 });
    expect(readCompanyState(paths.databaseFilePath)).toEqual(before);
    await page.getByLabel('Yrityksen nimi').fill('Synthetic first company');
    await page.getByRole('button', { name: 'Tallenna', exact: true }).click();
    await expect(page.getByText('Oman yrityksen tiedot tallennettu.')).toBeVisible();
    expect(requests.counts()).toEqual({ gets: initialReadCount, puts: 1 });
    expect((await (await api.get('/company-settings')).json()).companySettings.companyName)
      .toBe('Synthetic first company');
    expect(readCompanyState(paths.databaseFilePath).audit).toHaveLength(1);
  } finally {
    requests.close();
  }
});

for (const [id, unmount, outcome] of [
  ['005', true, 'success'], ['006', true, 'failure'],
  ['007', false, 'success'], ['008', false, 'failure'],
] as const) {
  test(`COMPANY-LOAD-${id} @critical ignores stale ${outcome}/finally after ${unmount ? 'unmount and return' : 'apiClient prop replacement'}`, async ({ e2eWeb }) => {
    const { page, api, paths } = e2eWeb;
    expect((await api.put('/company-settings', { data: createSyntheticCompanySettingsInput() })).status()).toBe(200);
    const before = readCompanyState(paths.databaseFilePath);
    const requests = await countCompanyRequests(page);
    const probe = await mountCompanySettingsLoadingProbe(page);
    const { view } = probe;
    let failure: { error: unknown } | undefined;
    try {
      await probe.waitForReads(1);
      await expectPending(view);
      await probe.startSession(unmount);
      await probe.waitForReads(2);
      await probe.release(0, outcome);
      // Old finally must not remove the current session's loading/PUT admission gate.
      await expectPending(view);
      await expect(view.getByText(genericError, { exact: true })).toHaveCount(0);
      await probe.release(1);
      await expect(view.getByLabel('Yrityksen nimi')).toHaveValue('Synthetic Builder Oy');

      await probe.startSession(unmount);
      await probe.waitForReads(3);
      await expectPending(view);
      await probe.startSession(unmount);
      await probe.waitForReads(4);
      await probe.release(3);
      await view.getByLabel('Yrityksen nimi').fill('Synthetic current session edit');
      await probe.release(2, outcome);
      await expect(view.getByLabel('Yrityksen nimi')).toHaveValue('Synthetic current session edit');
      await expect(view.getByRole('button', { name: 'Tallenna', exact: true })).toBeEnabled();
      await expect(view.getByText(genericError, { exact: true })).toHaveCount(0);
      await expect(view.getByText('Oman yrityksen tiedot tallennettu.')).toHaveCount(0);
      expect(requests.counts()).toEqual({ gets: 4, puts: 0 });
      expect(readCompanyState(paths.databaseFilePath)).toEqual(before);
      await view.getByRole('button', { name: 'Tallenna', exact: true }).click();
      await expect(view.getByText('Oman yrityksen tiedot tallennettu.')).toBeVisible();
      expect(requests.counts()).toEqual({ gets: 4, puts: 1 });
      expect((await (await api.get('/company-settings')).json()).companySettings.companyName)
        .toBe('Synthetic current session edit');
      expect(readCompanyState(paths.databaseFilePath).audit).toHaveLength(before.audit.length + 1);
    } catch (error) {
      failure = { error };
    } finally {
      try { await probe.close(); }
      catch (error) {
        test.info().annotations.push({ type: 'company-settings-load-cleanup', description: 'Browser probe cleanup failed.' });
        failure ??= { error };
      }
      finally { requests.close(); }
    }
    if (failure) throw failure.error;
  });
}

async function expectNoMasterForm(view: Page | Locator): Promise<void> {
  await expect(view.getByLabel('Yrityksen nimi')).toHaveCount(0);
  await expect(view.getByRole('button', { name: 'Tallenna', exact: true })).toHaveCount(0);
}

async function expectPending(view: Page | Locator): Promise<void> {
  const progress = view.getByRole('status').filter({ hasText: loadingMessage });
  await expect(progress).toBeVisible();
  await expect(progress).toHaveAttribute('aria-live', 'polite');
  await expect(progress).toHaveAttribute('aria-atomic', 'true');
  await expect(progress.locator('[aria-hidden="true"]')).toHaveCount(1);
  await expectNoMasterForm(view);
}

async function expectIndependentPanels(view: Page | Locator): Promise<void> {
  await expect(view.getByRole('heading', { name: 'Varmuuskopiointi ja palautus', exact: true })).toBeVisible();
  await expect(view.getByRole('button', { name: 'Diagnostiikka', exact: true })).toBeEnabled();
  await expect(view.getByRole('button', { name: 'Tapahtumat', exact: true })).toBeEnabled();
}

function readCompanyState(databaseFilePath: string) {
  return {
    settings: readE2eSqliteRows(databaseFilePath, 'SELECT * FROM company_settings ORDER BY id'),
    audit: readE2eSqliteRows(databaseFilePath, 'SELECT * FROM company_settings_audit_events ORDER BY id'),
  };
}

async function countCompanyRequests(page: Page) {
  // The initial customer view reads company pricing under StrictMode too.
  // Observe a fresh navigation so those requests finish before interception.
  const appUrl = page.url();
  await page.goto('about:blank');
  const initialResponses: Response[] = [];
  const observeInitialRead = (response: Response) => {
    if (response.request().method() === 'GET' &&
      new URL(response.url()).pathname === '/company-settings') initialResponses.push(response);
  };
  page.on('response', observeInitialRead);
  try {
    await page.goto(appUrl);
    await expect.poll(() => initialResponses.length).toBe(initialReadCount);
    for (const response of initialResponses) {
      expect(response.status()).toBe(200);
      expect(await response.finished()).toBeNull();
    }
  } finally {
    page.off('response', observeInitialRead);
  }
  let gets = 0;
  let puts = 0;
  const listener = (request: Request) => {
    if (new URL(request.url()).pathname !== '/company-settings') return;
    if (request.method() === 'GET') gets += 1;
    if (request.method() === 'PUT') puts += 1;
  };
  page.on('request', listener);
  return { counts: () => ({ gets, puts }), close: () => page.off('request', listener) };
}

async function holdCompanyRead(page: Page) {
  const pattern = '**/company-settings';
  const held: Array<{ route: Route; response: APIResponse }> = [];
  const pending: Array<Promise<void>> = [];
  let routeError: unknown;
  const handler = (route: Route) => {
    const operation = (async () => {
      if (route.request().method() !== 'GET') { await route.fallback(); return; }
      try {
        const response = await route.fetch();
        held.push({ route, response });
        expect(response.status()).toBe(200);
      } catch (error) {
        routeError ??= error;
        try { await route.abort(); }
        catch { /* Keep the original route failure for the test owner. */ }
      }
    })();
    pending.push(operation);
    return operation;
  };
  await page.route(pattern, handler);
  return {
    async waitUntilHeld(count: number) {
      await expect.poll(() => held.length === count || routeError !== undefined).toBe(true);
      if (routeError !== undefined) throw routeError;
    },
    async release(outcome: 'success' | 'failure' | 'malformed') {
      expect(held.length).toBeGreaterThan(0);
      while (held.length > 0) {
        const current = held[0]!;
        let failure: { error: unknown } | undefined;
        try {
          if (outcome === 'success') await current.route.fulfill({ response: current.response });
          else if (outcome === 'failure') await current.route.fulfill({
            status: 500, json: { error: 'Synthetic private failure detail' },
          });
          else await current.route.fulfill({ status: 200, json: {
            companySettings: { ...(await current.response.json()).companySettings, companyName: 42 },
          } });
        } catch (error) { failure = { error }; }
        if (failure) {
          try { await current.route.abort(); }
          catch { /* Preserve the response publication failure. */ }
        }
        try { await current.response.dispose(); }
        catch (error) { failure ??= { error }; }
        held.shift();
        if (failure) throw failure.error;
      }
    },
    async close() {
      const failures: unknown[] = [];
      try { await page.unroute(pattern, handler); }
      catch (error) { failures.push(error); }
      for (const result of await Promise.allSettled(pending)) {
        if (result.status === 'rejected') failures.push(result.reason);
      }
      for (const current of held.splice(0)) {
        try { await current.route.abort(); }
        catch (error) { failures.push(error); }
        try { await current.response.dispose(); }
        catch (error) { failures.push(error); }
      }
      if (routeError !== undefined) failures.unshift(routeError);
      if (failures.length > 0) throw new AggregateError(failures, 'Company settings held GET cleanup failed.');
    },
  };
}
