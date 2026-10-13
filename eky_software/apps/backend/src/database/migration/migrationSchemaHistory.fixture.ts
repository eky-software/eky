import type { DatabaseConnection } from '../connection/createDatabaseConnection.js';
import type { MigrationManifestEntry } from './migrationManifest.js';

export const historical038Chain =
  '5e841ae5c530da82d7dee0c8e2ed8480b23aca944a0faa64a8fcd0b9011b6503';

// Frozen technical DDL from the historical runners, not the current schema helper:
// 79bb00f78e82d4fa9b95e3e4fe33ed1625633a36 (runMigrations.ts) and
// 6ed99f5319c328f4d3cfbc03b912f21dbc4d1032 (migrationMetadata.ts).
export function createHistorical038Schema(
  database: DatabaseConnection,
  manifest: readonly MigrationManifestEntry[],
  withMetadata: boolean,
): void {
  const prefix = manifest.slice(0, 38);
  if (prefix.length !== 38 || prefix.at(-1)?.chainSha256 !== historical038Chain) {
    throw new Error('HISTORICAL_FIXTURE_MANIFEST_CHANGED');
  }
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      run_at TEXT NOT NULL
    );
  `);
  if (withMetadata) {
    database.exec(`
    CREATE TABLE schema_migration_metadata (
      migration_name TEXT PRIMARY KEY,
      metadata_version INTEGER NOT NULL CHECK (metadata_version = 1),
      source_sha256 TEXT NOT NULL CHECK (
        length(source_sha256) = 64
        AND source_sha256 NOT GLOB '*[^0-9a-f]*'
      ),
      chain_sha256 TEXT NOT NULL CHECK (
        length(chain_sha256) = 64
        AND chain_sha256 NOT GLOB '*[^0-9a-f]*'
      ),
      metadata_origin TEXT NOT NULL CHECK (
        metadata_origin IN ('legacy_baseline', 'applied')
      ),
      recorded_app_version TEXT NOT NULL CHECK (
        length(recorded_app_version) BETWEEN 1 AND 80
      ),
      recorded_build_revision TEXT NOT NULL CHECK (
        length(recorded_build_revision) BETWEEN 1 AND 40
      ),
      recorded_at TEXT NOT NULL,
      FOREIGN KEY (migration_name)
        REFERENCES schema_migrations(name)
        ON DELETE RESTRICT
    );
  `);
  }
  for (const entry of prefix) {
    database.transaction(() => {
      database.exec(entry.content.toString('utf8'));
      database.prepare('INSERT INTO schema_migrations VALUES (?, ?)')
        .run(entry.fileName, '2026-08-14T12:00:00.000Z');
      if (withMetadata) {
        database.prepare(`INSERT INTO schema_migration_metadata
          VALUES (?, 1, ?, ?, 'applied', '0.2.81', ?, ?)`)
          .run(entry.fileName, entry.sourceSha256, entry.chainSha256,
            '6ed99f5319c328f4d3cfbc03b912f21dbc4d1032', '2026-08-14T12:00:00.000Z');
      }
    })();
  }
}
