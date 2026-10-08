import type { Route } from '@playwright/test';
import { expect, test, type IsolatedWebHarness } from '../../src/fixtures/isolatedWebTest.js';
import {
  approveCurrentInvoiceDraft,
  createInvoiceDraftThroughUi,
  openApprovedInvoiceFromList,
  openInvoicingWorkspace,
  seedInvoiceJourneyPrerequisites,
} from '../../src/journeys/invoicingWebJourney.js';

// Browser wiring proof only: the preflight's preserved variant is supplied by
// a test adapter. Real legacy selection and bytes have separate backend proofs.
async function prepareAttachment(e2eWeb: IsolatedWebHarness) {
  const customer = await seedInvoiceJourneyPrerequisites(e2eWeb);
  await createInvoiceDraftThroughUi(e2eWeb.page, {
    customerId: customer.customerId, subject: 'Synthetic preserved attachment preview',
  });
  const approved = await approveCurrentInvoiceDraft(e2eWeb.page);
  let documentId = 'synthetic-copy-1';
  await e2eWeb.page.route(`**/invoices/${approved.invoiceId}/email/dry-run`, async (route) => {
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    const body = await response.json();
    body.email.documentTarget = { kind: 'preservedLegacy', documentId };
    body.email.attachment.documentId = documentId;
    body.email.body = 'Liitteenä säilytetty lasku-PDF.';
    await route.fulfill({ response, json: body });
  });
  await e2eWeb.page.getByRole('button', { name: 'Valmistele sähköposti', exact: true }).click();
  await expect(e2eWeb.page.getByRole('button', { name: 'Avaa säilytetty PDF-liite' })).toBeVisible();
  return { ...approved, setDocumentId: (next: string) => { documentId = next; } };
}

for (const changedTarget of [false, true]) {
  test(`INV-PRESERVED-SMTP-UI-001-${changedTarget ? 'changed' : 'exact'} @critical keeps customer sending bound to the preview`, async ({ e2eWeb }) => {
    const { page } = e2eWeb;
    const prepared = await prepareAttachment(e2eWeb);
    const documentTarget = { kind: 'preservedLegacy', documentId: 'synthetic-copy-1' };
    const preparations: Record<string, unknown>[] = [];
    const sends: Record<string, unknown>[] = [];
    const historyPath = `/invoices/${prepared.invoiceId}/delivery-events`;
    const historyBefore = await (await e2eWeb.api.get(historyPath)).json();
    // Synthetic transport adapters prove browser wiring, not native confirmation
    // or successful SMTP delivery. Neither request reaches an SMTP provider.
    await page.route(`**/invoices/${prepared.invoiceId}/email/smtp/prepare`, async (route) => {
      const input = route.request().postDataJSON();
      preparations.push(input);
      const returnedTarget = changedTarget
        ? { ...documentTarget, documentId: 'different-copy' }
        : documentTarget;
      await route.fulfill({ status: 200, json: { preparation: {
        attachment: { documentId: returnedTarget.documentId, fileName: 'synthetic.pdf', sizeBytes: 1024 },
        attemptId: 'synthetic-attempt', authorizationToken: 'synthetic-authorization',
        body: input.body, cc: input.cc ?? '', documentTarget: returnedTarget,
        expiresAt: '2099-01-01T00:00:00.000Z', invoiceId: prepared.invoiceId,
        invoiceNumber: prepared.invoiceNumber, recipient: input.to, resend: true,
        sender: 'Synthetic <sender@example.invalid>', subject: input.subject,
      } } });
    });
    await page.route(`**/invoices/${prepared.invoiceId}/email/smtp/send`, async (route) => {
      sends.push(route.request().postDataJSON());
      await route.fulfill({ status: 409, json: { error: 'Invoice delivery conflict.' } });
    });

    await page.getByText('Testitoiminnot', { exact: true }).click();
    await expect(page.getByRole('button', { name: 'Kuivaharjoittele lähetys' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Lähetä hallittu SMTP-testi' })).toBeDisabled();
    await page.getByLabel('Viestin sisältö').fill('Synthetic current message');
    await page.getByRole('button', { name: 'Lähetä lasku', exact: true }).click();
    await expect(page.getByRole('alert')).toHaveText('Lähetys on jo käynnissä, vahvistus vanheni tai lyhyt varoaika on voimassa. Odota hetki ja valmistele lähetys uudelleen.');
    expect(preparations).toHaveLength(1);
    expect(preparations[0]).toMatchObject({ documentTarget, body: 'Synthetic current message' });
    expect(sends).toEqual(changedTarget ? [] : [{
      ...preparations[0], attemptId: 'synthetic-attempt', authorizationToken: 'synthetic-authorization',
    }]);
    const historyAfter = await e2eWeb.api.get(historyPath);
    expect(historyAfter.status()).toBe(200);
    expect(await historyAfter.json()).toEqual(historyBefore);
  });
}

test('INV-PRESERVED-PREVIEW-UI-001 @critical opens only the selected copy and reports a blocked popup', async ({ e2eWeb }, testInfo) => {
  const { page, context } = e2eWeb;
  const prepared = await prepareAttachment(e2eWeb);
  const historyBefore = await (await e2eWeb.api.get(`/invoices/${prepared.invoiceId}/delivery-events`)).json();
  const unexpectedWrites: string[] = [];
  page.on('request', (request) => {
    if (request.method() !== 'GET') unexpectedWrites.push(new URL(request.url()).pathname);
  });
  await page.evaluate(() => {
    const open = window.open;
    window.open = () => { window.open = open; return null; };
  });
  const action = page.getByRole('button', { name: 'Avaa säilytetty PDF-liite' });
  await action.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('alert')).toHaveText(/PDF-liitettä ei voitu avata/);

  const exactPath = `/invoices/${prepared.invoiceId}/preserved-documents/synthetic-copy-1/pdf`;
  await context.route(`**${exactPath}`, (route) => route.fulfill({
    status: 200, contentType: 'text/plain', body: 'Synthetic exact-copy route reached',
  }));
  const popupPromise = context.waitForEvent('page');
  await action.click();
  const popup = await popupPromise;
  await expect(popup).toHaveURL(new RegExp(`${exactPath}$`));
  expect(await popup.evaluate(() => window.opener === null)).toBe(true);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await popup.close();
  expect(unexpectedWrites).toEqual([]);

  for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await action.scrollIntoViewIfNeeded();
    await expect(action).toBeVisible();
    expect(await action.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`preserved-attachment-${viewport.width}.png`) });
  }
  const historyAfter = await e2eWeb.api.get(`/invoices/${prepared.invoiceId}/delivery-events`);
  expect(historyAfter.status()).toBe(200);
  expect(await historyAfter.json()).toEqual(historyBefore);
});

