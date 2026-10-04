import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { DatabaseConnection } from '../../../database/connection/createDatabaseConnection.js';
import { runMigrations } from '../../../database/migration/runMigrations.js';
import {
  createInitialCreditDraft,
  prepareUpdatedCreditDraft,
} from '../application/creditInvoiceDraftModel.js';
import type { ApprovedInvoiceView } from '../domain/approvedInvoiceView.js';
import { calculateInvoiceLine } from '../domain/calculateInvoiceLine.js';
import { calculateInvoiceTotals } from '../domain/calculateInvoiceTotals.js';
import type { PriceInputMode } from '../domain/invoiceCalculation.js';
import { InvoiceCreditError } from '../domain/invoiceCreditError.js';
import type { ApproveCreditInvoiceDraftPersistenceInput } from '../ports/invoiceCreditApprovalRepository.js';
import { SqliteApprovedInvoiceReader } from './sqliteApprovedInvoiceReader.js';
import { SqliteInvoiceApprovalRepository } from './sqliteInvoiceApprovalRepository.js';
import { SqliteInvoiceCreditApprovalRepository } from './sqliteInvoiceCreditApprovalRepository.js';
import { SqliteInvoiceCreditDraftRepository } from './sqliteInvoiceCreditDraftRepository.js';
import { SqliteInvoiceDraftRepository } from './sqliteInvoiceDraftRepository.js';

