import type { DatabaseConnection } from '../connection/createDatabaseConnection.js';
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
  appliedMigrationNames: string[];
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

  const appliedMigrationNames = readAppliedMigrationNames(database);
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

  const appliedMigrationNames = readAppliedMigrationNames(database);
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
  if (
    !tableExists(database, 'schema_migrations') ||
    tableExists(database, 'schema_migration_metadata')
  ) {
    throw new Error('MIGRATION_HISTORY_INVALID');
  }

  const appliedMigrationNames = readAppliedMigrationNames(database);
  assertAppliedMigrationsAreManifestPrefix(appliedMigrationNames, manifest);
  const finalEntry = manifest[appliedMigrationNames.length - 1];

  if (
    appliedMigrationNames.length !==
      approvedLegacyMigrationAnchor.migrationCount ||
    finalEntry?.fileName !== approvedLegacyMigrationAnchor.migrationName ||
    finalEntry.chainSha256 !==
      approvedLegacyMigrationAnchor.migrationChainIdentity
  ) {
    throw new Error('MIGRATION_HISTORY_INVALID');
  }

  return {
    appliedMigrationNames,
    migrationChainIdentity: finalEntry.chainSha256,
  };
}

function createMigrationTable(database: DatabaseConnection): void {
  database.exec(`
    CREATE TABLE schema_migrations (
      name TEXT PRIMARY KEY,
      run_at TEXT NOT NULL
    );
  `);
}

function createMigrationMetadataTable(database: DatabaseConnection): void {
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
      .prepare<[], MigrationMetadataRow>(
        `
          SELECT
            migration_name,
            metadata_version,
            source_sha256,
            chain_sha256,
            metadata_origin,
            recorded_app_version,
            recorded_build_revision,
            recorded_at
          FROM schema_migration_metadata
          ORDER BY migration_name
        `,
      )
      .all();
  } catch {
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
      !safeAppVersionPattern.test(row.recorded_app_version) ||
      !safeBuildRevisionPattern.test(row.recorded_build_revision) ||
      !isIsoTimestamp(row.recorded_at)
    ) {
      throw new Error('MIGRATION_HISTORY_INVALID');
    }
  });
}

function readAppliedMigrationNames(database: DatabaseConnection): string[] {
  try {
    return database
      .prepare<[], { name: string }>(
        'SELECT name FROM schema_migrations ORDER BY name',
      )
      .all()
      .map(({ name }) => name);
  } catch {
    throw new Error('MIGRATION_HISTORY_INVALID');
  }
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
