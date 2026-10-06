import { expect } from 'vitest';

import type { DatabaseConnection } from '../../../database/connection/createDatabaseConnection.js';
import {
  historicalDatabase,
  insert,
  migrate,
} from '../../../database/migration/invoiceContentRevisionMigration.fixture.js';
import type {
  InvoiceContentRevisionRow,
  InvoiceLineRow,
  InvoiceRevisionLineRow,
  InvoiceRevisionVatBreakdownRow,
  InvoiceRow,
} from '../../../database/schema.js';
import {
  createInitialCreditDraft,
  prepareUpdatedCreditDraft,
  type CreditInvoiceDraftLineInput,
} from '../application/creditInvoiceDraftModel.js';
import type { ApprovedInvoiceView } from '../domain/approvedInvoiceView.js';
import type { ApproveCreditInvoiceDraftPersistenceInput } from '../ports/invoiceCreditApprovalRepository.js';
import {
  createApprovalRevisionFixture,
  createRevisionDraft,
  createRevisionLine,
  revisionApprovalInput,
} from './invoiceApprovalRevision.fixture.js';
import { SqliteApprovedInvoiceReader } from './sqliteApprovedInvoiceReader.js';
import { SqliteInvoiceCreditDraftRepository } from './sqliteInvoiceCreditDraftRepository.js';

export type ApprovalFixture = Awaited<ReturnType<typeof createApprovalRevisionFixture>>;

export function creditApprovalInput(
  overrides: Partial<ApproveCreditInvoiceDraftPersistenceInput> = {},
): ApproveCreditInvoiceDraftPersistenceInput {
  return {
    actorUserId: 'revision-actor',
    approvedAt: '2027-01-16T12:00:00.000Z',
    auditEventId: 'credit-revision-approved',
    companyId: 'revision-company',
    draftId: 'credit-revision-draft',
    invoiceId: 'credit-revision-invoice',
    ...overrides,
  };
}

export async function createSentRevisionSource(
  database: DatabaseConnection,
  fixture: ApprovalFixture,
  draft = createRevisionDraft(),
) {
  await fixture.drafts.saveDraft(draft);
  await expect(fixture.repository.approveDraft(revisionApprovalInput({
    companyId: draft.companyId,
    draftId: draft.id,
    reverseChargeEligibilityConfirmed: draft.taxTreatment === 'reverseChargeConstruction',
  }))).resolves.toMatchObject({ invoiceId: 'revision-invoice' });
  return markRevisionSourceSent(database, fixture, draft.companyId);
}

export async function markRevisionSourceSent(
  database: DatabaseConnection,
  fixture: ApprovalFixture,
  companyId = 'revision-company',
) {
  await expect(fixture.repository.markApprovedInvoiceSent({
    actorUserId: 'revision-actor',
    auditEventId: 'revision-source-sent',
    companyId,
    invoiceId: 'revision-invoice',
    markedSentAt: '2027-01-16T08:00:00.000Z',
  })).resolves.toEqual({ invoiceId: 'revision-invoice', status: 'sent' });
  return readCreditSourceView(database, companyId, 'revision-invoice');
}

export async function readCreditSourceView(
  database: DatabaseConnection,
  companyId: string,
  invoiceId: string,
): Promise<ApprovedInvoiceView> {
  const source = await new SqliteApprovedInvoiceReader(database)
    .getApprovedInvoiceById(companyId, invoiceId);
  if (source === undefined) throw new Error('Synthetic credit source missing.');
  return source;
}

export async function persistRevisionCreditDraft(
  database: DatabaseConnection,
  source: ApprovedInvoiceView,
  requestedLines?: readonly CreditInvoiceDraftLineInput[],
  draftId = creditApprovalInput().draftId,
) {
  const repository = new SqliteInvoiceCreditDraftRepository(database);
  const previous = await repository.listPreviousCreditLineAllocations(source.companyId, source.id);
  const initial = {
    ...createInitialCreditDraft(source, previous, '2027-01-16T10:00:00.000Z'),
    id: draftId,
  };
  const draft = requestedLines === undefined ? initial : prepareUpdatedCreditDraft(
    initial, source, previous, {
      subject: 'Synthetic partial credit',
      note: 'Synthetic credit note',
      refundIban: 'FI2112345600000785',
      lines: requestedLines,
      updatedAt: initial.updatedAt,
    },
  );
  await expect(repository.createCreditDraft({
    actorUserId: 'revision-actor',
    auditEventId: `${draftId}-created`,
    sourceInvoiceId: source.id,
    draft,
  })).resolves.toEqual({ outcome: 'created', draftId });
  return draft;
}