describe('SqliteInvoiceCreditApprovalRepository', () => {
  let database: DatabaseConnection;

  beforeEach(async () => {
    database = new Database(':memory:');
    database.pragma('foreign_keys = ON');
    await runMigrations(database);
    insertFixture(database);
  });

  afterEach(() => {
    database.close();
  });

  const roundingCases = [
    { priceInputMode: 'net', unitPriceCents: 1, net: 2, vat: 1, gross: 3 },
    { priceInputMode: 'net', unitPriceCents: 2, net: 4, vat: 1, gross: 5 },
    { priceInputMode: 'gross', unitPriceCents: 2, net: 3, vat: 1, gross: 4 },
    { priceInputMode: 'gross', unitPriceCents: 3, net: 5, vat: 1, gross: 6 },
  ] as const;

  it.each(roundingCases)(
    'fully credits a real $priceInputMode snapshot with two $unitPriceCents-cent lines',
    async ({ priceInputMode, unitPriceCents, net, vat, gross }) => {
      const source = await createSentRoundingSnapshot(database, priceInputMode, unitPriceCents);
      const expectedTotals = {
        netTotalCents: net,
        vatTotalCents: vat,
        grossTotalCents: gross,
        vatBreakdown: [{ vatRateBasisPoints: 2550, netCents: net, vatCents: vat, grossCents: gross }],
      };
      expect(source.totals).toMatchObject({
        netTotalCents: net, vatTotalCents: vat, grossTotalCents: gross,
      });
      expect(source.lines.reduce((sum, line) => sum + line.vatCents, 0)).not.toBe(vat);
      const draft = await persistRoundingCreditDraft(database, source, 'rounding-credit-draft-1');
      expect(draft.totals).toEqual(expectedTotals);
      const repository = new SqliteInvoiceCreditApprovalRepository(database);
      const input = {
        ...createInput(), draftId: draft.id, invoiceId: 'rounding-credit-1',
      };

      await expect(repository.approveCreditDraft(input)).resolves.toMatchObject({
        outcome: 'approved', invoice: { sequenceNumber: 3 },
      });
      const reader = new SqliteApprovedInvoiceReader(database);
      const credit = await reader.getApprovedInvoiceById('company-1', input.invoiceId);
      expect(credit?.totals).toEqual(expectedTotals);
      expect(credit?.lines.map((line) => line.sourceInvoiceLineId)).toEqual(
        source.lines.map((line) => line.id),
      );
      expect(credit?.lines.reduce((sum, line) => sum + line.vatCents, 0)).toBe(vat);
      expect(credit?.referenceNumber).toBe('');
      expect(await new SqliteInvoiceDraftRepository(database).getDraftById('company-1', draft.id)).toBeUndefined();
      expect(database.prepare('SELECT action FROM invoice_audit_events WHERE id = ?').get(input.auditEventId))
        .toEqual({ action: 'invoice.credit_approved' });
      expect(await reader.getApprovedInvoiceById('company-1', source.id)).toEqual(source);

      const previous = await new SqliteInvoiceCreditDraftRepository(database)
        .listPreviousCreditLineAllocations('company-1', source.id);
      expect(() => createInitialCreditDraft(source, previous, draft.createdAt))
        .toThrow('Source invoice has no remaining creditable lines.');
      await expect(repository.approveCreditDraft(input)).resolves.toEqual({ outcome: 'notFound' });
      expect(getSequence(database)?.last_sequence_number).toBe(3);
    },
  );

  it.each(roundingCases)(
    'exhausts a real $priceInputMode snapshot through successive $unitPriceCents-cent source credits',
    async ({ priceInputMode, unitPriceCents }) => {
      const source = await createSentRoundingSnapshot(database, priceInputMode, unitPriceCents);
      const initial = await persistRoundingCreditDraft(database, source, 'rounding-credit-draft-1');
      const firstLine = source.lines[0];
      if (firstLine === undefined) {
        throw new Error('Rounding source line is missing.');
      }
      const firstDraft = prepareUpdatedCreditDraft(initial, source, [], {
        subject: initial.subject,
        note: initial.note,
        refundIban: '',
        updatedAt: initial.updatedAt,
        lines: [{
          lineType: 'source',
          sourceInvoiceLineId: firstLine.id,
          description: firstLine.description,
          quantityHundredths: 100,
        }],
      });
      const draftRepository = new SqliteInvoiceDraftRepository(database);
      expect(await draftRepository.updateDraft(firstDraft)).toEqual(firstDraft);
      const approval = new SqliteInvoiceCreditApprovalRepository(database);
      await expect(approval.approveCreditDraft({
        ...createInput(), draftId: firstDraft.id, invoiceId: 'rounding-credit-1',
      })).resolves.toMatchObject({ outcome: 'approved' });

      const lastDraft = await persistRoundingCreditDraft(database, source, 'rounding-credit-draft-2');
      expect(lastDraft.lines).toHaveLength(1);
      expect(lastDraft.lines[0]?.sourceInvoiceLineId).toBe(source.lines[1]?.id);
      await expect(approval.approveCreditDraft({
        ...createInput(),
        auditEventId: 'rounding-credit-approval-2',
        draftId: lastDraft.id,
        invoiceId: 'rounding-credit-2',
      })).resolves.toMatchObject({ outcome: 'approved', invoice: { sequenceNumber: 4 } });

      const reader = new SqliteApprovedInvoiceReader(database);
      const first = await reader.getApprovedInvoiceById('company-1', 'rounding-credit-1');
      const last = await reader.getApprovedInvoiceById('company-1', 'rounding-credit-2');
      if (first === undefined || last === undefined) {
        throw new Error('Approved rounding credits are missing.');
      }
      expect(last.totals).toEqual(lastDraft.totals);
      expect(first.totals.netTotalCents + last.totals.netTotalCents).toBe(source.totals.netTotalCents);
      expect(first.totals.vatTotalCents + last.totals.vatTotalCents).toBe(source.totals.vatTotalCents);
      expect(first.totals.grossTotalCents + last.totals.grossTotalCents).toBe(source.totals.grossTotalCents);
      const creditDraftRepository = new SqliteInvoiceCreditDraftRepository(database);
      const previous = await creditDraftRepository.listPreviousCreditLineAllocations('company-1', source.id);
      expect(() => createInitialCreditDraft(source, previous, lastDraft.createdAt))
        .toThrow('Source invoice has no remaining creditable lines.');
      expect(await reader.getApprovedInvoiceById('company-1', source.id)).toEqual(source);
    },
  );

  it.each(['net', 'gross'] as const)(
    'rolls back a group-rounded %s credit when its audit write fails',
    async (priceInputMode) => {
      const source = await createSentRoundingSnapshot(database, priceInputMode, 2);
      const draft = await persistRoundingCreditDraft(database, source, 'rounding-credit-draft-1');
      const before = readRoundingApprovalState(database, draft.id);
      const repository = new SqliteInvoiceCreditApprovalRepository(database);

      await expect(repository.approveCreditDraft({
        ...createInput(),
        draftId: draft.id,
        invoiceId: 'rounding-credit-1',
        auditEventId: `${draft.id}-created`,
      })).rejects.toThrow('UNIQUE constraint failed: invoice_audit_events.id');

      expect(readRoundingApprovalState(database, draft.id)).toEqual(before);
      expect(await new SqliteInvoiceDraftRepository(database).getDraftById('company-1', draft.id))
        .toEqual(draft);
    },
  );

  it.each(['net', 'gross'] as const)(
    'keeps a group-rounded %s credit inside its company boundary',
    async (priceInputMode) => {
      const source = await createSentRoundingSnapshot(database, priceInputMode, 2);
      const draft = await persistRoundingCreditDraft(database, source, 'rounding-credit-draft-1');
      const before = readRoundingApprovalState(database, draft.id);
      const repository = new SqliteInvoiceCreditApprovalRepository(database);

      await expect(repository.approveCreditDraft({
        ...createInput(), companyId: 'other-company', draftId: draft.id,
      })).resolves.toEqual({ outcome: 'notFound' });
      await expect(new SqliteInvoiceCreditDraftRepository(database).createCreditDraft({
        actorUserId: 'other-user',
        auditEventId: 'other-audit',
        sourceInvoiceId: source.id,
        draft: { ...draft, id: 'other-draft', companyId: 'other-company' },
      })).resolves.toEqual({ outcome: 'notEligible' });
      await expect(new SqliteApprovedInvoiceReader(database)
        .getApprovedInvoiceById('other-company', source.id)).resolves.toBeUndefined();

      expect(readRoundingApprovalState(database, draft.id)).toEqual(before);
    },
  );

  it('approves a credit draft with numbering, source links, and audit atomically', async () => {
    const repository = new SqliteInvoiceCreditApprovalRepository(database);

    await expect(repository.approveCreditDraft(createInput())).resolves.toEqual({
      outcome: 'approved',
      invoice: {
        invoiceId: 'credit-invoice-1',
        draftId: 'credit-draft-1',
        invoiceNumber: '20260002',
        sequenceNumber: 2,
        sequenceScope: 'calendar-year:2026',
        numberingMode: 'calendarYearSequence',
        status: 'approved',
      },
    });

    expect(getCreditInvoice(database)).toMatchObject({
      invoice_kind: 'credit',
      credited_invoice_id: 'source-invoice-1',
      reference_number: null,
      customer_name_snapshot: 'Snapshot Customer Oy',
      total_net_cents: 5_000,
      total_vat_cents: 1_275,
      total_gross_cents: 6_275,
    });
    expect(getCreditLine(database)).toMatchObject({
      source_invoice_line_id: 'source-line-1',
      description: 'Partial credit',
      quantity_hundredths: 50,
      net_cents: 5_000,
      vat_cents: 1_275,
      gross_cents: 6_275,
    });
    expect(getAudit(database)).toMatchObject({
      action: 'invoice.credit_approved',
      actor_user_id: 'user-1',
      invoice_number: '20260002',
    });
    expect(getCreditDraft(database)).toMatchObject({
      approved_invoice_id: 'credit-invoice-1',
      approved_at: '2026-07-23T12:00:00.000Z',
    });
  });

  it('uses the active numbering series for a credit approval', async () => {
    database
      .prepare(
        `
          INSERT INTO invoice_numbering_settings (
            company_id,
            series_key,
            mode,
            fiscal_year_start_month,
            sequence_padding,
            first_sequence_number,
            created_at,
            updated_at
          )
          VALUES (
            'company-1',
            'series-2',
            'calendarYearSequence',
            1,
            4,
            100,
            '2026-07-23T11:00:00.000Z',
            '2026-07-23T11:00:00.000Z'
          )
        `,
      )
      .run();
    database
      .prepare(
        `
          UPDATE invoice_numbering_active_series
          SET
            active_series_key = 'series-2',
            revision = revision + 1,
            updated_at = '2026-07-23T11:00:00.000Z',
            updated_by = 'user-1'
          WHERE company_id = 'company-1'
        `,
      )
      .run();
    const repository = new SqliteInvoiceCreditApprovalRepository(database);

    await expect(repository.approveCreditDraft(createInput())).resolves.toMatchObject({
      outcome: 'approved',
      invoice: {
        invoiceNumber: '20260100',
        sequenceNumber: 100,
        sequenceScope: 'calendar-year:2026',
      },
    });

    expect(getCreditInvoice(database)).toMatchObject({
      invoice_number: '20260100',
      sequence_number: 100,
      sequence_scope: 'calendar-year:2026',
      series_key: 'series-2',
    });
    expect(
      database
        .prepare<
          [string, string],
          { last_sequence_number: number; sequence_scope: string }
        >(
          `
            SELECT last_sequence_number, sequence_scope
            FROM invoice_number_sequences
            WHERE company_id = ? AND series_key = ?
          `,
        )
        .get('company-1', 'series-2'),
    ).toEqual({
      last_sequence_number: 100,
      sequence_scope: 'calendar-year:2026',
    });
  });

  it('rechecks cumulative credit capacity inside the transaction', async () => {
    insertPreviousCredit(database, 60);
    const repository = new SqliteInvoiceCreditApprovalRepository(database);

    await expect(repository.approveCreditDraft(createInput())).rejects.toBeInstanceOf(
      InvoiceCreditError,
    );

    expect(getCreditInvoice(database)).toBeUndefined();
    expect(getCreditDraft(database)?.approved_invoice_id).toBeNull();
    expect(getSequence(database)?.last_sequence_number).toBe(1);
  });

  it('approves a manual credit and snapshots the optional refund account', async () => {
    replaceDraftLineWithManualCredit(database);
    database
      .prepare(
        `
          UPDATE invoice_drafts
          SET refund_iban = 'FI2112345600000785'
          WHERE id = 'credit-draft-1'
        `,
      )
      .run();
    const repository = new SqliteInvoiceCreditApprovalRepository(database);

    await expect(repository.approveCreditDraft(createInput())).resolves.toMatchObject({
      outcome: 'approved',
    });

    expect(getCreditInvoice(database)).toMatchObject({
      refund_iban_snapshot: 'FI2112345600000785',
      total_net_cents: 2_500,
      total_vat_cents: 638,
      total_gross_cents: 3_138,
    });
    expect(getCreditLine(database)).toMatchObject({
      source_invoice_line_id: null,
      description: 'Manual customer credit',
      quantity_hundredths: 100,
      unit: 'kpl',
      unit_price_cents: 2_500,
      vat_rate_basis_points: 2_550,
      net_cents: 2_500,
      vat_cents: 638,
      gross_cents: 3_138,
    });
  });

  it('approves a reverse charge credit with inherited tax snapshots and no VAT', async () => {
    convertFixtureToReverseCharge(database);
    const repository = new SqliteInvoiceCreditApprovalRepository(database);

    await expect(
      repository.approveCreditDraft(createInput()),
    ).resolves.toMatchObject({
      outcome: 'approved',
    });

    expect(getCreditInvoice(database)).toMatchObject({
      invoice_kind: 'credit',
      credited_invoice_id: 'source-invoice-1',
      tax_treatment: 'reverseChargeConstruction',
      tax_treatment_label_snapshot: 'Käännetty verovelvollisuus',
      tax_legal_basis_snapshot: 'AVL 8 c §',
      performance_date: '2026-07-01',
      performance_period_start: null,
      performance_period_end: null,
      total_net_cents: 5_000,
      total_vat_cents: 0,
      total_gross_cents: 5_000,
    });
    expect(getCreditLine(database)).toMatchObject({
      vat_rate_basis_points: null,
      net_cents: 5_000,
      vat_cents: 0,
      gross_cents: 5_000,
    });
  });

  it('returns a conflict if the source invoice is no longer sent', async () => {
    database
      .prepare(
        "UPDATE invoices SET status = 'approved' WHERE id = 'source-invoice-1'",
      )
      .run();
    const repository = new SqliteInvoiceCreditApprovalRepository(database);

    await expect(repository.approveCreditDraft(createInput())).resolves.toEqual({
      outcome: 'conflict',
    });
    expect(getCreditInvoice(database)).toBeUndefined();
  });

  it('rolls back all approval writes when audit persistence fails', async () => {
    database
      .prepare(
        `
          INSERT INTO invoice_audit_events (
            id,
            company_id,
            actor_user_id,
            action,
            draft_id,
            invoice_id,
            invoice_number,
            created_at
          )
          VALUES (
            'audit-credit-approval-1',
            'company-1',
            'user-1',
            'invoice.credit_draft_created',
            'credit-draft-1',
            'source-invoice-1',
            '20260001',
            '2026-07-23T11:00:00.000Z'
          )
        `,
      )
      .run();
    const repository = new SqliteInvoiceCreditApprovalRepository(database);

    await expect(repository.approveCreditDraft(createInput())).rejects.toThrow();

    expect(getCreditInvoice(database)).toBeUndefined();
    expect(getCreditDraft(database)?.approved_invoice_id).toBeNull();
    expect(getSequence(database)?.last_sequence_number).toBe(1);
  });
});

