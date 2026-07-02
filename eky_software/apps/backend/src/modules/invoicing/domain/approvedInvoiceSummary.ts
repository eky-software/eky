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
