import { randomUUID } from 'node:crypto';

import type { APIResponse, Locator, Page, Route } from '@playwright/test';

import {
  createSyntheticCompanySettingsInput,
  createSyntheticInvoiceDraftInput,
} from '../../src/data/syntheticBusinessInputs.js';
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

const readinessErrorMessage =
  'Laskun hyväksyntävalmiutta ei voitu tarkistaa. Yritä hetken kuluttua uudelleen.';
const syntheticReadinessError = 'Synthetic readiness delivery failure';
const readinessDeliveryHeader = 'x-eky-e2e-readiness-delivery';
const savedMessagePattern =
  /^(Tallennettu|Laskuluonnos tallennettu\.|Laskuluonnoksen muutokset tallennettu\.)$/;

interface InvoiceDraft {
  id: string;
  customerId: string;
  subject: string;
  note: string;
}

interface Readiness {
  isReady: boolean;
  issues: string[];
}

test('INV-READY-001 @critical rejects delayed ready after edit and resave until a fresh check approves the saved revision', async ({ e2eWeb }) => {
  const { page } = e2eWeb;
  const draft = await seedAndOpenDraft(e2eWeb);
  const requests = observeApprovalRequests(page);

  await withHeldReadiness(page, draft.id, async (older) => {
    await requestReadiness(page);
    expect(await older.received).toEqual({ isReady: true, issues: [] });
    await expectChecking(page);
    await page.getByLabel('Aihe').fill('Synthetic revised readiness draft');
    await expectUnsaved(page);
    await saveCurrentRevision(page, draft.id);
    const saved = await readDraft(e2eWeb, draft.id);
    expect(saved.subject).toBe('Synthetic revised readiness draft');

    await older.release('upstream');
    await expectNoReadiness(page);
    await expect(page.getByLabel('Aihe')).toHaveValue(saved.subject);
    expect(await readDraft(e2eWeb, draft.id)).toEqual(saved);
    await expectNoInvoices(e2eWeb);
    expect(requests).toEqual([readinessPath(draft.id)]);

    await checkCurrentReadiness(page, draft.id, true);
    await confirmAndVerifyInvoice(e2eWeb, saved);
    expect(requests).toEqual([
      readinessPath(draft.id), readinessPath(draft.id), approvalPath(draft.id),
    ]);
  });
});

for (const scenario of [
  { id: 'INV-READY-002', delivery: 'failure', missingIban: false },
  { id: 'INV-READY-003', delivery: 'upstream', missingIban: true },
] as const) {
  test(`${scenario.id} @critical @fault ignores stale ${scenario.missingIban ? 'not-ready' : 'error'} both during a newer check and after its accepted result`, async ({ e2eWeb }) => {
    const { page } = e2eWeb;
    const draft = await seedAndOpenDraft(e2eWeb, scenario.missingIban);
    const requests = observeApprovalRequests(page);
    const expectedOlder = scenario.missingIban
      ? { isReady: false, issues: ['companyIbanMissing'] }
      : { isReady: true, issues: [] };

    await withHeldReadiness(page, draft.id, async (first) => {
      await requestReadiness(page);
      expect(await first.received).toEqual(expectedOlder);
      await page.getByLabel('Lisätieto').fill('Synthetic second readiness revision');
      await saveCurrentRevision(page, draft.id);

      await withHeldReadiness(page, draft.id, async (second) => {
        await requestReadiness(page);
        expect(await second.received).toEqual(expectedOlder);
        await page.getByLabel('Lisätieto').fill('Synthetic current readiness revision');
        await saveCurrentRevision(page, draft.id);
        if (scenario.missingIban) {
          await setCompanyIban(e2eWeb, false);
        }

        await withHeldReadiness(page, draft.id, async (current) => {
          await requestReadiness(page);
          expect(await current.received).toEqual({ isReady: true, issues: [] });
          await expectChecking(page);
          await first.release(scenario.delivery);
          await expectChecking(page);
          await current.release('upstream');
          await expectConfirmation(page);
          await second.release(scenario.delivery);
          await expectConfirmation(page);
          await expect(page.getByLabel('Lisätieto')).toHaveValue('Synthetic current readiness revision');
          await expectNoInvoices(e2eWeb);
          const saved = await readDraft(e2eWeb, draft.id);
          expect(saved.note).toBe('Synthetic current readiness revision');
          await confirmAndVerifyInvoice(e2eWeb, saved);
          expect(requests).toEqual([
            readinessPath(draft.id), readinessPath(draft.id),
            readinessPath(draft.id), approvalPath(draft.id),
          ]);
        });
      });
    });
  });
}