async function createSentRoundingSnapshot(
  database: DatabaseConnection,
  priceInputMode: PriceInputMode,
  unitPriceCents: number,
): Promise<ApprovedInvoiceView> {
  const lines = [1, 2].map((position) => ({
    ...calculateInvoiceLine({
      quantityHundredths: 100,
      unitPriceCents,
      vatRateBasisPoints: 2550,
      priceInputMode,
      discount: { type: 'none' },
    }),
    id: `rounding-source-line-${position}`,
    sourceInvoiceLineId: null,
    position,
    code: '',
    description: 'Rounding test work',
    unit: 'kpl',
    discount: { type: 'none' } as const,
  }));
  await new SqliteInvoiceDraftRepository(database).saveDraft({
    id: 'rounding-source-draft',
    companyId: 'company-1',
    invoiceKind: 'standard',
    creditedInvoiceId: null,
    customerId: 'customer-1',
    billingRecipientCustomerId: null,
    status: 'draft',
    invoiceDate: '2026-07-01',
    dueDate: '2026-07-15',
    paymentTermDays: 14,
    reminderPeriodDays: 8,
    latePaymentInterestBasisPoints: 0,
    priceInputMode,
    taxTreatment: 'normalVat',
    performancePeriod: { type: 'invoiceDate' },
    subject: 'Rounding test invoice',
    orderNumber: '',
    note: '',
    deliveryAddressText: '',
    refundIban: '',
    lines,
    totals: calculateInvoiceTotals(lines),
    createdAt: '2026-07-01T10:00:00.000Z',
    updatedAt: '2026-07-01T10:00:00.000Z',
  });
  // Only party master data is stubbed; calculation and snapshot writes are real.
  const approval = new SqliteInvoiceApprovalRepository(database, {
    getSnapshotData: () => ({
      companyBusinessId: '1234567-1',
      companyVatNumber: 'FI12345671',
      companyStreetAddress: 'Test street 1',
      companyPostalCode: '00100',
      companyCity: 'Helsinki',
      companyEmail: '',
      companyPhone: '',
      companyWebsite: '',
      companyIban: 'FI2112345600000785',
      companyBic: '',
      companyBankName: '',
      companyName: 'Synthetic Seller Oy',
      customerBusinessId: '1234567-1',
      customerCity: 'Helsinki',
      customerEmail: '',
      customerName: 'Synthetic Customer Oy',
      customerNumber: '1',
      customerPhone: '',
      customerPostalCode: '00100',
      customerStreetAddress: 'Test street 2',
      customerType: 'company',
      billingRecipientBusinessId: '1234567-1',
      billingRecipientCity: 'Helsinki',
      billingRecipientCustomerId: 'customer-1',
      billingRecipientCustomerNumber: '1',
      billingRecipientCustomerType: 'company',
      billingRecipientEmail: '',
      billingRecipientName: 'Synthetic Customer Oy',
      billingRecipientPhone: '',
      billingRecipientPostalCode: '00100',
      billingRecipientStreetAddress: 'Test street 2',
    }),
  });
  await expect(approval.approveDraft({
    actorUserId: 'user-1',
    approvedAt: '2026-07-01T10:00:00.000Z',
    auditEventId: 'rounding-standard-approved',
    companyId: 'company-1',
    draftId: 'rounding-source-draft',
    invoiceId: 'rounding-source-invoice',
    reverseChargeEligibilityConfirmed: false,
  })).resolves.toMatchObject({ invoiceId: 'rounding-source-invoice', sequenceNumber: 2 });
  await expect(approval.markApprovedInvoiceSent({
    actorUserId: 'user-1',
    auditEventId: 'rounding-standard-sent',
    companyId: 'company-1',
    invoiceId: 'rounding-source-invoice',
    markedSentAt: '2026-07-01T11:00:00.000Z',
  })).resolves.toEqual({ invoiceId: 'rounding-source-invoice', status: 'sent' });
  const source = await new SqliteApprovedInvoiceReader(database)
    .getApprovedInvoiceById('company-1', 'rounding-source-invoice');
  if (source === undefined) {
    throw new Error('Standard rounding snapshot is missing.');
  }
  return source;
}

