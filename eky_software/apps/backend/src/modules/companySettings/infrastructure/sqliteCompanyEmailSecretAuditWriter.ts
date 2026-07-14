import { randomUUID } from 'node:crypto';

import type Database from 'better-sqlite3';

import type {
  CompanyEmailSecretAuditEvent,
  CompanyEmailSecretAuditWriter,
} from '../ports/companyEmailSecretAuditWriter.js';

export class SqliteCompanyEmailSecretAuditWriter
  implements CompanyEmailSecretAuditWriter
{
  constructor(private readonly database: Database.Database) {}

  async appendCompanyEmailSecretAuditEvent(
    event: CompanyEmailSecretAuditEvent,
  ): Promise<void> {
    this.database
      .prepare(
        `
          INSERT INTO company_email_secret_audit_events (
            id,
            company_id,
            actor_id,
            event_type,
            occurred_at
          ) VALUES (?, ?, ?, ?, ?)
        `,
      )
      .run(
        randomUUID(),
        event.companyId,
        event.actorId,
        event.eventType,
        event.occurredAt,
      );
  }
}
