import type Database from 'better-sqlite3';

import type {
  CompanyEmailSecretAuditCompletion,
  CompanyEmailSecretAuditOperation,
  CompanyEmailSecretAuditWriter,
} from '../ports/companyEmailSecretAuditWriter.js';

export class SqliteCompanyEmailSecretAuditWriter
  implements CompanyEmailSecretAuditWriter
{
  constructor(private readonly database: Database.Database) {}

  async completeCompanyEmailSecretAuditOperation(
    completion: CompanyEmailSecretAuditCompletion,
  ): Promise<void> {
    const result = this.database
      .prepare(
        `
          UPDATE company_email_secret_audit_events
          SET
            status = ?,
            completed_at = ?,
            failure_code = ?
          WHERE operation_id = ? AND status = 'pending'
        `,
      )
      .run(
        completion.status,
        completion.completedAt,
        completion.failureCode,
        completion.operationId,
      );

    if (result.changes !== 1) {
      throw new Error('Email secret audit operation cannot be completed.');
    }
  }

  async startCompanyEmailSecretAuditOperation(
    operation: CompanyEmailSecretAuditOperation,
  ): Promise<void> {
    this.database
      .prepare(
        `
          INSERT INTO company_email_secret_audit_events (
            operation_id,
            company_id,
            actor_id,
            action,
            status,
            started_at,
            completed_at,
            failure_code
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        operation.operationId,
        operation.companyId,
        operation.actorId,
        operation.action,
        operation.status,
        operation.startedAt,
        operation.completedAt,
        operation.failureCode,
      );
  }
}