async function persistRoundingCreditDraft(
  database: DatabaseConnection,
  source: ApprovedInvoiceView,
  draftId: string,
) {
  const repository = new SqliteInvoiceCreditDraftRepository(database);
  const previous = await repository.listPreviousCreditLineAllocations('company-1', source.id);
  const draft = {
    ...createInitialCreditDraft(source, previous, '2026-07-23T10:00:00.000Z'),
    id: draftId,
  };
  await expect(repository.createCreditDraft({
    actorUserId: 'user-1',
    auditEventId: `${draftId}-created`,
    draft,
    sourceInvoiceId: source.id,
  })).resolves.toEqual({ outcome: 'created', draftId });
  const storedDraft = await new SqliteInvoiceDraftRepository(database)
    .getDraftById('company-1', draftId);
  if (storedDraft === undefined) {
    throw new Error('Persisted rounding credit draft is missing.');
  }
  expect(storedDraft.totals).toEqual(draft.totals);
  expect(storedDraft.lines.map((line) => ({
    id: line.id,
    sourceInvoiceLineId: line.sourceInvoiceLineId,
    quantityHundredths: line.quantityHundredths,
  }))).toEqual(draft.lines.map((line) => ({
    id: line.id,
    sourceInvoiceLineId: line.sourceInvoiceLineId,
    quantityHundredths: line.quantityHundredths,
  })));
  return storedDraft;
}

