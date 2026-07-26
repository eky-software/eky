import type { CompanySettings } from '../domain/companySettings.js';
import type { CompanySettingsAuditEvent } from '../domain/companySettingsAuditEvent.js';

export interface CompanySettingsRepository {
  findByCompanyId(companyId: string): Promise<CompanySettings | null>;
  upsertCompanySettings(
    settings: CompanySettings,
    auditEvent: CompanySettingsAuditEvent,
  ): Promise<CompanySettings>;
}
