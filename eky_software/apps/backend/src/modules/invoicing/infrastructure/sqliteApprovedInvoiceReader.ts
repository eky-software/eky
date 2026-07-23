import type { DatabaseConnection } from '../../../database/connection/createDatabaseConnection.js';
import type { InvoiceLineRow, InvoiceRow } from '../../../database/schema.js';
import type {
  ApprovedInvoiceListSort,
  ApprovedInvoiceSummary,
  ApprovedInvoiceSummaryQuery,
  ApprovedInvoiceSummaryResult,
} from '../domain/approvedInvoiceSummary.js';
import type {
  ApprovedInvoiceVatBreakdown,
  ApprovedInvoiceView,
  ApprovedInvoiceViewLine,
} from '../domain/approvedInvoiceView.js';
import type { InvoiceLineDiscount } from '../domain/invoiceCalculation.js';
import type { InvoiceUnit } from '../domain/invoiceDraft.js';
import type { InvoiceCreditContext } from '../domain/invoiceCreditContext.js';
import type { InvoiceKind } from '../domain/invoiceKind.js';
import type { InvoiceNumberingMode } from '../domain/invoiceNumbering.js';
import type { ReferenceNumberType } from '../domain/invoiceReferenceNumber.js';
import type { ApprovedInvoiceReader } from '../ports/approvedInvoiceReader.js';
import type { InvoiceCreditContextReader } from '../ports/invoiceCreditContextReader.js';
import type {
  SentInvoiceGroup,
  SentInvoiceGroupQuery,
  SentInvoiceGroupResult,
} from '../domain/sentInvoiceGroup.js';
import type { SentInvoiceGroupReader } from '../ports/sentInvoiceGroupReader.js';

type ApprovedInvoiceKeyParameters = [string, string];
type ApprovedInvoiceLineParameters = [string];
interface CreditedInvoiceIdentity {
  invoice_number: string;
  invoice_date: string;
}
type ApprovedInvoiceListFilterParameters = [
  string,
  string,
  string | null,
  string | null,
  string | null,
  string | null,
];
type ApprovedInvoiceListParameters = [
  ...ApprovedInvoiceListFilterParameters,
  number,
  number,
];
type SentInvoiceRootFilterParameters = [
  string,
  string | null,
  string | null,
  string | null,
  string | null,
];
type SentInvoiceRootListParameters = [
  ...SentInvoiceRootFilterParameters,
  number,
  number,
];
type SentInvoiceChildParameters = [
  ...SentInvoiceRootListParameters,
  string,
];
interface CreditGrossAllocationRow {
  credited_invoice_id: string;
  credited_gross_cents: number;
}
interface ActiveCreditDraftRow {
  id: string;
}