function readRoundingApprovalState(database: DatabaseConnection, draftId: string) {
  return {
    invoices: database.prepare('SELECT * FROM invoices ORDER BY id').all(),
    lines: database.prepare('SELECT * FROM invoice_lines ORDER BY id').all(),
    audits: database.prepare('SELECT * FROM invoice_audit_events ORDER BY id').all(),
    sequences: database.prepare('SELECT * FROM invoice_number_sequences ORDER BY company_id, series_key, sequence_scope').all(),
    draft: database.prepare('SELECT * FROM invoice_drafts WHERE id = ?').get(draftId),
    draftLines: database.prepare('SELECT * FROM invoice_draft_lines WHERE invoice_draft_id = ? ORDER BY position').all(draftId),
  };
}

function createInput(): ApproveCreditInvoiceDraftPersistenceInput {
  return {
    actorUserId: 'user-1',
    approvedAt: '2026-07-23T12:00:00.000Z',
    auditEventId: 'audit-credit-approval-1',
    companyId: 'company-1',
    draftId: 'credit-draft-1',
    invoiceId: 'credit-invoice-1',
  };
}

function insertFixture(database: DatabaseConnection): void {
  database
    .prepare(
      `
        INSERT INTO invoice_numbering_settings (
          company_id,
          series_key,
          mode,
          fiscal_year_start_month,
          sequence_padding,
          first_sequence_number,
          created_at,
          updated_at
        )
        VALUES (
          'company-1',
          'default',
          'calendarYearSequence',
          1,
          4,
          1,
          '2026-01-01T00:00:00.000Z',
          '2026-01-01T00:00:00.000Z'
        )
      `,
    )
    .run();
  database
    .prepare(
      `
        INSERT INTO invoice_numbering_active_series (
          company_id,
          active_series_key,
          revision,
          updated_at,
          updated_by
        )
        VALUES (
          'company-1',
          'default',
          1,
          '2026-01-01T00:00:00.000Z',
          'user-1'
        )
      `,
    )
    .run();
  database
    .prepare(
      `
        INSERT INTO invoice_number_sequences (
          company_id,
          series_key,
          sequence_scope,
          last_sequence_number,
          created_at,
          updated_at
        )
        VALUES (
          'company-1',
          'default',
          'calendar-year:2026',
          1,
          '2026-01-01T00:00:00.000Z',
          '2026-07-01T00:00:00.000Z'
        )
      `,
    )
    .run();
  insertDraft(database, 'source-draft-1', 'standard', null, 100);
  database
    .prepare(
      `
        INSERT INTO invoices (
          id,
          company_id,
          source_draft_id,
          invoice_number,
          reference_number,
          reference_number_type,
          series_key,
          sequence_scope,
          sequence_number,
          numbering_mode,
          status,
          customer_id,
          customer_name_snapshot,
          invoice_date,
          due_date,
          payment_term_days,
          price_input_mode,
          total_net_cents,
          total_vat_cents,
          total_gross_cents,
          created_at,
          approved_at,
          updated_at
        )
        VALUES (
          'source-invoice-1',
          'company-1',
          'source-draft-1',
          '20260001',
          '202600017',
          'finnishDomestic',
          'default',
          'calendar-year:2026',
          1,
          'calendarYearSequence',
          'sent',
          'customer-1',
          'Snapshot Customer Oy',
          '2026-07-01',
          '2026-07-15',
          14,
          'net',
          10000,
          2550,
          12550,
          '2026-07-01T10:00:00.000Z',
          '2026-07-01T10:00:00.000Z',
          '2026-07-01T10:00:00.000Z'
        )
      `,
    )
    .run();
  database
    .prepare(
      `
        INSERT INTO invoice_lines (
          id,
          invoice_id,
          line_order,
          code,
          description,
          quantity_hundredths,
          unit,
          unit_price_cents,
          vat_rate_basis_points,
          discount_type,
          discount_value,
          base_cents,
          discount_cents,
          net_cents,
          vat_cents,
          gross_cents,
          created_at
        )
        VALUES (
          'source-line-1',
          'source-invoice-1',
          1,
          'WORK',
          'Source work',
          100,
          'h',
          10000,
          2550,
          'none',
          0,
          10000,
          0,
          10000,
          2550,
          12550,
          '2026-07-01T10:00:00.000Z'
        )
      `,
    )
    .run();
  insertDraft(database, 'credit-draft-1', 'credit', 'source-invoice-1', 50);
  database
    .prepare(
      `
        INSERT INTO invoice_draft_lines (
          id,
          invoice_draft_id,
          source_invoice_line_id,
          position,
          code,
          description,
          quantity_hundredths,
          unit,
          unit_price_cents,
          vat_rate_basis_points,
          discount_type,
          discount_value,
          base_cents,
          discount_cents,
          net_cents,
          vat_cents,
          gross_cents
        )
        VALUES (
          'credit-draft-line-1',
          'credit-draft-1',
          'source-line-1',
          1,
          'WORK',
          'Partial credit',
          50,
          'h',
          10000,
          2550,
          'none',
          0,
          5000,
          0,
          5000,
          1275,
          6275
        )
      `,
    )
    .run();
}

