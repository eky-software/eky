import type { APIResponse, Page, Route } from '@playwright/test';

import { createSyntheticInvoiceDraftInput } from '../../src/data/syntheticBusinessInputs.js';
import {
  expect,
  test,
  type IsolatedWebHarness,
} from '../../src/fixtures/isolatedWebTest.js';
import {
  openInvoiceDraftFromList,
  openInvoicingWorkspace,
  seedInvoiceJourneyPrerequisites,
} from '../../src/journeys/invoicingWebJourney.js';

interface InvoiceDraft {
  id: string;
  customerId: string;
  subject: string;
  note: string;
}

for (const scenario of [
  { id: 'INV-OPEN-001', failure: false, unmount: false },
  { id: 'INV-OPEN-002', failure: true, unmount: false },
  { id: 'INV-OPEN-003', failure: false, unmount: true },
]) {
  test(`${scenario.id} @critical keeps draft B and its save target after a late A response`, async ({ e2eWeb }) => {
    const { first, second } = await seedDrafts(e2eWeb);
    const { page } = e2eWeb;
    await openInvoicingWorkspace(page);

    await withHeldDraftRead(page, first.id, async (held) => {
      await page.getByRole('button', { name: first.subject, exact: true }).click();
      await held.received;
      await expect(page.getByText('Avataan laskuluonnosta...')).toBeVisible();
      if (scenario.unmount) {
        await page.getByRole('button', { name: 'Asiakkaat', exact: true }).click();
        await expect(page.getByRole('heading', { level: 2, name: 'Asiakaslista', exact: true })).toBeVisible();
      }
      await openInvoicingWorkspace(page);
      await openInvoiceDraftFromList(page, second.subject);
      await expect(page.getByLabel('Aihe')).toHaveValue(second.subject);

      await held.release(scenario.failure);
      await expect(page.getByRole('alert')).toHaveCount(0);
      await expect(page.getByLabel('Aihe')).toHaveValue(second.subject);
      await expect(page.getByLabel('Lisätieto')).toHaveValue(second.note);
      await saveSubject(page, second.id, 'Synthetic B edited');

      expect(await readDraft(e2eWeb, first.id)).toEqual(first);
      expect(await readDraft(e2eWeb, second.id)).toMatchObject({
        id: second.id, subject: 'Synthetic B edited', note: second.note,
      });
      await openInvoicingWorkspace(page);
      await openInvoiceDraftFromList(page, 'Synthetic B edited');
      await expect(page.getByLabel('Aihe')).toHaveValue('Synthetic B edited');
    });
  });
}

test('INV-OPEN-004 @critical keeps B loading and its own error after an older failure', async ({ e2eWeb }) => {
  const { first, second } = await seedDrafts(e2eWeb);
  const { page } = e2eWeb;
  await openInvoicingWorkspace(page);

  await withHeldDraftRead(page, first.id, async (older) => {
    await page.getByRole('button', { name: first.subject, exact: true }).click();
    await older.received;
    await openInvoicingWorkspace(page);
    await withHeldDraftRead(page, second.id, async (current) => {
      await page.getByRole('button', { name: second.subject, exact: true }).click();
      await current.received;
      await older.release(true);
      await expect(page.getByText('Avataan laskuluonnosta...')).toBeVisible();
      await expect(page.getByRole('alert')).toHaveCount(0);
      await current.release(true);
      await expect(page.getByRole('alert')).toHaveText('Laskuluonnosta ei voitu avata. Yritä hetken kuluttua uudelleen.');
      await expect(page.getByText('Avataan laskuluonnosta...')).toHaveCount(0);
    });
  });

  await page.getByRole('button', { name: 'Takaisin luonnoksiin' }).click();
  await openInvoiceDraftFromList(page, second.subject);
  await expect(page.getByLabel('Aihe')).toHaveValue(second.subject);
  expect(await readDraft(e2eWeb, first.id)).toEqual(first);
  expect(await readDraft(e2eWeb, second.id)).toEqual(second);
});

