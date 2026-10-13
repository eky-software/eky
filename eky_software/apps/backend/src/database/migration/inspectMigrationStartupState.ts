import type { DatabaseConnection } from '../connection/createDatabaseConnection.js';
import { readMigrationManifest } from './migrationManifest.js';
import { inspectAttestedMigrationHistory } from './inspectAttestedMigrationHistory.js';

export type MigrationStartupPolicy =
  | 'exactCurrentManifest'
  | 'restoreCompatible';

export interface MigrationStartupInspection {
  appliedMigrationCount: number;
  migrationChainIdentity: string;
  pendingMigrationCount: number;
  profileState: 'empty' | 'existing';
}

export interface InspectedMigrationStartupState extends MigrationStartupInspection {
  readonly appliedMigrationNames: readonly string[];
}

export function inspectMigrationStartupState(
  database: DatabaseConnection,
  migrationsDirectory: string,
  migrationPolicy: MigrationStartupPolicy = 'exactCurrentManifest',
): Readonly<InspectedMigrationStartupState> {
  const manifest = readMigrationManifest(migrationsDirectory);
  try {
    const history = inspectAttestedMigrationHistory(database, manifest, {
      allowEmpty: true,
      ...(migrationPolicy === 'restoreCompatible' ? { legacyPolicy: 'approvedRestore' } as const : {}),
    });

    return Object.freeze({
      appliedMigrationCount: history.appliedMigrationNames.length,
      appliedMigrationNames: Object.freeze([...history.appliedMigrationNames]),
      migrationChainIdentity: history.migrationChainIdentity,
      pendingMigrationCount:
        manifest.length - history.appliedMigrationNames.length,
      profileState: history.profileState,
    });
  } catch {
    throw new Error('MIGRATION_STARTUP_INSPECTION_FAILED');
  }
}
