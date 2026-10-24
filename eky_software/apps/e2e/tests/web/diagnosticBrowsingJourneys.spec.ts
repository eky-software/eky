import { appendFile, mkdir, truncate } from 'node:fs/promises';
import { join } from 'node:path';
import type { Page } from '@playwright/test';

import { expect, test } from '../../src/fixtures/isolatedWebTest.js';

async function seedHistory(logsRoot: string) {
  const directory = join(logsRoot, 'backend');
  await mkdir(directory, { recursive: true });
  const now = Date.now() + 60_000;
  const path = join(directory, `backend-warning-error-${new Date().toISOString().slice(0, 7)}-004.jsonl`);
  const event = (index: number) => ({ schemaVersion: 1, component: 'backend', category: 'database',
    eventId: `m43-event-${index}`, eventName: 'database.openFailed',
    timestamp: new Date(now + index * 1000).toISOString(), appVersion: '1.0.0', buildRevision: 'development',
    runtimeInstanceId: '11111111-1111-4111-8111-111111111111', level: 'error', outcome: 'failure',
    errorCode: `M43_EVENT_${index}` });
  await appendFile(path, Array.from({ length: 240 }, (_, index) => `${JSON.stringify(event(index))}\n`).join(''));
  return { path, append: () => appendFile(path, `${JSON.stringify(event(300))}\n`) };
}

async function openDiagnostics(page: Page) {
  await page.getByRole('button', { name: 'Oma yritys', exact: true }).click();
  await page.getByRole('button', { name: 'Diagnostiikka', exact: true }).click();
  await expect(page.getByText('M43_EVENT_239', { exact: true })).toBeVisible();
}

test('OBS-DIAGNOSTIC-BROWSE-UI-001 @critical browses real pages in both directions and refreshes explicitly', async ({ e2eWeb }) => {
  const history = await seedHistory(e2eWeb.paths.logsRoot);
  await openDiagnostics(e2eWeb.page);
  await expect(e2eWeb.page.getByText('M43_EVENT_139', { exact: true })).toHaveCount(0);
  let release!: () => void;
  let entered!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const observed = new Promise<void>(resolve => { entered = resolve; });
  let first = true;
  await e2eWeb.page.route('**/diagnostics/events?cursor=*', async route => {
    if (first) { first = false; entered(); await held; }
    await route.continue();
  });
  try {
    await e2eWeb.page.getByRole('button', { name: 'Vanhemmat', exact: true }).click();
    await observed;
    await expect(e2eWeb.page.getByText('M43_EVENT_239', { exact: true })).toBeVisible();
    await expect(e2eWeb.page.getByRole('button', { name: 'Vanhemmat', exact: true })).toBeDisabled();
  } finally { release(); }
  await expect(e2eWeb.page.getByText('M43_EVENT_139', { exact: true })).toBeVisible();
  await expect(e2eWeb.page.getByText('M43_EVENT_239', { exact: true })).toHaveCount(0);
  await history.append();
  await e2eWeb.page.getByRole('button', { name: 'Uudemmat', exact: true }).click();
  await expect(e2eWeb.page.getByText('M43_EVENT_239', { exact: true })).toBeVisible();
  await expect(e2eWeb.page.getByText('M43_EVENT_300', { exact: true })).toHaveCount(0);
  await e2eWeb.page.getByRole('button', { name: 'Uusimmat', exact: true }).click();
  await expect(e2eWeb.page.getByText('M43_EVENT_300', { exact: true })).toBeVisible();
});

test('OBS-DIAGNOSTIC-BROWSE-UI-002 @critical @fault retains visible rows through a failed page and manual retry', async ({ e2eWeb }) => {
  await seedHistory(e2eWeb.paths.logsRoot);
  await openDiagnostics(e2eWeb.page);
  let first = true;
  await e2eWeb.page.route('**/diagnostics/events?cursor=*', async route => {
    if (first) {
      first = false;
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'M43_PRIVATE_SOURCE_DETAIL' }) });
    } else await route.continue();
  });
  await e2eWeb.page.getByRole('button', { name: 'Vanhemmat', exact: true }).click();
  await expect(e2eWeb.page.getByRole('alert')).toBeVisible();
  await expect(e2eWeb.page.getByText('M43_EVENT_239', { exact: true })).toBeVisible();
  expect(await e2eWeb.page.content()).not.toContain('M43_PRIVATE_SOURCE_DETAIL');
  await e2eWeb.page.getByRole('button', { name: 'Yritä uudelleen', exact: true }).click();
  await expect(e2eWeb.page.getByText('M43_EVENT_139', { exact: true })).toBeVisible();
  await expect(e2eWeb.page.getByRole('alert')).toHaveCount(0);
});

test('OBS-DIAGNOSTIC-BROWSE-UI-003 @critical @fault requires a new browse after the captured source is truncated', async ({ e2eWeb }) => {
  const history = await seedHistory(e2eWeb.paths.logsRoot);
  await openDiagnostics(e2eWeb.page);
  await truncate(history.path, 0);
  await e2eWeb.page.getByRole('button', { name: 'Vanhemmat', exact: true }).click();
  await expect(e2eWeb.page.getByRole('alert')).toContainText('Selaus on vanhentunut.');
  await expect(e2eWeb.page.getByText('M43_EVENT_239', { exact: true })).toBeVisible();
  await expect(e2eWeb.page.getByRole('button', { name: 'Vanhemmat', exact: true })).toBeDisabled();
  let rejectNewest = true;
  await e2eWeb.page.route(/\/diagnostics\/events(?:\?.*)?$/, async route => {
    if (rejectNewest && !new URL(route.request().url()).searchParams.has('cursor')) {
      rejectNewest = false;
      await route.fulfill({ status: 503, contentType: 'application/json', body: '{}' });
    } else await route.continue();
  });
  await e2eWeb.page.getByRole('button', { name: 'Uusimmat', exact: true }).click();
  await expect(e2eWeb.page.getByRole('alert')).toContainText('API-pyyntö epäonnistui.');
  await expect(e2eWeb.page.getByText('M43_EVENT_239', { exact: true })).toBeVisible();
  await expect(e2eWeb.page.getByRole('button', { name: 'Vanhemmat', exact: true })).toBeDisabled();
  await expect(e2eWeb.page.getByRole('button', { name: 'Uudemmat', exact: true })).toBeDisabled();
  await e2eWeb.page.getByRole('button', { name: 'Uusimmat', exact: true }).click();
  await expect(e2eWeb.page.getByRole('alert')).toHaveCount(0);
  await expect(e2eWeb.page.getByText('M43_EVENT_239', { exact: true })).toHaveCount(0);
});