function insertDraft(
  database: DatabaseConnection,
  id: string,
  invoiceKind: 'credit' | 'standard',
  creditedInvoiceId: string | null,
  quantityHundredths: number,
): void {
  const factor = quantityHundredths / 100;
  database
    .prepare(
      `
        INSERT INTO invoice_drafts (
          id,
          company_id,
          invoice_kind,
          credited_invoice_id,
          customer_id,
          status,
          invoice_date,
          due_date,
          payment_term_days,
          reminder_period_days,
          late_payment_interest_basis_points,
          price_input_mode,
          subject,
          note,
          net_total_cents,
          vat_total_cents,
          gross_total_cents,
          created_at,
          updated_at
        )
        VALUES (
          @id,
          'company-1',
          @invoiceKind,
          @creditedInvoiceId,
          'customer-1',
          'draft',
          '2026-07-23',
          '2026-07-23',
          0,
          0,
          0,
          'net',
          'Credit invoice',
          'Credit note',
          @netTotalCents,
          @vatTotalCents,
          @grossTotalCents,
          '2026-07-23T10:00:00.000Z',
          '2026-07-23T10:00:00.000Z'
        )
      `,
    )
    .run({
      id,
      invoiceKind,
      creditedInvoiceId,
      netTotalCents: Math.round(10_000 * factor),
      vatTotalCents: Math.round(2_550 * factor),
      grossTotalCents: Math.round(12_550 * factor),
    });
}

