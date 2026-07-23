import type {
  SentInvoiceGroupQuery,
  SentInvoiceGroupResult,
} from '../domain/sentInvoiceGroup.js';

export interface SentInvoiceGroupReader {
  listSentInvoiceGroups(
    query: SentInvoiceGroupQuery,
  ): Promise<SentInvoiceGroupResult>;
}