test('INV-READY-004 @critical discards readiness from an unmounted session when the same draft is reopened', async ({ e2eWeb }) => {
  const { page } = e2eWeb;
  const draft = await seedAndOpenDraft(e2eWeb);
  const requests = observeApprovalRequests(page);

  await withHeldReadiness(page, draft.id, async (older) => {
    await requestReadiness(page);
    expect(await older.received).toEqual({ isReady: true, issues: [] });
    await page.getByRole('button', { name: 'Asiakkaat', exact: true }).click();
    await expect(page.getByRole('heading', { level: 2, name: 'Asiakaslista', exact: true })).toBeVisible();
    await openInvoicingWorkspace(page);
    await openInvoiceDraftFromList(page, draft.subject);
    await expectNoReadiness(page);

    // The same ID and unchanged form are a new editor session, not the old request owner.
    await withHeldReadiness(page, draft.id, async (current) => {
      await requestReadiness(page);
      expect(await current.received).toEqual({ isReady: true, issues: [] });
      await older.release('upstream');
      await expectChecking(page);
      await expect(page.getByLabel('Aihe')).toHaveValue(draft.subject);
      expect(await readDraft(e2eWeb, draft.id)).toEqual(draft);
      await expectNoInvoices(e2eWeb);
      await current.release('upstream');
      await expectConfirmation(page);
      await confirmAndVerifyInvoice(e2eWeb, draft);
      expect(requests).toEqual([
        readinessPath(draft.id), readinessPath(draft.id), approvalPath(draft.id),
      ]);
    });
  });
});

test('INV-READY-005 @critical discards draft A readiness after returning to the list and opening draft B', async ({ e2eWeb }) => {
  const { page } = e2eWeb;
  const first = await seedAndOpenDraft(e2eWeb);
  const second = await createDraft(e2eWeb, first.customerId, 'Synthetic other readiness draft');
  const requests = observeApprovalRequests(page);

  await withHeldReadiness(page, first.id, async (older) => {
    await requestReadiness(page);
    expect(await older.received).toEqual({ isReady: true, issues: [] });
    await page.getByRole('button', { name: 'Takaisin luonnoksiin', exact: true }).first().click();
    await openInvoiceDraftFromList(page, second.subject);
    await older.release('upstream');
    await expectNoReadiness(page);
    await expect(page.getByLabel('Aihe')).toHaveValue(second.subject);
    expect(await readDraft(e2eWeb, first.id)).toEqual(first);
    expect(await readDraft(e2eWeb, second.id)).toEqual(second);
    await expectNoInvoices(e2eWeb);

    await checkCurrentReadiness(page, second.id, true);
    await confirmAndVerifyInvoice(e2eWeb, second);
    expect(await readDraft(e2eWeb, first.id)).toEqual(first);
    expect(requests).toEqual([
      readinessPath(first.id), readinessPath(second.id), approvalPath(second.id),
    ]);
  });
});

