import type { DatabaseConnection } from '../connection/createDatabaseConnection.js';
import { isSqliteMemoryError } from '../connection/isSqliteMemoryError.js';
import type { MigrationManifestEntry } from './migrationManifest.js';

const migrationMetadataVersion = 1;
const approvedLegacyMigrationAnchor = {
  migrationChainIdentity:
    '5e841ae5c530da82d7dee0c8e2ed8480b23aca944a0faa64a8fcd0b9011b6503',
  migrationCount: 38,
  migrationName: '038_create_invoice_numbering_series_transitions.sql',
} as const;
const safeAppVersionPattern = /^[A-Za-z0-9.+_-]{1,80}$/;
const safeBuildRevisionPattern = /^(?:[0-9a-f]{7,40}|development)$/;
const sha256Pattern = /^[0-9a-f]{64}$/;

export interface MigrationReleaseIdentity {
  appVersion: string;
  buildRevision: string;
}

interface MigrationMetadataRow {
  chain_sha256: string;
  metadata_origin: string;
  metadata_version: number;
  migration_name: string;
  recorded_app_version: string;
  recorded_at: string;
  recorded_build_revision: string;
  source_sha256: string;
}

export interface MigrationHistoryInspection {
  readonly appliedMigrationNames: readonly string[];
  migrationChainIdentity: string;
}

export function prepareMigrationHistoryForRun(
  database: DatabaseConnection,
  manifest: readonly MigrationManifestEntry[],
  releaseIdentity: MigrationReleaseIdentity,
  recordedAt: string,
): Set<string> {
  validateReleaseIdentity(releaseIdentity);
  validateRecordedAt(recordedAt);

  const hasMigrationTable = tableExists(database, 'schema_migrations');
  const hasMetadataTable = tableExists(
    database,
    'schema_migration_metadata',
  );

  if (!hasMigrationTable) {
    if (hasMetadataTable || listBusinessTableNames(database).length !== 0) {
      throw new Error('MIGRATION_HISTORY_INVALID');
    }

    const initializeHistory = database.transaction(() => {
      createMigrationTable(database);
      createMigrationMetadataTable(database);
    });
    initializeHistory();
    return new Set<string>();
  }

  const appliedMigrationNames = readAppliedMigrationNames(database, manifest);
  assertAppliedMigrationsAreManifestPrefix(appliedMigrationNames, manifest);

  if (
    appliedMigrationNames.length === 0 &&
    listBusinessTableNames(database).length !== 0
  ) {
    throw new Error('MIGRATION_HISTORY_INVALID');
  }

  if (!hasMetadataTable) {
    const anchorLegacyHistory = database.transaction(() => {
      createMigrationMetadataTable(database);

      for (const migrationName of appliedMigrationNames) {
        const entry = manifest.find(
          (migration) => migration.fileName === migrationName,
        );

        if (entry === undefined) {
          throw new Error('MIGRATION_HISTORY_INVALID');
        }

        insertMigrationMetadata(database, {
          entry,
          metadataOrigin: 'legacy_baseline',
          recordedAt,
          releaseIdentity,
        });
      }
    });
    anchorLegacyHistory();
  } else {
    assertMetadataMatchesManifest(
      database,
      appliedMigrationNames,
      manifest,
    );
  }

  return new Set(appliedMigrationNames);
}

export function recordAppliedMigrationMetadata(
  database: DatabaseConnection,
  input: {
    entry: MigrationManifestEntry;
    recordedAt: string;
    releaseIdentity: MigrationReleaseIdentity;
  },
): void {
  validateReleaseIdentity(input.releaseIdentity);
  validateRecordedAt(input.recordedAt);
  insertMigrationMetadata(database, {
    ...input,
    metadataOrigin: 'applied',
  });
}

