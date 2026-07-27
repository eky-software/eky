import type { CompanySettingsActivityEntry } from '../domain/companySettingsActivityEntry.js';

export interface CompanySettingsActivityCriteria {
  companyId: string;
  limit: number;
  occurredAtFrom: string;
  occurredAtTo: string;
}

export interface CompanySettingsActivityReader {
  listCompanySettingsActivity(
    criteria: CompanySettingsActivityCriteria,
  ): Promise<CompanySettingsActivityEntry[]>;
}
