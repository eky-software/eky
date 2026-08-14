import type { DatabaseConnection } from '../connection/createDatabaseConnection.js';
import { readMigrationManifest } from './migrationManifest.js';
import {
  inspectApprovedLegacyMigrationHistory,
  inspectMigrationHistory,
} from './migrationMetadata.js';

export type MigrationStartupPolicy =
  | 'exactCurrentManifest'
  | 'restoreCompatible';

export interface MigrationStartupInspection {
  appliedMigrationCount: number;
  migrationChainIdentity: string;
  pendingMigrationCount: number;
  profileState: 'empty' | 'existing';
}

export function inspectMigrationStartupState(
  database: DatabaseConnection,
  migrationsDirectory: string,
  migrationPolicy: MigrationStartupPolicy = 'exactCurrentManifest',
): Readonly<MigrationStartupInspection> {
  const manifest = readMigrationManifest(migrationsDirectory);
  const hasMigrationHistory = tableExists(database, 'schema_migrations');
  const hasMigrationMetadata = tableExists(
    database,
    'schema_migration_metadata',
  );
  const businessTableNames = listBusinessTableNames(database);

  if (!hasMigrationHistory) {
    if (hasMigrationMetadata || businessTableNames.length !== 0) {
      throw new Error('MIGRATION_STARTUP_INSPECTION_FAILED');
    }

    return Object.freeze({
      appliedMigrationCount: 0,
      migrationChainIdentity: '',
      pendingMigrationCount: manifest.length,
      profileState: 'empty',
    });
  }

  try {
    const history = hasMigrationMetadata
      ? inspectMigrationHistory(database, manifest)
      : migrationPolicy === 'restoreCompatible'
        ? inspectApprovedLegacyMigrationHistory(database, manifest)
        : undefined;

    if (history === undefined) {
      throw new Error('MIGRATION_STARTUP_INSPECTION_FAILED');
    }

    return Object.freeze({
      appliedMigrationCount: history.appliedMigrationNames.length,
      migrationChainIdentity: history.migrationChainIdentity,
      pendingMigrationCount:
        manifest.length - history.appliedMigrationNames.length,
      profileState: 'existing',
    });
  } catch {
    throw new Error('MIGRATION_STARTUP_INSPECTION_FAILED');
  }
}

function tableExists(
  database: DatabaseConnection,
  tableName: string,
): boolean {
  return (
    database
      .prepare<[string], { name: string }>(
        `
          SELECT name
          FROM sqlite_master
          WHERE type = 'table' AND name = ?
        `,
      )
      .get(tableName) !== undefined
  );
}

function listBusinessTableNames(database: DatabaseConnection): string[] {
  return database
    .prepare<[], { name: string }>(
      `
        SELECT name
        FROM sqlite_master
        WHERE type = 'table'
          AND name NOT LIKE 'sqlite_%'
          AND name NOT IN ('schema_migrations', 'schema_migration_metadata')
        ORDER BY name
      `,
    )
    .all()
    .map(({ name }) => name);
}
