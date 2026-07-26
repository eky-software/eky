export class CompanySettingsAuditWriteError extends Error {
  constructor() {
    super('Company settings audit event could not be written.');
    this.name = 'CompanySettingsAuditWriteError';
  }
}