test('INV-PRESERVED-PREVIEW-UI-002 @critical keeps native opening feedback bound to its attachment', async ({ e2eWeb }) => {
  const { page } = e2eWeb;
  // This adapter is test-owned, not an Electron/native acceptance claim.
  await page.addInitScript(() => {
    const calls: unknown[][] = [];
    const failures: (() => void)[] = [];
    Object.assign(window, {
      previewProbe: { calls, failures },
      ekyDesktop: {
        openInvoicePdf: (...args: unknown[]) => {
          calls.push(args);
          return new Promise<void>((resolve, reject) => {
            if (calls.length > 1) resolve();
            else failures.push(() => reject(new Error('synthetic raw private detail')));
          });
        },
      },
    });
  });
  await page.reload();
  const prepared = await prepareAttachment(e2eWeb);
  const action = page.getByRole('button', { name: 'Avaa säilytetty PDF-liite' });
  await action.click();
  const busy = page.getByRole('button', { name: 'Avataan PDF-liitettä…' });
  await expect(busy).toBeDisabled();
  await expect(busy).toHaveAttribute('aria-busy', 'true');
  await busy.evaluate((element) => { (element as HTMLButtonElement).click(); });
  expect(await readCalls()).toEqual([[prepared.invoiceId, { kind: 'preservedLegacy', documentId: 'synthetic-copy-1' }]]);

  prepared.setDocumentId('synthetic-copy-2');
  await page.getByRole('button', { name: 'Valmistele sähköposti', exact: true }).click();
  await expect(action).toBeEnabled();
  await page.evaluate(() => {
    const probe = (window as unknown as { previewProbe: { failures: (() => void)[] } }).previewProbe;
    probe.failures[0]!();
  });
  await action.click();
  await expect(action).toBeEnabled();
  expect(await readCalls()).toEqual([
    [prepared.invoiceId, { kind: 'preservedLegacy', documentId: 'synthetic-copy-1' }],
    [prepared.invoiceId, { kind: 'preservedLegacy', documentId: 'synthetic-copy-2' }],
  ]);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByText('synthetic raw private detail')).toHaveCount(0);

  async function readCalls() {
    return page.evaluate(() => (window as unknown as { previewProbe: { calls: unknown[][] } }).previewProbe.calls);
  }
});

