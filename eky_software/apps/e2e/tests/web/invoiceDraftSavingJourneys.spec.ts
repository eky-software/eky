import type { APIResponse, Page, Route } from '@playwright/test';

import {
  expect,
  test,
  type IsolatedWebHarness,
} from '../../src/fixtures/isolatedWebTest.js';
import {
  createInvoiceDraftThroughUi,
  openInvoiceDraftFromList,
  openInvoicingWorkspace,
  seedInvoiceJourneyPrerequisites,
} from '../../src/journeys/invoicingWebJourney.js';

// Advance the existing debounce with the browser clock, never wall-clock sleeps.
const autosaveDelayMs = 1_800;
const outcomeUnknownMessage =
  'Luonnos on saattanut tallentua. Tarkista luonnoslista ennen uuden luonnoksen luomista. Automaattinen ja käsin tehtävä tallennus on keskeytetty tässä lomakkeessa.';
const savedMessagePattern =
  /^(Tallennettu|Laskuluonnos tallennettu\.|Laskuluonnoksen muutokset tallennettu\.)$/;

interface InvoiceDraft {
  id: string;
  customerId: string;
  subject: string;
  note: string;
}

type SaveSource = 'manual' | 'auto';
type ResponseDelivery = 'success' | 'lost';

for (const scenario of [
  { id: 'INV-SAVE-001', first: 'manual', next: 'auto' },
  { id: 'INV-SAVE-002', first: 'auto', next: 'manual' },
] as const) {
  test(`${scenario.id} @critical retains the create ID and newer edits with ${scenario.first}-first single flight`, async ({ e2eWeb }) => {
    const { page } = e2eWeb;
    const customer = await seedInvoiceJourneyPrerequisites(e2eWeb);
    const writes = observeDraftWrites(page);
    await pauseAutosaveClock(page);
    await openNewDraft(page, customer.customerId, 'Synthetic initial revision');

    await withHeldDraftWrite(page, 'POST', '/invoice-drafts', async (create) => {
      await startSave(page, scenario.first);
      const original = await create.committed;
      expect(await readDraft(e2eWeb, original.id)).toEqual(original);
      await expectSaving(page);
      await submitCurrentFormTwice(page);
      await page.getByLabel('Aihe').fill('Synthetic newer revision');
      await page.getByLabel('Lisätieto').fill('Synthetic newer note');
      await page.clock.runFor(autosaveDelayMs);
      expect(writes).toEqual([{ method: 'POST', path: '/invoice-drafts' }]);
      expect(await readDraft(e2eWeb, original.id)).toEqual(original);

      await withHeldDraftWrite(page, 'PUT', `/invoice-drafts/${original.id}`, async (update) => {
        await create.release('success');
        await expect(page.getByRole('heading', { level: 2, name: 'Muokkaa laskuluonnosta' })).toBeVisible();
        await expect(page.getByLabel('Aihe')).toHaveValue('Synthetic newer revision');
        await expect(page.getByLabel('Lisätieto')).toHaveValue('Synthetic newer note');
        await expectNotSaved(page);
        await expectApprovalBlocked(page);

        await startSave(page, scenario.next);
        const updated = await update.committed;
        expect(updated).toMatchObject({
          id: original.id, subject: 'Synthetic newer revision', note: 'Synthetic newer note',
        });
        await expectSaving(page);
        await expectNotSaved(page);
        await submitCurrentFormTwice(page);
        await page.clock.runFor(autosaveDelayMs);
        expect(writes).toEqual([
          { method: 'POST', path: '/invoice-drafts' },
          { method: 'PUT', path: `/invoice-drafts/${original.id}` },
        ]);
        await update.release('success');
        await expectSaved(page);
      });

      await page.clock.runFor(autosaveDelayMs);
      expect(writes).toHaveLength(2);
      expect(await readDraft(e2eWeb, original.id)).toMatchObject({
        id: original.id, subject: 'Synthetic newer revision', note: 'Synthetic newer note',
      });
      expect(await listDrafts(e2eWeb)).toMatchObject([{ id: original.id }]);
      await openInvoicingWorkspace(page);
      await openInvoiceDraftFromList(page, 'Synthetic newer revision');
      await expect(page.getByLabel('Lisätieto')).toHaveValue('Synthetic newer note');
    });
  });
}

