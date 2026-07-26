import type { DatabaseConnection } from '../../../database/connection/createDatabaseConnection.js';
import type { DatabaseDiagnosticSummary } from '../domain/supportBundleDiagnosticData.js';
import type { SystemDiagnosticSummaryReader } from '../ports/systemDiagnosticSummaryReader.js';

interface MigrationSummaryRow {
  applied_migration_count: number;
  latest_migration_name: string | null;
}

export class SqliteSystemDiagnosticSummaryReader
  implements SystemDiagnosticSummaryReader
{
  readonly #database: DatabaseConnection;

  constructor(database: DatabaseConnection) {
    this.#database = database;
  }

  async readDatabaseSummary(): Promise<DatabaseDiagnosticSummary> {
    const integrityResult: unknown = this.#database.pragma('quick_check', {
      simple: true,
    });
    if (integrityResult !== 'ok') {
      throw new Error('DATABASE_INTEGRITY_CHECK_FAILED');
    }

    const row = this.#database
      .prepare<[], MigrationSummaryRow>(
        `
          SELECT
            COUNT(*) AS applied_migration_count,
            MAX(name) AS latest_migration_name
          FROM schema_migrations
        `,
      )
      .get();

    if (
      row === undefined ||
      !Number.isSafeInteger(row.applied_migration_count) ||
      row.applied_migration_count < 0 ||
      (row.latest_migration_name !== null &&
        !isSafeMigrationName(row.latest_migration_name))
    ) {
      throw new Error('DATABASE_DIAGNOSTIC_SUMMARY_INVALID');
    }

    return {
      appliedMigrationCount: row.applied_migration_count,
      health: 'ok',
      latestMigrationName: row.latest_migration_name,
    };
  }
}

function isSafeMigrationName(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= 160 &&
    /^[A-Za-z0-9._-]+$/.test(value)
  );
}
