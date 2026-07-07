import type { DatabaseConnection } from '../../../database/connection/createDatabaseConnection.js';
import type { InvoiceLineRow, InvoiceRow } from '../../../database/schema.js';
import type { ApprovedInvoiceSummary } from '../domain/approvedInvoiceSummary.js';
import type {
  ApprovedInvoiceVatBreakdown,
  ApprovedInvoiceView,
  ApprovedInvoiceViewLine,
} from '../domain/approvedInvoiceView.js';
import type { InvoiceLineDiscount } from '../domain/invoiceCalculation.js';
import type { InvoiceUnit } from '../domain/invoiceDraft.js';
import type { InvoiceNumberingMode } from '../domain/invoiceNumbering.js';
import type { ReferenceNumberType } from '../domain/invoiceReferenceNumber.js';
import type { ApprovedInvoiceReader } from '../ports/approvedInvoiceReader.js';

type ApprovedInvoiceKeyParameters = [string, string];
type ApprovedInvoiceLineParameters = [string];
type ApprovedInvoiceListParameters = [string];

export class SqliteApprovedInvoiceReader implements ApprovedInvoiceReader {
  constructor(private readonly database: DatabaseConnection) {}

  async getApprovedInvoiceById(
    companyId: string,
    invoiceId: string,
  ): Promise<ApprovedInvoiceView | undefined> {
    const invoice = this.getInvoiceRow(companyId, invoiceId);

    if (invoice === undefined) {
      return undefined;
    }

    const lines = this.getInvoiceLines(invoice.id);
    const vatBreakdown = createVatBreakdown(lines);

    return toApprovedInvoiceView(invoice, lines, vatBreakdown);
  }

  async listApprovedInvoiceSummaries(
    companyId: string,
  ): Promise<ApprovedInvoiceSummary[]> {
    return this.database
      .prepare<ApprovedInvoiceListParameters, InvoiceRow>(
        `
          SELECT *
          FROM invoices
          WHERE
            company_id = ?
            AND status = 'approved'
          ORDER BY approved_at DESC, id DESC
        `,
      )
      .all(companyId)
      .map(toApprovedInvoiceSummary);
  }

  private getInvoiceRow(
    companyId: string,
    invoiceId: string,
  ): InvoiceRow | undefined {
    return this.database
      .prepare<ApprovedInvoiceKeyParameters, InvoiceRow>(
        `
          SELECT *
          FROM invoices
          WHERE
            company_id = ?
            AND id = ?
            AND status = 'approved'
        `,
      )
      .get(companyId, invoiceId);
  }

  private getInvoiceLines(invoiceId: string): InvoiceLineRow[] {
    return this.database
      .prepare<ApprovedInvoiceLineParameters, InvoiceLineRow>(
        `
          SELECT *
          FROM invoice_lines
          WHERE invoice_id = ?
          ORDER BY line_order
        `,
      )
      .all(invoiceId);
  }
}

function toApprovedInvoiceSummary(invoice: InvoiceRow): ApprovedInvoiceSummary {
  return {
    id: invoice.id,
    invoiceNumber: invoice.invoice_number,
    referenceNumber: invoice.reference_number ?? '',
    status: 'approved',
    customerId: invoice.customer_id,
    customerNumberSnapshot: invoice.customer_number_snapshot,
    customerNameSnapshot: invoice.customer_name_snapshot,
    billingRecipientNameSnapshot: invoice.billing_recipient_name_snapshot,
    invoiceDate: invoice.invoice_date,
    dueDate: invoice.due_date,
    grossTotalCents: invoice.total_gross_cents,
    approvedAt: invoice.approved_at,
    updatedAt: invoice.updated_at,
  };
}

