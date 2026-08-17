import Database from 'better-sqlite3';
import {
  copyFile,
  cp,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

import { runMigrations } from '../../database/migration/runMigrations.js';
import { inspectSqliteProfileDatabase } from './inspectSqliteProfileDatabase.js';

const approvedLegacyMigrationChainIdentity =
  '5e841ae5c530da82d7dee0c8e2ed8480b23aca944a0faa64a8fcd0b9011b6503';
const publishedMigrationsDirectory = fileURLToPath(
  new URL('../../database/migrations/', import.meta.url),
);
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) =>
      rm(root, { force: true, recursive: true }),
    ),
  );
});

describe('SQLite profile database migration compatibility', () => {
  it('accepts the approved metadata-less legacy anchor only for restore staging', async () => {
    const databasePath = await createPublishedDatabase({
      removeMigrationMetadata: true,
    });

    expect(() =>
      inspectSqliteProfileDatabase(
        databasePath,
        publishedMigrationsDirectory,
      ),
    ).toThrow('MIGRATION_HISTORY_INVALID');
    expect(() =>
      inspectSqliteProfileDatabase(
        databasePath,
        publishedMigrationsDirectory,
        'compatibleHistoricalPrefix',
      ),
    ).toThrow('MIGRATION_HISTORY_INVALID');

    expect(
      inspectSqliteProfileDatabase(
        databasePath,
        publishedMigrationsDirectory,
        'restoreCompatible',
      ),
    ).toEqual({
      migrationChainIdentity: approvedLegacyMigrationChainIdentity,
      profileId: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
  });

  it('rejects incomplete, future and changed metadata-less histories', async () => {
    const baselinePath = await createPublishedDatabase({
      removeMigrationMetadata: true,
    });
    const missingMiddlePath = await copyDatabaseFixture(
      baselinePath,
      'missing-middle',
    );
    mutateDatabase(missingMiddlePath, (database) => {
      database
        .prepare('DELETE FROM schema_migrations WHERE name = ?')
        .run('020_relax_invoice_line_unit_checks.sql');
    });

    const futurePath = await copyDatabaseFixture(baselinePath, 'future');
    mutateDatabase(futurePath, (database) => {
      database
        .prepare(
          'INSERT INTO schema_migrations (name, run_at) VALUES (?, ?)',
        )
        .run('999_future.sql', '2026-08-14T00:00:00.000Z');
    });

    const changedHistoryPath = await copyDatabaseFixture(
      baselinePath,
      'changed-history',
    );
    const changedMigrationsRoot = await mkdtemp(
      join(tmpdir(), 'eky-changed-legacy-migrations-'),
    );
    temporaryRoots.push(changedMigrationsRoot);
    await cp(publishedMigrationsDirectory, changedMigrationsRoot, {
      recursive: true,
    });
    const changedMigrationPath = join(
      changedMigrationsRoot,
      '001_create_customers.sql',
    );
    await writeFile(
      changedMigrationPath,
      `${await readFile(changedMigrationPath, 'utf8')}\n-- changed history\n`,
      'utf8',
    );

    for (const [databasePath, migrationsDirectory] of [
      [missingMiddlePath, publishedMigrationsDirectory],
      [futurePath, publishedMigrationsDirectory],
      [changedHistoryPath, changedMigrationsRoot],
    ] as const) {
      expect(() =>
        inspectSqliteProfileDatabase(
          databasePath,
          migrationsDirectory,
          'restoreCompatible',
        ),
      ).toThrow('MIGRATION_HISTORY_INVALID');
    }
  });

  it('does not treat corrupt current metadata as an approved legacy database', async () => {
    const databasePath = await createPublishedDatabase();
    mutateDatabase(databasePath, (database) => {
      database.exec('DELETE FROM schema_migration_metadata;');
    });

    expect(() =>
      inspectSqliteProfileDatabase(
        databasePath,
        publishedMigrationsDirectory,
        'restoreCompatible',
      ),
    ).toThrow('MIGRATION_HISTORY_INVALID');
  });

  it('anchors approved legacy history before normal startup continues', async () => {
    const databasePath = await createPublishedDatabase({
      removeMigrationMetadata: true,
    });

    inspectSqliteProfileDatabase(
      databasePath,
      publishedMigrationsDirectory,
      'restoreCompatible',
    );

    const database = new Database(databasePath);
    await runMigrations(database, {
      migrationsDirectory: publishedMigrationsDirectory,
      now: () => new Date('2026-08-14T12:00:00.000Z'),
      releaseIdentity: {
        appVersion: '0.1.0-alpha.1',
        buildRevision: '3256bc3fa6cba3d719cdf0e877bd1862daf5dc45',
      },
    });
    const metadataRows = database
      .prepare(
        `
          SELECT metadata_origin
          FROM schema_migration_metadata
          ORDER BY migration_name
        `,
      )
      .all() as Array<{ metadata_origin: string }>;
    database.close();

    expect(metadataRows).toHaveLength(38);
    expect(
      metadataRows.every(
        ({ metadata_origin }) => metadata_origin === 'legacy_baseline',
      ),
    ).toBe(true);
    expect(
      inspectSqliteProfileDatabase(
        databasePath,
        publishedMigrationsDirectory,
      ).migrationChainIdentity,
    ).toBe(approvedLegacyMigrationChainIdentity);
  });
});

async function createPublishedDatabase(
  options: { removeMigrationMetadata?: boolean } = {},
): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'eky-legacy-profile-'));
  temporaryRoots.push(root);
  const databasePath = join(root, 'profile.sqlite');
  const database = new Database(databasePath);
  await runMigrations(database, {
    migrationsDirectory: publishedMigrationsDirectory,
  });

  if (options.removeMigrationMetadata) {
    database.exec('DROP TABLE schema_migration_metadata;');
  }
  database.close();
  return databasePath;
}

async function copyDatabaseFixture(
  sourceDatabasePath: string,
  scenario: 'missing-middle' | 'future' | 'changed-history',
): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), `eky-${scenario}-profile-`));
  temporaryRoots.push(root);
  const databasePath = join(root, 'profile.sqlite');
  await copyFile(sourceDatabasePath, databasePath);
  return databasePath;
}

function mutateDatabase(
  databasePath: string,
  mutate: (database: Database.Database) => void,
): void {
  const database = new Database(databasePath);
  try {
    database.pragma('foreign_keys = OFF');
    mutate(database);
  } finally {
    database.close();
  }
}
