import type { DatabaseConnection } from '../../../database/connection/createDatabaseConnection.js';
import { runMigrations } from '../../../database/migration/runMigrations.js';
import type { InvoiceTable } from '../../../database/schema.js';
import { calculateInvoiceLine } from '../domain/calculateInvoiceLine.js';
import { calculateInvoiceTotals } from '../domain/calculateInvoiceTotals.js';
import { calculateReverseChargeInvoice } from '../domain/calculateReverseChargeInvoice.js';
import type { InvoiceLineCalculationInput } from '../domain/invoiceCalculation.js';
import type { InvoiceDraft, InvoiceDraftLine } from '../domain/invoiceDraft.js';
import type { ApproveInvoiceDraftPersistenceInput } from '../ports/invoiceApprovalRepository.js';
import type {
  InvoiceApprovalSnapshotData,
  InvoiceApprovalSnapshotRequest,
} from '../ports/invoiceApprovalSnapshotReader.js';
import { SqliteInvoiceApprovalRepository } from './sqliteInvoiceApprovalRepository.js';
import { SqliteInvoiceDraftRepository } from './sqliteInvoiceDraftRepository.js';

// Independent contract list: do not derive expected fields from the mapper.
export const approvalContentFields = [
  'source_draft_id', 'invoice_kind', 'credited_invoice_id', 'invoice_number',
  'reference_number', 'reference_number_type', 'series_key', 'sequence_scope',
  'sequence_number', 'numbering_mode', 'customer_id',
  'customer_number_snapshot', 'customer_name_snapshot',
  'customer_business_id_snapshot', 'customer_type_snapshot',
  'customer_email_snapshot', 'customer_phone_snapshot',
  'customer_street_address_snapshot', 'customer_postal_code_snapshot',
  'customer_city_snapshot', 'company_name_snapshot',
  'company_business_id_snapshot', 'company_vat_number_snapshot',
  'company_street_address_snapshot', 'company_postal_code_snapshot',
  'company_city_snapshot', 'company_email_snapshot', 'company_phone_snapshot',
  'company_website_snapshot', 'company_iban_snapshot', 'company_bic_snapshot',
  'company_bank_name_snapshot', 'billing_recipient_customer_id',
  'billing_recipient_customer_number_snapshot', 'billing_recipient_name_snapshot',
  'billing_recipient_business_id_snapshot',
  'billing_recipient_customer_type_snapshot', 'billing_recipient_email_snapshot',
  'billing_recipient_phone_snapshot', 'billing_recipient_street_address_snapshot',
  'billing_recipient_postal_code_snapshot', 'billing_recipient_city_snapshot',
  'invoice_date', 'due_date', 'payment_term_days', 'reminder_period_days',
  'late_payment_interest_basis_points', 'price_input_mode', 'subject',
  'order_number', 'note', 'delivery_address_text', 'refund_iban_snapshot',
  'tax_treatment', 'tax_treatment_label_snapshot', 'tax_legal_basis_snapshot',
  'performance_date', 'performance_period_start', 'performance_period_end',
  'total_net_cents', 'total_vat_cents', 'total_gross_cents', 'created_at',
  'approved_at',
] as const satisfies readonly (keyof InvoiceTable)[];

export const liveInvoiceFields = [
  'status', 'updated_at', 'cancelled_at', 'cancelled_by', 'cancellation_reason',
  'payment_state', 'paid_on', 'paid_amount_cents', 'payment_source',
  'payment_recorded_at', 'payment_recorded_by',
] as const satisfies readonly (keyof InvoiceTable)[];

export function createRevisionLine(
  id: string,
  position: number,
  overrides: Partial<InvoiceLineCalculationInput> = {},
): InvoiceDraftLine {
  const input: InvoiceLineCalculationInput = {
    quantityHundredths: 125,
    unitPriceCents: 1234,
    vatRateBasisPoints: 2550,
    priceInputMode: 'net',
    discount: { type: 'none' },
    ...overrides,
  };
  return {
    ...calculateInvoiceLine(input),
    id,
    position,
    sourceInvoiceLineId: null,
    code: `CODE-${position}`,
    description: `Synthetic service ${position}`,
    unit: 'h',
    discount: input.discount,
  };
}

export function createRevisionDraft(
  overrides: Partial<Omit<InvoiceDraft, 'lines' | 'totals'>> = {},
  lines = [
    createRevisionLine('revision-line-1', 1),
    createRevisionLine('revision-line-2', 2, {
      unitPriceCents: 4321,
      vatRateBasisPoints: 1350,
      discount: { type: 'percentage', basisPoints: 725 },
    }),
    createRevisionLine('revision-line-3', 3, {
      quantityHundredths: 200,
      unitPriceCents: 985,
      vatRateBasisPoints: 1000,
      discount: { type: 'fixed', amountCents: 127 },
    }),
  ],
): InvoiceDraft {
  return {
    id: 'revision-draft',
    companyId: 'revision-company',
    invoiceKind: 'standard',
    creditedInvoiceId: null,
    customerId: 'revision-customer',
    billingRecipientCustomerId: 'revision-recipient',
    status: 'draft',
    invoiceDate: '2027-01-15',
    dueDate: '2027-01-29',
    paymentTermDays: 14,
    reminderPeriodDays: 8,
    latePaymentInterestBasisPoints: 950,
    priceInputMode: 'net',
    taxTreatment: 'normalVat',
    performancePeriod: { type: 'singleDate', date: '2027-01-14' },
    subject: 'Synthetic revision invoice',
    orderNumber: 'SYNTHETIC-42',
    note: "Customer's synthetic note\nSecond line",
    deliveryAddressText: 'Synthetic site 42',
    refundIban: '',
    createdAt: '2027-01-15T08:00:00.000Z',
    updatedAt: '2027-01-15T09:00:00.000Z',
    ...overrides,
    lines,
    totals: calculateInvoiceTotals(lines.map((line) => {
      if (line.vatRateBasisPoints === null) {
        throw new Error('Normal revision fixture requires a VAT rate.');
      }
      return { ...line, vatRateBasisPoints: line.vatRateBasisPoints };
    })),
  };
}

