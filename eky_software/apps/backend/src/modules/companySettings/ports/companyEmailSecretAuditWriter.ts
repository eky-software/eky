export const companyEmailSecretAuditEventTypeValues = Object.freeze([
  'company_email_secret_set',
  'company_email_secret_removed',
] as const);

export type CompanyEmailSecretAuditEventType =
  (typeof companyEmailSecretAuditEventTypeValues)[number];

export interface CompanyEmailSecretAuditEvent {
  actorId: string;
  companyId: string;
  eventType: CompanyEmailSecretAuditEventType;
  occurredAt: string;
}

export interface CompanyEmailSecretAuditWriter {
  appendCompanyEmailSecretAuditEvent(
    event: CompanyEmailSecretAuditEvent,
  ): Promise<void>;
}