function insertPreviousCredit(
  database: DatabaseConnection,
  quantityHundredths: number,
): void {
  database
    .prepare(
      "UPDATE invoice_drafts SET credited_invoice_id = NULL WHERE id = 'credit-draft-1'",
    )
    .run();
  insertDraft(
    database,
    'previous-credit-draft',
    'credit',
    'source-invoice-1',
    quantityHundredths,
  );
  database
    .prepare(
      `
        UPDATE invoice_drafts
        SET
          approved_invoice_id = 'previous-credit-invoice',
          approved_at = '2026-07-20T10:00:00.000Z'
        WHERE id = 'previous-credit-draft'
      `,
    )
    .run();
  database
    .prepare(
      `
        INSERT INTO invoices (
          id,
          company_id,
          source_draft_id,
          invoice_kind,
          credited_invoice_id,
          invoice_number,
          series_key,
          sequence_scope,
          sequence_number,
          numbering_mode,
          status,
          customer_id,
          invoice_date,
          due_date,
          payment_term_days,
          price_input_mode,
          total_net_cents,
          total_vat_cents,
          total_gross_cents,
          created_at,
          approved_at,
          updated_at
        )
        VALUES (
          'previous-credit-invoice',
          'company-1',
          'previous-credit-draft',
          'credit',
          'source-invoice-1',
          '20260002',
          'default',
          'calendar-year:2026',
          2,
          'calendarYearSequence',
          'sent',
          'customer-1',
          '2026-07-20',
          '2026-07-20',
          0,
          'net',
          6000,
          1530,
          7530,
          '2026-07-20T10:00:00.000Z',
          '2026-07-20T10:00:00.000Z',
          '2026-07-20T10:00:00.000Z'
        )
      `,
    )
    .run();
  database
    .prepare(
      `
        INSERT INTO invoice_lines (
          id,
          invoice_id,
          source_invoice_line_id,
          line_order,
          description,
          quantity_hundredths,
          unit,
          unit_price_cents,
          vat_rate_basis_points,
          discount_type,
          discount_value,
          base_cents,
          discount_cents,
          net_cents,
          vat_cents,
          gross_cents,
          created_at
        )
        VALUES (
          'previous-credit-line',
          'previous-credit-invoice',
          'source-line-1',
          1,
          'Previous credit',
          @quantityHundredths,
          'h',
          10000,
          2550,
          'none',
          0,
          6000,
          0,
          6000,
          1530,
          7530,
          '2026-07-20T10:00:00.000Z'
        )
      `,
    )
    .run({ quantityHundredths });
  database
    .prepare(
      `
        UPDATE invoice_drafts
        SET credited_invoice_id = 'source-invoice-1'
        WHERE id = 'credit-draft-1'
      `,
    )
    .run();
}