export function inspectMigrationHistory(
  database: DatabaseConnection,
  manifest: readonly MigrationManifestEntry[],
): MigrationHistoryInspection {
  if (
    !tableExists(database, 'schema_migrations') ||
    !tableExists(database, 'schema_migration_metadata')
  ) {
    throw new Error('MIGRATION_HISTORY_INVALID');
  }

  const appliedMigrationNames = readAppliedMigrationNames(database, manifest);
  assertAppliedMigrationsAreManifestPrefix(appliedMigrationNames, manifest);
  assertMetadataMatchesManifest(database, appliedMigrationNames, manifest);

  const finalEntry = manifest[appliedMigrationNames.length - 1];

  return {
    appliedMigrationNames,
    migrationChainIdentity: finalEntry?.chainSha256 ?? '',
  };
}

export function inspectApprovedLegacyMigrationHistory(
  database: DatabaseConnection,
  manifest: readonly MigrationManifestEntry[],
): MigrationHistoryInspection {
  const history = inspectLegacyMigrationPrefix(database, manifest);
  const finalEntry = manifest[history.appliedMigrationNames.length - 1];

  if (
    history.appliedMigrationNames.length !==
      approvedLegacyMigrationAnchor.migrationCount ||
    finalEntry?.fileName !== approvedLegacyMigrationAnchor.migrationName ||
    finalEntry.chainSha256 !==
      approvedLegacyMigrationAnchor.migrationChainIdentity
  ) {
    throw new Error('MIGRATION_HISTORY_INVALID');
  }

  return history;
}

// Runner baselining is not authorization to restore an arbitrary old backup.
export function inspectLegacyMigrationPrefix(
  database: DatabaseConnection,
  manifest: readonly MigrationManifestEntry[],
): MigrationHistoryInspection {
  if (
    !tableExists(database, 'schema_migrations') ||
    tableExists(database, 'schema_migration_metadata')
  ) {
    throw new Error('MIGRATION_HISTORY_INVALID');
  }

  const appliedMigrationNames = readAppliedMigrationNames(database, manifest);
  assertAppliedMigrationsAreManifestPrefix(appliedMigrationNames, manifest);
  const finalEntry = manifest[appliedMigrationNames.length - 1];

  return {
    appliedMigrationNames,
    migrationChainIdentity: finalEntry?.chainSha256 ?? '',
  };
}

export function createMigrationTable(database: DatabaseConnection): void {
  database.exec(`
    CREATE TABLE schema_migrations (
      name TEXT PRIMARY KEY,
      run_at TEXT NOT NULL
    );
  `);
}