test('INV-OPEN-005 @critical ignores an older snapshot when the same draft is reopened', async ({ e2eWeb }) => {
  const { first } = await seedDrafts(e2eWeb);
  const { page } = e2eWeb;
  await openInvoicingWorkspace(page);

  await withHeldDraftRead(page, first.id, async (older) => {
    await page.getByRole('button', { name: first.subject, exact: true }).click();
    await older.received;
    const response = await e2eWeb.api.put(`/invoice-drafts/${first.id}`, {
      data: createSyntheticInvoiceDraftInput(first.customerId, {
        subject: 'Synthetic newer snapshot', note: 'Synthetic newer note',
      }),
    });
    expect(response.status()).toBe(200);
    await openInvoicingWorkspace(page);
    // The list may still show the original summary; the detail GET must be fresh.
    await openInvoiceDraftFromList(page, first.subject);
    await expect(page.getByLabel('Aihe')).toHaveValue('Synthetic newer snapshot');
    await older.release(false);
    await expect(page.getByLabel('Aihe')).toHaveValue('Synthetic newer snapshot');
    await expect(page.getByLabel('Lisätieto')).toHaveValue('Synthetic newer note');
    await saveSubject(page, first.id, 'Synthetic reopened draft edited');
    expect(await readDraft(e2eWeb, first.id)).toMatchObject({
      id: first.id, subject: 'Synthetic reopened draft edited', note: 'Synthetic newer note',
    });
  });
});

test('INV-OPEN-006 @critical keeps a new editing session after clearing a pending read', async ({ e2eWeb }) => {
  const { first } = await seedDrafts(e2eWeb);
  const { page } = e2eWeb;
  await openInvoicingWorkspace(page);
  let createdCount = 0;
  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/invoice-drafts') {
      createdCount += 1;
    }
  });

  await withHeldDraftRead(page, first.id, async (older) => {
    await page.getByRole('button', { name: first.subject, exact: true }).click();
    await older.received;
    await openInvoicingWorkspace(page);
    await page.getByRole('button', { name: 'Uusi lasku', exact: true }).click();
    await page.getByLabel('Aihe').fill('Synthetic new editing session');
    await older.release(false);
    await expect(page.getByLabel('Aihe')).toHaveValue('Synthetic new editing session');
    await page.getByRole('combobox', { name: 'Asiakas', exact: true }).selectOption(first.customerId);
    await page.getByLabel('Laskun päiväys').fill('2026-07-29');
    const createdResponse = page.waitForResponse((response) =>
      response.request().method() === 'POST' && new URL(response.url()).pathname === '/invoice-drafts');
    const row = page.getByRole('group', { name: 'Rivi 1', exact: true });
    await row.getByLabel('Nimike').fill('Synthetic new work');
    await row.getByLabel('Määrä').fill('1');
    await row.getByLabel('Yksikköhinta').fill('25');
    const response = await createdResponse;
    expect(response.status()).toBe(201);
    const body = await response.json() as { invoiceDraft: InvoiceDraft };
    expect(body.invoiceDraft.id).not.toBe(first.id);
    await expect(page.getByRole('heading', { level: 2, name: 'Muokkaa laskuluonnosta' })).toBeVisible();
    await saveSubject(page, body.invoiceDraft.id, 'Synthetic new session saved twice');
    expect(createdCount).toBe(1);
    expect(await readDraft(e2eWeb, first.id)).toEqual(first);
    expect(await readDraft(e2eWeb, body.invoiceDraft.id)).toMatchObject({
      id: body.invoiceDraft.id, subject: 'Synthetic new session saved twice',
    });
  });
});

