import { createSyntheticCompanySettingsInput } from '../../src/data/syntheticBusinessInputs.js';
import { readElectronNativeAdapterSnapshot } from '../../src/electron/electronMainCapabilities.js';
import { expect, test } from '../../src/fixtures/isolatedElectronTest.js';
import { createApprovedInvoiceWithPdf } from '../../src/journeys/invoicingApiJourney.js';

for (const mode of ['accept', 'cancel'] as const) {
  test.describe(`customer SMTP native confirmation ${mode}`, () => {
    test.use({ e2eDialogMode: mode });

    test(`DESK-SMTP-CONFIRM-${mode === 'accept' ? '001' : '002'} @critical @security ${mode}s the exact prepared invoice through the production protocol`, async ({ e2eElectron }) => {
      const { api, page, electronApp } = e2eElectron;
      const invoice = await createApprovedInvoiceWithPdf(api);
      const settings = await api.put('/company-settings', {
        data: createSyntheticCompanySettingsInput({ emailDeliveryProvider: 'dnaSmtp' }),
      });
      expect(settings.status()).toBe(200);
      const pdf = await api.get(`/invoices/${invoice.invoiceId}/pdf`);
      expect(pdf.status()).toBe(200);
      const originalBytes = await pdf.body();
      const before = await readElectronNativeAdapterSnapshot(electronApp);

      // Only the OS dialog and SMTP provider are test adapters. Requests use
      // the renderer's real eky protocol, main confirmation and backend runtime.
      // Keep the one-time authorization inside that renderer invocation.
      const result = await page.evaluate(async ({ invoiceId }) => {
        const base = `eky://app/invoices/${invoiceId}/email`;
        const previewResponse = await fetch(`${base}/dry-run`, { method: 'POST' });
        if (!previewResponse.ok) return { previewStatus: previewResponse.status };
        const { email } = await previewResponse.json();
        const message = {
          body: 'Synthetic Electron confirmation message', cc: '',
          documentTarget: email.documentTarget,
          subject: 'Synthetic Electron invoice', to: 'recipient@example.invalid',
        };
        const prepared = await fetch(`${base}/smtp/prepare`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(message),
        });
        const preparationBody = await prepared.json();
        if (!prepared.ok) return {
          previewStatus: previewResponse.status, prepareStatus: prepared.status,
          hasAuthorization: JSON.stringify(preparationBody).includes('authorizationToken'),
          sendStatus: null,
        };
        const { preparation } = preparationBody;
        const exact = preparation.invoiceId === invoiceId
          && preparation.documentTarget.kind === message.documentTarget.kind
          && preparation.documentTarget.documentId === message.documentTarget.documentId
          && preparation.attachment.documentId === message.documentTarget.documentId;
        if (!exact) return { previewStatus: previewResponse.status, prepareStatus: prepared.status, exact: false };
        const sent = await fetch(`${base}/smtp/send`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...message, attemptId: preparation.attemptId,
            authorizationToken: preparation.authorizationToken }),
        });
        return {
          previewStatus: previewResponse.status, prepareStatus: prepared.status,
          exact: true, sendStatus: sent.status,
        };
      }, invoice);

      const after = await readElectronNativeAdapterSnapshot(electronApp);
      expect(after.messageBoxCount - before.messageBoxCount).toBe(1);
      const historyResponse = await api.get(`/invoices/${invoice.invoiceId}/delivery-events`);
      expect(historyResponse.status()).toBe(200);
      const history = await historyResponse.json();
      const current = await api.get(`/invoices/${invoice.invoiceId}`);
      expect(current.status()).toBe(200);
      if (mode === 'cancel') {
        expect(result).toEqual({ previewStatus: 200, prepareStatus: 409, hasAuthorization: false, sendStatus: null });
        expect(history).toEqual({ events: [] });
        expect(await current.json()).toMatchObject({ invoice: { status: 'approved' } });
      } else {
        expect(result).toEqual({ previewStatus: 200, prepareStatus: 200, exact: true, sendStatus: 200 });
        expect(history).toEqual({ events: [expect.objectContaining({
          id: expect.any(String), status: 'succeeded', provider: 'smtp',
          recipientEmail: 'recipient@example.invalid',
        })] });
        expect(await current.json()).toMatchObject({ invoice: { status: 'sent' } });
        const delivered = await api.get(`/invoices/${invoice.invoiceId}/delivery-events/${history.events[0].id}/pdf`);
        expect(delivered.status()).toBe(200);
        expect(await delivered.body()).toEqual(originalBytes);
      }
    });
  });
}
