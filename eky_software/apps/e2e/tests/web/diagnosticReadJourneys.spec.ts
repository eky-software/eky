import { appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Page } from '@playwright/test';

import { expect, test } from '../../src/fixtures/isolatedWebTest.js';
import { mountDiagnosticsReadProbe } from './diagnosticsReadMount.js';

test('OBS-DIAGNOSTIC-READ-UI-001 @critical @fault shows valid rows and partial coverage through the real reader and strict client', async ({ e2eWeb }) => {
  const timestamp = new Date().toISOString();
  const directory = join(e2eWeb.paths.logsRoot, 'backend');
  await mkdir(directory, { recursive: true });
  await appendFile(join(directory, `backend-warning-error-${timestamp.slice(0, 7)}-004.jsonl`),
    `${JSON.stringify({ schemaVersion: 1, component: 'backend', category: 'database',
      eventId: 'synthetic-h4-error', eventName: 'database.openFailed', timestamp,
      appVersion: '1.0.0', buildRevision: 'development',
      runtimeInstanceId: '11111111-1111-4111-8111-111111111111',
      level: 'error', outcome: 'failure', errorCode: 'SYNTHETIC_H4_READ_FAILED',
    })}\n{synthetic malformed private line\n`);
  const response = await e2eWeb.api.get('/diagnostics/events');
  expect(response.status()).toBe(200);
  expect(await response.json()).toMatchObject({ readState: { status: 'partial', reasons: ['invalidEntries'] } });
  await openDiagnostics(e2eWeb.page);
  await expect(e2eWeb.page.getByText('Diagnostiikkatiedot ovat osittaiset.', { exact: false })).toBeVisible();
  await expect(e2eWeb.page.getByText('SYNTHETIC_H4_READ_FAILED', { exact: true })).toBeVisible();
  await expect(e2eWeb.page.getByText('Lokiyhteenveto on osittainen.', { exact: false })).toBeVisible();
  await expect(e2eWeb.page.getByText('Diagnostiikkatapahtumia ei ole vielä.', { exact: true })).toHaveCount(0);
  expect((await e2eWeb.page.content()).includes('synthetic malformed private line')).toBe(false);
});

test('OBS-DIAGNOSTIC-READ-UI-002 @critical @fault retains event results when only the summary request fails', async ({ e2eWeb }) => {
  await e2eWeb.page.route('**/diagnostics/summary', route => route.fulfill({
    status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'synthetic private summary detail' }),
  }));
  await openDiagnostics(e2eWeb.page);
  await expect(e2eWeb.page.getByRole('alert')).toBeVisible();
  await expect(e2eWeb.page.getByRole('table')).toBeVisible();
  await expect(e2eWeb.page.getByText('backend.started', { exact: true })).toBeVisible();
  expect((await e2eWeb.page.content()).includes('synthetic private summary detail')).toBe(false);
});

for (const [id, reason, message] of [
  ['003', 'sourceUnavailable', 'Diagnostiikkatietoja ei voitu lukea.'],
  ['004', 'notConfigured', 'Tässä ajotilassa ei ole määritetty diagnostiikan lokilähdettä.'],
] as const) {
  test(`OBS-DIAGNOSTIC-READ-UI-${id} @critical @fault distinguishes ${reason} from empty history at the HTTP/UI boundary`, async ({ e2eWeb }) => {
    await e2eWeb.page.route('**/diagnostics/events', route => route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify({
        diagnosticEvents: [], readState: { status: 'unavailable', reasons: [reason] },
      }),
    }));
    await openDiagnostics(e2eWeb.page);
    await expect(e2eWeb.page.getByText(message, { exact: true })).toBeVisible();
    await expect(e2eWeb.page.getByText('Diagnostiikkatapahtumia ei ole vielä.', { exact: true })).toHaveCount(0);
    await expect(e2eWeb.page.getByRole('table')).toHaveCount(0);
    await expect(e2eWeb.page.getByRole('heading', { name: 'Järjestelmäyhteenveto' })).toBeVisible();
  });
}

for (const [id, first] of [['005', 'events'], ['006', 'summary']] as const) {
  test(`OBS-DIAGNOSTIC-READ-UI-${id} @critical retains independent loading when ${first} resolves first`, async ({ e2eWeb }) => {
    const probe = await mountDiagnosticsReadProbe(e2eWeb.page);
    let failure: { error: unknown } | undefined;
    try {
      expect(await probe.callCount()).toBe(2);
      await probe.release(first === 'events' ? 1 : 0);
      await expect(probe.view.getByText(first === 'events'
        ? 'Ladataan järjestelmäyhteenvetoa...' : 'Ladataan diagnostiikkaa...', { exact: true })).toBeVisible();
      await expect(first === 'events' ? probe.view.getByRole('table')
        : probe.view.getByRole('heading', { name: 'Järjestelmäyhteenveto' })).toBeVisible();
      await probe.release(first === 'events' ? 0 : 1);
      await expect(probe.view.getByRole('table')).toBeVisible();
      await expect(probe.view.getByText('Ladataan järjestelmäyhteenvetoa...', { exact: true })).toHaveCount(0);
      await expect(probe.view.getByText('Ladataan diagnostiikkaa...', { exact: true })).toHaveCount(0);
    } catch (error) { failure = { error }; }
    finally {
      try { await probe.close(); }
      catch (error) { failure ??= { error }; }
    }
    if (failure) throw failure.error;
  });
}

test('OBS-DIAGNOSTIC-READ-UI-007 @critical @fault ignores old failures after client replacement and navigation remount', async ({ e2eWeb }) => {
  const probe = await mountDiagnosticsReadProbe(e2eWeb.page);
  let failure: { error: unknown } | undefined;
  try {
    await probe.startSession(false);
    expect(await probe.callCount()).toBe(4);
    await probe.release(0, true);
    await probe.release(1, true);
    await expect(probe.view.getByRole('alert')).toHaveCount(0);
    await expect(probe.view.getByText('Ladataan diagnostiikkaa...', { exact: true })).toBeVisible();
    await expect(probe.view.getByText('Ladataan järjestelmäyhteenvetoa...', { exact: true })).toBeVisible();
    await probe.startSession(true);
    expect(await probe.callCount()).toBe(6);
    await probe.release(4);
    await probe.release(5);
    await probe.release(2, true);
    await probe.release(3, true);
    await expect(probe.view.getByRole('table')).toBeVisible();
    await expect(probe.view.getByRole('heading', { name: 'Järjestelmäyhteenveto' })).toBeVisible();
    await expect(probe.view.getByRole('alert')).toHaveCount(0);
  } catch (error) { failure = { error }; }
  finally {
    try { await probe.close(); }
    catch (error) { failure ??= { error }; }
  }
  if (failure) throw failure.error;
});

async function openDiagnostics(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Oma yritys', exact: true }).click();
  await page.getByRole('button', { name: 'Diagnostiikka', exact: true }).click();
  await expect(page.getByRole('main').getByRole('heading', { name: 'Diagnostiikka', exact: true })).toBeVisible();
}
