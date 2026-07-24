import type { DatabaseConnection } from '../../../database/connection/createDatabaseConnection.js';
import type { InvoiceRow } from '../../../database/schema.js';
import type {
  SentInvoiceCreditStateFilter,
  SentInvoiceGroupQuery,
  SentInvoiceGroupResult,
} from '../domain/sentInvoiceGroup.js';
import type { SentInvoiceGroupReader } from '../ports/sentInvoiceGroupReader.js';
import {
  getApprovedInvoiceListOrderBy,
  toApprovedInvoiceSummary,
} from './approvedInvoiceReadModelMapping.js';
import {
  createSentInvoiceGroup,
  groupCreditInvoices,
} from './sentInvoiceGroupMapping.js';

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