export function createReverseChargeRevisionDraft(): InvoiceDraft {
  const discount = { type: 'percentage', basisPoints: 725 } as const;
  const calculated = calculateReverseChargeInvoice([{
    quantityHundredths: 125,
    unitPriceCents: 1234,
    priceInputMode: 'net',
    discount,
  }]);
  return {
    ...createRevisionDraft(),
    taxTreatment: 'reverseChargeConstruction',
    performancePeriod: {
      type: 'dateRange', startDate: '2027-01-01', endDate: '2027-01-14',
    },
    lines: calculated.lines.map((line, index) => ({
      ...line,
      id: `reverse-line-${index + 1}`,
      position: index + 1,
      sourceInvoiceLineId: null,
      code: 'CONSTRUCTION',
      description: 'Synthetic construction service',
      unit: 'h',
      discount,
    })),
    totals: calculated.totals,
  };
}

export function revisionApprovalInput(
  overrides: Partial<ApproveInvoiceDraftPersistenceInput> = {},
): ApproveInvoiceDraftPersistenceInput {
  return {
    actorUserId: 'revision-actor',
    approvedAt: '2027-01-15T12:00:00.000Z',
    auditEventId: 'revision-approval-audit',
    companyId: 'revision-company',
    draftId: 'revision-draft',
    invoiceId: 'revision-invoice',
    reverseChargeEligibilityConfirmed: false,
    ...overrides,
  };
}

export async function createApprovalRevisionFixture(
  database: DatabaseConnection,
  onSnapshotRead: () => void = () => {},
) {
  database.pragma('foreign_keys = ON');
  await runMigrations(database);
  for (const companyId of ['revision-company', 'foreign-company']) {
    database.prepare(`
      INSERT INTO invoice_numbering_settings (
        company_id, series_key, mode, fiscal_year_start_month,
        sequence_padding, first_sequence_number, created_at, updated_at
      ) VALUES (?, 'default', 'calendarYearSequence', 1, 4, 1, ?, ?)
    `).run(companyId, '2027-01-01T08:00:00.000Z', '2027-01-01T08:00:00.000Z');
    database.prepare(`
      INSERT INTO invoice_numbering_active_series (
        company_id, active_series_key, revision, updated_at, updated_by
      ) VALUES (?, 'default', 1, ?, 'revision-actor')
    `).run(companyId, '2027-01-01T08:00:00.000Z');
  }

  const snapshot: InvoiceApprovalSnapshotData = {
    companyName: 'Synthetic Seller Oy',
    companyBusinessId: '7654321-0',
    companyVatNumber: 'FI76543210',
    companyStreetAddress: 'Seller Street 2',
    companyPostalCode: '33100',
    companyCity: 'Tampere',
    companyEmail: 'seller@example.invalid',
    companyPhone: '03 000 0000',
    companyWebsite: 'https://seller.example.invalid',
    companyIban: 'FI2112345600000785',
    companyBic: 'NDEAFIHH',
    companyBankName: 'Synthetic Bank',
    customerName: 'Synthetic Customer Oy',
    customerNumber: '1001',
    customerBusinessId: '1234567-8',
    customerType: 'company',
    customerEmail: 'customer@example.invalid',
    customerPhone: '040 000 0001',
    customerStreetAddress: 'Customer Street 3',
    customerPostalCode: '00100',
    customerCity: 'Helsinki',
    billingRecipientCustomerId: 'revision-recipient',
    billingRecipientCustomerNumber: '2002',
    billingRecipientName: 'Synthetic Recipient Oy',
    billingRecipientBusinessId: '2345678-9',
    billingRecipientCustomerType: 'housingCompany',
    billingRecipientEmail: 'recipient@example.invalid',
    billingRecipientPhone: '040 000 0002',
    billingRecipientStreetAddress: 'Recipient Street 4',
    billingRecipientPostalCode: '20100',
    billingRecipientCity: 'Turku',
  };
  const snapshotRequests: InvoiceApprovalSnapshotRequest[] = [];
  const repository = new SqliteInvoiceApprovalRepository(database, {
    getSnapshotData(input) {
      onSnapshotRead();
      snapshotRequests.push(input);
      return { ...snapshot };
    },
  });
  return {
    repository,
    drafts: new SqliteInvoiceDraftRepository(database),
    snapshot,
    snapshotRequests,
  };
}

export function readApprovalState(database: DatabaseConnection) {
  // Whole-row reads deliberately detect unexpected writes beyond the assertions.
  const tables = [
    'invoice_numbering_settings', 'invoice_numbering_active_series',
    'invoice_number_sequences', 'invoice_drafts', 'invoice_draft_lines',
    'invoices', 'invoice_lines', 'invoice_audit_events',
    'invoice_content_revisions', 'invoice_revision_lines',
    'invoice_revision_vat_breakdown', 'invoice_current_revisions',
  ] as const;
  return Object.fromEntries(tables.map((table) => [
    table, database.prepare(`SELECT * FROM ${table} ORDER BY 1, 2`).all(),
  ]));
}
