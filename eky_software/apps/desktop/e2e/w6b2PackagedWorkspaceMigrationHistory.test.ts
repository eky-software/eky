import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { ElectronWorkspaceCandidateRuntimeFactory } from '../src/workspaces/runtime/electronWorkspaceCandidateRuntimeFactory.js';
import {
  snapshotW6b2PackagedWorkspaceEvidence,
  w6b2PackagedWorkspaceContentPreserved,
} from './w6b2PackagedWorkspaceEvidence.js';
import { createW6b2PackagedWorkspaceEvidenceTestFixture } from './w6b2PackagedWorkspaceEvidenceTestFixture.js';
import {
  invalidateW6b2MigrationHistoryDatabase,
  invalidateW6b2PackagedWorkspaceMigrationHistory,
} from './w6b2PackagedWorkspaceMigrationHistory.js';

vi.mock('electron', () => ({ utilityProcess: { fork: vi.fn() } }));

const temporaryRoots: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    temporaryRoots.splice(0).map((root) =>
      rm(root, { force: true, recursive: true }),
    ),
  );
});

describe('W6B.2 ordinary-content quarantine fixture', () => {
  it('preserves schema, history and business evidence while inspecting C through the target factory', async () => {
    const fixture = await createContentFixture();
    const before = await snapshotW6b2PackagedWorkspaceEvidence(fixture, 'beforeContentFault');
    const historyBefore = readSchemaAndHistory(fixture.databaseFilePath);
    const { factory, start, inspect, stop } = createInspectionFactory();

    await invalidateW6b2PackagedWorkspaceMigrationHistory({ fixture, targetFactory: factory });

    expect(readSchemaAndHistory(fixture.databaseFilePath)).toEqual(historyBefore);
    const after = await snapshotW6b2PackagedWorkspaceEvidence(fixture);
    expect(w6b2PackagedWorkspaceContentPreserved(before, after)).toBe(true);
    expect(after.database.sha256).not.toBe(before.database.sha256);
    expect(start).toHaveBeenCalledExactlyOnceWith({
      databaseFilePath: fixture.databaseFilePath,
      expectedProfileId: fixture.profileId,
      operationId: expect.any(String),
      publishedRoot: fixture.workspaceRoot,
    });
    expect(stop).toHaveBeenCalledTimes(2);
    expect(inspect).toHaveBeenCalledOnce();
    expect(stop.mock.invocationCallOrder[0]).toBeLessThan(inspect.mock.invocationCallOrder[0]!);
  });

  it('propagates wrong-metadata inspection rejection instead of accepting quarantine', async () => {
    const fixture = await createContentFixture();
    invalidateW6b2MigrationHistoryDatabase(fixture.databaseFilePath);
    const historyBefore = readSchemaAndHistory(fixture.databaseFilePath);
    const { factory, start } = createInspectionFactory();
    const failure = new Error('MIGRATION_HISTORY_INVALID');
    start.mockRejectedValue(failure);

    await expect(invalidateW6b2PackagedWorkspaceMigrationHistory({ fixture, targetFactory: factory }))
      .rejects.toBe(failure);
    expect(start).toHaveBeenCalledOnce();
    expect(readSchemaAndHistory(fixture.databaseFilePath)).toEqual(historyBefore);
  });

  it.each(['current', 'compatiblePending'] as const)(
    'rejects unexpected inspection status %s', async status => {
      const fixture = await createContentFixture();
      const { factory, inspect } = createInspectionFactory();
      inspect.mockResolvedValue({ status, appliedMigrationCount: 1, pendingMigrationCount: 0 });
      await expect(invalidateW6b2PackagedWorkspaceMigrationHistory({ fixture, targetFactory: factory }))
        .rejects.toThrow('W6B2_INVALID_HISTORY_NOT_DETECTED');
    },
  );

  it('does not accept inspection while handles remain open', async () => {
    const fixture = await createContentFixture();
    const { factory, inspect, stop } = createInspectionFactory();
    stop.mockResolvedValue(false);
    await expect(invalidateW6b2PackagedWorkspaceMigrationHistory({ fixture, targetFactory: factory }))
      .rejects.toThrow('WORKSPACE_FIRST_START_PROOF_HANDLES_OPEN');
    expect(inspect).not.toHaveBeenCalled();
  });

  it.each(['A', 'B'] as const)('refuses to corrupt %s', async fixtureKey => {
    const fixture = { ...await createContentFixture(), fixtureKey };
    const before = await readFile(fixture.databaseFilePath);
    const { factory, start } = createInspectionFactory();
    await expect(invalidateW6b2PackagedWorkspaceMigrationHistory({ fixture, targetFactory: factory }))
      .rejects.toThrow('W6B2_INVALID_HISTORY_FIXTURE_INVALID');
    expect(await readFile(fixture.databaseFilePath)).toEqual(before);
    expect(start).not.toHaveBeenCalled();
  });
});

