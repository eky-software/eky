import type { DatabaseConnection } from '../../../database/connection/createDatabaseConnection.js';
import type { InvoiceRow } from '../../../database/schema.js';
import type {
  ApprovedInvoiceListSort,
  ApprovedInvoiceSummary,
} from '../domain/approvedInvoiceSummary.js';
import type { InvoiceKind } from '../domain/invoiceKind.js';
import type {
  SentInvoiceCreditStateFilter,
  SentInvoiceGroup,
  SentInvoiceGroupQuery,
  SentInvoiceGroupResult,
} from '../domain/sentInvoiceGroup.js';
import type { SentInvoiceGroupReader } from '../ports/sentInvoiceGroupReader.js';

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

export class SqliteSentInvoiceGroupReader implements SentInvoiceGroupReader {
  constructor(private readonly database: DatabaseConnection) {}

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
    const rootInvoiceQuery = createSentInvoiceRootQuery(
      orderBy,
      query.creditState,
    );
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
          FROM invoices AS root_invoices
          WHERE
            root_invoices.company_id = ?
            AND root_invoices.status = 'sent'
            AND root_invoices.invoice_kind = 'standard'
            AND (? IS NULL OR root_invoices.invoice_date >= ?)
            AND (? IS NULL OR root_invoices.invoice_date <= ?)
            ${getSentInvoiceCreditStateWhereClause(query.creditState)}
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
}

function createSentInvoiceRootQuery(
  orderBy: string,
  creditState: SentInvoiceCreditStateFilter,
): string {
  return `
    SELECT root_invoices.*
    FROM invoices AS root_invoices
    WHERE
      root_invoices.company_id = ?
      AND root_invoices.status = 'sent'
      AND root_invoices.invoice_kind = 'standard'
      AND (? IS NULL OR root_invoices.invoice_date >= ?)
      AND (? IS NULL OR root_invoices.invoice_date <= ?)
      ${getSentInvoiceCreditStateWhereClause(creditState)}
    ORDER BY ${orderBy}
    LIMIT ? OFFSET ?
  `;
}

function getSentInvoiceCreditStateWhereClause(
  creditState: SentInvoiceCreditStateFilter,
): string {
  if (creditState === 'all') {
    return '';
  }

  const comparison = creditState === 'credited' ? '>' : '=';

  return `
    AND (
      SELECT COALESCE(SUM(credit_invoices.total_gross_cents), 0)
      FROM invoices AS credit_invoices
      WHERE
        credit_invoices.company_id = root_invoices.company_id
        AND credit_invoices.credited_invoice_id = root_invoices.id
        AND credit_invoices.invoice_kind = 'credit'
        AND credit_invoices.status IN ('approved', 'sent')
    ) ${comparison} 0
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
