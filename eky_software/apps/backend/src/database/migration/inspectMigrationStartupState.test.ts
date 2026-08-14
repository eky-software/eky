import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { createDatabaseConnection } from '../connection/createDatabaseConnection.js';
import { inspectMigrationStartupState } from './inspectMigrationStartupState.js';
import { readMigrationManifest } from './migrationManifest.js';
import { runMigrations } from './runMigrations.js';

const approvedLegacyMigrationChainIdentity =
  '5e841ae5c530da82d7dee0c8e2ed8480b23aca944a0faa64a8fcd0b9011b6503';
const publishedMigrationsDirectory = fileURLToPath(
  new URL('../migrations/', import.meta.url),
);
const temporaryRoots: string[] = [];

describe('inspectMigrationStartupState', () => {
  afterEach(async () => {
    const { rm } = await import('node:fs/promises');
    await Promise.all(
      temporaryRoots.splice(0).map((root) =>
        rm(root, { force: true, recursive: true }),
      ),
    );
  });

  it('reports a clean empty profile without creating migration tables', async () => {
    const fixture = await createFixture(2);
    const database = createDatabaseConnection({
      databaseFilePath: fixture.databaseFilePath,
    });

    expect(
      inspectMigrationStartupState(database, fixture.migrationsDirectory),
    ).toEqual({
      appliedMigrationCount: 0,
      migrationChainIdentity: '',
      pendingMigrationCount: 2,
      profileState: 'empty',
    });
    expect(readTableNames(database)).toEqual([]);
    database.close();
  });

  it('reports an existing healthy profile and pending forward migrations', async () => {
    const fixture = await createFixture(1);
    const database = createDatabaseConnection({
      databaseFilePath: fixture.databaseFilePath,
    });
    await runMigrations(database, {
      migrationsDirectory: fixture.migrationsDirectory,
    });
    await writeMigration(
      fixture.migrationsDirectory,
      2,
      'CREATE TABLE second_probe (id TEXT PRIMARY KEY);',
    );

    const inspection = inspectMigrationStartupState(
      database,
      fixture.migrationsDirectory,
    );

    expect(inspection).toMatchObject({
      appliedMigrationCount: 1,
      pendingMigrationCount: 1,
      profileState: 'existing',
    });
    expect(inspection.migrationChainIdentity).toMatch(/^[0-9a-f]{64}$/);
    expect(readTableNames(database)).not.toContain('second_probe');
    database.close();
  });

  it('fails closed for business tables without a migration history', async () => {
    const fixture = await createFixture(1);
    const database = createDatabaseConnection({
      databaseFilePath: fixture.databaseFilePath,
    });
    database.exec('CREATE TABLE unexpected_business_data (id TEXT);');

    expect(() =>
      inspectMigrationStartupState(database, fixture.migrationsDirectory),
    ).toThrow('MIGRATION_STARTUP_INSPECTION_FAILED');
    database.close();
  });

  it('fails closed when stored migration metadata no longer matches the source', async () => {
    const fixture = await createFixture(1);
    const database = createDatabaseConnection({
      databaseFilePath: fixture.databaseFilePath,
    });
    await runMigrations(database, {
      migrationsDirectory: fixture.migrationsDirectory,
    });
    await writeMigration(
      fixture.migrationsDirectory,
      1,
      'CREATE TABLE changed_probe (id TEXT PRIMARY KEY);',
    );

    expect(() =>
      inspectMigrationStartupState(database, fixture.migrationsDirectory),
    ).toThrow('MIGRATION_STARTUP_INSPECTION_FAILED');
    database.close();
  });

  it('allows the approved metadata-less legacy anchor only for restore startup and anchors it before normal startup', async () => {
    const databaseFilePath = await createApprovedLegacyDatabase();
    const database = createDatabaseConnection({ databaseFilePath });
    const manifest = readMigrationManifest(publishedMigrationsDirectory);

    expect(() =>
      inspectMigrationStartupState(
        database,
        publishedMigrationsDirectory,
      ),
    ).toThrow('MIGRATION_STARTUP_INSPECTION_FAILED');

    expect(
      inspectMigrationStartupState(
        database,
        publishedMigrationsDirectory,
        'restoreCompatible',
      ),
    ).toEqual({
      appliedMigrationCount: 38,
      migrationChainIdentity: approvedLegacyMigrationChainIdentity,
      pendingMigrationCount: manifest.length - 38,
      profileState: 'existing',
    });

    await runMigrations(database, {
      migrationsDirectory: publishedMigrationsDirectory,
      now: () => new Date('2026-08-14T12:00:00.000Z'),
      releaseIdentity: {
        appVersion: '0.1.0-alpha.1',
        buildRevision: '3256bc3fa6cba3d719cdf0e877bd1862daf5dc45',
      },
    });

    expect(
      inspectMigrationStartupState(
        database,
        publishedMigrationsDirectory,
      ),
    ).toEqual({
      appliedMigrationCount: manifest.length,
      migrationChainIdentity: manifest.at(-1)?.chainSha256 ?? '',
      pendingMigrationCount: 0,
      profileState: 'existing',
    });
    expect(
      database
        .prepare<[], { metadata_origin: string }>(
          'SELECT metadata_origin FROM schema_migration_metadata ORDER BY migration_name',
        )
        .all()
        .slice(0, 38)
        .every(({ metadata_origin }) => metadata_origin === 'legacy_baseline'),
    ).toBe(true);
    database.close();
  });

  it('rejects an incomplete metadata-less legacy history during restore startup', async () => {
    const databaseFilePath = await createApprovedLegacyDatabase();
    const database = createDatabaseConnection({ databaseFilePath });
    database
      .prepare('DELETE FROM schema_migrations WHERE name = ?')
      .run('020_relax_invoice_line_unit_checks.sql');

    expect(() =>
      inspectMigrationStartupState(
        database,
        publishedMigrationsDirectory,
        'restoreCompatible',
      ),
    ).toThrow('MIGRATION_STARTUP_INSPECTION_FAILED');
    database.close();
  });
});

