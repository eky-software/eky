import type { InvoiceKind } from '@eky/api-client';

export type InvoicingNavigationTarget =
  | {
      id: string;
      invoiceKind: InvoiceKind;
      type: 'draft';
    }
  | {
      id: string;
      type: 'approvedInvoice';
    };

export interface InvoicingNavigationRequest {
  revision: number;
  target: InvoicingNavigationTarget | null;
}