test('INV-SAVE-003 @critical does not reopen the editor after a committed create returns to the list', async ({ e2eWeb }) => {
  const { page } = e2eWeb;
  const customer = await seedInvoiceJourneyPrerequisites(e2eWeb);
  const writes = observeDraftWrites(page);
  await pauseAutosaveClock(page);
  await openNewDraft(page, customer.customerId, 'Synthetic departed draft');

  await withHeldDraftWrite(page, 'POST', '/invoice-drafts', async (older) => {
    await startSave(page, 'manual');
    const original = await older.committed;
    await page.getByRole('button', { name: 'Takaisin luonnoksiin', exact: true }).first().click();
    await expect(page.getByRole('heading', { level: 2, name: 'Laskuluonnoslista' })).toBeVisible();
    await older.release('success');
    await page.clock.runFor(autosaveDelayMs);
    expect(await readDraft(e2eWeb, original.id)).toEqual(original);
    await expect(page.getByRole('heading', { level: 2, name: 'Laskuluonnoslista' })).toBeVisible();
    await expect(page.getByLabel('Aihe')).toHaveCount(0);
    await expect(page.getByRole('alert')).toHaveCount(0);
    expect(writes).toEqual([{ method: 'POST', path: '/invoice-drafts' }]);
    expect(await listDrafts(e2eWeb)).toMatchObject([{ id: original.id }]);
  });
});

for (const scenario of [
  { id: 'INV-SAVE-004', delivery: 'success', unmount: false },
  { id: 'INV-SAVE-005', delivery: 'lost', unmount: true },
] as const) {
  test(`${scenario.id} @critical keeps the new session busy after an older create ${scenario.delivery} outcome`, async ({ e2eWeb }) => {
    const { page } = e2eWeb;
    const customer = await seedInvoiceJourneyPrerequisites(e2eWeb);
    const writes = observeDraftWrites(page);
    await pauseAutosaveClock(page);
    await openNewDraft(page, customer.customerId, 'Synthetic old session');

    await withHeldDraftWrite(page, 'POST', '/invoice-drafts', async (older) => {
      await startSave(page, 'auto');
      const original = await older.committed;
      if (scenario.unmount) {
        await page.getByRole('button', { name: 'Asiakkaat', exact: true }).click();
        await expect(page.getByRole('heading', { level: 2, name: 'Asiakaslista', exact: true })).toBeVisible();
      }
      await openNewDraft(page, customer.customerId, 'Synthetic current session');
      await withHeldDraftWrite(page, 'POST', '/invoice-drafts', async (current) => {
        await startSave(page, 'manual');
        const currentDraft = await current.committed;
        expect(currentDraft.id).not.toBe(original.id);
        await older.release(scenario.delivery);
        await page.clock.runFor(autosaveDelayMs);
        await expect(page.getByRole('heading', { level: 2, name: 'Uusi lasku', exact: true })).toBeVisible();
        await expect(page.getByLabel('Aihe')).toHaveValue('Synthetic current session');
        await expect(page.getByRole('alert')).toHaveCount(0);
        await expectSaving(page);
        await expectNotSaved(page);
        await submitCurrentFormTwice(page);
        expect(writes).toHaveLength(2);
        await current.release('success');
        await expectSaved(page);

        await page.getByLabel('Aihe').fill('Synthetic current session edited');
        await withHeldDraftWrite(page, 'PUT', `/invoice-drafts/${currentDraft.id}`, async (update) => {
          await startSave(page, 'auto');
          expect(await update.committed).toMatchObject({
            id: currentDraft.id, subject: 'Synthetic current session edited',
          });
          await update.release('success');
          await expectSaved(page);
        });
        expect(await readDraft(e2eWeb, original.id)).toEqual(original);
        expect(await readDraft(e2eWeb, currentDraft.id)).toMatchObject({
          id: currentDraft.id, subject: 'Synthetic current session edited',
        });
        expect((await listDrafts(e2eWeb)).map((draft) => draft.id).sort()).toEqual(
          [original.id, currentDraft.id].sort(),
        );
        expect(writes).toEqual([
          { method: 'POST', path: '/invoice-drafts' },
          { method: 'POST', path: '/invoice-drafts' },
          { method: 'PUT', path: `/invoice-drafts/${currentDraft.id}` },
        ]);
      });
    });
  });
}