function toApprovedInvoiceView(
  invoice: InvoiceRow,
  lines: InvoiceLineRow[],
  vatBreakdown: ApprovedInvoiceVatBreakdown[],
): ApprovedInvoiceView {
  return {
    id: invoice.id,
    companyId: invoice.company_id,
    sourceDraftId: invoice.source_draft_id,
    invoiceNumber: invoice.invoice_number,
    referenceNumber: invoice.reference_number ?? '',
    referenceNumberType:
      (invoice.reference_number_type ?? 'finnishDomestic') as ReferenceNumberType,
    seriesKey: invoice.series_key,
    sequenceScope: invoice.sequence_scope,
    sequenceNumber: invoice.sequence_number,
    numberingMode: invoice.numbering_mode as InvoiceNumberingMode,
    status: 'approved',
    customerId: invoice.customer_id,
    customerNumberSnapshot: invoice.customer_number_snapshot,
    customerNameSnapshot: invoice.customer_name_snapshot,
    customerBusinessIdSnapshot: invoice.customer_business_id_snapshot,
    customerTypeSnapshot: invoice.customer_type_snapshot,
    customerEmailSnapshot: invoice.customer_email_snapshot,
    customerPhoneSnapshot: invoice.customer_phone_snapshot,
    customerStreetAddressSnapshot: invoice.customer_street_address_snapshot,
    customerPostalCodeSnapshot: invoice.customer_postal_code_snapshot,
    customerCitySnapshot: invoice.customer_city_snapshot,
    companyNameSnapshot: invoice.company_name_snapshot,
    companyBusinessIdSnapshot: invoice.company_business_id_snapshot,
    companyVatNumberSnapshot: invoice.company_vat_number_snapshot,
    companyStreetAddressSnapshot: invoice.company_street_address_snapshot,
    companyPostalCodeSnapshot: invoice.company_postal_code_snapshot,
    companyCitySnapshot: invoice.company_city_snapshot,
    companyEmailSnapshot: invoice.company_email_snapshot,
    companyPhoneSnapshot: invoice.company_phone_snapshot,
    companyWebsiteSnapshot: invoice.company_website_snapshot,
    companyIbanSnapshot: invoice.company_iban_snapshot,
    companyBicSnapshot: invoice.company_bic_snapshot,
    companyBankNameSnapshot: invoice.company_bank_name_snapshot,
    billingRecipientCustomerId: invoice.billing_recipient_customer_id,
    billingRecipientCustomerNumberSnapshot:
      invoice.billing_recipient_customer_number_snapshot,
    billingRecipientNameSnapshot: invoice.billing_recipient_name_snapshot,
    billingRecipientBusinessIdSnapshot:
      invoice.billing_recipient_business_id_snapshot,
    billingRecipientCustomerTypeSnapshot:
      invoice.billing_recipient_customer_type_snapshot,
    billingRecipientEmailSnapshot: invoice.billing_recipient_email_snapshot,
    billingRecipientPhoneSnapshot: invoice.billing_recipient_phone_snapshot,
    billingRecipientStreetAddressSnapshot:
      invoice.billing_recipient_street_address_snapshot,
    billingRecipientPostalCodeSnapshot:
      invoice.billing_recipient_postal_code_snapshot,
    billingRecipientCitySnapshot: invoice.billing_recipient_city_snapshot,
    invoiceDate: invoice.invoice_date,
    dueDate: invoice.due_date,
    paymentTermDays: invoice.payment_term_days,
    reminderPeriodDays: invoice.reminder_period_days,
    latePaymentInterestBasisPoints: invoice.late_payment_interest_basis_points,
    priceInputMode: invoice.price_input_mode as 'net' | 'gross',
    subject: invoice.subject,
    orderNumber: invoice.order_number,
    note: invoice.note,
    deliveryAddressText: invoice.delivery_address_text,
    lines: lines.map(toApprovedInvoiceViewLine),
    totals: {
      netTotalCents: invoice.total_net_cents,
      vatTotalCents: invoice.total_vat_cents,
      grossTotalCents: invoice.total_gross_cents,
      vatBreakdown,
    },
    vatBreakdown,
    createdAt: invoice.created_at,
    approvedAt: invoice.approved_at,
    updatedAt: invoice.updated_at,
  };
}

function toApprovedInvoiceViewLine(line: InvoiceLineRow): ApprovedInvoiceViewLine {
  return {
    id: line.id,
    lineOrder: line.line_order,
    code: line.code,
    description: line.description,
    quantityHundredths: line.quantity_hundredths,
    unit: line.unit as InvoiceUnit,
    unitPriceCents: line.unit_price_cents,
    vatRateBasisPoints: line.vat_rate_basis_points,
    discount: toDiscount(line),
    baseCents: line.base_cents,
    discountCents: line.discount_cents,
    netCents: line.net_cents,
    vatCents: line.vat_cents,
    grossCents: line.gross_cents,
  };
}

function toDiscount(line: InvoiceLineRow): InvoiceLineDiscount {
  if (line.discount_type === 'none') {
    return { type: 'none' };
  }

  if (line.discount_type === 'percentage') {
    return { type: 'percentage', basisPoints: line.discount_value };
  }

  if (line.discount_type === 'fixed') {
    return { type: 'fixed', amountCents: line.discount_value };
  }

  throw new Error('Stored invoice line discount type is invalid.');
}

function createVatBreakdown(
  lines: InvoiceLineRow[],
): ApprovedInvoiceVatBreakdown[] {
  const breakdownByRate = new Map<number, ApprovedInvoiceVatBreakdown>();

  for (const line of lines) {
    const current = breakdownByRate.get(line.vat_rate_basis_points) ?? {
      vatRateBasisPoints: line.vat_rate_basis_points,
      netCents: 0,
      vatCents: 0,
      grossCents: 0,
    };

    breakdownByRate.set(line.vat_rate_basis_points, {
      vatRateBasisPoints: line.vat_rate_basis_points,
      netCents: current.netCents + line.net_cents,
      vatCents: current.vatCents + line.vat_cents,
      grossCents: current.grossCents + line.gross_cents,
    });
  }

  return [...breakdownByRate.values()].sort(
    (first, second) => first.vatRateBasisPoints - second.vatRateBasisPoints,
  );
}