describe('W6B.2 wrong-metadata rejection fixture', () => {
  it('changes only one migration metadata row and keeps SQLite business data healthy', async () => {
    const databaseFilePath = await createDatabaseFixture(true);

    invalidateW6b2MigrationHistoryDatabase(databaseFilePath);

    const database = new DatabaseSync(databaseFilePath, {
      open: true,
      readOnly: true,
    });
    try {
      const metadata = database
        .prepare(
          `
            SELECT migration_name, source_sha256
            FROM schema_migration_metadata
            ORDER BY migration_name
          `,
        )
        .all();
      expect(metadata).toEqual([
        {
          migration_name: '001_first.sql',
          source_sha256: 'b'.repeat(64),
        },
        {
          migration_name: '002_second.sql',
          source_sha256: 'a'.repeat(64),
        },
      ]);
      expect(
        database.prepare('SELECT value FROM business_probe').get(),
      ).toEqual({ value: 'preserved' });
      expect(database.prepare('PRAGMA integrity_check;').get()).toEqual({
        integrity_check: 'ok',
      });
      expect(database.prepare('PRAGMA foreign_key_check;').all()).toEqual([]);
    } finally {
      database.close();
    }
  });

  it('fails closed when the earliest migration has no metadata row', async () => {
    const databaseFilePath = await createDatabaseFixture(false);

    expect(() =>
      invalidateW6b2MigrationHistoryDatabase(databaseFilePath),
    ).toThrowError('W6B2_MIGRATION_HISTORY_NOT_CHANGED');

    const database = new DatabaseSync(databaseFilePath, {
      open: true,
      readOnly: true,
    });
    try {
      expect(
        database.prepare('SELECT value FROM business_probe').get(),
      ).toEqual({ value: 'preserved' });
      expect(database.prepare('PRAGMA integrity_check;').get()).toEqual({
        integrity_check: 'ok',
      });
    } finally {
      database.close();
    }
  });
});

async function createContentFixture() {
  const root = await mkdtemp(join(tmpdir(), 'eky-w6b2-content-'));
  temporaryRoots.push(root);
  return createW6b2PackagedWorkspaceEvidenceTestFixture(root, 'C');
}

function createInspectionFactory() {
  const factory = new ElectronWorkspaceCandidateRuntimeFactory({
    reservationOwner: { bindCandidate() { throw new Error('unexpected-candidate-start'); } },
    appVersion: '0.2.7', buildRevision: 'a'.repeat(40),
    backendRoot: 'unused', migrationsDirectory: 'unused', runnerPath: 'unused',
  });
  const inspect = vi.fn<Awaited<ReturnType<typeof factory.startMigrationInspection>>['inspectStoppedMigrationInspection']>()
    .mockResolvedValue({ status: 'invalidHistory', appliedMigrationCount: 0, pendingMigrationCount: 0 });
  const stop = vi.fn(async () => true);
  const start = vi.spyOn(factory, 'startMigrationInspection').mockResolvedValue({
    inspectStoppedMigrationInspection: inspect,
    stopAndProveHandlesClosed: stop,
  });
  return { factory, start, inspect, stop };
}

function readSchemaAndHistory(databaseFilePath: string) {
  const database = new DatabaseSync(databaseFilePath, { readOnly: true });
  try {
    return {
      schema: database.prepare('SELECT type, name, tbl_name, sql FROM sqlite_schema ORDER BY name').all(),
      ledger: database.prepare('SELECT * FROM schema_migrations ORDER BY name').all(),
      metadata: database.prepare('SELECT * FROM schema_migration_metadata ORDER BY migration_name').all(),
    };
  } finally {
    database.close();
  }
}

async function createDatabaseFixture(
  includeEarliestMetadata: boolean,
): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'eky-w6b2-history-'));
  temporaryRoots.push(root);
  const databaseFilePath = join(root, 'workspace.sqlite');
  const database = new DatabaseSync(databaseFilePath);
  try {
    database.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE schema_migrations (
        name TEXT PRIMARY KEY
      );
      CREATE TABLE schema_migration_metadata (
        migration_name TEXT PRIMARY KEY,
        source_sha256 TEXT NOT NULL,
        FOREIGN KEY (migration_name) REFERENCES schema_migrations(name)
      );
      CREATE TABLE business_probe (
        value TEXT NOT NULL
      );
      INSERT INTO schema_migrations (name)
      VALUES ('001_first.sql'), ('002_second.sql');
      INSERT INTO business_probe (value) VALUES ('preserved');
    `);
    if (includeEarliestMetadata) {
      database
        .prepare(
          `
            INSERT INTO schema_migration_metadata (
              migration_name,
              source_sha256
            ) VALUES (?, ?)
          `,
        )
        .run('001_first.sql', 'a'.repeat(64));
    }
    database
      .prepare(
        `
          INSERT INTO schema_migration_metadata (
            migration_name,
            source_sha256
          ) VALUES (?, ?)
        `,
      )
      .run('002_second.sql', 'a'.repeat(64));
  } finally {
    database.close();
  }
  return databaseFilePath;
}