async function createApprovedLegacyDatabase(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'eky-migration-legacy-startup-'));
  temporaryRoots.push(root);
  const databaseFilePath = join(root, 'profile.sqlite');
  const database = createDatabaseConnection({ databaseFilePath });
  const manifest = readMigrationManifest(publishedMigrationsDirectory);
  const legacyEntries = manifest.slice(0, 38);

  expect(legacyEntries.at(-1)?.fileName).toBe(
    '038_create_invoice_numbering_series_transitions.sql',
  );
  expect(legacyEntries.at(-1)?.chainSha256).toBe(
    approvedLegacyMigrationChainIdentity,
  );

  database.exec(`
    CREATE TABLE schema_migrations (
      name TEXT PRIMARY KEY,
      run_at TEXT NOT NULL
    );
  `);
  for (const entry of legacyEntries) {
    const applyMigration = database.transaction(() => {
      database.exec(entry.content.toString('utf8'));
      database
        .prepare<[string, string]>(
          'INSERT INTO schema_migrations (name, run_at) VALUES (?, ?)',
        )
        .run(entry.fileName, '2026-08-04T12:00:00.000Z');
    });
    applyMigration();
  }
  database.close();
  return databaseFilePath;
}

async function createFixture(migrationCount: number): Promise<{
  databaseFilePath: string;
  migrationsDirectory: string;
}> {
  const root = await mkdtemp(join(tmpdir(), 'eky-migration-preflight-'));
  temporaryRoots.push(root);
  const migrationsDirectory = join(root, 'migrations');
  const { mkdir } = await import('node:fs/promises');
  await mkdir(migrationsDirectory);

  for (let ordinal = 1; ordinal <= migrationCount; ordinal += 1) {
    await writeMigration(
      migrationsDirectory,
      ordinal,
      `CREATE TABLE probe_${ordinal} (id TEXT PRIMARY KEY);`,
    );
  }

  return {
    databaseFilePath: join(root, 'profile.sqlite'),
    migrationsDirectory,
  };
}

async function writeMigration(
  migrationsDirectory: string,
  ordinal: number,
  content: string,
): Promise<void> {
  await writeFile(
    join(
      migrationsDirectory,
      `${String(ordinal).padStart(3, '0')}_probe.sql`,
    ),
    content,
  );
}

function readTableNames(
  database: ReturnType<typeof createDatabaseConnection>,
): string[] {
  return database
    .prepare<[], { name: string }>(
      `
        SELECT name
        FROM sqlite_master
        WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
        ORDER BY name
      `,
    )
    .all()
    .map(({ name }) => name);
}
