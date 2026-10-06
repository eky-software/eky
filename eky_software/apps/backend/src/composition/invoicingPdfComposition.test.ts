import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

import { removeDirectories } from '../database/migration/invoiceContentRevisionMigration.fixture.js';
import { SqliteInvoiceApprovalRepository } from '../modules/invoicing/infrastructure/sqliteInvoiceApprovalRepository.js';
import { SqliteInvoiceCreditApprovalRepository } from '../modules/invoicing/infrastructure/sqliteInvoiceCreditApprovalRepository.js';
import { createSentRevisionSource, persistRevisionCreditDraft } from '../modules/invoicing/infrastructure/invoiceCreditRevision.fixture.js';
import {
  closePublicationDatabases, nextPublicationRevision, setInvoiceStatus,
} from '../modules/invoicing/infrastructure/sqliteInvoiceDocumentPublication.fixture.js';
import { SqliteInvoiceDocumentRepository } from '../modules/invoicing/infrastructure/sqliteInvoiceDocumentRepository.js';
import type { InvoiceRevisionKey } from '../modules/invoicing/domain/invoiceContentRevision.js';
import { createPdfCompositionFixture as fixture } from './invoicingPdfComposition.fixture.js';

afterEach(() => { vi.restoreAllMocks(); closePublicationDatabases(); });
afterAll(removeDirectories);

