import type { ApprovedInvoiceStatus } from './approvedInvoice.js';

export interface ApprovedInvoiceSummary {
  id: string;
  invoiceNumber: string;
  referenceNumber: string;
  status: ApprovedInvoiceStatus;
  customerId: string;
  customerNumberSnapshot: string;
  customerNameSnapshot: string;
  billingRecipientNameSnapshot: string;
  invoiceDate: string;
  dueDate: string;
  grossTotalCents: number;
  approvedAt: string;
  updatedAt: string;
}

export type ApprovedInvoiceListSort =
  | 'invoiceDateDesc'
  | 'invoiceDateAsc'
  | 'dueDateAsc'
  | 'customerNameAsc';

export interface ApprovedInvoiceSummaryQuery {
  companyId: string;
  status: ApprovedInvoiceStatus;
  dateFrom: string | null;
  dateTo: string | null;
  limit: number;
  offset: number;
  sort: ApprovedInvoiceListSort;
}

export interface ApprovedInvoiceSummaryResult {
  invoices: ApprovedInvoiceSummary[];
  totalCount: number;
}

export interface ApprovedInvoiceListPage {
  invoices: ApprovedInvoiceSummary[];
  page: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
}
