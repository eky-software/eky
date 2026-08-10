import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { DatabaseConnection } from '../connection/createDatabaseConnection.js';
import { readMigrationManifest } from './migrationManifest.js';
import {
  prepareMigrationHistoryForRun,
  recordAppliedMigrationMetadata,
  type MigrationReleaseIdentity,
} from './migrationMetadata.js';

const defaultMigrationsDirectory = fileURLToPath(
  new URL('../migrations/', import.meta.url),
);

export interface RunMigrationsOptions {
  migrationsDirectory?: string;
  now?: () => Date;
  releaseIdentity?: MigrationReleaseIdentity;
}

const developmentReleaseIdentity: MigrationReleaseIdentity = {
  appVersion: '0.0.0',
  buildRevision: 'development',
};

export async function runMigrations(
  database: DatabaseConnection,
  options: RunMigrationsOptions = {},
): Promise<void> {
  const migrationsDirectory = resolve(
    options.migrationsDirectory ?? defaultMigrationsDirectory,
  );
  const manifest = readMigrationManifest(migrationsDirectory);
  const releaseIdentity =
    options.releaseIdentity ?? developmentReleaseIdentity;
  const now = options.now ?? (() => new Date());
  const initialRecordedAt = readRecordedAt(now);
  const appliedMigrationNames = prepareMigrationHistoryForRun(
    database,
    manifest,
    releaseIdentity,
    initialRecordedAt,
  );

  for (const migration of manifest) {
    if (appliedMigrationNames.has(migration.fileName)) {
      continue;
    }

    const recordedAt = readRecordedAt(now);

    const runMigration = database.transaction(() => {
      database.exec(migration.content.toString('utf8'));
      database
        .prepare<[string, string]>(
          'INSERT INTO schema_migrations (name, run_at) VALUES (?, ?)',
        )
        .run(migration.fileName, recordedAt);
      recordAppliedMigrationMetadata(database, {
        entry: migration,
        recordedAt,
        releaseIdentity,
      });
    });

    runMigration();
  }
}

function readRecordedAt(now: () => Date): string {
  try {
    return now().toISOString();
  } catch {
    throw new Error('MIGRATION_RECORDED_AT_INVALID');
  }
}
