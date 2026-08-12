import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';

import { runMigrations } from '../../database/migration/runMigrations.js';
import { ProfileMaintenanceState } from '../profileMaintenance/profileMaintenanceState.js';
import {
  createSqliteProfileSnapshotService,
  SqliteProfileSnapshotService,
} from './createSqliteProfileSnapshot.js';
import { inspectSqliteProfileDatabase } from './inspectSqliteProfileDatabase.js';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((path) =>
      rm(path, { force: true, recursive: true }),
    ),
  );
});

describe('SQLite profile snapshot', () => {
  it('BACKUP-SNAPSHOT-001 @critical backs up WAL data and verifies integrity, migrations and metadata', async () => {
    const fixture = await createFixture();
    const operationId = randomUUID();

    expect(() =>
      inspectSqliteProfileDatabase(
        fixture.database.name,
        fixture.migrationsDirectory,
      ),
    ).not.toThrow();
    await fixture.maintenanceState.begin(operationId, 1_000);
    const metadata = await fixture.service.createSqliteSnapshot({
      migrationPolicy: 'exactCurrentManifest',
      operationId,
      signal: new AbortController().signal,
    });

    const snapshotPath = join(
      fixture.stagingRoot,
      operationId,
      'profile.sqlite',
    );
    const snapshot = new Database(snapshotPath, {
      fileMustExist: true,
      readonly: true,
    });

    try {
      expect(
        snapshot
          .prepare<[], { value: string }>('SELECT value FROM probe')
          .all(),
      ).toEqual([{ value: 'committed-in-wal' }]);
      expect(snapshot.pragma('integrity_check', { simple: true })).toBe('ok');
      expect(snapshot.pragma('foreign_key_check')).toEqual([]);
    } finally {
      snapshot.close();
    }

    const file = await lstat(snapshotPath);
    expect(metadata).toEqual({
      databaseByteSize: file.size,
      logicalPath: 'profile.sqlite',
      sha256: await sha256(snapshotPath),
      totalPages: expect.any(Number),
    });
    expect(metadata.totalPages).toBeGreaterThan(0);
    expect(
      fixture.database
        .prepare<[], { value: string }>('SELECT value FROM probe')
        .get(),
    ).toEqual({ value: 'committed-in-wal' });

    fixture.maintenanceState.end(operationId);
    fixture.database.close();
  });

  it('requires the matching active maintenance operation', async () => {
    const fixture = await createFixture();
    const operationId = randomUUID();

    await expect(
      fixture.service.createSqliteSnapshot({
        migrationPolicy: 'exactCurrentManifest',
        operationId,
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow('PROFILE_MAINTENANCE_OPERATION_MISMATCH');
    await expect(
      lstat(join(fixture.stagingRoot, operationId)),
    ).rejects.toMatchObject({ code: 'ENOENT' });

    fixture.database.close();
  });

  it('rejects cancellation and removes its private operation staging', async () => {
    const fixture = await createFixture();
    const operationId = randomUUID();
    const controller = new AbortController();
    controller.abort();
    await fixture.maintenanceState.begin(operationId, 1_000);

    await expect(
      fixture.service.createSqliteSnapshot({
        migrationPolicy: 'exactCurrentManifest',
        operationId,
        signal: controller.signal,
      }),
    ).rejects.toThrow('PROFILE_SNAPSHOT_DATABASE_FAILED');
    await expect(
      lstat(join(fixture.stagingRoot, operationId)),
    ).rejects.toMatchObject({ code: 'ENOENT' });

    fixture.maintenanceState.end(operationId);
    fixture.database.close();
  });

  it('rejects migration mismatch and removes an incomplete snapshot', async () => {
    const fixture = await createFixture();
    const operationId = randomUUID();
    await writeFile(
      join(fixture.migrationsDirectory, '002_missing_from_source.sql'),
      'CREATE TABLE missing (id TEXT PRIMARY KEY);',
      'utf8',
    );
    await fixture.maintenanceState.begin(operationId, 1_000);

    await expect(
      fixture.service.createSqliteSnapshot({
        migrationPolicy: 'exactCurrentManifest',
        operationId,
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow('PROFILE_SNAPSHOT_DATABASE_FAILED');
    await expect(
      lstat(join(fixture.stagingRoot, operationId)),
    ).rejects.toMatchObject({ code: 'ENOENT' });

    fixture.maintenanceState.end(operationId);
    fixture.database.close();
  });

  it('allows an exact historical prefix only for a pre-migration snapshot', async () => {
    const fixture = await createFixture();
    const operationId = randomUUID();
    await writeFile(
      join(fixture.migrationsDirectory, '002_pending.sql'),
      'CREATE TABLE pending (id TEXT PRIMARY KEY);',
      'utf8',
    );
    await fixture.maintenanceState.begin(operationId, 1_000);

    await expect(
      fixture.service.createSqliteSnapshot({
        migrationPolicy: 'compatibleHistoricalPrefix',
        operationId,
        signal: new AbortController().signal,
      }),
    ).resolves.toMatchObject({
      databaseByteSize: expect.any(Number),
      logicalPath: 'profile.sqlite',
      sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(() =>
      inspectSqliteProfileDatabase(
        join(fixture.stagingRoot, operationId, 'profile.sqlite'),
        fixture.migrationsDirectory,
        { allowHistoricalMigrationPrefix: true },
      ),
    ).not.toThrow();

    fixture.maintenanceState.end(operationId);
    fixture.database.close();
  });

  it('rejects changed historical SQL from a pre-migration snapshot', async () => {
    const fixture = await createFixture();
    const migrationPath = join(
      fixture.migrationsDirectory,
      '001_create_probe.sql',
    );
    await writeFile(
      migrationPath,
      `${await readFile(migrationPath, 'utf8')}\nCREATE TABLE changed_history (id TEXT);`,
      'utf8',
    );

    await expectPreMigrationSnapshotRejected(fixture);
  });

  it.each([
    ['source', 'source_sha256'],
    ['chain', 'chain_sha256'],
  ] as const)(
    'rejects a changed stored %s hash from a pre-migration snapshot',
    async (_name, column) => {
      const fixture = await createFixture();
      fixture.database
        .prepare(
          `UPDATE schema_migration_metadata SET ${column} = ?`,
        )
        .run('f'.repeat(64));

      await expectPreMigrationSnapshotRejected(fixture);
    },
  );

  it('rejects a missing middle migration from a pre-migration snapshot', async () => {
    const fixture = await createFixtureWithThreeAppliedMigrations();
    fixture.database.pragma('foreign_keys = OFF');
    fixture.database
      .prepare(
        'DELETE FROM schema_migration_metadata WHERE migration_name = ?',
      )
      .run('002_pending.sql');
    fixture.database
      .prepare('DELETE FROM schema_migrations WHERE name = ?')
      .run('002_pending.sql');
    fixture.database.pragma('foreign_keys = ON');

    await expectPreMigrationSnapshotRejected(fixture);
  });

  it('rejects reordered migration metadata from a pre-migration snapshot', async () => {
    const fixture = await createFixtureWithThreeAppliedMigrations();
    const rows = fixture.database
      .prepare<
        [],
        {
          chain_sha256: string;
          migration_name: string;
          source_sha256: string;
        }
      >(
        `
          SELECT migration_name, source_sha256, chain_sha256
          FROM schema_migration_metadata
          WHERE migration_name IN ('002_pending.sql', '003_pending.sql')
          ORDER BY migration_name
        `,
      )
      .all();
    expect(rows).toHaveLength(2);
    fixture.database
      .prepare(
        `
          UPDATE schema_migration_metadata
          SET source_sha256 = ?, chain_sha256 = ?
          WHERE migration_name = ?
        `,
      )
      .run(
        rows[1]!.source_sha256,
        rows[1]!.chain_sha256,
        rows[0]!.migration_name,
      );

    await expectPreMigrationSnapshotRejected(fixture);
  });

  it('rejects a future-version database from a pre-migration snapshot', async () => {
    const fixture = await createFixture();
    fixture.database
      .prepare(
        'INSERT INTO schema_migrations (name, run_at) VALUES (?, ?)',
      )
      .run('999_future.sql', '2026-08-12T00:00:00.000Z');

    await expectPreMigrationSnapshotRejected(fixture);
  });

  it('does not overwrite or remove a pre-existing operation directory', async () => {
    const fixture = await createFixture();
    const operationId = randomUUID();
    const operationRoot = join(fixture.stagingRoot, operationId);
    const sentinelPath = join(operationRoot, 'sentinel.txt');
    await mkdir(operationRoot, { mode: 0o700 });
    await writeFile(sentinelPath, 'keep', 'utf8');
    await fixture.maintenanceState.begin(operationId, 1_000);

    await expect(
      fixture.service.createSqliteSnapshot({
        migrationPolicy: 'exactCurrentManifest',
        operationId,
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow('PROFILE_SNAPSHOT_DATABASE_FAILED');
    await expect(readFile(sentinelPath, 'utf8')).resolves.toBe('keep');

    fixture.maintenanceState.end(operationId);
    fixture.database.close();
  });

  it('cleans staging after a backup adapter failure', async () => {
    const stagingRoot = await createTemporaryRoot('eky-snapshot-staging-');
    const migrationsDirectory = await createTemporaryRoot(
      'eky-snapshot-migrations-',
    );
    const maintenanceState = new ProfileMaintenanceState();
    const operationId = randomUUID();
    await maintenanceState.begin(operationId, 1_000);
    const service = new SqliteProfileSnapshotService({
      async backupDatabase() {
        throw new Error('private database path and details');
      },
      maintenanceState,
      migrationsDirectory,
      stagingRoot,
    });

    await expect(
      service.createSqliteSnapshot({
        migrationPolicy: 'exactCurrentManifest',
        operationId,
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow('PROFILE_SNAPSHOT_DATABASE_FAILED');
    await expect(
      lstat(join(stagingRoot, operationId)),
    ).rejects.toMatchObject({ code: 'ENOENT' });

    maintenanceState.end(operationId);
  });
});

async function createFixture(): Promise<{
  database: Database.Database;
  maintenanceState: ProfileMaintenanceState;
  migrationsDirectory: string;
  service: ReturnType<typeof createSqliteProfileSnapshotService>;
  stagingRoot: string;
}> {
  const root = await createTemporaryRoot('eky-sqlite-snapshot-');
  const databasePath = join(root, 'source.sqlite');
  const migrationsDirectory = join(root, 'migrations');
  const stagingRoot = join(root, 'staging');
  await mkdir(migrationsDirectory, { mode: 0o700 });
  await mkdir(stagingRoot, { mode: 0o700 });
  await chmod(stagingRoot, 0o700);
  await writeFile(
    join(migrationsDirectory, '001_create_probe.sql'),
    `
      CREATE TABLE local_runtime_identity (
        singleton_key TEXT PRIMARY KEY,
        installation_id TEXT NOT NULL,
        company_id TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE probe (value TEXT NOT NULL);
    `,
    'utf8',
  );

  const database = new Database(databasePath);
  database.pragma('foreign_keys = ON');
  database.pragma('journal_mode = WAL');
  await runMigrations(database, { migrationsDirectory });
  database
    .prepare('INSERT INTO probe (value) VALUES (?)')
    .run('committed-in-wal');
  database
    .prepare(
      `
        INSERT INTO local_runtime_identity (
          singleton_key,
          installation_id,
          company_id,
          actor_id,
          created_at
        ) VALUES ('local-runtime', ?, 'company-1', 'local-owner', ?)
      `,
    )
    .run('a'.repeat(32), '2026-08-04T00:00:00.000Z');

  const maintenanceState = new ProfileMaintenanceState();

  return {
    database,
    maintenanceState,
    migrationsDirectory,
    service: createSqliteProfileSnapshotService({
      database,
      maintenanceState,
      migrationsDirectory,
      stagingRoot,
    }),
    stagingRoot,
  };
}

async function createFixtureWithThreeAppliedMigrations(): Promise<
  Awaited<ReturnType<typeof createFixture>>
> {
  const fixture = await createFixture();
  await writeFile(
    join(fixture.migrationsDirectory, '002_pending.sql'),
    'CREATE TABLE pending_2 (id TEXT PRIMARY KEY);',
    'utf8',
  );
  await writeFile(
    join(fixture.migrationsDirectory, '003_pending.sql'),
    'CREATE TABLE pending_3 (id TEXT PRIMARY KEY);',
    'utf8',
  );
  await runMigrations(fixture.database, {
    migrationsDirectory: fixture.migrationsDirectory,
  });
  return fixture;
}

async function expectPreMigrationSnapshotRejected(
  fixture: Awaited<ReturnType<typeof createFixture>>,
): Promise<void> {
  const operationId = randomUUID();
  await fixture.maintenanceState.begin(operationId, 1_000);

  await expect(
    fixture.service.createSqliteSnapshot({
      migrationPolicy: 'compatibleHistoricalPrefix',
      operationId,
      signal: new AbortController().signal,
    }),
  ).rejects.toThrow('PROFILE_SNAPSHOT_DATABASE_FAILED');
  await expect(
    lstat(join(fixture.stagingRoot, operationId)),
  ).rejects.toMatchObject({ code: 'ENOENT' });

  fixture.maintenanceState.end(operationId);
  fixture.database.close();
}

async function createTemporaryRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  temporaryRoots.push(root);
  await chmod(root, 0o700);
  return root;
}

async function sha256(path: string): Promise<string> {
  const hash = createHash('sha256');

  for await (const chunk of createReadStream(path)) {
    hash.update(chunk as Buffer);
  }

  return hash.digest('hex');
}