test('INV-READY-006 @critical clears accepted confirmation on edit and cancel and blocks unsaved approval', async ({ e2eWeb }) => {
  const { page } = e2eWeb;
  const draft = await seedAndOpenDraft(e2eWeb);
  const requests = observeApprovalRequests(page);
  await checkCurrentReadiness(page, draft.id, true);
  await page.getByLabel('Lisätieto').fill('Synthetic unsaved readiness note');
  await expectUnsaved(page);
  // The disabled control must not request readiness or approval. Keep autosave
  // paused; this does not claim to invoke React's disabled-button handler.
  await page.getByRole('button', { name: 'Hyväksy laskuksi', exact: true }).dispatchEvent('click');
  await page.clock.runFor(0);
  await expectUnsaved(page);
  expect(await readDraft(e2eWeb, draft.id)).toEqual(draft);
  await expectNoInvoices(e2eWeb);
  expect(requests).toEqual([readinessPath(draft.id)]);

  await saveCurrentRevision(page, draft.id);
  await expectNoReadiness(page);
  await checkCurrentReadiness(page, draft.id, true);
  await confirmation(page).getByRole('button', { name: 'Peruuta', exact: true }).click();
  await expectNoReadiness(page);
  await expectNoInvoices(e2eWeb);
  expect(requests).toEqual([readinessPath(draft.id), readinessPath(draft.id)]);

  await withHeldReadiness(page, draft.id, async (fresh) => {
    await requestReadiness(page);
    expect(await fresh.received).toEqual({ isReady: true, issues: [] });
    await expectChecking(page);
    await fresh.release('upstream');
    await expectConfirmation(page);
    const saved = await readDraft(e2eWeb, draft.id);
    expect(saved.note).toBe('Synthetic unsaved readiness note');
    await confirmAndVerifyInvoice(e2eWeb, saved);
    expect(requests).toEqual([
      readinessPath(draft.id), readinessPath(draft.id),
      readinessPath(draft.id), approvalPath(draft.id),
    ]);
  });
});

test('INV-READY-007 @critical @fault shows current not-ready and safe error then recovers through normal approval', async ({ e2eWeb }) => {
  const { page } = e2eWeb;
  const draft = await seedAndOpenDraft(e2eWeb, true);
  const requests = observeApprovalRequests(page);
  await checkCurrentReadiness(page, draft.id, false);
  await expect(page.getByRole('alert')).toContainText('Laskun tiedot ovat puutteelliset');
  await expect(page.getByRole('alert')).toContainText('Täydennä oman yrityksen IBAN-tilinumero.');
  await expect(confirmation(page)).toHaveCount(0);
  expect(await readDraft(e2eWeb, draft.id)).toEqual(draft);
  await expectNoInvoices(e2eWeb);

  await setCompanyIban(e2eWeb, false);
  await withHeldReadiness(page, draft.id, async (current) => {
    await requestReadiness(page);
    expect(await current.received).toEqual({ isReady: true, issues: [] });
    await expectChecking(page);
    await current.release('failure');
    await expect(page.getByRole('alert')).toHaveText(readinessErrorMessage);
    await expect(page.getByText(syntheticReadinessError, { exact: true })).toHaveCount(0);
    await expect(confirmation(page)).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Tarkistetaan tietoja...', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Hyväksy laskuksi', exact: true })).toBeEnabled();
    expect(await readDraft(e2eWeb, draft.id)).toEqual(draft);
    await expectNoInvoices(e2eWeb);

    await checkCurrentReadiness(page, draft.id, true);
    await confirmAndVerifyInvoice(e2eWeb, draft);
    expect(requests).toEqual([
      readinessPath(draft.id), readinessPath(draft.id),
      readinessPath(draft.id), approvalPath(draft.id),
    ]);
  });
});

