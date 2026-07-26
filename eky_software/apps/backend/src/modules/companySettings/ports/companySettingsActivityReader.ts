import type { CompanySettingsActivityEntry } from '../domain/companySettingsActivityEntry.js';

export interface CompanySettingsActivityReader {
  listCompanySettingsActivity(
    companyId: string,
    limit: number,
  ): Promise<CompanySettingsActivityEntry[]>;
}