export class SqliteApprovedInvoiceReader
  implements
    ApprovedInvoiceReader,
    InvoiceCreditContextReader,
    SentInvoiceGroupReader
{
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
    const creditedInvoice = this.getCreditedInvoiceIdentity(
      companyId,
      invoice.credited_invoice_id,
    );

    return toApprovedInvoiceView(invoice, lines, vatBreakdown, creditedInvoice);
  }

  async listApprovedInvoiceSummaries(
    query: ApprovedInvoiceSummaryQuery,
  ): Promise<ApprovedInvoiceSummaryResult> {
    const filterParameters: ApprovedInvoiceListFilterParameters = [
      query.companyId,
      query.status,
      query.dateFrom,
      query.dateFrom,
      query.dateTo,
      query.dateTo,
    ];
    const orderBy = getApprovedInvoiceListOrderBy(query.sort);
    const invoices = this.database
      .prepare<ApprovedInvoiceListParameters, InvoiceRow>(
        `
          SELECT *
          FROM invoices
          WHERE
            company_id = ?
            AND status = ?
            AND (? IS NULL OR invoice_date >= ?)
            AND (? IS NULL OR invoice_date <= ?)
          ORDER BY ${orderBy}
          LIMIT ? OFFSET ?
        `,
      )
      .all(...filterParameters, query.limit, query.offset)
      .map(toApprovedInvoiceSummary);
    const countRow = this.database
      .prepare<ApprovedInvoiceListFilterParameters, { total_count: number }>(
        `
          SELECT COUNT(*) AS total_count
          FROM invoices
          WHERE
            company_id = ?
            AND status = ?
            AND (? IS NULL OR invoice_date >= ?)
            AND (? IS NULL OR invoice_date <= ?)
        `,
      )
      .get(...filterParameters);

    return {
      invoices,
      totalCount: countRow?.total_count ?? 0,
    };
  }

  async listSentInvoiceGroups(
    query: SentInvoiceGroupQuery,
  ): Promise<SentInvoiceGroupResult> {
    const filterParameters: SentInvoiceRootFilterParameters = [
      query.companyId,
      query.dateFrom,
      query.dateFrom,
      query.dateTo,
      query.dateTo,
    ];
    const orderBy = getApprovedInvoiceListOrderBy(query.sort);
    const rootInvoiceQuery = createSentInvoiceRootQuery(orderBy);
    const rootParameters: SentInvoiceRootListParameters = [
      ...filterParameters,
      query.limit,
      query.offset,
    ];
    const rootInvoices = this.database
      .prepare<SentInvoiceRootListParameters, InvoiceRow>(rootInvoiceQuery)
      .all(...rootParameters)
      .map(toApprovedInvoiceSummary);
    const countRow = this.database
      .prepare<SentInvoiceRootFilterParameters, { total_count: number }>(
        `
          SELECT COUNT(*) AS total_count
          FROM invoices
          WHERE
            company_id = ?
            AND status = 'sent'
            AND invoice_kind = 'standard'
            AND (? IS NULL OR invoice_date >= ?)
            AND (? IS NULL OR invoice_date <= ?)
        `,
      )
      .get(...filterParameters);

    if (rootInvoices.length === 0) {
      return {
        groups: [],
        totalCount: countRow?.total_count ?? 0,
      };
    }

    const childParameters: SentInvoiceChildParameters = [
      ...rootParameters,
      query.companyId,
    ];
    const sentCreditInvoices = this.database
      .prepare<SentInvoiceChildParameters, InvoiceRow>(
        `
          WITH paged_roots AS (${rootInvoiceQuery})
          SELECT credit_invoices.*
          FROM invoices AS credit_invoices
          INNER JOIN paged_roots
            ON paged_roots.id = credit_invoices.credited_invoice_id
          WHERE
            credit_invoices.company_id = ?
            AND credit_invoices.invoice_kind = 'credit'
            AND credit_invoices.status = 'sent'
          ORDER BY
            credit_invoices.invoice_date ASC,
            credit_invoices.id ASC
        `,
      )
      .all(...childParameters)
      .map(toApprovedInvoiceSummary);
    const creditAllocations = this.database
      .prepare<SentInvoiceChildParameters, CreditGrossAllocationRow>(
        `
          WITH paged_roots AS (${rootInvoiceQuery})
          SELECT
            credit_invoices.credited_invoice_id,
            SUM(credit_invoices.total_gross_cents) AS credited_gross_cents
          FROM invoices AS credit_invoices
          INNER JOIN paged_roots
            ON paged_roots.id = credit_invoices.credited_invoice_id
          WHERE
            credit_invoices.company_id = ?
            AND credit_invoices.invoice_kind = 'credit'
            AND credit_invoices.status IN ('approved', 'sent')
          GROUP BY credit_invoices.credited_invoice_id
        `,
      )
      .all(...childParameters);
    const creditInvoicesByRoot = groupCreditInvoices(sentCreditInvoices);
    const creditedGrossByRoot = new Map(
      creditAllocations.map((row) => [
        row.credited_invoice_id,
        row.credited_gross_cents,
      ]),
    );

    return {
      groups: rootInvoices.map((rootInvoice) =>
        createSentInvoiceGroup(
          rootInvoice,
          creditInvoicesByRoot.get(rootInvoice.id) ?? [],
          creditedGrossByRoot.get(rootInvoice.id) ?? 0,
        ),
      ),
      totalCount: countRow?.total_count ?? 0,
    };
  }

  async getInvoiceCreditContext(
    companyId: string,
    sourceInvoiceId: string,
  ): Promise<InvoiceCreditContext | undefined> {
    const sourceInvoice = this.database
      .prepare<ApprovedInvoiceKeyParameters, InvoiceRow>(
        `
          SELECT *
          FROM invoices
          WHERE
            company_id = ?
            AND id = ?
            AND invoice_kind = 'standard'
            AND status = 'sent'
        `,
      )
      .get(companyId, sourceInvoiceId);

    if (sourceInvoice === undefined) {
      return undefined;
    }

    const creditInvoices = this.database
      .prepare<ApprovedInvoiceKeyParameters, InvoiceRow>(
        `
          SELECT *
          FROM invoices
          WHERE
            company_id = ?
            AND credited_invoice_id = ?
            AND invoice_kind = 'credit'
            AND status IN ('approved', 'sent')
          ORDER BY invoice_date ASC, id ASC
        `,
      )
      .all(companyId, sourceInvoiceId)
      .map(toApprovedInvoiceSummary);
    const activeCreditDraft = this.database
      .prepare<ApprovedInvoiceKeyParameters, ActiveCreditDraftRow>(
        `
          SELECT id
          FROM invoice_drafts
          WHERE
            company_id = ?
            AND credited_invoice_id = ?
            AND invoice_kind = 'credit'
            AND approved_invoice_id IS NULL
          ORDER BY created_at ASC, id ASC
          LIMIT 1
        `,
      )
      .get(companyId, sourceInvoiceId);
    const creditedGrossCents = creditInvoices.reduce(
      (sum, invoice) => sum + invoice.grossTotalCents,
      0,
    );
    const group = createSentInvoiceGroup(
      toApprovedInvoiceSummary(sourceInvoice),
      creditInvoices,
      creditedGrossCents,
    );

    return {
      sourceInvoiceId,
      creditInvoices,
      creditStatus: group.creditStatus,
      remainingCreditableGrossCents: group.remainingCreditableGrossCents,
      activeCreditDraftId: activeCreditDraft?.id ?? null,
    };
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
            AND status IN ('approved', 'sent', 'cancelled')
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

  private getCreditedInvoiceIdentity(
    companyId: string,
    creditedInvoiceId: string | null,
  ): CreditedInvoiceIdentity | undefined {
    if (creditedInvoiceId === null) {
      return undefined;
    }

    return this.database
      .prepare<ApprovedInvoiceKeyParameters, CreditedInvoiceIdentity>(
        `
          SELECT invoice_number, invoice_date
          FROM invoices
          WHERE
            company_id = ?
            AND id = ?
            AND invoice_kind = 'standard'
        `,
      )
      .get(companyId, creditedInvoiceId);
  }
}

