import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { DatabaseConnection } from '../connection/createDatabaseConnection.js';
import {
  readMigrationManifest,
  type MigrationManifestEntry,
} from './migrationManifest.js';
import { MigrationRunError } from './migrationRunError.js';
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
  let manifest: MigrationManifestEntry[];
  try {
    manifest = readMigrationManifest(migrationsDirectory);
  } catch {
    throw new MigrationRunError({
      completedMigrationCount: 0,
      errorCode: 'MIGRATION_MANIFEST_FAILED',
      failureStage: 'manifest',
    });
  }
  const releaseIdentity =
    options.releaseIdentity ?? developmentReleaseIdentity;
  const now = options.now ?? (() => new Date());
  let appliedMigrationNames: Set<string>;
  try {
    const initialRecordedAt = readRecordedAt(now);
    appliedMigrationNames = prepareMigrationHistoryForRun(
      database,
      manifest,
      releaseIdentity,
      initialRecordedAt,
    );
  } catch {
    throw new MigrationRunError({
      completedMigrationCount: 0,
      errorCode: 'MIGRATION_HISTORY_PREPARATION_FAILED',
      failureStage: 'historyPreparation',
    });
  }
  let completedMigrationCount = 0;

  for (const migration of manifest) {
    if (appliedMigrationNames.has(migration.fileName)) {
      continue;
    }

    try {
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
      completedMigrationCount += 1;
    } catch {
      throw new MigrationRunError({
        completedMigrationCount,
        errorCode: 'MIGRATION_EXECUTION_FAILED',
        failureStage: 'migrationExecution',
      });
    }
  }
}

function readRecordedAt(now: () => Date): string {
  try {
    return now().toISOString();
  } catch {
    throw new Error('MIGRATION_RECORDED_AT_INVALID');
  }
}
