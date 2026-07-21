import type {
  InvoiceDraftLineTable,
  InvoiceDraftTable,
  InvoiceRow,
  NewInvoiceAuditEventRow,
  NewInvoiceLineRow,
  NewInvoiceRow,
} from '../../../database/schema.js';
import { ApproveInvoiceDraftError } from '../application/approveInvoiceDraftError.js';
import type { InvoiceAuditAction } from '../domain/approvedInvoice.js';
import { calculateInvoiceTotals } from '../domain/calculateInvoiceTotals.js';
import type { InvoiceTotals, PriceInputMode } from '../domain/invoiceCalculation.js';
import type {
  InvoiceNumberingMode,
  StoredInvoiceNumberingSettings,
} from '../domain/invoiceNumbering.js';
import type { ReferenceNumberType } from '../domain/invoiceReferenceNumber.js';
import type {
  ApproveInvoiceDraftPersistenceInput,
} from '../ports/invoiceApprovalRepository.js';
import type { InvoiceApprovalSnapshotData } from '../ports/invoiceApprovalSnapshotReader.js';

interface InvoiceAuditEventSource {
  actorUserId: string;
  auditEventId: string;
  companyId: string;
  draftId: string;
  invoiceId: string;
}

export interface InvoiceNumberingSettingsRow {
  mode: string;
  fiscal_year_start_month: number;
  sequence_padding: number;
  first_sequence_number: number;
  created_at: string;
  updated_at: string;
}

export interface InvoiceNumberSequenceRow {
  last_sequence_number: number;
  created_at: string;
  updated_at: string;
}

interface StoredDiscount {
  type: 'fixed' | 'none' | 'percentage';
  value: number;
}

function toStoredDiscount(
  discountType: string,
  discountValue: number,
): StoredDiscount {
  if (discountType === 'none') {
    return { type: 'none', value: 0 };
  }

  if (discountType === 'percentage') {
    return { type: 'percentage', value: discountValue };
  }

  if (discountType === 'fixed') {
    return { type: 'fixed', value: discountValue };
  }

  throw new ApproveInvoiceDraftError(
    'Stored invoice draft discount type is invalid.',
  );
}