test('INV-READY-008 @critical keeps backend approval authoritative when master data changes after readiness', async ({ e2eWeb }) => {
  const { page } = e2eWeb;
  const draft = await seedAndOpenDraft(e2eWeb);
  const requests = observeApprovalRequests(page);
  await checkCurrentReadiness(page, draft.id, true);
  await setCompanyIban(e2eWeb, true);

  const [rejected] = await Promise.all([
    page.waitForResponse((response) => response.request().method() === 'POST' &&
      new URL(response.url()).pathname === approvalPath(draft.id)),
    confirmation(page).getByRole('button', { name: 'Hyväksy laskuksi', exact: true }).click(),
  ]);
  expect(rejected.status()).toBe(400);
  expect(await rejected.json()).toEqual({ error: 'Invoice information is incomplete.' });
  await expect(page.getByRole('alert')).toHaveText(
    'Laskua ei voitu hyväksyä. Tarkista laskun tiedot ja yritä uudelleen.',
  );
  await expect(page.getByText('Invoice information is incomplete.', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Lasku hyväksyttiin.', exact: true })).toHaveCount(0);
  expect(await readDraft(e2eWeb, draft.id)).toEqual(draft);
  await expectNoInvoices(e2eWeb);

  await confirmation(page).getByRole('button', { name: 'Peruuta', exact: true }).click();
  await expect(confirmation(page)).toHaveCount(0);
  await setCompanyIban(e2eWeb, false);
  await checkCurrentReadiness(page, draft.id, true);
  await confirmAndVerifyInvoice(e2eWeb, draft);
  expect(requests).toEqual([
    readinessPath(draft.id), approvalPath(draft.id),
    readinessPath(draft.id), approvalPath(draft.id),
  ]);
});

async function seedAndOpenDraft(e2eWeb: IsolatedWebHarness, missingIban = false): Promise<InvoiceDraft> {
  const customer = await seedInvoiceJourneyPrerequisites(e2eWeb, {
    settingsInput: missingIban ? { iban: '' } : {},
  });
  const draft = await createDraft(e2eWeb, customer.customerId, 'Synthetic readiness draft');
  await e2eWeb.page.clock.install({ time: new Date('2026-07-29T08:00:00Z') });
  await e2eWeb.page.clock.pauseAt(new Date('2026-07-29T09:00:00Z'));
  await openInvoicingWorkspace(e2eWeb.page);
  await openInvoiceDraftFromList(e2eWeb.page, draft.subject);
  await expectNoReadiness(e2eWeb.page);
  return draft;
}

async function createDraft(e2eWeb: IsolatedWebHarness, customerId: string, subject: string): Promise<InvoiceDraft> {
  const response = await e2eWeb.api.post('/invoice-drafts', {
    data: createSyntheticInvoiceDraftInput(customerId, { subject }),
  });
  expect(response.status()).toBe(201);
  const body = await response.json() as { invoiceDraft: InvoiceDraft };
  return body.invoiceDraft;
}

async function setCompanyIban(e2eWeb: IsolatedWebHarness, missing: boolean): Promise<void> {
  const response = await e2eWeb.api.put('/company-settings', {
    data: createSyntheticCompanySettingsInput(missing ? { iban: '' } : {}),
  });
  expect(response.status()).toBe(200);
}

async function readDraft(e2eWeb: IsolatedWebHarness, id: string): Promise<InvoiceDraft> {
  const response = await e2eWeb.api.get(`/invoice-drafts/${id}`);
  expect(response.status()).toBe(200);
  const body = await response.json() as { invoiceDraft: InvoiceDraft };
  return body.invoiceDraft;
}

async function expectNoInvoices(e2eWeb: IsolatedWebHarness): Promise<void> {
  const response = await e2eWeb.api.get('/invoices');
  expect(response.status()).toBe(200);
  expect(await response.json()).toMatchObject({ invoicePage: { invoices: [] } });
}

async function saveCurrentRevision(page: Page, id: string): Promise<void> {
  const [saved] = await Promise.all([
    page.waitForResponse((response) => response.request().method() === 'PUT' &&
      new URL(response.url()).pathname === `/invoice-drafts/${id}`),
    page.getByRole('button', { name: 'Tallenna', exact: true }).click(),
  ]);
  expect(saved.status()).toBe(200);
  await expect(page.getByRole('status').filter({ hasText: savedMessagePattern })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Tallenna', exact: true })).toBeDisabled();
}

function confirmation(page: Page): Locator {
  return page.getByRole('region', { name: 'Hyväksynnän vahvistus', exact: true });
}

async function requestReadiness(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Hyväksy laskuksi', exact: true }).click();
}

async function checkCurrentReadiness(page: Page, id: string, isReady: boolean): Promise<void> {
  const [response] = await Promise.all([
    page.waitForResponse((value) => value.request().method() === 'GET' &&
      new URL(value.url()).pathname === readinessPath(id)),
    requestReadiness(page),
  ]);
  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual({
    invoiceIssuanceReadiness: {
      isReady, issues: isReady ? [] : ['companyIbanMissing'],
    },
  });
  if (isReady) {
    await expectConfirmation(page);
  } else {
    await expect(page.getByRole('alert')).toContainText('Täydennä oman yrityksen IBAN-tilinumero.');
  }
}

async function expectChecking(page: Page): Promise<void> {
  await expect(page.getByRole('button', { name: 'Tarkistetaan tietoja...', exact: true })).toBeDisabled();
  await expect(confirmation(page)).toHaveCount(0);
  await expect(page.getByRole('alert')).toHaveCount(0);
}

async function expectNoReadiness(page: Page): Promise<void> {
  await expect(confirmation(page)).toHaveCount(0);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Tarkistetaan tietoja...', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Hyväksy laskuksi', exact: true })).toBeEnabled();
}

