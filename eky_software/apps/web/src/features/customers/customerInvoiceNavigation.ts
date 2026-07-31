import type { InvoiceKind } from '@eky/api-client';

export type CustomerInvoiceNavigationTarget =
  | {
      id: string;
      invoiceKind: InvoiceKind;
      type: 'draft';
    }
  | {
      id: string;
      type: 'approvedInvoice';
    };
