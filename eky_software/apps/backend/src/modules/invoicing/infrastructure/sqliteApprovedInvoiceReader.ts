import type { DatabaseConnection } from '../../../database/connection/createDatabaseConnection.js';
import type { InvoiceLineRow, InvoiceRow } from '../../../database/schema.js';
import type {
  ApprovedInvoiceSummaryQuery,
  ApprovedInvoiceSummaryResult,
} from '../domain/approvedInvoiceSummary.js';
import type { ApprovedInvoiceView } from '../domain/approvedInvoiceView.js';
import type { ApprovedInvoiceReader } from '../ports/approvedInvoiceReader.js';
import {
  type CreditedInvoiceIdentityRow,
  getApprovedInvoiceListOrderBy,
  toApprovedInvoiceSummary,
  toApprovedInvoiceView,
} from './approvedInvoiceReadModelMapping.js';

type ApprovedInvoiceKeyParameters = [string, string];
type ApprovedInvoiceLineParameters = [string];
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
    const creditedInvoice = this.getCreditedInvoiceIdentity(
      companyId,
      invoice.credited_invoice_id,
    );

    return toApprovedInvoiceView(invoice, lines, creditedInvoice);
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
  ): CreditedInvoiceIdentityRow | undefined {
    if (creditedInvoiceId === null) {
      return undefined;
    }

    return this.database
      .prepare<ApprovedInvoiceKeyParameters, CreditedInvoiceIdentityRow>(
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
