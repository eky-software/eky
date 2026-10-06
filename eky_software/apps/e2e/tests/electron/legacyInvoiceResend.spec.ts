import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { createDatabaseConnection } from '../../../backend/src/database/connection/createDatabaseConnection.js';
import { createSyntheticCompanySettingsInput } from '../../src/data/syntheticBusinessInputs.js';
import { readElectronE2eActiveWorkspace } from '../../src/environment/readElectronE2eActiveWorkspace.js';
import { closeElectronPdfPreviews, readElectronNativeAdapterSnapshot, readElectronPdfPreviewUrls } from '../../src/electron/electronMainCapabilities.js';
import { expect, test } from '../../src/fixtures/isolatedElectronTest.js';
import { openApprovedInvoiceFromList, openInvoicingWorkspace } from '../../src/journeys/invoicingWebJourney.js';

for (const mode of ['accept', 'cancel'] as const) {
  test.describe(`preserved legacy resend ${mode}`, () => {
    test.use({ e2eDialogMode: mode, e2eLegacyInvoiceProfile: 'sent' });

    test(`DESK-LEGACY-RESEND-${mode === 'accept' ? '001' : '002'} @critical @security @recovery ${mode}s the migrated original PDF through the UI and native confirmation`, async ({ e2eElectron }) => {
      const fixture = e2eElectron.legacyInvoiceProfile;
      expect(fixture).toBeDefined();
      if (fixture === undefined) throw new Error('LEGACY_INVOICE_PROFILE_MISSING');
      const { api, page, electronApp } = e2eElectron;
      const invoicePath = `/invoices/${fixture.invoiceId}`;
      const historyPath = `${invoicePath}/delivery-events`;
      const originalPdfPath = `${historyPath}/${fixture.eventId}/pdf`;
      const invoiceResponse = await api.get(invoicePath);
      expect(invoiceResponse.status()).toBe(200);
      const invoiceBefore = await invoiceResponse.json();
      expect(invoiceBefore).toMatchObject({ invoice: { id: fixture.invoiceId, invoiceNumber: fixture.invoiceNumber, status: 'sent' } });
      const historyResponse = await api.get(historyPath);
      expect(historyResponse.status()).toBe(200);
      const historyBefore = await historyResponse.json();
      expect(historyBefore.events).toEqual([expect.objectContaining({
        id: fixture.eventId, status: 'succeeded', documentSource: 'legacyOriginal', sendMode: 'legacyUnknown',
      })]);
      const originalPdf = await api.get(originalPdfPath);
      expect(originalPdf.status()).toBe(200);
      const originalBytes = await originalPdf.body();
      expect(createHash('sha256').update(originalBytes).digest('hex')).toBe(fixture.pdfSha256);
      expect((await api.put('/company-settings', {
        data: createSyntheticCompanySettingsInput({ emailDeliveryProvider: 'dnaSmtp' }),
      })).status()).toBe(200);
      expect((await api.put('/company-settings/email-secret', {
        data: { secret: 'synthetic-legacy-resend-not-a-real-password' },
      })).status()).toBe(200);
      if (mode === 'accept') {
        const archiveStatus = await page.evaluate(async () => {
          const bridge = (window as typeof window & {
            ekyDesktop?: { chooseInvoicePdfArchiveDirectory(): Promise<unknown> };
          }).ekyDesktop;
          if (bridge === undefined) throw new Error('Desktop bridge is unavailable.');
          return bridge.chooseInvoicePdfArchiveDirectory();
        });
        expect(archiveStatus).toMatchObject({ enabled: true, lastSafeErrorCode: null, pendingCount: 0 });
      }

      // Only SMTP and the OS dialog use test adapters. Migration, preserved
      // selection, protocol, native confirmation and persistence are real.
      await openInvoicingWorkspace(page);
      await openApprovedInvoiceFromList(page, fixture.invoiceNumber);
      const preflightResponse = page.waitForResponse(response => response.request().method() === 'POST'
        && new URL(response.url()).pathname === `${invoicePath}/email/dry-run`);
      await page.getByRole('button', { name: 'Valmistele sähköposti', exact: true }).click();
      const preflight = await preflightResponse;
      expect(preflight.status()).toBe(200);
      const { email } = await preflight.json();
      expect(email.documentTarget).toEqual({ kind: 'preservedLegacy', documentId: expect.any(String) });
      expect(email.documentTarget.documentId).not.toBe(fixture.documentId);
      expect(email.attachment.documentId).toBe(email.documentTarget.documentId);
      const preservedPdfPath = `${invoicePath}/preserved-documents/${email.documentTarget.documentId}/pdf`;
      const preservedPdf = await api.get(preservedPdfPath);
      expect(preservedPdf.status()).toBe(200);
      expect(await preservedPdf.body()).toEqual(originalBytes);
      await page.getByRole('button', { name: 'Avaa säilytetty PDF-liite' }).click();
      await expect.poll(() => readElectronPdfPreviewUrls(electronApp)).toEqual([`eky://app${preservedPdfPath}`]);
      await closeElectronPdfPreviews(electronApp);
      await expect.poll(() => electronApp.windows().length).toBe(1);
      await page.getByLabel('Vastaanottajan sähköposti', { exact: true }).fill('recipient@example.invalid');
      await page.getByLabel('Viestin sisältö').fill('Synthetic preserved invoice resend');
      const nativeBefore = await readElectronNativeAdapterSnapshot(electronApp);
      let sends = 0;
      page.on('request', request => {
        if (request.method() === 'POST' && new URL(request.url()).pathname === `${invoicePath}/email/smtp/send`) sends++;
      });
      await page.getByRole('button', { name: 'Lähetä uudelleen', exact: true }).click();
      if (mode === 'cancel') {
        await expect(page.getByRole('alert')).toHaveText('Sähköpostilähetys peruutettiin.');
        expect(sends).toBe(0);
      } else {
        await expect(page.getByRole('status').filter({ hasText: 'Lasku lähetettiin uudelleen.' })).toBeVisible();
        expect(sends).toBe(1);
      }
      const nativeAfter = await readElectronNativeAdapterSnapshot(electronApp);
      expect(nativeAfter.messageBoxCount - nativeBefore.messageBoxCount).toBe(1);
      const afterResponse = await api.get(historyPath);
      expect(afterResponse.status()).toBe(200);
      const historyAfter = await afterResponse.json();
      if (mode === 'cancel') {
        expect(historyAfter).toEqual(historyBefore);
      } else {
        expect(historyAfter.events).toHaveLength(2);
        expect(historyAfter.events).toContainEqual(historyBefore.events[0]);
        const delivered = historyAfter.events.find((event: { id: string }) => event.id !== fixture.eventId);
        expect(delivered).toMatchObject({
          status: 'succeeded', provider: 'smtp', sendMode: 'customer', documentSource: 'preservedLegacy',
          recipientEmail: 'recipient@example.invalid',
        });
        const workspace = readElectronE2eActiveWorkspace(e2eElectron.runtime.userDataPath);
        const database = createDatabaseConnection({ databaseFilePath: workspace.databaseFilePath });
        try {
          database.pragma('query_only = ON');
          expect(database.prepare(`
            SELECT e.document_id, d.source_document_id, d.binding_kind
            FROM invoice_delivery_events e JOIN invoice_documents d
              ON d.company_id = e.company_id AND d.invoice_id = e.invoice_id AND d.id = e.document_id
            WHERE e.id = ? AND e.invoice_id = ?
          `).get(delivered.id, fixture.invoiceId)).toEqual({
            document_id: email.documentTarget.documentId,
            source_document_id: fixture.documentId,
            binding_kind: 'preservedLegacy',
          });
        } finally { database.close(); }
        const deliveredPdf = await api.get(`${historyPath}/${delivered.id}/pdf`);
        expect(deliveredPdf.status()).toBe(200);
        expect(await deliveredPdf.body()).toEqual(originalBytes);
        const archivePath = join(e2eElectron.runtime.invoicePdfArchiveDirectoryPath,
          workspace.workspaceId, `Lasku-${fixture.invoiceNumber}.pdf`);
        await expect.poll(() => existsSync(archivePath)).toBe(true);
        expect(readFileSync(archivePath)).toEqual(originalBytes);
        await expect.poll(() => JSON.parse(readFileSync(workspace.archiveJournalPath, 'utf8')).tasks).toEqual([]);
      }
      expect(await (await api.get(invoicePath)).json()).toEqual(invoiceBefore);
      await e2eElectron.restart();
      const restartedHistory = await e2eElectron.api.get(historyPath);
      expect(restartedHistory.status()).toBe(200);
      expect(await restartedHistory.json()).toEqual(historyAfter);
      expect(await (await e2eElectron.api.get(invoicePath)).json()).toEqual(invoiceBefore);
      const restartedPdf = await e2eElectron.api.get(preservedPdfPath);
      expect(restartedPdf.status()).toBe(200);
      expect(await restartedPdf.body()).toEqual(originalBytes);
      expect(await (await e2eElectron.api.get(originalPdfPath)).body()).toEqual(originalBytes);
    });
  });
}
