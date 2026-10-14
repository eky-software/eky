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

import { afterEach, describe, expect, it, vi } from 'vitest';

import * as identityReader from '../../database/localRuntimeIdentityReader.js';
import { readLocalRuntimeIdentity } from '../../database/localRuntimeIdentityReader.js';
import { interruptSqliteTransaction } from '../../database/connection/hotJournal.fixture.js';
import { runMigrations } from '../../database/migration/runMigrations.js';
import { readMigrationManifest } from '../../database/migration/migrationManifest.js';
import { createHistorical038Schema } from '../../database/migration/migrationSchemaHistory.fixture.js';
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
type MigrationHistoryMutation = (database: Database.Database) => void;

const invalidHistoryScenarios: ReadonlyArray<
  readonly [name: string, mutate: MigrationHistoryMutation]
> = [
  [
    'changed',
    (database) => {
      database
        .prepare(
          'UPDATE schema_migration_metadata SET source_sha256 = ? WHERE migration_name = (SELECT min(name) FROM schema_migrations)',
        )
        .run('b'.repeat(64));
    },
  ],
  [
    'missing-middle',
    (database) => {
      database.pragma('foreign_keys = OFF');
      const name = database
        .prepare(
          'SELECT name FROM schema_migrations ORDER BY name LIMIT 1 OFFSET 4',
        )
        .pluck()
        .get() as string;
      database
        .prepare(
          'DELETE FROM schema_migration_metadata WHERE migration_name = ?',
        )
        .run(name);
      database.prepare('DELETE FROM schema_migrations WHERE name = ?').run(name);
    },
  ],
  [
    'duplicate',
    (database) => {
      database.pragma('foreign_keys = OFF');
      database.exec(`
        CREATE TABLE duplicate_schema_migrations AS
          SELECT name, run_at FROM schema_migrations;
        DROP TABLE schema_migrations;
        ALTER TABLE duplicate_schema_migrations RENAME TO schema_migrations;
      `);
      const first = database
        .prepare(
          'SELECT name, run_at FROM schema_migrations ORDER BY name LIMIT 1',
        )
        .get() as { name: string; run_at: string };
      database
        .prepare('INSERT INTO schema_migrations (name, run_at) VALUES (?, ?)')
        .run(first.name, first.run_at);
    },
  ],
  [
    'unknown',
    (database) => {
      database.pragma('foreign_keys = OFF');
      database
        .prepare('INSERT INTO schema_migrations (name, run_at) VALUES (?, ?)')
        .run('999_future.sql', '2026-08-21T00:00:00.000Z');
    },
  ],
];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    temporaryRoots.splice(0).map((root) =>
      rm(root, { force: true, recursive: true }),
    ),
  );
});

