import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createDatabaseConnection } from '../connection/createDatabaseConnection.js';
import { inspectMigrationStartupState } from './inspectMigrationStartupState.js';
import { runMigrations } from './runMigrations.js';

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
});

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
