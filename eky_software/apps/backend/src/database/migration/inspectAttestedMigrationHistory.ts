import type { DatabaseConnection } from '../connection/createDatabaseConnection.js';
import type { MigrationManifestEntry } from './migrationManifest.js';
import {
  inspectApprovedLegacyMigrationHistory,
  inspectLegacyMigrationPrefix,
  inspectMigrationHistory,
  type MigrationHistoryInspection,
} from './migrationMetadata.js';
import {
  getMigrationSchemaReference,
  getMigrationTechnicalSchema,
  type MigrationSchemaObject,
  type MigrationSchemaReferences,
} from './migrationSchemaReference.js';
import { readBoundedMigrationSchema } from './readBoundedMigrationSchema.js';

export interface AttestedMigrationHistory extends MigrationHistoryInspection {
  profileState: 'empty' | 'existing';
}

interface AttestationOptions {
  allowEmpty?: boolean;
  legacyPolicy?: 'approvedRestore' | 'runnerBaseline';
}

export function inspectAttestedMigrationHistory(
  database: DatabaseConnection,
  manifest: readonly MigrationManifestEntry[],
  options: AttestationOptions = {},
): AttestedMigrationHistory {
  return inspectAttestedMigrationHistoryWithReferences(database, manifest, {
    getTechnicalSchema: getMigrationTechnicalSchema,
    getSchemaReference: getMigrationSchemaReference,
  }, options);
}

export function inspectAttestedMigrationHistoryWithReferences(
  database: DatabaseConnection,
  manifest: readonly MigrationManifestEntry[],
  references: MigrationSchemaReferences,
  options: AttestationOptions = {},
): AttestedMigrationHistory {
  if (typeof references?.getTechnicalSchema !== 'function' ||
      typeof references.getSchemaReference !== 'function') {
    throw new Error('PROFILE_INSPECTION_PROTOCOL_INVALID');
  }
  const previousQueryOnly = database.pragma('query_only', { simple: true });
  database.pragma('trusted_schema = OFF');
  database.pragma('query_only = ON');
  try {
    return database.transaction(() => inspect(database, manifest, references, options))();
  } finally {
    if (previousQueryOnly === 0) database.pragma('query_only = OFF');
  }
}

function inspect(
  database: DatabaseConnection,
  manifest: readonly MigrationManifestEntry[],
  references: MigrationSchemaReferences,
  options: AttestationOptions,
): AttestedMigrationHistory {
  const technicalReference = references.getTechnicalSchema();
  // Attest the history relations before reading any attacker-controlled history row.
  const technicalObjects = readBoundedMigrationSchema(database, technicalReference, 'history');
  const hasHistory = technicalObjects.some(row => row.name === 'schema_migrations');
  const hasMetadata = technicalObjects.some(row => row.name === 'schema_migration_metadata');
  if (!hasHistory) {
    assertSchemaMatches(technicalObjects, []);
    assertSchemaMatches(readBoundedMigrationSchema(database, [], 'all'), []);
    if (!options.allowEmpty) throw new Error('MIGRATION_HISTORY_INVALID');
    return { appliedMigrationNames: [], migrationChainIdentity: '', profileState: 'empty' };
  }
  assertSchemaMatches(technicalObjects, technicalReference.filter(row =>
    hasMetadata || row.tbl_name !== 'schema_migration_metadata',
  ));
  const history = hasMetadata
    ? inspectMigrationHistory(database, manifest)
    : options.legacyPolicy === 'approvedRestore'
      ? inspectApprovedLegacyMigrationHistory(database, manifest)
      : options.legacyPolicy === 'runnerBaseline'
        ? inspectLegacyMigrationPrefix(database, manifest)
        : undefined;
  if (history === undefined) throw new Error('MIGRATION_HISTORY_INVALID');
  const expected = references.getSchemaReference(
    manifest.slice(0, history.appliedMigrationNames.length), hasMetadata,
  );
  assertSchemaMatches(readBoundedMigrationSchema(database, expected, 'all'), expected);
  return { ...history, profileState: 'existing' };
}

function assertSchemaMatches(
  actual: readonly MigrationSchemaObject[],
  expected: readonly MigrationSchemaObject[],
): void {
  const unmatched = new Map(expected.map(row => [row.name, row]));
  if (actual.length !== expected.length) throw new Error('PROFILE_SCHEMA_UNSUPPORTED');
  for (const row of actual) {
    const reference = unmatched.get(row.name);
    if (reference === undefined || row.type !== reference.type ||
      row.tbl_name !== reference.tbl_name || row.sql !== reference.sql) {
      throw new Error('PROFILE_SCHEMA_UNSUPPORTED');
    }
    unmatched.delete(row.name);
  }
  if (unmatched.size !== 0) throw new Error('PROFILE_SCHEMA_UNSUPPORTED');
}
