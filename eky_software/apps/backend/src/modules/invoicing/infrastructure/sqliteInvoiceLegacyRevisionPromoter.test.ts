import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it } from 'vitest';

import {
  closeDatabases, insert, openDatabase, removeDirectories, snapshots, temporaryDirectory,
} from '../../../database/migration/invoiceContentRevisionMigration.fixture.js';
import type { InvoiceLineRow } from '../../../database/schema.js';
import { InvoiceContentRevisionIntegrityError } from '../application/invoiceContentRevisionIntegrityError.js';
import { InvoiceDeliveryConflictError } from '../domain/invoiceDeliveryConflictError.js';
import { InvoiceLegacyDeliveryReviewRequiredError } from '../domain/invoiceLegacyDeliveryReviewRequiredError.js';
import { getInvoiceTaxTreatmentSnapshot } from '../domain/invoiceTaxTreatment.js';
import {
  createLegacyPromotionFixture, insertLegacyPromotionEvent, promotionPreservedState,
} from './invoiceLegacyRevisionPromotion.fixture.js';
import { syntheticPdf } from './invoicePdfRead.fixture.js';
import { corruptStoredReaderRow } from './sqliteInvoiceContentRevisionReader.fixture.js';
import { SqliteInvoiceContentRevisionReader } from './sqliteInvoiceContentRevisionReader.js';
import { SqliteInvoiceLegacyRevisionPromoter } from './sqliteInvoiceLegacyRevisionPromoter.js';
import { validateInvoiceRevisionCatalog } from './validateInvoiceRevisionCatalog.js';

afterEach(closeDatabases);
afterAll(removeDirectories);