describe('inspectPublishedWorkspaceMigration', () => {
  it('rolls back a proved local interrupted transaction before inspecting the real migration schema and identity', async () => {
    const fixture = await createInterruptedWorkspace();
    const assertOwnedDatabase = vi.fn(async (path: string) => {
      expect(path).toBe(fixture.databaseFilePath);
    });
    const inspection = await inspectPublishedWorkspaceMigration({
      ...fixture, ...releaseIdentity, migrationsDirectory,
    }, undefined, { assertOwnedDatabase, signal: new AbortController().signal });
    expect(inspection).toEqual({
      kind: 'migrationInspection', status: 'current',
      appliedMigrationCount: fixture.migrationCount, pendingMigrationCount: 0,
    });
    const database = new Database(fixture.databaseFilePath, { readonly: true });
    try {
      expect(database.prepare("SELECT COUNT(*) AS count FROM customers WHERE name = 'uncommitted'")
        .get()).toEqual({ count: 0 });
      expect(database.prepare('SELECT COUNT(*) AS count FROM customers').get()).toEqual({ count: 200 });
    } finally { database.close(); }
    expect(assertOwnedDatabase).toHaveBeenCalledTimes(3);
  });

  it('does not infer recovery authority from the published operation or directory', async () => {
    const fixture = await createInterruptedWorkspace();
    const before = await sha256(fixture.databaseFilePath);
    const journal = await sha256(fixture.databaseFilePath + '-journal');
    const readIdentity = vi.spyOn(identityReader, 'readLocalRuntimeIdentity');
    await expect(inspectPublishedWorkspaceMigration({
      ...fixture, ...releaseIdentity, migrationsDirectory,
    })).rejects.toThrow();
    expect(readIdentity).not.toHaveBeenCalled();
    expect(await sha256(fixture.databaseFilePath)).toBe(before);
    expect(await sha256(fixture.databaseFilePath + '-journal')).toBe(journal);
  });

  it('still rejects an untrusted recovered schema before identity and without a business migration', async () => {
    const fixture = await createInterruptedWorkspace(true);
    const readIdentity = vi.spyOn(identityReader, 'readLocalRuntimeIdentity');
    await expect(inspectPublishedWorkspaceMigration({
      ...fixture, ...releaseIdentity, migrationsDirectory,
    }, undefined, {
      assertOwnedDatabase: async () => {}, signal: new AbortController().signal,
    })).rejects.toThrow('PROFILE_SCHEMA_UNSUPPORTED');
    expect(readIdentity).not.toHaveBeenCalled();
    const database = new Database(fixture.databaseFilePath, { readonly: true });
    try {
      expect(database.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get())
        .toEqual({ count: fixture.migrationCount });
      expect(database.prepare("SELECT COUNT(*) AS count FROM customers WHERE name = 'uncommitted'")
        .get()).toEqual({ count: 0 });
      expect(database.prepare("SELECT type FROM sqlite_schema WHERE name = 'unexpected_workspace_view'")
        .get()).toEqual({ type: 'view' });
    } finally { database.close(); }
  });

  it.each([
    'CREATE VIEW unexpected_workspace_view AS SELECT 1;',
    `DROP TABLE local_runtime_identity;
     CREATE VIEW local_runtime_identity AS
       SELECT 'local-runtime' AS singleton_key,
         json('not-json') AS company_id,
         'not-an-actor' AS actor_id,
         'not-an-installation' AS installation_id;`,
  ])('rejects untrusted schema before identity or invalid-history classification: %s', async (sql) => {
    const fixture = await createWorkspaceFixture();
    mutateDatabase(fixture.databaseFilePath, (database) => {
      database.pragma('foreign_keys = OFF');
      database.exec(sql);
    });
    const readIdentity = vi.spyOn(identityReader, 'readLocalRuntimeIdentity');

    await expectUnchangedRejection(
      fixture,
      fixture.expectedProfileId,
      'PROFILE_SCHEMA_UNSUPPORTED',
    );
    expect(readIdentity).not.toHaveBeenCalled();
  });

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

  it.each(invalidHistoryScenarios)(
    'rejects unproven %s migration history without reading identity or changing files',
    async (name, mutate) => {
      const fixture = await createWorkspaceFixture();
      mutateDatabase(fixture.databaseFilePath, mutate);
      const readIdentity = vi.spyOn(identityReader, 'readLocalRuntimeIdentity');
      await expectUnchangedRejection(
        fixture,
        fixture.expectedProfileId,
        name === 'duplicate' ? 'PROFILE_SCHEMA_UNSUPPORTED' : 'MIGRATION_HISTORY_INVALID',
      );
      expect(readIdentity).not.toHaveBeenCalled();
    },
  );

  it('rejects an unreadable schema without guessing identity or creating sidecars', async () => {
    const fixture = await createWorkspaceFixture();
    await writeFile(fixture.databaseFilePath, 'not a sqlite database', 'utf8');

    const readIdentity = vi.spyOn(identityReader, 'readLocalRuntimeIdentity');
    await expectUnchangedRejection(fixture, fixture.expectedProfileId);
    expect(readIdentity).not.toHaveBeenCalled();
  });

  it('keeps trusted-schema foreign-key content errors classified as invalid history', async () => {
    const fixture = await createWorkspaceFixture();
    mutateDatabase(fixture.databaseFilePath, (database) => {
      database.pragma('foreign_keys = OFF');
      database.exec(`INSERT INTO invoice_payment_events (
        id, company_id, invoice_id, actor_user_id, action, payment_source,
        paid_on, amount_cents, occurred_at
      ) VALUES (
        'synthetic-payment', 'synthetic-company', 'missing-invoice',
        'synthetic-actor', 'paymentMarkedPaid', 'manual',
        '2026-01-01', 1, '2026-01-01T00:00:00.000Z'
      );`);
    });

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

  it('does not use a wrong identity to bypass unproven migration history', async () => {
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
      'MIGRATION_HISTORY_INVALID',
    );
  });

  it('does not inspect missing identity when migration history is unproven', async () => {
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
      'MIGRATION_HISTORY_INVALID',
    );
  });

  it('rejects missing identity only after schema and history are trusted', async () => {
    const fixture = await createWorkspaceFixture();
    mutateDatabase(fixture.databaseFilePath, (database) => {
      database.prepare("DELETE FROM local_runtime_identity WHERE singleton_key = 'local-runtime'").run();
    });

    await expectUnchangedRejection(
      fixture,
      fixture.expectedProfileId,
      'WORKSPACE_MIGRATION_PROFILE_IDENTITY_INVALID',
    );
  });

  it('does not use the restore-only metadata-less historical exception for inventory', async () => {
    const fixture = await createWorkspaceFixture(await createHistoricalPrefixMigrations());
    mutateDatabase(fixture.databaseFilePath, (database) => {
      database.exec('DROP TABLE schema_migration_metadata;');
    });

    await expectUnchangedRejection(
      fixture,
      fixture.expectedProfileId,
      'MIGRATION_HISTORY_INVALID',
    );
  });

  it.each([false, true])('keeps the approved038 inventory boundary distinct from restore admission (metadata=%s)', async withMetadata => {
    const publishedRoot = await createPrivateTemporaryRoot('eky-workspace-approved038-');
    const databaseFilePath = join(publishedRoot, 'profile.sqlite');
    const database = new Database(databaseFilePath);
    let expectedProfileId: string;
    try {
      createHistorical038Schema(database, readMigrationManifest(migrationsDirectory), withMetadata);
      expectedProfileId = createProfileBackupIdentity(readLocalRuntimeIdentity(database).companyId);
    } finally { database.close(); }
    const fixture = { publishedRoot, databaseFilePath, expectedProfileId, migrationCount: 38 };
    const readIdentity = vi.spyOn(identityReader, 'readLocalRuntimeIdentity');
    if (withMetadata) {
      await expectUnchangedInspection(fixture, {
        kind: 'migrationInspection', status: 'compatiblePending', appliedMigrationCount: 38,
        pendingMigrationCount: readMigrationManifest(migrationsDirectory).length - 38,
      });
      expect(readIdentity).toHaveBeenCalledOnce();
    } else {
      await expectUnchangedRejection(fixture, expectedProfileId, 'MIGRATION_HISTORY_INVALID');
      expect(readIdentity).not.toHaveBeenCalled();
    }
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

async function createInterruptedWorkspace(untrustedSchema = false): Promise<WorkspaceFixture> {
  const fixture = await createWorkspaceFixture();
  mutateDatabase(fixture.databaseFilePath, database => {
    const companyId = readLocalRuntimeIdentity(database).companyId;
    const insert = database.prepare('INSERT INTO customers (id, company_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)');
    database.transaction(() => {
      for (let index = 0; index < 200; index++) {
        insert.run(`synthetic-${index}`, companyId, 'committed-' + 'x'.repeat(4096),
          '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
      }
    })();
    if (untrustedSchema) database.exec('CREATE VIEW unexpected_workspace_view AS SELECT 1;');
  });
  await interruptSqliteTransaction(fixture.databaseFilePath, "UPDATE customers SET name = 'uncommitted'");
  return fixture;
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
  expectedError?: string,
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