for (const status of [409, 500]) {
  test(`INV-PRESERVED-PREVIEW-UI-003-${status} @critical @fault invalidates the old attachment after failed preparation`, async ({ e2eWeb }) => {
    const { page } = e2eWeb;
    const prepared = await prepareAttachment(e2eWeb);
    await page.route(`**/invoices/${prepared.invoiceId}/email/dry-run`, (route) => route.fulfill({
      status, json: { error: 'Synthetic preparation failure' },
    }));
    await page.getByRole('button', { name: 'Valmistele sähköposti', exact: true }).click();
    await expect(page.getByRole('alert')).toHaveText('Sähköpostiluonnosta ei voitu valmistella. Yritä hetken kuluttua uudelleen.');
    await expect(page.getByRole('button', { name: 'Avaa säilytetty PDF-liite' })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Sähköpostin esikatselu' })).toHaveCount(0);
  });
}

for (const scenario of [
  { id: 'INV-PRESERVED-PREVIEW-UI-004', unmount: false },
  { id: 'INV-PRESERVED-PREVIEW-UI-005', unmount: true },
]) {
  test(`${scenario.id} @critical ignores preparation after ${scenario.unmount ? 'unmounting' : 'clearing'} the same invoice view`, async ({ e2eWeb }) => {
    const { page } = e2eWeb;
    const prepared = await prepareAttachment(e2eWeb);
    const path = `/invoices/${prepared.invoiceId}/email/dry-run`;
    let heldRoute!: Route;
    let capture!: () => void;
    const captured = new Promise<void>((resolve) => { capture = resolve; });
    await page.route(`**${path}`, (route) => { heldRoute = route; capture(); });
    await page.getByRole('button', { name: 'Valmistele sähköposti', exact: true }).click();
    await captured;
    if (scenario.unmount) {
      await page.getByRole('button', { name: 'Asiakkaat', exact: true }).click();
      await expect(page.getByRole('heading', { level: 2, name: 'Asiakaslista', exact: true })).toBeVisible();
      await openInvoicingWorkspace(page);
    } else {
      await page.getByRole('button', { name: 'Takaisin luonnoksiin' }).click();
    }
    await openApprovedInvoiceFromList(page, prepared.invoiceNumber);
    const upstream = await heldRoute.fetch();
    expect(upstream.status()).toBe(200);
    const body = await upstream.json();
    body.email.documentTarget = { kind: 'preservedLegacy', documentId: 'stale-copy' };
    body.email.attachment.documentId = 'stale-copy';
    const received = page.waitForResponse((response) => new URL(response.url()).pathname === path);
    await heldRoute.fulfill({ response: upstream, json: body });
    await (await received).finished();
    await expect(page.getByRole('button', { name: 'Valmistele sähköposti', exact: true })).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Avaa säilytetty PDF-liite' })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Sähköpostin esikatselu' })).toHaveCount(0);
  });
}

test('INV-PRESERVED-PREVIEW-UI-006 @critical preserves a newer pending preparation after an older rejection', async ({ e2eWeb }) => {
  const { page } = e2eWeb;
  const prepared = await prepareAttachment(e2eWeb);
  const path = `/invoices/${prepared.invoiceId}/email/dry-run`;
  const held: Route[] = [];
  const capture: (() => void)[] = [];
  const captured = [0, 1].map((index) => new Promise<void>((resolve) => { capture[index] = resolve; }));
  await page.route(`**${path}`, (route) => {
    held.push(route);
    capture[held.length - 1]!();
  });
  await page.getByRole('button', { name: 'Valmistele sähköposti', exact: true }).click();
  await captured[0];
  await page.getByRole('button', { name: 'Takaisin luonnoksiin' }).click();
  await openApprovedInvoiceFromList(page, prepared.invoiceNumber);
  await page.getByRole('button', { name: 'Valmistele sähköposti', exact: true }).click();
  await captured[1];

  const olderResponse = page.waitForResponse((response) => new URL(response.url()).pathname === path);
  await held[0]!.fulfill({ status: 500, json: { error: 'Synthetic stale failure' } });
  await (await olderResponse).finished();
  await expect(page.getByRole('button', { name: 'Valmistellaan...', exact: true })).toBeDisabled();
  await expect(page.getByRole('alert')).toHaveCount(0);

  const upstream = await held[1]!.fetch();
  expect(upstream.status()).toBe(200);
  const body = await upstream.json();
  body.email.documentTarget = { kind: 'preservedLegacy', documentId: 'current-copy' };
  body.email.attachment.documentId = 'current-copy';
  body.email.attachment.fileName = 'current-preserved.pdf';
  await held[1]!.fulfill({ response: upstream, json: body });
  await expect(page.getByRole('button', { name: 'Avaa säilytetty PDF-liite' })).toBeEnabled();
  await expect(page.getByText(/^current-preserved\.pdf \(/)).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
});
