import { createHash } from 'node:crypto';
import Database from 'better-sqlite3';
import {
  chmod,
  copyFile,
  cp,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { readLocalRuntimeIdentity } from '../../database/localRuntimeIdentityReader.js';
import { runMigrations } from '../../database/migration/runMigrations.js';
import { createProfileBackupIdentity } from '../profileSnapshot/inspectSqliteProfileDatabase.js';
import { inspectPublishedWorkspaceMigration } from './inspectPublishedWorkspaceMigration.js';

const migrationsDirectory = fileURLToPath(
  new URL('../../database/migrations/', import.meta.url),
);
const releaseIdentity = Object.freeze({
  appVersion: '0.2.6',
  buildRevision: 'a'.repeat(40),
});
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) =>
      rm(root, { force: true, recursive: true }),
    ),
  );
});

describe('inspectPublishedWorkspaceMigration', () => {
  it('classifies current and compatible prefix databases without writes', async () => {
    const current = await createWorkspaceFixture();
    const prefixMigrations = await createHistoricalPrefixMigrations();
    const compatible = await createWorkspaceFixture(prefixMigrations);

    await expectUnchangedInspection(current, {
      appliedMigrationCount: current.migrationCount,
      kind: 'migrationInspection',
      pendingMigrationCount: 0,
      status: 'current',
    });
    await expectUnchangedInspection(
      compatible,
      {
        appliedMigrationCount: compatible.migrationCount,
        kind: 'migrationInspection',
        pendingMigrationCount:
          current.migrationCount - compatible.migrationCount,
        status: 'compatiblePending',
      },
      migrationsDirectory,
    );
  });

  it('classifies changed, missing-middle, duplicate and unknown histories as invalid without writes', async () => {
    const scenarios: Array<(
      database: Database.Database,
    ) => void> = [
      (database) => {
        database
          .prepare(
            'UPDATE schema_migration_metadata SET source_sha256 = ? WHERE migration_name = (SELECT min(name) FROM schema_migrations)',
          )
          .run('b'.repeat(64));
      },
      (database) => {
        database.pragma('foreign_keys = OFF');
        const name = database
          .prepare('SELECT name FROM schema_migrations ORDER BY name LIMIT 1 OFFSET 4')
          .pluck()
          .get() as string;
        database
          .prepare('DELETE FROM schema_migration_metadata WHERE migration_name = ?')
          .run(name);
        database.prepare('DELETE FROM schema_migrations WHERE name = ?').run(name);
      },
      (database) => {
        database.pragma('foreign_keys = OFF');
        database.exec(`
          CREATE TABLE duplicate_schema_migrations AS
            SELECT name, run_at FROM schema_migrations;
          DROP TABLE schema_migrations;
          ALTER TABLE duplicate_schema_migrations RENAME TO schema_migrations;
        `);
        const first = database
          .prepare('SELECT name, run_at FROM schema_migrations ORDER BY name LIMIT 1')
          .get() as { name: string; run_at: string };
        database
          .prepare('INSERT INTO schema_migrations (name, run_at) VALUES (?, ?)')
          .run(first.name, first.run_at);
      },
      (database) => {
        database.pragma('foreign_keys = OFF');
        database
          .prepare('INSERT INTO schema_migrations (name, run_at) VALUES (?, ?)')
          .run('999_future.sql', '2026-08-21T00:00:00.000Z');
      },
    ];

    for (const mutate of scenarios) {
      const fixture = await createWorkspaceFixture();
      mutateDatabase(fixture.databaseFilePath, mutate);
      await expectUnchangedInspection(fixture, {
        appliedMigrationCount: 0,
        kind: 'migrationInspection',
        pendingMigrationCount: 0,
        status: 'invalidHistory',
      });
    }
  });

  it('classifies a corrupt database as invalid without creating sidecars', async () => {
    const fixture = await createWorkspaceFixture();
    await writeFile(fixture.databaseFilePath, 'not a sqlite database', 'utf8');

    await expectUnchangedInspection(fixture, {
      appliedMigrationCount: 0,
      kind: 'migrationInspection',
      pendingMigrationCount: 0,
      status: 'invalidHistory',
    });
  });

  it('fails closed for a missing database and wrong profile identity', async () => {
    const fixture = await createWorkspaceFixture();

    await expect(
      inspectPublishedWorkspaceMigration({
        ...releaseIdentity,
        databaseFilePath: join(fixture.publishedRoot, 'missing.sqlite'),
        expectedProfileId: fixture.expectedProfileId,
        migrationsDirectory,
        publishedRoot: fixture.publishedRoot,
      }),
    ).rejects.toThrow();
    await expect(readdir(fixture.publishedRoot)).resolves.toEqual([
      'profile.sqlite',
    ]);

    await expectUnchangedRejection(
      fixture,
      'f'.repeat(64),
      'WORKSPACE_MIGRATION_PROFILE_MISMATCH',
    );
  });

  it('fails closed for a wrong identity before classifying invalid migration history', async () => {
    const fixture = await createWorkspaceFixture();
    mutateDatabase(fixture.databaseFilePath, (database) => {
      database
        .prepare(
          'UPDATE schema_migration_metadata SET source_sha256 = ? WHERE migration_name = (SELECT min(name) FROM schema_migrations)',
        )
        .run('b'.repeat(64));
    });

    await expectUnchangedRejection(
      fixture,
      'f'.repeat(64),
      'WORKSPACE_MIGRATION_PROFILE_MISMATCH',
    );
  });

  it('fails closed for missing identity before classifying invalid migration history', async () => {
    const fixture = await createWorkspaceFixture();
    mutateDatabase(fixture.databaseFilePath, (database) => {
      database
        .prepare(
          'UPDATE schema_migration_metadata SET source_sha256 = ? WHERE migration_name = (SELECT min(name) FROM schema_migrations)',
        )
        .run('b'.repeat(64));
      database
        .prepare(
          "DELETE FROM local_runtime_identity WHERE singleton_key = 'local-runtime'",
        )
        .run();
    });

    await expectUnchangedRejection(
      fixture,
      fixture.expectedProfileId,
      'WORKSPACE_MIGRATION_PROFILE_IDENTITY_INVALID',
    );
  });

  it('cancels before opening the database and leaves it unchanged', async () => {
    const fixture = await createWorkspaceFixture();
    const before = await sha256(fixture.databaseFilePath);
    const controller = new AbortController();
    controller.abort();

    await expect(
      inspectPublishedWorkspaceMigration(
        {
          ...releaseIdentity,
          databaseFilePath: fixture.databaseFilePath,
          expectedProfileId: fixture.expectedProfileId,
          migrationsDirectory,
          publishedRoot: fixture.publishedRoot,
        },
        controller.signal,
      ),
    ).rejects.toThrow('WORKSPACE_MIGRATION_INSPECTION_CANCELLED');
    expect(await sha256(fixture.databaseFilePath)).toBe(before);
  });
});