function replaceDraftLineWithManualCredit(
  database: DatabaseConnection,
): void {
  database
    .prepare(
      `
        DELETE FROM invoice_draft_lines
        WHERE invoice_draft_id = 'credit-draft-1'
      `,
    )
    .run();
  database
    .prepare(
      `
        INSERT INTO invoice_draft_lines (
          id,
          invoice_draft_id,
          source_invoice_line_id,
          position,
          code,
          description,
          quantity_hundredths,
          unit,
          unit_price_cents,
          vat_rate_basis_points,
          discount_type,
          discount_value,
          base_cents,
          discount_cents,
          net_cents,
          vat_cents,
          gross_cents
        )
        VALUES (
          'manual-credit-draft-line',
          'credit-draft-1',
          NULL,
          1,
          '',
          'Manual customer credit',
          100,
          'kpl',
          2500,
          2550,
          'none',
          0,
          1,
          0,
          1,
          0,
          1
        )
      `,
    )
    .run();
}

function convertFixtureToReverseCharge(database: DatabaseConnection): void {
  database.transaction(() => {
    database
      .prepare(
        `
          DELETE FROM invoice_draft_lines
          WHERE invoice_draft_id = 'credit-draft-1'
        `,
      )
      .run();
    database
      .prepare(
        `
          DELETE FROM invoice_lines
          WHERE invoice_id = 'source-invoice-1'
        `,
      )
      .run();
    database
      .prepare(
        `
          UPDATE invoices
          SET
            tax_treatment = 'reverseChargeConstruction',
            tax_treatment_label_snapshot = 'Käännetty verovelvollisuus',
            tax_legal_basis_snapshot = 'AVL 8 c §',
            performance_date = '2026-07-01',
            total_vat_cents = 0,
            total_gross_cents = total_net_cents
          WHERE id = 'source-invoice-1'
        `,
      )
      .run();
    database
      .prepare(
        `
          UPDATE invoice_drafts
          SET
            tax_treatment = 'reverseChargeConstruction',
            performance_date = '2026-07-01',
            vat_total_cents = 0,
            gross_total_cents = net_total_cents
          WHERE id = 'credit-draft-1'
        `,
      )
      .run();
    database
      .prepare(
        `
          INSERT INTO invoice_lines (
            id,
            invoice_id,
            line_order,
            code,
            description,
            quantity_hundredths,
            unit,
            unit_price_cents,
            vat_rate_basis_points,
            discount_type,
            discount_value,
            base_cents,
            discount_cents,
            net_cents,
            vat_cents,
            gross_cents,
            created_at
          )
          VALUES (
            'source-line-1',
            'source-invoice-1',
            1,
            'WORK',
            'Source work',
            100,
            'h',
            10000,
            NULL,
            'none',
            0,
            10000,
            0,
            10000,
            0,
            10000,
            '2026-07-01T10:00:00.000Z'
          )
        `,
      )
      .run();
    database
      .prepare(
        `
          INSERT INTO invoice_draft_lines (
            id,
            invoice_draft_id,
            source_invoice_line_id,
            position,
            code,
            description,
            quantity_hundredths,
            unit,
            unit_price_cents,
            vat_rate_basis_points,
            discount_type,
            discount_value,
            base_cents,
            discount_cents,
            net_cents,
            vat_cents,
            gross_cents
          )
          VALUES (
            'credit-draft-line-1',
            'credit-draft-1',
            'source-line-1',
            1,
            'WORK',
            'Partial credit',
            50,
            'h',
            10000,
            NULL,
            'none',
            0,
            5000,
            0,
            5000,
            0,
            5000
          )
        `,
      )
      .run();
  })();
}

function getCreditInvoice(database: DatabaseConnection) {
  return database
    .prepare("SELECT * FROM invoices WHERE id = 'credit-invoice-1'")
    .get();
}

function getCreditLine(database: DatabaseConnection) {
  return database
    .prepare(
      "SELECT * FROM invoice_lines WHERE invoice_id = 'credit-invoice-1'",
    )
    .get();
}

function getAudit(database: DatabaseConnection) {
  return database
    .prepare(
      "SELECT * FROM invoice_audit_events WHERE action = 'invoice.credit_approved'",
    )
    .get();
}

function getCreditDraft(database: DatabaseConnection) {
  return database
    .prepare(
      `
        SELECT approved_invoice_id, approved_at
        FROM invoice_drafts
        WHERE id = 'credit-draft-1'
      `,
    )
    .get() as
    | { approved_at: string | null; approved_invoice_id: string | null }
    | undefined;
}

function getSequence(database: DatabaseConnection) {
  return database
    .prepare(
      `
        SELECT last_sequence_number
        FROM invoice_number_sequences
        WHERE
          company_id = 'company-1'
          AND series_key = 'default'
          AND sequence_scope = 'calendar-year:2026'
      `,
    )
    .get() as { last_sequence_number: number } | undefined;
}