function createSentInvoiceRootQuery(orderBy: string): string {
  return `
    SELECT *
    FROM invoices
    WHERE
      company_id = ?
      AND status = 'sent'
      AND invoice_kind = 'standard'
      AND (? IS NULL OR invoice_date >= ?)
      AND (? IS NULL OR invoice_date <= ?)
    ORDER BY ${orderBy}
    LIMIT ? OFFSET ?
  `;
}

function groupCreditInvoices(
  creditInvoices: ApprovedInvoiceSummary[],
): Map<string, ApprovedInvoiceSummary[]> {
  const invoicesByRoot = new Map<string, ApprovedInvoiceSummary[]>();

  for (const creditInvoice of creditInvoices) {
    if (creditInvoice.creditedInvoiceId === null) {
      continue;
    }

    const invoices = invoicesByRoot.get(creditInvoice.creditedInvoiceId) ?? [];
    invoices.push(creditInvoice);
    invoicesByRoot.set(creditInvoice.creditedInvoiceId, invoices);
  }

  return invoicesByRoot;
}

function createSentInvoiceGroup(
  rootInvoice: ApprovedInvoiceSummary,
  creditInvoices: ApprovedInvoiceSummary[],
  creditedGrossCents: number,
): SentInvoiceGroup {
  const remainingCreditableGrossCents = Math.max(
    0,
    rootInvoice.grossTotalCents - creditedGrossCents,
  );

  return {
    rootInvoice,
    creditInvoices,
    creditStatus:
      creditedGrossCents <= 0
        ? 'none'
        : remainingCreditableGrossCents === 0
          ? 'full'
          : 'partial',
    remainingCreditableGrossCents,
  };
}