interface WorkspaceFixture {
  readonly databaseFilePath: string;
  readonly expectedProfileId: string;
  readonly migrationCount: number;
  readonly publishedRoot: string;
}

async function createWorkspaceFixture(
  fixtureMigrationsDirectory = migrationsDirectory,
): Promise<WorkspaceFixture> {
  const publishedRoot = await createPrivateTemporaryRoot(
    'eky-workspace-migration-',
  );
  const databaseFilePath = join(publishedRoot, 'profile.sqlite');
  const database = new Database(databaseFilePath);
  await runMigrations(database, {
    migrationsDirectory: fixtureMigrationsDirectory,
    releaseIdentity,
  });
  const expectedProfileId = createProfileBackupIdentity(
    readLocalRuntimeIdentity(database).companyId,
  );
  const migrationCount = (
    database.prepare('SELECT count(*) FROM schema_migrations').pluck().get() as number
  );
  database.close();
  return {
    databaseFilePath,
    expectedProfileId,
    migrationCount,
    publishedRoot,
  };
}

async function createHistoricalPrefixMigrations(): Promise<string> {
  const root = await createPrivateTemporaryRoot(
    'eky-workspace-prefix-migrations-',
  );
  await cp(migrationsDirectory, root, { recursive: true });
  const migrationNames = (await readdir(root))
    .filter((name) => name.endsWith('.sql'))
    .sort();
  const lastMigrationName = migrationNames.at(-1);
  if (lastMigrationName === undefined) throw new Error('invalid fixture');
  await rm(join(root, lastMigrationName));
  if (process.platform !== 'win32') await chmod(root, 0o755);
  return root;
}

async function createPrivateTemporaryRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  temporaryRoots.push(root);
  if (process.platform !== 'win32') await chmod(root, 0o700);
  return root;
}

async function expectUnchangedInspection(
  fixture: WorkspaceFixture,
  expected: object,
  expectedMigrationsDirectory = migrationsDirectory,
): Promise<void> {
  const before = await snapshotDatabase(fixture);
  await expect(
    inspectPublishedWorkspaceMigration({
      ...releaseIdentity,
      databaseFilePath: fixture.databaseFilePath,
      expectedProfileId: fixture.expectedProfileId,
      migrationsDirectory: expectedMigrationsDirectory,
      publishedRoot: fixture.publishedRoot,
    }),
  ).resolves.toEqual(expected);
  expect(await snapshotDatabase(fixture)).toEqual(before);
}

async function expectUnchangedRejection(
  fixture: WorkspaceFixture,
  expectedProfileId: string,
  expectedError: string,
): Promise<void> {
  const before = await snapshotDatabase(fixture);
  await expect(
    inspectPublishedWorkspaceMigration({
      ...releaseIdentity,
      databaseFilePath: fixture.databaseFilePath,
      expectedProfileId,
      migrationsDirectory,
      publishedRoot: fixture.publishedRoot,
    }),
  ).rejects.toThrow(expectedError);
  expect(await snapshotDatabase(fixture)).toEqual(before);
}

function mutateDatabase(
  databaseFilePath: string,
  mutate: (database: Database.Database) => void,
): void {
  const database = new Database(databaseFilePath);
  try {
    mutate(database);
  } finally {
    database.close();
  }
}

async function sha256(path: string): Promise<string> {
  return createHash('sha256').update(await readFile(path)).digest('hex');
}

async function snapshotDatabase(fixture: WorkspaceFixture) {
  const metadata = await stat(fixture.databaseFilePath);
  return {
    fileNames: (await readdir(fixture.publishedRoot)).sort(),
    mtimeMs: metadata.mtimeMs,
    sha256: await sha256(fixture.databaseFilePath),
    size: metadata.size,
  };
}
