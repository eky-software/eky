export interface CompanySettingsAuditRetentionPort {
  deleteCompanySettingsAuditEventsBefore(cutoff: string): Promise<number>;
}