function getApprovedInvoiceListOrderBy(sort: ApprovedInvoiceListSort): string {
  switch (sort) {
    case 'invoiceDateAsc':
      return 'invoice_date ASC, id ASC';
    case 'dueDateAsc':
      return 'due_date ASC, id ASC';
    case 'customerNameAsc':
      return 'customer_name_snapshot COLLATE NOCASE ASC, invoice_date DESC, id DESC';
    case 'invoiceDateDesc':
      return 'invoice_date DESC, id DESC';
  }
}

function toApprovedInvoiceSummary(invoice: InvoiceRow): ApprovedInvoiceSummary {
  return {
    id: invoice.id,
    invoiceKind: invoice.invoice_kind as InvoiceKind,
    creditedInvoiceId: invoice.credited_invoice_id,
    invoiceNumber: invoice.invoice_number,
    referenceNumber: invoice.reference_number ?? '',
    status: invoice.status as 'approved' | 'sent' | 'cancelled',
    customerId: invoice.customer_id,
    customerNumberSnapshot: invoice.customer_number_snapshot,
    customerNameSnapshot: invoice.customer_name_snapshot,
    billingRecipientNameSnapshot: invoice.billing_recipient_name_snapshot,
    invoiceDate: invoice.invoice_date,
    dueDate: invoice.due_date,
    grossTotalCents: invoice.total_gross_cents,
    approvedAt: invoice.approved_at,
    updatedAt: invoice.updated_at,
    cancelledAt: invoice.cancelled_at,
  };
}

function toApprovedInvoiceView(
  invoice: InvoiceRow,
  lines: InvoiceLineRow[],
  vatBreakdown: ApprovedInvoiceVatBreakdown[],
  creditedInvoice: CreditedInvoiceIdentity | undefined,
): ApprovedInvoiceView {
  return {
    id: invoice.id,
    companyId: invoice.company_id,
    sourceDraftId: invoice.source_draft_id,
    invoiceKind: invoice.invoice_kind as InvoiceKind,
    creditedInvoiceId: invoice.credited_invoice_id,
    creditedInvoiceNumber: creditedInvoice?.invoice_number ?? null,
    creditedInvoiceDate: creditedInvoice?.invoice_date ?? null,
    invoiceNumber: invoice.invoice_number,
    referenceNumber: invoice.reference_number ?? '',
    referenceNumberType:
      (invoice.reference_number_type ?? 'none') as ReferenceNumberType,
    seriesKey: invoice.series_key,
    sequenceScope: invoice.sequence_scope,
    sequenceNumber: invoice.sequence_number,
    numberingMode: invoice.numbering_mode as InvoiceNumberingMode,
    status: invoice.status as 'approved' | 'sent' | 'cancelled',
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
    refundIbanSnapshot: invoice.refund_iban_snapshot,
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
    cancelledAt: invoice.cancelled_at,
    cancelledBy: invoice.cancelled_by,
    cancellationReason: invoice.cancellation_reason,
  };
}

function toApprovedInvoiceViewLine(line: InvoiceLineRow): ApprovedInvoiceViewLine {
  return {
    id: line.id,
    sourceInvoiceLineId: line.source_invoice_line_id,
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
