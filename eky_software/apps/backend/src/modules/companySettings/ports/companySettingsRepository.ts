import type { CompanySettings } from '../domain/companySettings.js';

export interface CompanySettingsRepository {
  findByCompanyId(companyId: string): Promise<CompanySettings | null>;
  upsertCompanySettings(settings: CompanySettings): Promise<CompanySettings>;
}