test('INV-SAVE-006 @critical @fault blocks both create paths after a committed autosave response is lost', async ({ e2eWeb }) => {
  const { page } = e2eWeb;
  const customer = await seedInvoiceJourneyPrerequisites(e2eWeb);
  const writes = observeDraftWrites(page);
  await pauseAutosaveClock(page);
  await openNewDraft(page, customer.customerId, 'Synthetic committed uncertain draft');

  await withHeldDraftWrite(page, 'POST', '/invoice-drafts', async (create) => {
    await startSave(page, 'auto');
    const original = await create.committed;
    expect(await readDraft(e2eWeb, original.id)).toEqual(original);
    expect(await listDrafts(e2eWeb)).toMatchObject([{ id: original.id }]);
    await create.release('lost');
    await expect(page.getByRole('alert')).toHaveText(outcomeUnknownMessage);
    await expectNotSaved(page);
    await expect(page.getByRole('button', { name: 'Tallenna', exact: true })).toBeDisabled();
    await expect(page.getByLabel('Aihe')).toBeEditable();
    await expect(page.getByLabel('Lisätieto')).toBeEditable();

    await page.getByLabel('Aihe').fill('Synthetic still editable after response loss');
    await page.getByLabel('Lisätieto').fill('Synthetic unsaved local note');
    await page.clock.runFor(autosaveDelayMs);
    await submitCurrentFormTwice(page);
    await page.clock.runFor(autosaveDelayMs);
    expect(await readDraft(e2eWeb, original.id)).toEqual(original);
    expect(await listDrafts(e2eWeb)).toMatchObject([{ id: original.id }]);
    expect(writes).toEqual([{ method: 'POST', path: '/invoice-drafts' }]);
    await expect(page.getByRole('alert')).toHaveText(outcomeUnknownMessage);
    await expect(page.getByLabel('Aihe')).toHaveValue('Synthetic still editable after response loss');
    await expect(page.getByLabel('Lisätieto')).toHaveValue('Synthetic unsaved local note');
    await expect(page.getByRole('button', { name: 'Tallenna', exact: true })).toBeDisabled();
    await expectNotSaved(page);

    await withHeldDraftResponse(page, 'GET', '/invoice-drafts', async (list) => {
      await page.getByRole('button', { name: 'Takaisin luonnoksiin', exact: true }).first().click();
      expect(await (await list.received).json()).toMatchObject({
        invoiceDrafts: [{ id: original.id, subject: original.subject }],
      });
      await expectDraftListLoading(page);
      await list.release('success');
      await expectDraftListed(page, original.subject);
    });
    await openInvoiceDraftFromList(page, original.subject);
    await expect(page.getByLabel('Aihe')).toHaveValue(original.subject);
    await expect(page.getByLabel('Lisätieto')).toHaveValue(original.note);
    await expect(page.getByRole('alert')).toHaveCount(0);
    expect(writes).toEqual([{ method: 'POST', path: '/invoice-drafts' }]);
  });
});