describe('invoice PDF production composition', () => {
  it('denies credit approval before revision or PDF work without the correction permission', async () => {
    const f = await fixture(false);
    const source = await createSentRevisionSource(f.database, f.approval);
    const draft = await persistRevisionCreditDraft(f.database, source);
    const approve = vi.spyOn(SqliteInvoiceCreditApprovalRepository.prototype, 'approveCreditDraft');
    const storage = vi.spyOn(f.storage, 'writeCandidate');
    const response = await f.createApp(f.storage, false).request(`/invoice-drafts/${draft.id}/approve-credit`, { method: 'POST' });
    expect(response.status).toBe(403);
    expect(approve).not.toHaveBeenCalled();
    expect(storage).not.toHaveBeenCalled();
    expect(f.noNetwork).not.toHaveBeenCalled();
  });

  it.each([false, true])('binds the credit approval hook to its returned revision (superseded: %s)', async (superseded) => {
    const f = await fixture(false);
    const source = await createSentRevisionSource(f.database, f.approval);
    const draft = await persistRevisionCreditDraft(f.database, source);
    const originalApprove = SqliteInvoiceCreditApprovalRepository.prototype.approveCreditDraft;
    let approvedKey: InvoiceRevisionKey | undefined;
    vi.spyOn(SqliteInvoiceCreditApprovalRepository.prototype, 'approveCreditDraft').mockImplementation(async function (this: SqliteInvoiceCreditApprovalRepository, input) {
      const result = await originalApprove.call(this, input);
      if (result.outcome !== 'approved') throw new Error('Synthetic credit approval failed.');
      approvedKey = result.invoice.revisionKey;
      if (superseded) nextPublicationRevision(f.database, approvedKey);
      return result;
    });
    const response = await f.createApp().request(`/invoice-drafts/${draft.id}/approve-credit`, { method: 'POST' });
    expect(response.status).toBe(200);
    const body = await response.json() as { approvedInvoice: { invoiceId: string; revisionKey?: unknown } };
    expect(body.approvedInvoice.revisionKey).toBeUndefined();
    expect(approvedKey?.invoiceId).toBe(body.approvedInvoice.invoiceId);
    const document = await new SqliteInvoiceDocumentRepository(f.database).findDocumentForRevision(approvedKey!);
    if (superseded) {
      expect(document).toBeUndefined();
      expect(f.database.prepare('SELECT COUNT(*) AS count FROM invoice_documents').get()).toEqual({ count: 0 });
      expect(f.write).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
        eventName: 'invoicePdf.generationFailed', stage: 'generate',
      }));
    } else {
      expect(document).toBeDefined();
      expect(document!.fileName).toMatch(/^hyvityslasku-/);
      const bytes = await f.storage.readVerifiedDocument(document!);
      expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');
      expect(f.write).not.toHaveBeenCalled();
    }
    expect(f.noNetwork).not.toHaveBeenCalled();
  });

  it('publishes a real PDF for the exact approval revision without changing the public response', async () => {
    const f = await fixture();
    const response = await f.approve(f.createApp());
    expect(response.status).toBe(200);
    const body = await response.json() as { approvedInvoice: { invoiceId: string; revisionKey?: unknown } };
    expect(body.approvedInvoice.revisionKey).toBeUndefined();
    const key = f.current();
    expect(key.invoiceId).toBe(body.approvedInvoice.invoiceId);
    const document = await new SqliteInvoiceDocumentRepository(f.database).findDocumentForRevision(key);
    expect(document).toBeDefined();
    const bytes = await f.storage.readVerifiedDocument(document!);
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');
    expect(bytes.length).toBeGreaterThan(1000);
    expect(f.write).not.toHaveBeenCalled();
    expect(f.noNetwork).not.toHaveBeenCalled();
  });

  it('does not replace the approval key with a newer current revision in the hook', async () => {
    const f = await fixture();
    const originalApprove = SqliteInvoiceApprovalRepository.prototype.approveDraft;
    let approvedKey: InvoiceRevisionKey | undefined;
    vi.spyOn(SqliteInvoiceApprovalRepository.prototype, 'approveDraft').mockImplementation(async function (this: SqliteInvoiceApprovalRepository, input) {
      const approved = await originalApprove.call(this, input);
      if (!approved) throw new Error('Synthetic approval failed.');
      approvedKey = approved.revisionKey;
      nextPublicationRevision(f.database, approved.revisionKey);
      return approved;
    });
    const response = await f.approve(f.createApp());
    expect(response.status).toBe(200);
    expect(approvedKey).toBeDefined();
    expect(f.current().revisionId).not.toBe(approvedKey!.revisionId);
    expect(f.database.prepare('SELECT COUNT(*) AS count FROM invoice_documents').get()).toEqual({ count: 0 });
    expect(f.write).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      eventName: 'invoicePdf.generationFailed', errorCode: 'INVOICE_PDF_GENERATION_FAILED', stage: 'generate',
    }));
    expect(f.noNetwork).not.toHaveBeenCalled();
  });

  it('preserves successful approval and safe diagnostics when the PDF file write fails', async () => {
    const f = await fixture();
    const error = new Error('synthetic-secret-value private@example.invalid /synthetic/private/path');
    vi.spyOn(f.storage, 'writeCandidate').mockRejectedValueOnce(error);
    const response = await f.approve(f.createApp());
    expect(response.status).toBe(200);
    expect(f.database.prepare('SELECT COUNT(*) AS count FROM invoice_content_revisions').get()).toEqual({ count: 1 });
    expect(f.database.prepare('SELECT COUNT(*) AS count FROM invoice_documents').get()).toEqual({ count: 0 });
    expect(f.write).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      eventName: 'invoicePdf.generationFailed', errorCode: 'INVOICE_PDF_GENERATION_FAILED', stage: 'generate',
    }));
    const output = JSON.stringify(f.write.mock.calls);
    for (const forbidden of ['synthetic-secret-value', 'private@example.invalid', '/synthetic/private/path', error.stack!]) {
      expect(output).not.toContain(forbidden);
    }
    expect(f.noNetwork).not.toHaveBeenCalled();
  });

  it('records publication conflict and failed candidate cleanup as separate safe stages', async () => {
    const f = await fixture();
    const originalWrite = f.storage.writeCandidate.bind(f.storage);
    vi.spyOn(f.storage, 'writeCandidate').mockImplementationOnce(async (input) => {
      const file = await originalWrite(input);
      setInvoiceStatus(f.database, input.scope, 'cancelled');
      return { ...file, async discard() { throw new Error('Synthetic private cleanup error'); } };
    });
    const response = await f.approve(f.createApp());
    expect(response.status).toBe(200);
    expect(f.write.mock.calls.map(([event]) => event.stage)).toEqual(['generate', 'cleanup']);
    expect(f.write.mock.calls.every(([event]) => event.errorCode === 'INVOICE_PDF_GENERATION_FAILED')).toBe(true);
    expect(JSON.stringify(f.write.mock.calls)).not.toContain('Synthetic private cleanup error');
    expect(f.database.prepare('SELECT COUNT(*) AS count FROM invoice_documents').get()).toEqual({ count: 0 });
    expect(f.noNetwork).not.toHaveBeenCalled();
  });
});
