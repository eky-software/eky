import type {
  ApprovedInvoiceSummaryQuery,
  ApprovedInvoiceSummaryResult,
} from '../domain/approvedInvoiceSummary.js';
import type { ApprovedInvoiceView } from '../domain/approvedInvoiceView.js';

export interface ApprovedInvoiceReader {
  getApprovedInvoiceById(
    companyId: string,
    invoiceId: string,
  ): Promise<ApprovedInvoiceView | undefined>;

  listApprovedInvoiceSummaries(
    query: ApprovedInvoiceSummaryQuery,
  ): Promise<ApprovedInvoiceSummaryResult>;
}
