import type {
  InvoiceActivityEntry,
  InvoiceActivityOutcome,
} from '../domain/invoiceActivityEntry.js';

export interface InvoiceActivityCriteria {
  companyId: string;
  limit: number;
  occurredAtFrom: string;
  occurredAtTo: string;
  outcomes: readonly InvoiceActivityOutcome[];
}

export interface InvoiceActivityReader {
  listInvoiceActivity(
    criteria: InvoiceActivityCriteria,
  ): Promise<InvoiceActivityEntry[]>;
}
