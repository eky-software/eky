import type { ApprovedInvoiceStatus } from './approvedInvoice.js';
import type { InvoiceKind } from './invoiceKind.js';
import type { InvoicePaymentReadModel } from './invoicePayment.js';

export interface ApprovedInvoiceSummary extends InvoicePaymentReadModel {
  id: string;
  invoiceKind: InvoiceKind;
  creditedInvoiceId: string | null;
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
  cancelledAt: string | null;
}

export type ApprovedInvoiceListSort =
  | 'invoiceDateDesc'
  | 'invoiceDateAsc'
  | 'dueDateAsc'
  | 'customerNameAsc';

export interface ApprovedInvoiceSummaryQuery {
  companyId: string;
  customerId: string | null;
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