export function readCreditRevision(
  database: DatabaseConnection,
  invoiceId: string,
  companyId = 'revision-company',
) {
  const header = database.prepare<[string, string], InvoiceContentRevisionRow>(`
    SELECT revision.* FROM invoice_current_revisions current
    JOIN invoice_content_revisions revision
      ON revision.company_id = current.company_id
      AND revision.invoice_id = current.invoice_id
      AND revision.id = current.revision_id
    WHERE current.company_id = ? AND current.invoice_id = ?
  `).get(companyId, invoiceId);
  if (header === undefined) throw new Error('Synthetic current revision missing.');
  return {
    header,
    lines: database.prepare<[string], InvoiceRevisionLineRow>(`
      SELECT * FROM invoice_revision_lines WHERE revision_id = ? ORDER BY line_order
    `).all(header.id),
    vat: database.prepare<[string], InvoiceRevisionVatBreakdownRow>(`
      SELECT * FROM invoice_revision_vat_breakdown
      WHERE revision_id = ? ORDER BY vat_rate_basis_points
    `).all(header.id),
  };
}

export function readCreditSourceState(database: DatabaseConnection, source: ApprovedInvoiceView) {
  return {
    invoice: database.prepare<[string], InvoiceRow>('SELECT * FROM invoices WHERE id = ?').get(source.id),
    lines: database.prepare<[string], InvoiceLineRow>(`
      SELECT * FROM invoice_lines WHERE invoice_id = ? ORDER BY line_order
    `).all(source.id),
    revision: readCreditRevision(database, source.id, source.companyId),
    documents: database.prepare('SELECT * FROM invoice_documents ORDER BY id').all(),
    deliveryEvents: database.prepare('SELECT * FROM invoice_delivery_events ORDER BY id').all(),
  };
}

export async function createLegacyCreditRevisionSource() {
  const database = await historicalDatabase();
  const draft = createRevisionDraft({}, [
    createRevisionLine('legacy-line-1', 1, { quantityHundredths: 100, unitPriceCents: 2 }),
    createRevisionLine('legacy-line-2', 2, { quantityHundredths: 100, unitPriceCents: 2 }),
  ]);
  database.prepare('DELETE FROM invoice_lines WHERE invoice_id = ?').run('invoice-1');
  for (const line of draft.lines) {
    insert(database, 'invoice_lines', {
      id: line.id, invoice_id: 'invoice-1', source_invoice_line_id: null,
      line_order: line.position, code: line.code, description: line.description,
      quantity_hundredths: line.quantityHundredths, unit: line.unit,
      unit_price_cents: line.unitPriceCents, vat_rate_basis_points: line.vatRateBasisPoints,
      discount_type: 'none', discount_value: 0, base_cents: line.baseCents,
      discount_cents: line.discountCents, net_cents: line.netCents,
      vat_cents: line.vatCents, gross_cents: line.grossCents, created_at: draft.createdAt,
    });
  }
  database.prepare(`
    UPDATE invoices SET status = 'sent', total_net_cents = ?, total_vat_cents = ?, total_gross_cents = ?
    WHERE id = 'invoice-1'
  `).run(draft.totals.netTotalCents, draft.totals.vatTotalCents, draft.totals.grossTotalCents);
  insert(database, 'invoice_numbering_settings', {
    company_id: 'dev-company', series_key: 'default', mode: 'calendarYearSequence',
    fiscal_year_start_month: 1, sequence_padding: 4, first_sequence_number: 1,
    created_at: draft.createdAt, updated_at: draft.createdAt,
  });
  insert(database, 'invoice_numbering_active_series', {
    company_id: 'dev-company', active_series_key: 'default', revision: 1,
    updated_at: draft.createdAt, updated_by: 'revision-actor',
  });
  insert(database, 'invoice_documents', {
    id: 'legacy-source-document', company_id: 'dev-company', invoice_id: 'invoice-1',
    document_type: 'approved_invoice_pdf', file_name: 'synthetic.pdf',
    storage_path: 'synthetic/legacy.pdf', mime_type: 'application/pdf',
    sha256: 'a'.repeat(64), size_bytes: 64, created_at: draft.createdAt,
  });
  insert(database, 'invoice_delivery_events', {
    id: 'legacy-source-delivery', company_id: 'dev-company', invoice_id: 'invoice-1',
    document_id: 'legacy-source-document', delivery_method: 'email', provider: 'smtp',
    status: 'outcomeUnknown', subject: 'Synthetic historical event', created_at: draft.createdAt,
  });
  await migrate(database);
  return { database, source: await readCreditSourceView(database, 'dev-company', 'invoice-1') };
}
