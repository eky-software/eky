import type { DatabaseConnection } from '../../../database/connection/createDatabaseConnection.js';
import type {
  InvoiceSettingsAuditAction,
  InvoiceSettingsAuditEvent,
} from '../domain/invoiceSettingsAuditEvent.js';
import { InvoiceSettingsAuditWriteError } from '../ports/invoiceSettingsAuditWriteError.js';

type InvoiceSettingsAuditInsertParameters = [
  string,
  string,
  string,
  string,
  string,
  string,
];

export function insertInvoiceSettingsAuditEvent(
  database: DatabaseConnection,
  event: InvoiceSettingsAuditEvent,
  expected: {
    action: InvoiceSettingsAuditAction;
    companyId: string;
  },
): void {
  validateEvent(event, expected);

  try {
    database
      .prepare<InvoiceSettingsAuditInsertParameters>(
        `
          INSERT INTO invoice_settings_audit_events (
            id,
            company_id,
            actor_user_id,
            action,
            outcome,
            occurred_at
          ) VALUES (?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        event.id,
        event.companyId,
        event.actorUserId,
        event.action,
        event.outcome,
        event.occurredAt,
      );
  } catch {
    throw new InvoiceSettingsAuditWriteError();
  }
}

function validateEvent(
  event: InvoiceSettingsAuditEvent,
  expected: {
    action: InvoiceSettingsAuditAction;
    companyId: string;
  },
): void {
  if (
    event.id.trim().length === 0 ||
    event.companyId.trim().length === 0 ||
    event.actorUserId.trim().length === 0 ||
    event.occurredAt.trim().length === 0 ||
    event.outcome !== 'success' ||
    event.action !== expected.action ||
    event.companyId !== expected.companyId
  ) {
    throw new InvoiceSettingsAuditWriteError();
  }
}
