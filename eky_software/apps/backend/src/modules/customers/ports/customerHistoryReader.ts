import type { CustomerHistoryEntry } from '../domain/customerHistory.js';

export interface CustomerHistoryCriteria {
  companyId: string;
  customerId: string;
  limit: number;
  offset: number;
}

export interface CustomerHistoryReader {
  listCustomerHistory(
    criteria: CustomerHistoryCriteria,
  ): Promise<CustomerHistoryEntry[]>;
}
