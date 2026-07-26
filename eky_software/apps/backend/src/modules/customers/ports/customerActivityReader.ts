import type { CustomerActivityEntry } from '../domain/customerActivityEntry.js';

export interface CustomerActivityReader {
  listCustomerActivity(
    companyId: string,
    limit: number,
  ): Promise<CustomerActivityEntry[]>;
}