export function createMigrationMetadataTable(database: DatabaseConnection): void {
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

function insertMigrationMetadata(
  database: DatabaseConnection,
  input: {
    entry: MigrationManifestEntry;
    metadataOrigin: 'applied' | 'legacy_baseline';
    recordedAt: string;
    releaseIdentity: MigrationReleaseIdentity;
  },
): void {
  database
    .prepare<
      [string, number, string, string, string, string, string, string]
    >(
      `
        INSERT INTO schema_migration_metadata (
          migration_name,
          metadata_version,
          source_sha256,
          chain_sha256,
          metadata_origin,
          recorded_app_version,
          recorded_build_revision,
          recorded_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
    )
    .run(
      input.entry.fileName,
      migrationMetadataVersion,
      input.entry.sourceSha256,
      input.entry.chainSha256,
      input.metadataOrigin,
      input.releaseIdentity.appVersion,
      input.releaseIdentity.buildRevision,
      input.recordedAt,
    );
}

function assertMetadataMatchesManifest(
  database: DatabaseConnection,
  appliedMigrationNames: readonly string[],
  manifest: readonly MigrationManifestEntry[],
): void {
  let rows: MigrationMetadataRow[];

  try {
    rows = database
      .prepare<[number, number], MigrationMetadataRow>(
        `
          SELECT
            CASE WHEN length(CAST(migration_name AS BLOB)) <= ?
              THEN migration_name END AS migration_name,
            CASE WHEN typeof(metadata_version) = 'integer'
              THEN metadata_version END AS metadata_version,
            CASE WHEN length(CAST(source_sha256 AS BLOB)) <= 64
              THEN source_sha256 END AS source_sha256,
            CASE WHEN length(CAST(chain_sha256 AS BLOB)) <= 64
              THEN chain_sha256 END AS chain_sha256,
            CASE WHEN length(CAST(metadata_origin AS BLOB)) <= 15
              THEN metadata_origin END AS metadata_origin,
            CASE WHEN length(CAST(recorded_app_version AS BLOB)) <= 80
              THEN recorded_app_version END AS recorded_app_version,
            CASE WHEN length(CAST(recorded_build_revision AS BLOB)) <= 40
              THEN recorded_build_revision END AS recorded_build_revision,
            CASE WHEN length(CAST(recorded_at AS BLOB)) <= 27
              THEN recorded_at END AS recorded_at
          FROM main.schema_migration_metadata
          ORDER BY schema_migration_metadata.migration_name
          LIMIT ?
        `,
      )
      .all(maximumMigrationNameBytes(manifest), manifest.length + 1);
  } catch (error) {
    if (isSqliteMemoryError(error)) throw error;
    throw new Error('MIGRATION_HISTORY_INVALID');
  }

  if (rows.length !== appliedMigrationNames.length) {
    throw new Error('MIGRATION_HISTORY_INVALID');
  }

  rows.forEach((row, index) => {
    const expectedName = appliedMigrationNames[index];
    const expectedEntry = manifest[index];

    if (
      expectedEntry === undefined ||
      row.migration_name !== expectedName ||
      row.migration_name !== expectedEntry.fileName ||
      row.metadata_version !== migrationMetadataVersion ||
      row.source_sha256 !== expectedEntry.sourceSha256 ||
      row.chain_sha256 !== expectedEntry.chainSha256 ||
      (row.metadata_origin !== 'legacy_baseline' &&
        row.metadata_origin !== 'applied') ||
      typeof row.recorded_app_version !== 'string' ||
      !safeAppVersionPattern.test(row.recorded_app_version) ||
      typeof row.recorded_build_revision !== 'string' ||
      !safeBuildRevisionPattern.test(row.recorded_build_revision) ||
      typeof row.recorded_at !== 'string' ||
      !isIsoTimestamp(row.recorded_at)
    ) {
      throw new Error('MIGRATION_HISTORY_INVALID');
    }
  });
}

function readAppliedMigrationNames(
  database: DatabaseConnection,
  manifest: readonly MigrationManifestEntry[],
): string[] {
  try {
    return database
      .prepare<[number, number], { name: string }>(
        `SELECT CASE WHEN length(CAST(name AS BLOB)) <= ? THEN name END AS name
         FROM main.schema_migrations ORDER BY schema_migrations.name LIMIT ?`,
      )
      .all(maximumMigrationNameBytes(manifest), manifest.length + 1)
      .map(({ name }) => name);
  } catch (error) {
    if (isSqliteMemoryError(error)) throw error;
    throw new Error('MIGRATION_HISTORY_INVALID');
  }
}

function maximumMigrationNameBytes(manifest: readonly MigrationManifestEntry[]): number {
  return Math.max(0, ...manifest.map(entry => Buffer.byteLength(entry.fileName, 'utf8')));
}

function assertAppliedMigrationsAreManifestPrefix(
  appliedMigrationNames: readonly string[],
  manifest: readonly MigrationManifestEntry[],
): void {
  if (
    appliedMigrationNames.length > manifest.length ||
    appliedMigrationNames.some(
      (migrationName, index) =>
        migrationName !== manifest[index]?.fileName,
    )
  ) {
    throw new Error('MIGRATION_HISTORY_INVALID');
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

function validateReleaseIdentity(identity: MigrationReleaseIdentity): void {
  if (
    !safeAppVersionPattern.test(identity.appVersion) ||
    !safeBuildRevisionPattern.test(identity.buildRevision)
  ) {
    throw new Error('MIGRATION_RELEASE_IDENTITY_INVALID');
  }
}

function validateRecordedAt(recordedAt: string): void {
  if (!isIsoTimestamp(recordedAt)) {
    throw new Error('MIGRATION_RECORDED_AT_INVALID');
  }
}

function isIsoTimestamp(value: string): boolean {
  const date = new Date(value);
  return !Number.isNaN(date.valueOf()) && date.toISOString() === value;
}
