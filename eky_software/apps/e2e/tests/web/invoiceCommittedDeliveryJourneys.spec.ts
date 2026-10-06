import { expect, test } from '../../src/fixtures/isolatedWebTest.js';
import {
  approveCurrentInvoiceDraft,
  createCurrentInvoicePdf,
  createInvoiceDraftThroughUi,
  seedInvoiceJourneyPrerequisites,
} from '../../src/journeys/invoicingWebJourney.js';

test('INV-SMTP-COMMITTED-READ-UI-001 @critical @fault distinguishes a committed delivery from a failed response read', async ({ e2eWeb }) => {
  const { page, api } = e2eWeb;
  const customer = await seedInvoiceJourneyPrerequisites(e2eWeb);
  await createInvoiceDraftThroughUi(page, {
    customerId: customer.customerId, subject: 'Synthetic committed delivery',
  });
  const { invoiceId } = await approveCurrentInvoiceDraft(page);
  await createCurrentInvoicePdf(page);
  const sendPath = `/invoices/${invoiceId}/email/smtp/send`;
  let sendCalls = 0;
  let realSendStatus: number | null = null;

  // The backend composition tests own the real read fault and diagnostics.
  // This adapter preserves a real fake-SMTP success, then supplies its
  // committed-read error contract to the actual API-client and form.
  await page.route(`**${sendPath}`, async (route) => {
    sendCalls += 1;
    const response = await route.fetch();
    realSendStatus = response.status();
    if (!response.ok()) {
      await route.fulfill({ response });
      return;
    }
    await route.fulfill({
      status: 409,
      json: {
        code: 'INVOICE_DELIVERY_COMMITTED_READ_FAILED',
        error: 'Invoice delivery completed, but the updated invoice could not be read.',
        technicalDetail: 'synthetic-private-read-failure',
      },
    });
  });
  await page.getByRole('button', { name: 'Valmistele sähköposti' }).click();
  await expect(page.getByRole('heading', { name: 'Sähköpostin esikatselu' })).toBeVisible();
  const sendResponse = page.waitForResponse((response) =>
    new URL(response.url()).pathname === sendPath && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Lähetä lasku', exact: true }).click();
  expect((await sendResponse).status()).toBe(409);
  await expect(page.getByRole('alert').getByText(
    'Lasku lähetettiin, mutta päivitettyjen tietojen lukeminen epäonnistui. Älä lähetä laskua uudelleen tämän ilmoituksen vuoksi. Avaa lasku uudelleen ja tarkista toimitushistoria.',
  )).toBeVisible();
  await expect(page.getByText('Laskun sähköpostia ei voitu lähettää. Laskua ei merkitty lähetetyksi.', { exact: true })).toHaveCount(0);
  await expect(page.getByText('synthetic-private-read-failure', { exact: false })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Lähetä lasku', exact: true })).toBeEnabled();

  const current = await api.get(`/invoices/${invoiceId}`);
  expect(current.status()).toBe(200);
  expect(await current.json()).toMatchObject({ invoice: { status: 'sent' } });
  const history = await api.get(`/invoices/${invoiceId}/delivery-events`);
  expect(history.status()).toBe(200);
  expect(await history.json()).toEqual({ events: [expect.objectContaining({
    provider: 'smtp', status: 'succeeded',
  })] });
  expect(realSendStatus).toBe(200);
  expect(sendCalls).toBe(1);
});