describe('SqliteInvoiceLegacyRevisionPromoter', () => {
  it.each(['standard', 'credit'] as const)('promotes %s once, retaining all original content and side-effect tables', async kind => {
    const f = await createLegacyPromotionFixture({ kind });
    const before = promotionPreservedState(f.database);
    const history = snapshots(f.database);
    const promoted = await f.promoter.promoteLegacyRevisionIfCurrent(f.key);
    expect(promoted).toEqual({
      ...f.original, revisionId: promoted.revisionId, origin: 'validatedLegacySnapshot',
      vatBreakdownState: 'authoritative', vatBreakdown: promoted.vatBreakdown,
    });
    expect(promoted.revisionId).not.toBe(f.key.revisionId);
    expect(promoted.vatBreakdown).toEqual(kind === 'credit' ? [
      { vatRateBasisPoints: 1000, netCents: 100, vatCents: 10, grossCents: 110 },
      { vatRateBasisPoints: 2550, netCents: 2, vatCents: 0, grossCents: 2 },
    ] : [
      { vatRateBasisPoints: 0, netCents: 2000, vatCents: 0, grossCents: 2000 },
      { vatRateBasisPoints: 1000, netCents: 10000, vatCents: 1000, grossCents: 11000 },
      { vatRateBasisPoints: 2550, netCents: 18000, vatCents: 4590, grossCents: 22590 },
    ]);
    expect(await f.reader.getCurrentRevision(f.scope)).toEqual(promoted);
    expect(await f.reader.getRevision(f.key)).toEqual(f.original);
    expect(promotionPreservedState(f.database)).toEqual(before);
    const after = snapshots(f.database);
    expect(after.invoice_content_revisions).toHaveLength(history.invoice_content_revisions!.length + 1);
    for (const row of history.invoice_revision_lines!) expect(after.invoice_revision_lines).toContainEqual(row);
    for (const row of history.invoice_content_revisions!) expect(after.invoice_content_revisions).toContainEqual(row);
    const originalDocument = await f.dependencies.invoiceDocumentRepository.findDocumentById({
      ...f.scope, documentId: 'legacy-document',
    });
    expect(new Uint8Array(await f.storage.readVerifiedDocument(originalDocument!))).toEqual(new Uint8Array(syntheticPdf));
    expect(() => validateInvoiceRevisionCatalog(f.database)).not.toThrow();
    await expect(f.promoter.promoteLegacyRevisionIfCurrent(f.key)).rejects.toBeInstanceOf(InvoiceDeliveryConflictError);
    await expect(f.promoter.promoteLegacyRevisionIfCurrent(promoted)).rejects.toBeInstanceOf(InvoiceDeliveryConflictError);
    expect(snapshots(f.database)).toEqual(after);
  });

  it('promotes reverse charge without inventing a VAT group', async () => {
    const f = await createLegacyPromotionFixture({ beforeMigration: database => {
      const tax = getInvoiceTaxTreatmentSnapshot('reverseChargeConstruction');
      database.transaction(() => {
        const lines = database.prepare<[], InvoiceLineRow>(
          "SELECT * FROM invoice_lines WHERE invoice_id = 'invoice-1' ORDER BY line_order",
        ).all();
        // Construct the pre-039 fixture with each tax guard enabled throughout.
        database.prepare("DELETE FROM invoice_lines WHERE invoice_id = 'invoice-1'").run();
        database.prepare(`UPDATE invoices SET tax_treatment = 'reverseChargeConstruction',
          tax_treatment_label_snapshot = ?, tax_legal_basis_snapshot = ?, total_vat_cents = 0,
          total_gross_cents = total_net_cents WHERE id = 'invoice-1'`).run(tax.label, tax.legalBasis);
        for (const line of lines) insert(database, 'invoice_lines', {
          ...line, vat_rate_basis_points: null, vat_cents: 0, gross_cents: line.net_cents,
        });
      }).immediate();
    } });
    expect(await f.promoter.promoteLegacyRevisionIfCurrent(f.key)).toMatchObject({
      origin: 'validatedLegacySnapshot', vatBreakdown: [], totalNetCents: 30000, totalVatCents: 0, totalGrossCents: 30000,
    });
    expect(() => validateInvoiceRevisionCatalog(f.database)).not.toThrow();
  });

  it.each(['companyId', 'invoiceId', 'revisionId'] as const)('rejects the wrong exact %s without writes', async field => {
    const f = await createLegacyPromotionFixture();
    const before = { ...promotionPreservedState(f.database), ...snapshots(f.database) };
    await expect(f.promoter.promoteLegacyRevisionIfCurrent({ ...f.key, [field]: 'foreign-or-missing' }))
      .rejects.toBeInstanceOf(InvoiceDeliveryConflictError);
    expect({ ...promotionPreservedState(f.database), ...snapshots(f.database) }).toEqual(before);
  });

  it.each(['sent', 'cancelled', 'reopened_for_edit'] as const)('rejects %s and never returns its latest revision', async status => {
    const f = await createLegacyPromotionFixture();
    corruptStoredReaderRow(f.database, 'invoices', { id: f.key.invoiceId }, { status });
    const before = snapshots(f.database);
    await expect(f.promoter.promoteLegacyRevisionIfCurrent(f.key)).rejects.toBeInstanceOf(InvoiceDeliveryConflictError);
    expect(snapshots(f.database)).toEqual(before);
  });

  it.each(['succeeded', 'failed', 'attempted', 'outcomeUnknown'] as const)('holds legacy SMTP %s without guessing test mode', async status => {
    const f = await createLegacyPromotionFixture({ beforeMigration: (database, id) => {
      insertLegacyPromotionEvent(database, id, { status, recipient_email: 'self@example.invalid' });
    } });
    const before = { ...promotionPreservedState(f.database), ...snapshots(f.database) };
    await expect(f.promoter.promoteLegacyRevisionIfCurrent(f.key))
      .rejects.toBeInstanceOf(InvoiceLegacyDeliveryReviewRequiredError);
    expect({ ...promotionPreservedState(f.database), ...snapshots(f.database) }).toEqual(before);
  });

  it.each(['attempted', 'outcomeUnknown'] as const)('blocks unresolved non-SMTP %s too', async status => {
    const f = await createLegacyPromotionFixture({ beforeMigration: (database, id) => {
      insertLegacyPromotionEvent(database, id, { provider: 'dryRun', status });
    } });
    const before = snapshots(f.database);
    await expect(f.promoter.promoteLegacyRevisionIfCurrent(f.key)).rejects.toBeInstanceOf(InvoiceDeliveryConflictError);
    expect(snapshots(f.database)).toEqual(before);
  });

  it('preserves terminal non-SMTP history without treating it as external SMTP', async () => {
    const f = await createLegacyPromotionFixture({ beforeMigration: (database, id) => {
      insertLegacyPromotionEvent(database, id, { provider: 'dryRun', status: 'failed' });
    } });
    const before = promotionPreservedState(f.database);
    await f.promoter.promoteLegacyRevisionIfCurrent(f.key);
    expect(promotionPreservedState(f.database)).toEqual(before);
  });

  it.each(['header', 'line', 'legacyTotals', 'creditSource'] as const)('fails closed for inconsistent %s', async corruption => {
    const f = await createLegacyPromotionFixture({
      kind: corruption === 'creditSource' ? 'credit' : 'standard',
      beforeMigration: database => {
        if (corruption === 'legacyTotals') {
          database.exec("UPDATE invoices SET total_vat_cents = 5591, total_gross_cents = 35591 WHERE id = 'invoice-1'");
        }
      },
    });
    if (corruption === 'header') corruptStoredReaderRow(f.database, 'invoices', { id: f.key.invoiceId }, { note: 'Changed projection' });
    if (corruption === 'line') corruptStoredReaderRow(f.database, 'invoice_lines', { id: 'line-1' }, { description: 'Changed projection' });
    if (corruption === 'creditSource') corruptStoredReaderRow(f.database, 'invoice_content_revisions',
      { id: f.original.creditedRevisionId }, { invoice_number: 'different-source-number' });
    const before = { ...promotionPreservedState(f.database), ...snapshots(f.database) };
    await expect(f.promoter.promoteLegacyRevisionIfCurrent(f.key)).rejects.toBeInstanceOf(InvoiceContentRevisionIntegrityError);
    expect({ ...promotionPreservedState(f.database), ...snapshots(f.database) }).toEqual(before);
  });

  it.each(['abort', 'ignore'] as const)('rolls back children, header and pointer after a late %s', async failure => {
    const f = await createLegacyPromotionFixture();
    f.database.exec(`CREATE TRIGGER fail_promotion_pointer BEFORE UPDATE ON invoice_current_revisions
      BEGIN SELECT RAISE(${failure === 'abort' ? "ABORT, 'SYNTHETIC_PROMOTION_FAILURE'" : 'IGNORE'}); END`);
    const before = { ...promotionPreservedState(f.database), ...snapshots(f.database) };
    await expect(f.promoter.promoteLegacyRevisionIfCurrent(f.key)).rejects.toThrow();
    expect({ ...promotionPreservedState(f.database), ...snapshots(f.database) }).toEqual(before);
    expect(f.database.inTransaction).toBe(false);
    f.database.exec('DROP TRIGGER fail_promotion_pointer');
    await expect(f.promoter.promoteLegacyRevisionIfCurrent(f.key)).resolves.toMatchObject({ origin: 'validatedLegacySnapshot' });
  });

  it('allows only one competing writer and preserves both revisions after reopening the database', async () => {
    const f = await createLegacyPromotionFixture({ kind: 'credit' });
    const path = join(temporaryDirectory(), 'promotion.sqlite');
    await f.database.backup(path);
    const first = openDatabase(path);
    const second = openDatabase(path);
    const results = await Promise.allSettled([
      new SqliteInvoiceLegacyRevisionPromoter(first).promoteLegacyRevisionIfCurrent(f.key),
      new SqliteInvoiceLegacyRevisionPromoter(second).promoteLegacyRevisionIfCurrent(f.key),
    ]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
    const winner = results.find(result => result.status === 'fulfilled');
    if (winner?.status !== 'fulfilled') throw new Error('Synthetic promotion winner missing.');
    first.close();
    second.close();
    const restarted = openDatabase(path);
    const reader = new SqliteInvoiceContentRevisionReader(restarted);
    expect(await reader.getCurrentRevision(f.scope)).toEqual(winner.value);
    expect(await reader.getRevision(f.key)).toEqual(f.original);
    expect(promotionPreservedState(restarted)).toEqual(promotionPreservedState(f.database));
    expect(() => validateInvoiceRevisionCatalog(restarted)).not.toThrow();
  });
});
