import type { Customer, InvoiceKind } from '@eky/api-client';

export type InvoicingNavigationTarget =
  | {
      customerId: string;
      type: 'createInvoiceForCustomer';
    }
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

export function resolveActiveInvoiceCustomerId(
  customers: readonly Customer[],
  customerId: string,
): string | null {
  const customer = customers.find((candidate) => candidate.id === customerId);

  return customer?.status === 'active' ? customer.id : null;
}
