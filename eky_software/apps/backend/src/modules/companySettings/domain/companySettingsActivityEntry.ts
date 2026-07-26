export type CompanySettingsActivityAction =
  | 'companyEmailSecret.configured'
  | 'companyEmailSecret.removed'
  | 'companySettings.updated';

export interface CompanySettingsActivityEntry {
  action: CompanySettingsActivityAction;
  id: string;
  occurredAt: string;
}
