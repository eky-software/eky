import type {
  CompanyEmailSecretAuditEvent,
  CompanyEmailSecretAuditEventType,
} from '../ports/companyEmailSecretAuditWriter.js';
import { CompanySettingsValidationError } from '../domain/companySettingsRules.js';

export function createCompanyEmailSecretAuditEvent(input: {
  actorId: string;
  companyId: string;
  eventType: CompanyEmailSecretAuditEventType;
  occurredAt: unknown;
}): CompanyEmailSecretAuditEvent {
  return Object.freeze({
    actorId: input.actorId,
    companyId: input.companyId,
    eventType: input.eventType,
    occurredAt: normalizeOccurredAt(input.occurredAt),
  });
}

function normalizeOccurredAt(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) ||
    !Number.isFinite(Date.parse(value))
  ) {
    throw new CompanySettingsValidationError(
      'Email secret audit timestamp is invalid.',
    );
  }

  return value;
}