async function expectUnsaved(page: Page): Promise<void> {
  await expect(confirmation(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Hyväksy laskuksi', exact: true })).toBeDisabled();
  await expect(page.getByRole('status').filter({ hasText: savedMessagePattern })).toHaveCount(0);
}

async function expectConfirmation(page: Page): Promise<void> {
  await expect(confirmation(page)).toBeVisible();
  await expect(confirmation(page).getByRole('button', { name: 'Hyväksy laskuksi', exact: true })).toBeEnabled();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Tarkistetaan tietoja...', exact: true })).toHaveCount(0);
}

async function confirmAndVerifyInvoice(e2eWeb: IsolatedWebHarness, draft: InvoiceDraft): Promise<void> {
  const { page } = e2eWeb;
  const [approved] = await Promise.all([
    page.waitForResponse((response) => response.request().method() === 'POST' &&
      new URL(response.url()).pathname === approvalPath(draft.id)),
    confirmation(page).getByRole('button', { name: 'Hyväksy laskuksi', exact: true }).click(),
  ]);
  expect(approved.status()).toBe(200);
  const body = await approved.json() as {
    approvedInvoice: { invoiceId: string; invoiceNumber: string };
  };
  await expect(page.getByRole('heading', { name: 'Lasku hyväksyttiin.', exact: true })).toBeVisible();
  const invoice = await e2eWeb.api.get(`/invoices/${body.approvedInvoice.invoiceId}`);
  expect(invoice.status()).toBe(200);
  expect(await invoice.json()).toMatchObject({
    invoice: {
      id: body.approvedInvoice.invoiceId,
      sourceDraftId: draft.id,
      invoiceNumber: body.approvedInvoice.invoiceNumber,
      sequenceNumber: 1,
      status: 'approved',
      subject: draft.subject,
      note: draft.note,
    },
  });
  const listed = await e2eWeb.api.get('/invoices');
  expect(listed.status()).toBe(200);
  expect(await listed.json()).toMatchObject({
    invoicePage: { invoices: [{ id: body.approvedInvoice.invoiceId, status: 'approved' }] },
  });
}

function readinessPath(id: string): string {
  return `/invoice-drafts/${id}/issuance-readiness`;
}

function approvalPath(id: string): string {
  return `/invoice-drafts/${id}/approve`;
}

function observeApprovalRequests(page: Page): string[] {
  const requests: string[] = [];
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if ((request.method() === 'GET' && /^\/invoice-drafts\/[^/]+\/issuance-readiness$/.test(path)) ||
        (request.method() === 'POST' && /^\/invoice-drafts\/[^/]+\/approve$/.test(path))) {
      requests.push(path);
    }
  });
  return requests;
}

interface HeldReadiness {
  received: Promise<Readiness>;
  release(delivery: 'upstream' | 'failure'): Promise<void>;
}