async function seedDrafts(e2eWeb: IsolatedWebHarness): Promise<{ first: InvoiceDraft; second: InvoiceDraft }> {
  const customer = await seedInvoiceJourneyPrerequisites(e2eWeb);
  const drafts: InvoiceDraft[] = [];
  for (const name of ['A', 'B']) {
    const response = await e2eWeb.api.post('/invoice-drafts', {
      data: createSyntheticInvoiceDraftInput(customer.customerId, {
        subject: `Synthetic draft ${name}`, note: `Synthetic note ${name}`,
      }),
    });
    expect(response.status()).toBe(201);
    const body = await response.json() as { invoiceDraft: InvoiceDraft };
    drafts.push(body.invoiceDraft);
  }
  return { first: drafts[0]!, second: drafts[1]! };
}

async function readDraft(e2eWeb: IsolatedWebHarness, id: string): Promise<InvoiceDraft> {
  const response = await e2eWeb.api.get(`/invoice-drafts/${id}`);
  expect(response.status()).toBe(200);
  const body = await response.json() as { invoiceDraft: InvoiceDraft };
  return body.invoiceDraft;
}

async function saveSubject(page: Page, id: string, subject: string): Promise<void> {
  const saved = page.waitForResponse((response) =>
    response.request().method() === 'PUT' && new URL(response.url()).pathname === `/invoice-drafts/${id}`);
  await page.getByLabel('Aihe').fill(subject);
  await page.getByRole('button', { name: 'Tallenna', exact: true }).click();
  expect((await saved).status()).toBe(200);
  await expect(page.getByLabel('Aihe')).toHaveValue(subject);
}

interface HeldDraftRead {
  received: Promise<void>;
  release(failure: boolean): Promise<void>;
}

async function withHeldDraftRead(
  page: Page,
  id: string,
  run: (held: HeldDraftRead) => Promise<void>,
): Promise<void> {
  let capture!: (value: { route: Route; response: APIResponse }) => void;
  let rejectCapture!: (error: unknown) => void;
  const captured = new Promise<{ route: Route; response: APIResponse }>((resolve, reject) => {
    capture = resolve;
    rejectCapture = reject;
  });
  // Observe early transport failure even while the test is completing its click.
  const received = captured.then(() => undefined);
  void received.catch(() => undefined);
  const pattern = `**/invoice-drafts/${id}`;
  let pending: Route | undefined;
  let intercepted = false;
  let fulfillmentStarted = false;
  const handler = async (route: Route): Promise<void> => {
    if (intercepted || route.request().method() !== 'GET') {
      await route.fallback();
      return;
    }
    intercepted = true;
    pending = route;
    try {
      const response = await route.fetch();
      capture({ route, response });
    } catch (error) {
      rejectCapture(error);
    }
  };
  // Keep interception enabled while another captured request is still pending.
  await page.route(pattern, handler);
  const failures: unknown[] = [];
  try {
    await run({
      received,
      release: async (failure) => {
        const { route, response } = await captured;
        fulfillmentStarted = true;
        const [finished] = await Promise.all([
          page.waitForResponse((value) =>
            value.request().method() === 'GET' && new URL(value.url()).pathname === `/invoice-drafts/${id}`),
          route.fulfill(failure
            ? { status: 500, json: { error: 'Synthetic read failure' } }
            : { response }),
        ]);
        pending = undefined;
        await finished.finished();
      },
    });
  } catch (error) {
    failures.push(error);
  }
  // A failed fulfill may already have consumed the route. The fixture still
  // owns context closure; never obscure that failure with a second handling.
  if (pending !== undefined && !fulfillmentStarted) {
    try {
      await pending.abort();
    } catch (error) {
      failures.push(error);
    }
  }
  try {
    await page.unroute(pattern, handler);
  } catch (error) {
    failures.push(error);
  }
  if (failures.length === 1) {
    throw failures[0];
  }
  if (failures.length > 1) {
    throw new AggregateError(failures, 'Draft read scenario and route cleanup failed.');
  }
}
