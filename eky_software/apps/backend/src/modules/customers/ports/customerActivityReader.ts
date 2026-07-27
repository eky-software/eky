import type { CustomerActivityEntry } from '../domain/customerActivityEntry.js';

export interface CustomerActivityCriteria {
  companyId: string;
  limit: number;
  occurredAtFrom: string;
  occurredAtTo: string;
}

export interface CustomerActivityReader {
  listCustomerActivity(
    criteria: CustomerActivityCriteria,
  ): Promise<CustomerActivityEntry[]>;
}