async function withHeldReadiness(
  page: Page,
  id: string,
  run: (held: HeldReadiness) => Promise<void>,
): Promise<void> {
  let capture!: (value: { route: Route; response: APIResponse }) => void;
  let rejectCapture!: (error: unknown) => void;
  const captured = new Promise<{ route: Route; response: APIResponse }>((resolve, reject) => {
    capture = resolve;
    rejectCapture = reject;
  });
  const received = captured.then(async ({ response }) => {
    const body = await response.json() as { invoiceIssuanceReadiness: Readiness };
    return body.invoiceIssuanceReadiness;
  });
  void received.catch(() => undefined);
  const readinessUrl = new URL(readinessPath(id), page.url()).href;
  const pattern = (url: URL): boolean => url.href === readinessUrl;
  let intercepted = false;
  let pending: Route | undefined;
  let upstreamResponse: APIResponse | undefined;
  let fetchFinished: Promise<void> | undefined;
  let captureFailure: unknown;
  let handlingStarted = false;
  const handler = (route: Route): Promise<void> => {
    if (intercepted || route.request().method() !== 'GET') {
      return route.fallback();
    }
    intercepted = true;
    pending = route;
    fetchFinished = (async () => {
      try {
        // Read once from the real backend; only browser delivery is controlled.
        upstreamResponse = await route.fetch({ maxRedirects: 0 });
        expect(upstreamResponse.status()).toBe(200);
        capture({ route, response: upstreamResponse });
      } catch (error) {
        captureFailure = error;
        rejectCapture(error);
      }
    })();
    return fetchFinished;
  };
  await page.route(pattern, handler);
  const failures: unknown[] = [];
  try {
    await run({
      received,
      release: async (delivery) => {
        const { route, response } = await captured;
        if (handlingStarted) {
          throw new Error('Readiness response delivery has already started.');
        }
        const token = randomUUID();
        const observer = await armReadinessConsumption(page, readinessUrl, token);
        const deliveryFailures: unknown[] = [];
        try {
          handlingStarted = true;
          const [delivered] = await Promise.all([
            page.waitForResponse((value) => value.request() === route.request()),
            route.fulfill(delivery === 'failure'
              ? {
                status: 500,
                headers: { [readinessDeliveryHeader]: token },
                json: { error: syntheticReadinessError },
              }
              : { response, headers: { ...response.headers(), [readinessDeliveryHeader]: token } }),
          ]);
          expect(await delivered.finished()).toBeNull();
          pending = undefined;
          await observer.evaluate((value) => value.consumed);
        } catch (error) {
          deliveryFailures.push(error);
        }
        try {
          await observer.evaluate((value) => value.restore());
        } catch (error) {
          deliveryFailures.push(error);
        }
        try {
          await observer.dispose();
        } catch (error) {
          deliveryFailures.push(error);
        }
        if (deliveryFailures.length === 1) {
          throw deliveryFailures[0];
        }
        if (deliveryFailures.length > 1) {
          throw new AggregateError(deliveryFailures, 'Readiness delivery and observer cleanup failed.');
        }
      },
    });
  } catch (error) {
    failures.push(error);
  }
  try {
    await page.unroute(pattern, handler);
  } catch (error) {
    failures.push(error);
  }
  // A failed fulfillment may have consumed the route. Context closure remains
  // fixture-owned; cleanup must not replace the first scenario failure.
  if (pending !== undefined && !handlingStarted) {
    try {
      await pending.abort();
    } catch (error) {
      failures.push(error);
    }
  }
  await fetchFinished;
  if (captureFailure !== undefined && !failures.includes(captureFailure)) {
    failures.push(captureFailure);
  }
  try {
    await upstreamResponse?.dispose();
  } catch (error) {
    failures.push(error);
  }
  if (failures.length === 1) {
    throw failures[0];
  }
  if (failures.length > 1) {
    throw new AggregateError(failures, 'Readiness scenario and route cleanup failed.');
  }
}

async function armReadinessConsumption(page: Page, url: string, token: string) {
  return page.evaluateHandle(({ url, token, header }) => {
    const descriptor = Object.getOwnPropertyDescriptor(Response.prototype, 'json');
    if (descriptor === undefined || typeof descriptor.value !== 'function') {
      throw new Error('Readiness JSON observer requires the response JSON method.');
    }
    const originalJson = Response.prototype.json;
    const channel = new MessageChannel();
    let active = true;
    let consumed!: () => void;
    const consumption = new Promise<void>((resolve) => { consumed = resolve; });
    // This task follows the current client's promise-only chain through hook
    // ownership processing. It is not a general React commit barrier.
    channel.port1.onmessage = () => consumed();
    const settled = (): void => {
      if (active) {
        channel.port2.postMessage(null);
      }
    };
    const observedJson = function (this: Response, ...args: Parameters<Response['json']>) {
      const result = originalJson.apply(this, args);
      if (this.url === url && this.headers.get(header) === token) {
        void result.then(settled, settled);
      }
      return result;
    };
    try {
      Object.defineProperty(Response.prototype, 'json', { ...descriptor, value: observedJson });
    } catch (error) {
      channel.port1.close();
      channel.port2.close();
      throw error;
    }
    return {
      consumed: consumption,
      restore: () => {
        active = false;
        channel.port1.onmessage = null;
        channel.port1.close();
        channel.port2.close();
        Object.defineProperty(Response.prototype, 'json', descriptor);
      },
    };
  }, { url, token, header: readinessDeliveryHeader });
}