export function toNumberingSettings(
  companyId: string,
  seriesKey: string,
  row: InvoiceNumberingSettingsRow,
): StoredInvoiceNumberingSettings {
  return {
    companyId,
    seriesKey,
    mode: row.mode as InvoiceNumberingMode,
    fiscalYearStartMonth: row.fiscal_year_start_month,
    sequencePadding: row.sequence_padding,
    firstSequenceNumber: row.first_sequence_number,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createInvoiceRow(
  input: ApproveInvoiceDraftPersistenceInput,
  draft: InvoiceDraftTable,
  totals: InvoiceTotals,
  settings: StoredInvoiceNumberingSettings,
  sequenceScope: string,
  sequenceNumber: number,
  invoiceNumber: string,
  referenceNumber: string,
  referenceNumberType: ReferenceNumberType,
  snapshot: InvoiceApprovalSnapshotData,
): NewInvoiceRow {
  return {
    id: input.invoiceId,
    company_id: input.companyId,
    source_draft_id: input.draftId,
    invoice_number: invoiceNumber,
    reference_number: referenceNumber,
    reference_number_type: referenceNumberType,
    series_key: input.seriesKey,
    sequence_scope: sequenceScope,
    sequence_number: sequenceNumber,
    numbering_mode: settings.mode,
    status: 'approved',
    customer_id: draft.customer_id,
    customer_number_snapshot: snapshot.customerNumber,
    customer_name_snapshot: snapshot.customerName,
    customer_business_id_snapshot: snapshot.customerBusinessId,
    customer_type_snapshot: snapshot.customerType,
    customer_email_snapshot: snapshot.customerEmail,
    customer_phone_snapshot: snapshot.customerPhone,
    customer_street_address_snapshot: snapshot.customerStreetAddress,
    customer_postal_code_snapshot: snapshot.customerPostalCode,
    customer_city_snapshot: snapshot.customerCity,
    company_name_snapshot: snapshot.companyName,
    company_business_id_snapshot: snapshot.companyBusinessId,
    company_vat_number_snapshot: snapshot.companyVatNumber,
    company_street_address_snapshot: snapshot.companyStreetAddress,
    company_postal_code_snapshot: snapshot.companyPostalCode,
    company_city_snapshot: snapshot.companyCity,
    company_email_snapshot: snapshot.companyEmail,
    company_phone_snapshot: snapshot.companyPhone,
    company_website_snapshot: snapshot.companyWebsite,
    company_iban_snapshot: snapshot.companyIban,
    company_bic_snapshot: snapshot.companyBic,
    company_bank_name_snapshot: snapshot.companyBankName,
    billing_recipient_customer_id: snapshot.billingRecipientCustomerId,
    billing_recipient_customer_number_snapshot:
      snapshot.billingRecipientCustomerNumber,
    billing_recipient_name_snapshot: snapshot.billingRecipientName,
    billing_recipient_business_id_snapshot: snapshot.billingRecipientBusinessId,
    billing_recipient_customer_type_snapshot:
      snapshot.billingRecipientCustomerType,
    billing_recipient_email_snapshot: snapshot.billingRecipientEmail,
    billing_recipient_phone_snapshot: snapshot.billingRecipientPhone,
    billing_recipient_street_address_snapshot:
      snapshot.billingRecipientStreetAddress,
    billing_recipient_postal_code_snapshot: snapshot.billingRecipientPostalCode,
    billing_recipient_city_snapshot: snapshot.billingRecipientCity,
    invoice_date: draft.invoice_date,
    due_date: draft.due_date,
    payment_term_days: draft.payment_term_days,
    reminder_period_days: draft.reminder_period_days,
    late_payment_interest_basis_points: draft.late_payment_interest_basis_points,
    price_input_mode: draft.price_input_mode,
    subject: draft.subject,
    order_number: draft.order_number,
    note: draft.note,
    delivery_address_text: draft.delivery_address_text,
    total_net_cents: totals.netTotalCents,
    total_vat_cents: totals.vatTotalCents,
    total_gross_cents: totals.grossTotalCents,
    created_at: input.approvedAt,
    approved_at: input.approvedAt,
    updated_at: input.approvedAt,
  };
}

export function createReapprovedInvoiceRow(
  input: ApproveInvoiceDraftPersistenceInput,
  draft: InvoiceDraftTable,
  totals: InvoiceTotals,
  existingInvoice: InvoiceRow,
  snapshot: InvoiceApprovalSnapshotData,
): NewInvoiceRow {
  return {
    ...createInvoiceRow(
      {
        ...input,
        invoiceId: existingInvoice.id,
      },
      draft,
      totals,
      {
        companyId: existingInvoice.company_id,
        createdAt: existingInvoice.created_at,
        fiscalYearStartMonth: 1,
        firstSequenceNumber: existingInvoice.sequence_number,
        mode: existingInvoice.numbering_mode as InvoiceNumberingMode,
        sequencePadding: 0,
        seriesKey: existingInvoice.series_key,
        updatedAt: existingInvoice.updated_at,
      },
      existingInvoice.sequence_scope,
      existingInvoice.sequence_number,
      existingInvoice.invoice_number,
      existingInvoice.reference_number ?? '',
      (existingInvoice.reference_number_type ??
        'finnishDomestic') as ReferenceNumberType,
      snapshot,
    ),
    created_at: existingInvoice.created_at,
  };
}

export function createInvoiceLineRows(
  input: ApproveInvoiceDraftPersistenceInput,
  lines: InvoiceDraftLineTable[],
): NewInvoiceLineRow[] {
  return lines.map((line) => {
    const discount = toStoredDiscount(line.discount_type, line.discount_value);

    return {
      id: line.id,
      invoice_id: input.invoiceId,
      line_order: line.position,
      code: line.code,
      description: line.description,
      quantity_hundredths: line.quantity_hundredths,
      unit: line.unit,
      unit_price_cents: line.unit_price_cents,
      vat_rate_basis_points: line.vat_rate_basis_points,
      discount_type: discount.type,
      discount_value: discount.value,
      base_cents: line.base_cents,
      discount_cents: line.discount_cents,
      net_cents: line.net_cents,
      vat_cents: line.vat_cents,
      gross_cents: line.gross_cents,
      created_at: input.approvedAt,
    };
  });
}

export function calculateStoredDraftTotals(
  draft: InvoiceDraftTable,
  lines: InvoiceDraftLineTable[],
): InvoiceTotals {
  const priceInputMode = draft.price_input_mode as PriceInputMode;

  return calculateInvoiceTotals(
    lines.map((line) => ({
      quantityHundredths: line.quantity_hundredths,
      unitPriceCents: line.unit_price_cents,
      vatRateBasisPoints: line.vat_rate_basis_points,
      priceInputMode,
      baseCents: line.base_cents,
      discountCents: line.discount_cents,
      netCents: line.net_cents,
      vatCents: line.vat_cents,
      grossCents: line.gross_cents,
    })),
  );
}

export function createAuditEventRow(
  input: InvoiceAuditEventSource,
  invoiceNumber: string,
  action: InvoiceAuditAction,
  createdAt: string,
): NewInvoiceAuditEventRow {
  return {
    id: input.auditEventId,
    company_id: input.companyId,
    actor_user_id: input.actorUserId,
    action,
    draft_id: input.draftId,
    invoice_id: input.invoiceId,
    invoice_number: invoiceNumber,
    created_at: createdAt,
  };
}
