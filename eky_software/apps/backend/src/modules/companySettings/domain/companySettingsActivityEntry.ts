import type { CompanySettingsChangedFieldCategory } from './companySettingsAuditEvent.js';

export type CompanySettingsActivityAction =
  | 'companyEmailSecret.configured'
  | 'companyEmailSecret.removed'
  | 'companySettings.updated';

export interface CompanySettingsActivityEntry {
  action: CompanySettingsActivityAction;
  changeCategories: readonly CompanySettingsChangedFieldCategory[];
  id: string;
  occurredAt: string;
}