test('INV-SAVE-007 @critical allows correction after a genuine pre-write validation rejection', async ({ e2eWeb }) => {
  const { page } = e2eWeb;
  const customer = await seedInvoiceJourneyPrerequisites(e2eWeb);
  const writes = observeDraftWrites(page);
  await pauseAutosaveClock(page);
  // The current UI accepts this text; the HTTP parser rejects it before saveDraft.
  await openNewDraft(page, customer.customerId, 'S'.repeat(501));
  const [rejected] = await Promise.all([
    page.waitForResponse((response) => response.request().method() === 'POST' &&
      new URL(response.url()).pathname === '/invoice-drafts'),
    startSave(page, 'manual'),
  ]);
  expect(rejected.status()).toBe(400);
  expect(await rejected.json()).toEqual({ error: 'Invalid invoice draft body.' });
  expect(await listDrafts(e2eWeb)).toEqual([]);
  await expect(page.getByRole('alert')).toHaveText(
    'Laskuluonnosta ei voitu tallentaa. Tarkista tiedot ja yritä uudelleen.',
  );
  await expect(page.getByText(outcomeUnknownMessage, { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Tallenna', exact: true })).toBeEnabled();
  await page.clock.runFor(autosaveDelayMs);
  expect(writes).toEqual([{ method: 'POST', path: '/invoice-drafts' }]);
  expect(await listDrafts(e2eWeb)).toEqual([]);
  await page.getByLabel('Aihe').fill('Synthetic corrected draft');

  await withHeldDraftWrite(page, 'POST', '/invoice-drafts', async (create) => {
    await startSave(page, 'manual');
    const corrected = await create.committed;
    await create.release('success');
    await expectSaved(page);
    await expect(page.getByRole('alert')).toHaveCount(0);
    await page.clock.runFor(autosaveDelayMs);
    expect(await readDraft(e2eWeb, corrected.id)).toMatchObject({
      id: corrected.id, subject: 'Synthetic corrected draft',
    });
    expect(await listDrafts(e2eWeb)).toMatchObject([{ id: corrected.id }]);
    expect(writes).toEqual([
      { method: 'POST', path: '/invoice-drafts' },
      { method: 'POST', path: '/invoice-drafts' },
    ]);
  });
});

test('INV-SAVE-008 @critical creates edits and reopens one persisted draft through the normal UI', async ({ e2eWeb }) => {
  const { page } = e2eWeb;
  const customer = await seedInvoiceJourneyPrerequisites(e2eWeb);
  const writes = observeDraftWrites(page);
  const draft = await createInvoiceDraftThroughUi(page, {
    customerId: customer.customerId,
    subject: 'Synthetic normal draft',
    note: 'Synthetic normal note',
    lines: [{ description: 'Synthetic work', quantity: '1', unitPrice: '25' }],
  });
  await expectSaved(page);
  await page.getByLabel('Aihe').fill('Synthetic normal draft edited');
  const [updated] = await Promise.all([
    page.waitForResponse((response) => response.request().method() === 'PUT' &&
      new URL(response.url()).pathname === `/invoice-drafts/${draft.id}`),
    page.getByRole('button', { name: 'Tallenna', exact: true }).click(),
  ]);
  expect(updated.status()).toBe(200);
  await expectSaved(page);
  const persisted = await readDraft(e2eWeb, draft.id);
  expect(persisted).toMatchObject({
    id: draft.id, subject: 'Synthetic normal draft edited', note: 'Synthetic normal note',
  });
  await openInvoicingWorkspace(page);
  await openInvoiceDraftFromList(page, persisted.subject);
  await expect(page.getByLabel('Aihe')).toHaveValue(persisted.subject);
  await expect(page.getByLabel('Lisätieto')).toHaveValue(persisted.note);
  await expectSaved(page);
  expect(await readDraft(e2eWeb, draft.id)).toEqual(persisted);
  expect(await listDrafts(e2eWeb)).toMatchObject([{ id: draft.id }]);
  expect(writes).toEqual([
    { method: 'POST', path: '/invoice-drafts' },
    { method: 'PUT', path: `/invoice-drafts/${draft.id}` },
  ]);
});

test('INV-SAVE-009 @critical @fault @recovery shows a list error instead of an empty recovery list', async ({ e2eWeb }) => {
  const { page } = e2eWeb;
  const customer = await seedInvoiceJourneyPrerequisites(e2eWeb);
  const writes = observeDraftWrites(page);
  await pauseAutosaveClock(page);
  await openNewDraft(page, customer.customerId, 'Synthetic recovery list failure');

  await withHeldDraftWrite(page, 'POST', '/invoice-drafts', async (create) => {
    await startSave(page, 'auto');
    const original = await create.committed;
    expect(await readDraft(e2eWeb, original.id)).toEqual(original);
    await create.release('lost');
    await expect(page.getByRole('alert')).toHaveText(outcomeUnknownMessage);

    await withHeldDraftResponse(page, 'GET', '/invoice-drafts', async (list) => {
      await page.getByRole('button', { name: 'Takaisin luonnoksiin', exact: true }).first().click();
      expect(await (await list.received).json()).toMatchObject({
        invoiceDrafts: [{ id: original.id, subject: original.subject }],
      });
      await expectDraftListLoading(page);
      await list.release('failure');
      await expect(page.getByRole('alert')).toHaveText(
        'Laskuluonnoksia ei voitu ladata. Yritä hetken kuluttua uudelleen.',
      );
      await expect(page.getByText('Ladataan laskuluonnoksia...', { exact: true })).toHaveCount(0);
      await expect(page.getByText('Laskuluonnoksia ei ole vielä.', { exact: true })).toHaveCount(0);
      await expect(page.getByRole('table', { name: 'Laskuluonnoslista', exact: true })).toHaveCount(0);
      await expect(page.getByText('Synthetic draft list failure', { exact: true })).toHaveCount(0);
      expect(await readDraft(e2eWeb, original.id)).toEqual(original);
      expect(await listDrafts(e2eWeb)).toMatchObject([{ id: original.id }]);
      expect(writes).toEqual([{ method: 'POST', path: '/invoice-drafts' }]);
    });
  });
});

for (const scenario of [
  { id: 'INV-SAVE-010', delivery: 'success' },
  { id: 'INV-SAVE-011', delivery: 'failure' },
] as const) {
  test(`${scenario.id} @critical @recovery ignores older list ${scenario.delivery} before and after the recovery refresh`, async ({ e2eWeb }) => {
    const { page } = e2eWeb;
    const customer = await seedInvoiceJourneyPrerequisites(e2eWeb);
    const writes = observeDraftWrites(page);
    await pauseAutosaveClock(page);

    await withHeldDraftResponse(page, 'GET', '/invoice-drafts', async (initialList) => {
      await openInvoicingWorkspace(page);
      expect(await (await initialList.received).json()).toEqual({ invoiceDrafts: [] });

      // New-invoice reset starts another real GET. Both old snapshots precede
      // the commit, so neither may replace the later non-empty recovery list.
      await withHeldDraftResponse(page, 'GET', '/invoice-drafts', async (resetList) => {
        await page.getByRole('button', { name: 'Uusi lasku', exact: true }).click();
        expect(await (await resetList.received).json()).toEqual({ invoiceDrafts: [] });
        await fillNewDraft(page, customer.customerId, 'Synthetic latest recovery list');

        await withHeldDraftWrite(page, 'POST', '/invoice-drafts', async (create) => {
          await startSave(page, 'auto');
          const original = await create.committed;
          await create.release('lost');
          await expect(page.getByRole('alert')).toHaveText(outcomeUnknownMessage);

          await withHeldDraftResponse(page, 'GET', '/invoice-drafts', async (currentList) => {
            await page.getByRole('button', { name: 'Takaisin luonnoksiin', exact: true }).first().click();
            expect(await (await currentList.received).json()).toMatchObject({
              invoiceDrafts: [{ id: original.id, subject: original.subject }],
            });
            await expectDraftListLoading(page);
            await initialList.release(scenario.delivery);
            await expectDraftListLoading(page);

            await currentList.release('success');
            await expectDraftListed(page, original.subject);
            await resetList.release(scenario.delivery);
            expect(await readDraft(e2eWeb, original.id)).toEqual(original);
            await expectDraftListed(page, original.subject);
            expect(await listDrafts(e2eWeb)).toMatchObject([{ id: original.id }]);
            expect(writes).toEqual([{ method: 'POST', path: '/invoice-drafts' }]);
          });
        });
      });
    });
  });
}

async function pauseAutosaveClock(page: Page): Promise<void> {
  await page.clock.install({ time: new Date('2026-07-29T08:00:00Z') });
  await page.clock.pauseAt(new Date('2026-07-29T09:00:00Z'));
}

async function openNewDraft(page: Page, customerId: string, subject: string): Promise<void> {
  await openInvoicingWorkspace(page);
  await page.getByRole('button', { name: 'Uusi lasku', exact: true }).click();
  await fillNewDraft(page, customerId, subject);
}

async function fillNewDraft(page: Page, customerId: string, subject: string): Promise<void> {
  await expect(page.getByRole('heading', { level: 2, name: 'Uusi lasku', exact: true })).toBeVisible();
  await page.getByRole('combobox', { name: 'Asiakas', exact: true }).selectOption(customerId);
  await page.getByLabel('Laskun päiväys').fill('2026-07-29');
  await page.getByLabel('Aihe').fill(subject);
  await page.getByLabel('Lisätieto').fill('Synthetic original note');
  const row = page.getByRole('group', { name: 'Rivi 1', exact: true });
  await row.getByLabel('Nimike').fill('Synthetic draft saving work');
  await row.getByLabel('Määrä').fill('1');
  await row.getByLabel('Yksikköhinta').fill('25');
}

async function startSave(page: Page, source: SaveSource): Promise<void> {
  if (source === 'auto') {
    await page.clock.runFor(autosaveDelayMs);
  } else {
    await page.getByRole('button', { name: 'Tallenna', exact: true }).click();
  }
}

async function submitCurrentFormTwice(page: Page): Promise<void> {
  // Exercise the native submit handler even while the button is disabled:
  // button appearance alone must not be the duplicate-write guard.
  await page.getByLabel('Aihe').evaluate((element) => {
    const form = element.closest('form');
    if (form === null) {
      throw new Error('Invoice subject must belong to its form.');
    }
    form.requestSubmit();
    form.requestSubmit();
  });
}

async function expectSaved(page: Page): Promise<void> {
  await expect(page.getByRole('status').filter({ hasText: savedMessagePattern })).toBeVisible();
}

async function expectNotSaved(page: Page): Promise<void> {
  await expect(page.getByRole('status').filter({ hasText: savedMessagePattern })).toHaveCount(0);
}

async function expectSaving(page: Page): Promise<void> {
  await expect(page.getByRole('button', { name: /^Tallennetaan (luonnosta|muutoksia)\.\.\.$/ })).toBeDisabled();
}

async function expectApprovalBlocked(page: Page): Promise<void> {
  const approve = page.getByRole('button', { name: 'Hyväksy laskuksi', exact: true });
  await expect(approve).toBeDisabled();
  await expect(page.getByRole('region', { name: 'Hyväksynnän vahvistus' })).toHaveCount(0);
}

async function expectDraftListLoading(page: Page): Promise<void> {
  await expect(page.getByRole('heading', { level: 2, name: 'Laskuluonnoslista' })).toBeVisible();
  await expect(page.getByText('Ladataan laskuluonnoksia...', { exact: true })).toBeVisible();
  await expect(page.getByText('Laskuluonnoksia ei ole vielä.', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('alert')).toHaveCount(0);
}

async function expectDraftListed(page: Page, subject: string): Promise<void> {
  const list = page.getByRole('table', { name: 'Laskuluonnoslista', exact: true });
  await expect(list).toBeVisible();
  await expect(list.getByRole('button', { name: subject, exact: true })).toHaveCount(1);
  await expect(page.getByText('Ladataan laskuluonnoksia...', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Laskuluonnoksia ei ole vielä.', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('alert')).toHaveCount(0);
}

function observeDraftWrites(page: Page): { method: string; path: string }[] {
  const writes: { method: string; path: string }[] = [];
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if ((request.method() === 'POST' && path === '/invoice-drafts') ||
        (request.method() === 'PUT' && /^\/invoice-drafts\/[^/]+$/.test(path))) {
      writes.push({ method: request.method(), path });
    }
  });
  return writes;
}

async function readDraft(e2eWeb: IsolatedWebHarness, id: string): Promise<InvoiceDraft> {
  const response = await e2eWeb.api.get(`/invoice-drafts/${id}`);
  expect(response.status()).toBe(200);
  const body = await response.json() as { invoiceDraft: InvoiceDraft };
  return body.invoiceDraft;
}

async function listDrafts(e2eWeb: IsolatedWebHarness): Promise<Pick<InvoiceDraft, 'id' | 'subject'>[]> {
  const response = await e2eWeb.api.get('/invoice-drafts');
  expect(response.status()).toBe(200);
  const body = await response.json() as { invoiceDrafts: Pick<InvoiceDraft, 'id' | 'subject'>[] };
  return body.invoiceDrafts;
}

interface HeldDraftWrite {
  committed: Promise<InvoiceDraft>;
  release(delivery: ResponseDelivery): Promise<void>;
}

async function withHeldDraftWrite(
  page: Page,
  method: 'POST' | 'PUT',
  path: string,
  run: (held: HeldDraftWrite) => Promise<void>,
): Promise<void> {
  await withHeldDraftResponse(page, method, path, async (held) => {
    const committed = held.received.then(async (response) => {
      const body = await response.json() as { invoiceDraft: InvoiceDraft };
      return body.invoiceDraft;
    });
    void committed.catch(() => undefined);
    await run({ committed, release: held.release });
  });
}

interface HeldDraftResponse {
  received: Promise<APIResponse>;
  release(delivery: ResponseDelivery | 'failure'): Promise<void>;
}

async function withHeldDraftResponse(
  page: Page,
  method: 'GET' | 'POST' | 'PUT',
  path: string,
  run: (held: HeldDraftResponse) => Promise<void>,
): Promise<void> {
  let capture!: (value: { route: Route; response: APIResponse }) => void;
  let rejectCapture!: (error: unknown) => void;
  const captured = new Promise<{ route: Route; response: APIResponse }>((resolve, reject) => {
    capture = resolve;
    rejectCapture = reject;
  });
  const received = captured.then(({ response }) => response);
  void received.catch(() => undefined);
  const pattern = `**${path}`;
  let pending: Route | undefined;
  let upstreamResponse: APIResponse | undefined;
  let fetchFinished: Promise<void> | undefined;
  let captureFailure: unknown;
  let intercepted = false;
  let handlingStarted = false;
  const handler = (route: Route): Promise<void> => {
    if (intercepted || route.request().method() !== method) {
      return route.fallback();
    }
    intercepted = true;
    pending = route;
    fetchFinished = (async () => {
      try {
        // Send exactly once to the real backend, then hold only browser delivery.
        upstreamResponse = await route.fetch();
        expect(upstreamResponse.status()).toBe(method === 'POST' ? 201 : 200);
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
          throw new Error('Draft response delivery has already started.');
        }
        if (delivery === 'failure' && method !== 'GET') {
          throw new Error('Only a draft read may receive a synthetic HTTP failure.');
        }
        handlingStarted = true;
        if (delivery === 'lost') {
          await Promise.all([
            page.waitForEvent('requestfailed', { predicate: (request) => request === route.request() }),
            route.abort('failed'),
          ]);
        } else {
          const [delivered] = await Promise.all([
            page.waitForResponse((value) => value.request() === route.request()),
            route.fulfill(delivery === 'failure'
              ? { status: 500, json: { error: 'Synthetic draft list failure' } }
              : { response }),
          ]);
          expect(await delivered.finished()).toBeNull();
        }
        pending = undefined;
        await page.clock.runFor(0);
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
  // A failed fulfillment may have consumed its route. Context closure remains
  // fixture-owned, and cleanup failures must not replace the original failure.
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
    throw new AggregateError(failures, 'Draft response scenario and route cleanup failed.');
  }
}
