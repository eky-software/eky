import { createHash } from 'node:crypto';
import {
  chmod,
  copyFile,
  cp,
  link,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, toNamespacedPath } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it, vi } from 'vitest';

import Database from 'better-sqlite3';

import * as connections from '../../database/connection/createDatabaseConnection.js';
import { interruptSqliteTransaction } from '../../database/connection/hotJournal.fixture.js';
import * as migrationStartup from '../../database/migration/inspectMigrationStartupState.js';
import * as attestation from '../../database/migration/inspectAttestedMigrationHistory.js';
import * as profileInspection from '../profileSnapshot/inspectSqliteProfileDatabase.js';
import { runWorkspaceCandidateOperation, type WorkspaceCandidateOperation } from './runWorkspaceCandidateOperation.js';

const migrationsDirectory = fileURLToPath(
  new URL('../../database/migrations/', import.meta.url),
);
const releaseIdentity = Object.freeze({
  appVersion: '0.2.6',
  buildRevision: 'a'.repeat(40),
});
const roots: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

describe('runWorkspaceCandidateOperation', () => {
  describe.each(['validatePublished', 'validateHistoricalPublished', 'validateAndMaterialize'] as const)(
    '%s database admission', operation => {
      it('rejects a missing database without creating it or opening a writable connection', async () => {
        const root = await createPrivateTempRoot();
        const candidate = await createCandidateLayout(join(root, 'candidate'));
        const writable = vi.spyOn(connections, 'createDatabaseConnection');
        const before = await readdir(dirname(candidate.databaseFilePath));

        await expect(runWorkspaceCandidateOperation(validationInput(operation, candidate, 'a'.repeat(64), root)))
          .rejects.toThrow('WORKSPACE_CANDIDATE_OPERATION_FAILED');

        expect.soft(writable).not.toHaveBeenCalled();
        expect(await readdir(dirname(candidate.databaseFilePath))).toEqual(before);
        await expect(lstat(candidate.databaseFilePath)).rejects.toMatchObject({ code: 'ENOENT' });
      });

      it('retains the interrupted database and hot journal without implicit native rollback', async () => {
        const root = await createPrivateTempRoot();
        const candidate = await createCandidateLayout(join(root, 'candidate'));
        const database = new Database(candidate.databaseFilePath);
        try {
          database.exec('CREATE TABLE recovery_probe (payload TEXT NOT NULL)');
          const insert = database.prepare('INSERT INTO recovery_probe (payload) VALUES (?)');
          database.transaction(() => {
            for (let index = 0; index < 200; index++) insert.run('committed-' + 'x'.repeat(4096));
          })();
        } finally { database.close(); }
        await interruptSqliteTransaction(candidate.databaseFilePath,
          "UPDATE recovery_probe SET payload = 'uncommitted'");
        const journalPath = candidate.databaseFilePath + '-journal';
        const beforeDatabase = await readFile(candidate.databaseFilePath);
        const beforeJournal = await readFile(journalPath);
        const writable = vi.spyOn(connections, 'createDatabaseConnection');

        await expect(runWorkspaceCandidateOperation(validationInput(operation, candidate, 'a'.repeat(64), root)))
          .rejects.toThrow('WORKSPACE_CANDIDATE_OPERATION_FAILED');

        expect.soft(writable).not.toHaveBeenCalled();
        // Compare every byte without expanding large buffers into object properties.
        expect.soft((await readFile(candidate.databaseFilePath)).equals(beforeDatabase)).toBe(true);
        expect((await readFile(journalPath)).equals(beforeJournal)).toBe(true);
      });

      it.each(['directory', 'hardLink'] as const)('rejects a %s before opening SQLite', async kind => {
        const root = await createPrivateTempRoot();
        const candidate = await createCandidateLayout(join(root, 'candidate'));
        if (kind === 'directory') await mkdir(candidate.databaseFilePath);
        else await writeFile(candidate.databaseFilePath, 'synthetic database');
        if (kind === 'hardLink') await link(candidate.databaseFilePath, join(root, 'database-alias'));
        const opened = vi.spyOn(Database.prototype, 'pragma');
        await expect(runWorkspaceCandidateOperation(validationInput(operation, candidate, 'a'.repeat(64), root)))
          .rejects.toMatchObject({ cause: { message: 'MIGRATION_DATABASE_FILE_INVALID' } });
        expect(opened).not.toHaveBeenCalled();
        if (kind === 'hardLink') {
          expect(await readFile(join(root, 'database-alias'), 'utf8')).toBe('synthetic database');
        }
      });

      it.each(['empty', 'untrustedSchema'] as const)('rejects %s before writable admission', async kind => {
        const fixture = await createValidationFixture(operation);
        if (kind === 'empty') await writeFile(fixture.input.databaseFilePath, '');
        else {
          const database = new Database(fixture.input.databaseFilePath, { fileMustExist: true });
          try { database.exec('CREATE TABLE unexpected (id TEXT)'); } finally { database.close(); }
        }
        const before = await readFile(fixture.input.databaseFilePath);
        const writable = vi.spyOn(connections, 'createDatabaseConnection');
        await expect(runWorkspaceCandidateOperation(fixture.input)).rejects.toThrow('WORKSPACE_CANDIDATE_OPERATION_FAILED');
        expect(writable).not.toHaveBeenCalled();
        expect(await readFile(fixture.input.databaseFilePath)).toEqual(before);
      });

      it.each(['DELETE', 'WAL'] as const)('attests healthy %s content before writable admission and keeps the closed file set', async journalMode => {
        const fixture = await createValidationFixture(operation);
        if (journalMode === 'WAL') {
          const connection = new Database(fixture.input.databaseFilePath, { fileMustExist: true });
          try { connection.pragma('journal_mode = WAL'); } finally { connection.close(); }
        }
        const before = await readFile(fixture.input.databaseFilePath);
        const beforeEntries = await readdir(dirname(fixture.input.databaseFilePath));
        const writable = vi.spyOn(connections, 'createDatabaseConnection');
        const attest = vi.spyOn(attestation, 'inspectAttestedMigrationHistory');
        const close = vi.spyOn(Database.prototype, 'close');
        await expect(runWorkspaceCandidateOperation(fixture.input)).resolves.toMatchObject({
          kind: operation === 'validateHistoricalPublished' ? 'historicalReadiness' : 'readiness',
          profileId: fixture.profileId,
        });
        expect(writable).toHaveBeenCalledExactlyOnceWith({ databaseFilePath: fixture.input.databaseFilePath, fileMustExist: true });
        const targetAttestations = attest.mock.calls.filter(([database]) => database.name === fixture.input.databaseFilePath);
        expect(targetAttestations.slice(0, 2).map(([database]) => database.readonly)).toEqual([true, false]);
        expect(attest.mock.invocationCallOrder[0]).toBeLessThan(writable.mock.invocationCallOrder[0]!);
        const handles = (close.mock.contexts as Database.Database[])
          .filter(handle => handle.name === fixture.input.databaseFilePath ||
            handle.name === toNamespacedPath(fixture.input.databaseFilePath));
        expect(handles).toHaveLength(2);
        expect(handles.map(handle => ({ open: handle.open, readonly: handle.readonly })))
          .toEqual([{ open: false, readonly: true }, { open: false, readonly: false }]);
        expect(await readFile(fixture.input.databaseFilePath)).toEqual(before);
        expect(await readdir(dirname(fixture.input.databaseFilePath))).toEqual(beforeEntries);
      });

      it.each([false, true])('preserves the inspection failure before a close failure (inspection fails: %s)', async fails => {
        const fixture = await createValidationFixture(operation);
        const first = new Error('synthetic inspection failure');
        const cleanup = new Error('synthetic close failure');
        if (fails) vi.spyOn(migrationStartup, 'inspectMigrationStartupState').mockImplementation(() => { throw first; });
        const originalClose = Database.prototype.close;
        vi.spyOn(Database.prototype, 'close').mockImplementation(function (this: Database.Database) {
          const result = originalClose.call(this);
          if (!this.readonly && (this.name === fixture.input.databaseFilePath || this.name === toNamespacedPath(fixture.input.databaseFilePath))) {
            throw cleanup;
          }
          return result;
        });
        const failure = await runWorkspaceCandidateOperation(fixture.input).then(
          () => undefined, (error: unknown) => error,
        );
        expect(failure).toBeInstanceOf(Error);
        const aggregate = (failure as Error).cause as AggregateError;
        expect(aggregate).toBeInstanceOf(AggregateError);
        expect(aggregate.errors).toEqual(fails ? [first, cleanup] : [cleanup]);
        expect(aggregate.cause).toBe(fails ? first : cleanup);
      });

      it('retains the readonly admission failure when its close also fails', async () => {
        const fixture = await createValidationFixture(operation);
        const database = new Database(fixture.input.databaseFilePath, { fileMustExist: true });
        try { database.exec('CREATE TABLE unexpected (id TEXT)'); } finally { database.close(); }
        const cleanup = new Error('synthetic readonly close failure');
        const originalClose = Database.prototype.close;
        vi.spyOn(Database.prototype, 'close').mockImplementation(function (this: Database.Database) {
          const result = originalClose.call(this);
          if (this.readonly && this.name === fixture.input.databaseFilePath) throw cleanup;
          return result;
        });
        const writable = vi.spyOn(connections, 'createDatabaseConnection');
        const failure = await runWorkspaceCandidateOperation(fixture.input).then(
          () => undefined, (error: unknown) => error,
        );
        expect(failure).toBeInstanceOf(Error);
        const aggregate = (failure as Error).cause as AggregateError;
        expect(aggregate).toBeInstanceOf(AggregateError);
        expect(aggregate.errors).toHaveLength(2);
        expect(aggregate.errors[0]).toMatchObject({ errorCode: 'MIGRATION_HISTORY_PREPARATION_FAILED' });
        expect(aggregate.errors[1]).toBe(cleanup);
        expect(aggregate.cause).toBe(aggregate.errors[0]);
        expect(writable).not.toHaveBeenCalled();
      });
    },
  );

  it.each(['migrateBackup', 'validateAndMaterialize', 'validatePublished', 'validateHistoricalPublished'] as const)(
    'rejects local recovery authority for %s before file access or writable open', async operation => {
      const root = join(tmpdir(), 'synthetic-uncreated-import');
      const assertOwnedDatabase = vi.fn(async () => {});
      const writable = vi.spyOn(connections, 'createDatabaseConnection');
      const common = {
        ...releaseIdentity,
        artifactRoot: join(root, 'artifacts'), candidateRoot: root,
        databaseFilePath: join(root, 'profile.sqlite'), migrationsDirectory,
      };
      const input = (() => {
        switch (operation) {
          case 'migrateBackup': return { ...common, operation, expectedProfileId: 'a'.repeat(64),
            expectedSourceMigrationChainIdentity: 'b'.repeat(64), importStagingRoot: join(root, 'import'),
            inspectionRoot: join(root, 'inspection') };
          case 'validateAndMaterialize': return { ...common, operation,
            expectedProfileId: 'a'.repeat(64), importStagingRoot: join(root, 'import') };
          case 'validateHistoricalPublished': return { ...common, operation, expectedProfileId: 'a'.repeat(64) };
          case 'validatePublished': return { ...common, operation };
        }
      })();
      await expect(runWorkspaceCandidateOperation(input, {
        ownedLocalDatabaseRecovery: { assertOwnedDatabase, signal: new AbortController().signal },
      })).rejects.toMatchObject({ message: 'WORKSPACE_CANDIDATE_OPERATION_FAILED',
        cause: { message: 'WORKSPACE_CANDIDATE_OPERATION_INVALID' } });
      expect(assertOwnedDatabase).not.toHaveBeenCalled();
      expect(writable).not.toHaveBeenCalled();
    },
  );

  it.each([false, true])(
    'migrates a closed WAL backup without touching its original snapshot (historical: %s)',
    async historical => {
      const fixture = await createImportedCandidateFixture(historical);
      await stageClosedWalBackup(fixture, { removeMetadata: historical });
      const sourcePath = join(fixture.importStagingRoot, 'profile.sqlite');
      const before = await readFile(sourcePath);
      const sourceEntries = await readdir(fixture.importStagingRoot);
      const inspection = vi.spyOn(profileInspection, 'inspectSqliteProfileDatabase');
      const outcome = await runImportedCandidate(fixture).then(
        result => ({ result, error: undefined }),
        (error: unknown) => ({ result: undefined, error }),
      );

      expect.soft(outcome.error instanceof Error ? outcome.error.message : outcome.error).toBeUndefined();
      expect.soft(outcome.result).toMatchObject({ kind: 'migration', profileId: fixture.profileId });
      expect.soft(await readFile(sourcePath)).toEqual(before);
      expect.soft(await readdir(fixture.importStagingRoot)).toEqual(sourceEntries);
      expect(inspection.mock.calls.some(([inspectedPath]) => inspectedPath === sourcePath)).toBe(false);
    },
  );

  it('rejects a WAL backup schema before writable open and retains the sidecar-free source', async () => {
    const fixture = await createImportedCandidateFixture();
    await stageClosedWalBackup(fixture, { extraTable: true });
    const sourcePath = join(fixture.importStagingRoot, 'profile.sqlite');
    const before = await readFile(sourcePath);
    const sourceEntries = await readdir(fixture.importStagingRoot);
    const writable = vi.spyOn(connections, 'createDatabaseConnection');

    await expect(runImportedCandidate(fixture)).rejects.toThrow('WORKSPACE_CANDIDATE_OPERATION_FAILED');

    expect(writable).not.toHaveBeenCalled();
    await expect(lstat(fixture.target.databaseFilePath)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(sourcePath)).toEqual(before);
    expect(await readdir(fixture.importStagingRoot)).toEqual(sourceEntries);
  });

  it.each(['-wal', '-shm', '-journal'] as const)(
    'retains a pre-existing imported %s without opening or migrating the snapshot',
    async suffix => {
      const fixture = await createImportedCandidateFixture();
      await stageClosedWalBackup(fixture);
      const sourcePath = join(fixture.importStagingRoot, 'profile.sqlite');
      const sidecarPath = sourcePath + suffix;
      const sidecar = Buffer.from('unknown retained input');
      await writeFile(sidecarPath, sidecar, { flag: 'wx' });
      const before = await readFile(sourcePath);
      const inspection = vi.spyOn(profileInspection, 'inspectSqliteProfileDatabase');
      const writable = vi.spyOn(connections, 'createDatabaseConnection');

      await expect(runImportedCandidate(fixture)).rejects.toThrow('WORKSPACE_CANDIDATE_OPERATION_FAILED');

      expect(inspection).not.toHaveBeenCalled();
      expect(writable).not.toHaveBeenCalled();
      await expect(lstat(fixture.target.databaseFilePath)).rejects.toMatchObject({ code: 'ENOENT' });
      expect(await readFile(sourcePath)).toEqual(before);
      expect(await readFile(sidecarPath)).toEqual(sidecar);
    },
  );

  it.each(['extraTable', 'historyView'] as const)(
    'rejects imported %s before copying or opening a writable database',
    async mutation => {
      const fixture = await createImportedCandidateFixture();
      const sourcePath = join(fixture.importStagingRoot, 'profile.sqlite');
      const database = new Database(sourcePath);
      try {
        if (mutation === 'extraTable') database.exec('CREATE TABLE unexpected (id TEXT)');
        else database.exec('DROP TABLE schema_migration_metadata; DROP TABLE schema_migrations; CREATE VIEW schema_migrations AS SELECT 1 AS name');
      } finally { database.close(); }
      const before = await readFile(sourcePath);
      const writable = vi.spyOn(connections, 'createDatabaseConnection');

      await expect(runImportedCandidate(fixture)).rejects.toThrow('WORKSPACE_CANDIDATE_OPERATION_FAILED');

      expect(writable).not.toHaveBeenCalled();
      await expect(lstat(fixture.target.databaseFilePath)).rejects.toMatchObject({ code: 'ENOENT' });
      expect(await readFile(sourcePath)).toEqual(before);
    },
  );

  it('rejects same-size source changes after readonly inspection', async () => {
    const fixture = await createImportedCandidateFixture();
    const sourcePath = join(fixture.importStagingRoot, 'profile.sqlite');
    const sourceSize = (await lstat(sourcePath)).size;
    const originalInspect = profileInspection.inspectSqliteProfileConnection;
    const changed = vi.fn();
    vi.spyOn(profileInspection, 'inspectSqliteProfileConnection').mockImplementation((...args) => {
      const result = originalInspect(...args);
      if (args[0].name === toNamespacedPath(join(fixture.inspectionRoot, 'profile.sqlite'))) {
        const database = new Database(sourcePath);
        try { database.pragma('user_version = 123'); }
        finally { database.close(); }
        changed();
      }
      return result;
    });
    const writable = vi.spyOn(connections, 'createDatabaseConnection');

    await expect(runImportedCandidate(fixture)).rejects.toThrow('WORKSPACE_CANDIDATE_OPERATION_FAILED');

    expect(writable).not.toHaveBeenCalled();
    expect(changed).toHaveBeenCalledOnce();
    expect((await lstat(sourcePath)).size).toBe(sourceSize);
    await expect(lstat(fixture.target.databaseFilePath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('keeps the approved metadata-less 038 restore path and leaves its source unchanged', async () => {
    const fixture = await createImportedCandidateFixture(true);
    const sourcePath = join(fixture.importStagingRoot, 'profile.sqlite');
    const source = new Database(sourcePath);
    try { source.exec('DROP TABLE schema_migration_metadata'); }
    finally { source.close(); }
    const before = await readFile(sourcePath);
    await expect(runImportedCandidate(fixture)).resolves.toMatchObject({ kind: 'migration', profileId: fixture.profileId });
    expect(await readFile(sourcePath)).toEqual(before);
  });

  it('bootstraps, imports and validates isolated workspaces with closed database handles', async () => {
    const root = await createPrivateTempRoot();
    const source = await createCandidateLayout(join(root, 'source'));
    const bootstrapped = await runWorkspaceCandidateOperation({
      ...releaseIdentity,
      ...source,
      migrationsDirectory,
      operation: 'bootstrapEmpty',
    });
    expect(bootstrapped).toMatchObject({
      actorId: 'local-owner',
      artifactRootHealth: 'ready',
      databaseHealth: 'healthy',
      foreignKeyHealth: 'healthy',
      kind: 'readiness',
    });
    if (bootstrapped.kind !== 'readiness') throw new Error('invalid fixture');

    const importStagingRoot = join(root, 'import-staging');
    await createPrivateDirectory(importStagingRoot);
    await copyFile(
      source.databaseFilePath,
      join(importStagingRoot, 'profile.sqlite'),
    );
    await writeFile(
      join(importStagingRoot, 'snapshot-catalog-v1.json'),
      JSON.stringify({ artifacts: [], formatVersion: 1 }),
      { mode: 0o600 },
    );

    const target = await createCandidateLayout(join(root, 'target'));
    const inspectionRoot = join(target.candidateRoot, 'inspection');
    await createPrivateDirectory(inspectionRoot);
    const migrated = await runWorkspaceCandidateOperation({
      ...releaseIdentity,
      ...target,
      expectedProfileId: bootstrapped.profileId,
      expectedSourceMigrationChainIdentity:
        bootstrapped.migrationChainIdentity,
      importStagingRoot,
      inspectionRoot,
      migrationsDirectory,
      operation: 'migrateBackup',
    });
    expect(migrated).toEqual({
      kind: 'migration',
      migrationChainIdentity: bootstrapped.migrationChainIdentity,
      profileId: bootstrapped.profileId,
    });

    const validated = await runWorkspaceCandidateOperation({
      ...releaseIdentity,
      ...target,
      expectedProfileId: bootstrapped.profileId,
      importStagingRoot,
      migrationsDirectory,
      operation: 'validateAndMaterialize',
    });
    expect(validated).toMatchObject({
      actorId: 'local-owner',
      companyId: bootstrapped.companyId,
      kind: 'readiness',
      migrationChainIdentity: bootstrapped.migrationChainIdentity,
      profileId: bootstrapped.profileId,
    });

    await expect(
      runWorkspaceCandidateOperation({
        ...releaseIdentity,
        ...target,
        expectedProfileId: bootstrapped.profileId,
        migrationsDirectory,
        operation: 'validatePublished',
      }),
    ).resolves.toMatchObject({ kind: 'readiness' });

    await expect(rm(root, { recursive: true })).resolves.toBeUndefined();
    roots.pop();
  });

  it('validates a compatible historical published workspace without migrating or writing it', async () => {
    const root = await createPrivateTempRoot();
    const historicalMigrations = await createHistoricalPrefixMigrations(root);
    const candidate = await createCandidateLayout(join(root, 'historical'));
    const bootstrapped = await runWorkspaceCandidateOperation({
      ...releaseIdentity,
      ...candidate,
      migrationsDirectory: historicalMigrations,
      operation: 'bootstrapEmpty',
    });
    if (bootstrapped.kind !== 'readiness') throw new Error('invalid fixture');
    const before = await sha256(candidate.databaseFilePath);

    await expect(
      runWorkspaceCandidateOperation({
        ...releaseIdentity,
        ...candidate,
        expectedProfileId: bootstrapped.profileId,
        migrationsDirectory,
        operation: 'validateHistoricalPublished',
      }),
    ).resolves.toEqual({
      actorId: 'local-owner',
      artifactRootHealth: 'ready',
      companyId: bootstrapped.companyId,
      databaseHealth: 'healthy',
      foreignKeyHealth: 'healthy',
      kind: 'historicalReadiness',
      migrationChainIdentity: bootstrapped.migrationChainIdentity,
      profileId: bootstrapped.profileId,
    });
    expect(await sha256(candidate.databaseFilePath)).toBe(before);

    await expect(
      runWorkspaceCandidateOperation({
        ...releaseIdentity,
        ...candidate,
        expectedProfileId: 'f'.repeat(64),
        migrationsDirectory,
        operation: 'validateHistoricalPublished',
      }),
    ).rejects.toThrow('WORKSPACE_CANDIDATE_OPERATION_FAILED');
    expect(await sha256(candidate.databaseFilePath)).toBe(before);
  });

  it('rejects current workspaces from the historical-only validation operation', async () => {
    const root = await createPrivateTempRoot();
    const candidate = await createCandidateLayout(join(root, 'current'));
    const bootstrapped = await runWorkspaceCandidateOperation({
      ...releaseIdentity,
      ...candidate,
      migrationsDirectory,
      operation: 'bootstrapEmpty',
    });
    if (bootstrapped.kind !== 'readiness') throw new Error('invalid fixture');
    const before = await sha256(candidate.databaseFilePath);

    await expect(
      runWorkspaceCandidateOperation({
        ...releaseIdentity,
        ...candidate,
        expectedProfileId: bootstrapped.profileId,
        migrationsDirectory,
        operation: 'validateHistoricalPublished',
      }),
    ).rejects.toThrow('WORKSPACE_CANDIDATE_OPERATION_FAILED');
    expect(await sha256(candidate.databaseFilePath)).toBe(before);
  });

  it('rejects database and artifact paths outside the candidate root', async () => {
    const root = await createPrivateTempRoot();
    const candidate = await createCandidateLayout(join(root, 'candidate'));

    await expect(
      runWorkspaceCandidateOperation({
        ...releaseIdentity,
        ...candidate,
        databaseFilePath: join(root, 'outside.sqlite'),
        migrationsDirectory,
        operation: 'bootstrapEmpty',
      }),
    ).rejects.toThrow('WORKSPACE_CANDIDATE_OPERATION_FAILED');
  });

  it('accepts a canonical read-only migration code directory with standard POSIX permissions', async () => {
    const root = await createPrivateTempRoot();
    const publishedMigrations = join(root, 'published-migrations');
    await cp(migrationsDirectory, publishedMigrations, { recursive: true });
    if (process.platform !== 'win32') await chmod(publishedMigrations, 0o755);
    const candidate = await createCandidateLayout(join(root, 'candidate'));

    await expect(
      runWorkspaceCandidateOperation({
        ...releaseIdentity,
        ...candidate,
        migrationsDirectory: publishedMigrations,
        operation: 'bootstrapEmpty',
      }),
    ).resolves.toMatchObject({ kind: 'readiness' });
  });

  it.skipIf(process.platform === 'win32')(
    'rejects writable or linked migration code roots without weakening private candidate roots',
    async () => {
      const root = await createPrivateTempRoot();
      const candidate = await createCandidateLayout(join(root, 'candidate'));
      const writableMigrations = join(root, 'writable-migrations');
      await cp(migrationsDirectory, writableMigrations, { recursive: true });
      await chmod(writableMigrations, 0o777);

      await expect(
        runWorkspaceCandidateOperation({
          ...releaseIdentity,
          ...candidate,
          migrationsDirectory: writableMigrations,
          operation: 'bootstrapEmpty',
        }),
      ).rejects.toThrow('WORKSPACE_CANDIDATE_OPERATION_FAILED');

      const linkedMigrations = join(root, 'linked-migrations');
      await symlink(migrationsDirectory, linkedMigrations, 'dir');
      await expect(
        runWorkspaceCandidateOperation({
          ...releaseIdentity,
          ...candidate,
          migrationsDirectory: linkedMigrations,
          operation: 'bootstrapEmpty',
        }),
      ).rejects.toThrow('WORKSPACE_CANDIDATE_OPERATION_FAILED');

      await chmod(candidate.candidateRoot, 0o755);
      await expect(
        runWorkspaceCandidateOperation({
          ...releaseIdentity,
          ...candidate,
          migrationsDirectory,
          operation: 'bootstrapEmpty',
        }),
      ).rejects.toThrow('WORKSPACE_CANDIDATE_OPERATION_FAILED');
      await expect(lstat(candidate.databaseFilePath)).rejects.toMatchObject({
        code: 'ENOENT',
      });
    },
  );

  it('rejects unknown operations, extra fields and malformed inputs without writes', async () => {
    const root = await createPrivateTempRoot();
    const candidate = await createCandidateLayout(join(root, 'candidate'));
    const validOperation = {
      ...releaseIdentity,
      ...candidate,
      migrationsDirectory,
      operation: 'bootstrapEmpty',
    } as const;

    for (const invalidOperation of [
      { ...validOperation, operation: 'unknown' },
      { ...validOperation, unexpected: 'value' },
      { ...validOperation, appVersion: 1 },
    ]) {
      await expect(
        runWorkspaceCandidateOperation(invalidOperation as never),
      ).rejects.toThrow('WORKSPACE_CANDIDATE_OPERATION_FAILED');
    }

    await expect(lstat(candidate.databaseFilePath)).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('cancels an in-flight operation before opening the candidate database', async () => {
    const root = await createPrivateTempRoot();
    const candidate = await createCandidateLayout(join(root, 'candidate'));
    const controller = new AbortController();
    const operation = runWorkspaceCandidateOperation(
      {
        ...releaseIdentity,
        ...candidate,
        migrationsDirectory,
        operation: 'bootstrapEmpty',
      },
      { signal: controller.signal },
    );
    controller.abort();

    await expect(operation).rejects.toThrow(
      'WORKSPACE_CANDIDATE_OPERATION_FAILED',
    );
    await expect(lstat(candidate.databaseFilePath)).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('fails closed on migration execution errors and releases the database handle', async () => {
    const root = await createPrivateTempRoot();
    const candidate = await createCandidateLayout(join(root, 'candidate'));
    const brokenMigrationsDirectory = join(root, 'broken-migrations');
    await createPrivateDirectory(brokenMigrationsDirectory);
    await writeFile(
      join(brokenMigrationsDirectory, '001_broken.sql'),
      'CREATE TABLE broken syntax;',
      { mode: 0o600 },
    );

    await expect(
      runWorkspaceCandidateOperation({
        ...releaseIdentity,
        ...candidate,
        migrationsDirectory: brokenMigrationsDirectory,
        operation: 'bootstrapEmpty',
      }),
    ).rejects.toThrow('WORKSPACE_CANDIDATE_OPERATION_FAILED');

    await expect(
      rm(candidate.candidateRoot, { recursive: true }),
    ).resolves.toBeUndefined();
  });

  it('rejects mismatched migration lineage and closes the copied database', async () => {
    const fixture = await createImportedCandidateFixture();

    await expect(
      runWorkspaceCandidateOperation({
        ...releaseIdentity,
        ...fixture.target,
        expectedProfileId: fixture.profileId,
        expectedSourceMigrationChainIdentity: 'b'.repeat(64),
        importStagingRoot: fixture.importStagingRoot,
        inspectionRoot: fixture.inspectionRoot,
        migrationsDirectory,
        operation: 'migrateBackup',
      }),
    ).rejects.toThrow('WORKSPACE_CANDIDATE_OPERATION_FAILED');

    await expect(
      rm(fixture.target.candidateRoot, { recursive: true }),
    ).resolves.toBeUndefined();
  });

  it('rejects the source catalog before applying pending backup migrations', async () => {
    const fixture = await createImportedCandidateFixture(true);
    await writeFile(join(fixture.importStagingRoot, 'snapshot-catalog-v1.json'),
      JSON.stringify({ artifacts: [], formatVersion: 2 }), { mode: 0o600 });

    await expect(runWorkspaceCandidateOperation({
      ...releaseIdentity, ...fixture.target,
      expectedProfileId: fixture.profileId,
      expectedSourceMigrationChainIdentity: fixture.migrationChainIdentity,
      importStagingRoot: fixture.importStagingRoot,
      inspectionRoot: fixture.inspectionRoot,
      migrationsDirectory, operation: 'migrateBackup',
    })).rejects.toThrow('WORKSPACE_CANDIDATE_OPERATION_FAILED');

    await expect(lstat(fixture.target.databaseFilePath)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(join(fixture.inspectionRoot, 'profile.sqlite')))
      .toEqual(await readFile(join(fixture.importStagingRoot, 'profile.sqlite')));
    expect(await readdir(fixture.target.artifactRoot)).toEqual([]);
  });

  it('migrates a historical backup and rechecks its original catalog before materialization', async () => {
    const fixture = await createImportedCandidateFixture(true);
    const catalogPath = join(fixture.importStagingRoot, 'snapshot-catalog-v1.json');
    const original = await readFile(catalogPath);
    const migrated = await runWorkspaceCandidateOperation({
      ...releaseIdentity, ...fixture.target,
      expectedProfileId: fixture.profileId,
      expectedSourceMigrationChainIdentity: fixture.migrationChainIdentity,
      importStagingRoot: fixture.importStagingRoot,
      inspectionRoot: fixture.inspectionRoot,
      migrationsDirectory, operation: 'migrateBackup',
    });
    expect(migrated.kind).toBe('migration');
    if (migrated.kind !== 'migration') throw new Error('invalid fixture');
    expect(migrated.migrationChainIdentity).not.toBe(fixture.migrationChainIdentity);
    expect(await readFile(catalogPath)).toEqual(original);

    await rm(catalogPath);
    await expect(runWorkspaceCandidateOperation({
      ...releaseIdentity, ...fixture.target,
      expectedProfileId: fixture.profileId,
      importStagingRoot: fixture.importStagingRoot,
      migrationsDirectory, operation: 'validateAndMaterialize',
    })).rejects.toThrow('WORKSPACE_CANDIDATE_OPERATION_FAILED');
    expect(await readdir(fixture.target.artifactRoot)).toEqual([]);

    await writeFile(catalogPath, original, { mode: 0o600 });
    await expect(runWorkspaceCandidateOperation({
      ...releaseIdentity, ...fixture.target,
      expectedProfileId: fixture.profileId,
      importStagingRoot: fixture.importStagingRoot,
      migrationsDirectory, operation: 'validateAndMaterialize',
    })).resolves.toMatchObject({ kind: 'readiness', profileId: fixture.profileId });
  });

  it('rejects foreign-key failures in a published candidate', async () => {
    const root = await createPrivateTempRoot();
    const candidate = await createCandidateLayout(join(root, 'candidate'));
    await runWorkspaceCandidateOperation({
      ...releaseIdentity,
      ...candidate,
      migrationsDirectory,
      operation: 'bootstrapEmpty',
    });
    const database = new Database(candidate.databaseFilePath);
    try {
      database.pragma('foreign_keys = OFF');
      database
        .prepare(
          `
            INSERT INTO invoice_number_sequences (
              company_id,
              series_key,
              sequence_scope,
              last_sequence_number,
              created_at,
              updated_at
            ) VALUES (?, ?, ?, ?, ?, ?)
          `,
        )
        .run(
          'missing-company',
          'missing-series',
          '2026',
          1,
          '2026-08-19T00:00:00.000Z',
          '2026-08-19T00:00:00.000Z',
        );
    } finally {
      database.close();
    }

    await expect(
      runWorkspaceCandidateOperation({
        ...releaseIdentity,
        ...candidate,
        migrationsDirectory,
        operation: 'validatePublished',
      }),
    ).rejects.toThrow('WORKSPACE_CANDIDATE_OPERATION_FAILED');

    await expect(
      rm(candidate.candidateRoot, { recursive: true }),
    ).resolves.toBeUndefined();
  });

  it.each(['validatePublished', 'validateHistoricalPublished'] as const)(
    '%s rejects many foreign-key violations after reading only the first result', async operation => {
      const fixture = await createValidationFixture(operation);
      const database = new Database(fixture.input.databaseFilePath, { fileMustExist: true });
      try {
        database.pragma('foreign_keys = OFF');
        const insert = database.prepare(`
          INSERT INTO invoice_number_sequences (
            company_id, series_key, sequence_scope, last_sequence_number, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?)
        `);
        database.transaction(() => {
          for (let index = 0; index < 1_000; index++) {
            insert.run('missing-company', `missing-series-${index}`, '2026', 1,
              '2026-08-19T00:00:00.000Z', '2026-08-19T00:00:00.000Z');
          }
        })();
        expect(database.pragma('integrity_check', { simple: true })).toBe('ok');
      } finally { database.close(); }
      const before = await readFile(fixture.input.databaseFilePath);
      const beforeEntries = await readdir(dirname(fixture.input.databaseFilePath));
      const originalPrepare = Database.prototype.prepare;
      const firstResults = vi.fn();
      const unboundedResults = vi.fn();
      const pragma = vi.spyOn(Database.prototype, 'pragma');
      const close = vi.spyOn(Database.prototype, 'close');
      vi.spyOn(Database.prototype, 'prepare').mockImplementation(function (this: Database.Database, sql: string) {
        const statement = (originalPrepare<unknown[]>).call(this, sql);
        if (sql === 'PRAGMA foreign_key_check') {
          const originalGet = statement.get.bind(statement);
          const originalAll = statement.all.bind(statement);
          vi.spyOn(statement, 'get').mockImplementation(() => {
            const row = originalGet();
            firstResults(row);
            return row;
          });
          vi.spyOn(statement, 'all').mockImplementation(() => {
            unboundedResults();
            return originalAll();
          });
        }
        return statement;
      });

      await expect(runWorkspaceCandidateOperation(fixture.input)).rejects.toMatchObject({
        message: 'WORKSPACE_CANDIDATE_OPERATION_FAILED',
        cause: { message: 'ACTIVE_PROFILE_VALIDATION_FAILED' },
      });

      expect(firstResults).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ table: 'invoice_number_sequences' }));
      expect(unboundedResults).not.toHaveBeenCalled();
      expect(pragma.mock.calls.some(([source]) => /foreign_key_check/iu.test(source))).toBe(false);
      const handles = (close.mock.contexts as Database.Database[]).filter(handle =>
        handle.name === fixture.input.databaseFilePath || handle.name === toNamespacedPath(fixture.input.databaseFilePath));
      expect(handles).toHaveLength(2);
      expect(handles.every(handle => !handle.open)).toBe(true);
      expect(await readFile(fixture.input.databaseFilePath)).toEqual(before);
      expect(await readdir(dirname(fixture.input.databaseFilePath))).toEqual(beforeEntries);
    },
  );

  it('rejects corrupted SQLite state and releases the database handle', async () => {
    const root = await createPrivateTempRoot();
    const candidate = await createCandidateLayout(join(root, 'candidate'));
    await runWorkspaceCandidateOperation({
      ...releaseIdentity,
      ...candidate,
      migrationsDirectory,
      operation: 'bootstrapEmpty',
    });
    const databaseFile = await open(candidate.databaseFilePath, 'r+');
    try {
      await databaseFile.write(Buffer.alloc(64), 0, 64, 100);
      await databaseFile.sync();
    } finally {
      await databaseFile.close();
    }

    await expect(
      runWorkspaceCandidateOperation({
        ...releaseIdentity,
        ...candidate,
        migrationsDirectory,
        operation: 'validatePublished',
      }),
    ).rejects.toThrow('WORKSPACE_CANDIDATE_OPERATION_FAILED');

    await expect(
      rm(candidate.candidateRoot, { recursive: true }),
    ).resolves.toBeUndefined();
  });

  it('rejects an unexpected local actor identity and releases the database handle', async () => {
    const root = await createPrivateTempRoot();
    const candidate = await createCandidateLayout(join(root, 'candidate'));
    await runWorkspaceCandidateOperation({
      ...releaseIdentity,
      ...candidate,
      migrationsDirectory,
      operation: 'bootstrapEmpty',
    });
    const database = new Database(candidate.databaseFilePath);
    try {
      database
        .prepare(
          `
            UPDATE local_runtime_identity
            SET actor_id = 'other-actor'
            WHERE singleton_key = 'local-runtime'
          `,
        )
        .run();
    } finally {
      database.close();
    }

    await expect(
      runWorkspaceCandidateOperation({
        ...releaseIdentity,
        ...candidate,
        migrationsDirectory,
        operation: 'validatePublished',
      }),
    ).rejects.toThrow('WORKSPACE_CANDIDATE_OPERATION_FAILED');

    await expect(
      rm(candidate.candidateRoot, { recursive: true }),
    ).resolves.toBeUndefined();
  });

  it('rejects invalid artifact staging without leaking local paths', async () => {
    const root = await createPrivateTempRoot();
    const candidate = await createCandidateLayout(join(root, 'candidate'));
    const bootstrapped = await runWorkspaceCandidateOperation({
      ...releaseIdentity,
      ...candidate,
      migrationsDirectory,
      operation: 'bootstrapEmpty',
    });
    if (bootstrapped.kind !== 'readiness') throw new Error('invalid fixture');
    const importStagingRoot = join(root, 'missing-catalog');
    await createPrivateDirectory(importStagingRoot);

    const result = runWorkspaceCandidateOperation({
      ...releaseIdentity,
      ...candidate,
      expectedProfileId: bootstrapped.profileId,
      importStagingRoot,
      migrationsDirectory,
      operation: 'validateAndMaterialize',
    });
    await expect(result).rejects.toThrow(
      'WORKSPACE_CANDIDATE_OPERATION_FAILED',
    );
    await result.catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).not.toContain(root);
      expect(message).not.toContain('snapshot-catalog-v1.json');
      expect(message).not.toContain('stack');
    });
    await expect(
      rm(candidate.candidateRoot, { recursive: true }),
    ).resolves.toBeUndefined();
  });
});

type ValidationOperation = 'validatePublished' | 'validateHistoricalPublished' | 'validateAndMaterialize';

function validationInput(
  operation: ValidationOperation,
  candidate: Awaited<ReturnType<typeof createCandidateLayout>>,
  expectedProfileId: string,
  importStagingRoot: string,
): Exclude<WorkspaceCandidateOperation, { operation: 'inspectPublishedMigration' }> {
  const common = { ...releaseIdentity, ...candidate, migrationsDirectory, expectedProfileId };
  return operation === 'validateAndMaterialize'
    ? { ...common, operation, importStagingRoot }
    : { ...common, operation };
}

async function createValidationFixture(operation: ValidationOperation) {
  const root = await createPrivateTempRoot();
  const candidate = await createCandidateLayout(join(root, 'candidate'));
  const result = await runWorkspaceCandidateOperation({
    ...releaseIdentity, ...candidate, operation: 'bootstrapEmpty',
    migrationsDirectory: operation === 'validateHistoricalPublished'
      ? await createHistoricalPrefixMigrations(root) : migrationsDirectory,
  });
  if (result.kind !== 'readiness') throw new Error('invalid fixture');
  if (operation === 'validateHistoricalPublished') {
    const connection = new Database(candidate.databaseFilePath, { fileMustExist: true });
    try { connection.exec('DROP TABLE schema_migration_metadata'); } finally { connection.close(); }
  }
  const importStagingRoot = join(root, 'import');
  await createPrivateDirectory(importStagingRoot);
  await writeFile(join(importStagingRoot, 'snapshot-catalog-v1.json'),
    JSON.stringify({ artifacts: [], formatVersion: 1 }), { mode: 0o600 });
  return { input: validationInput(operation, candidate, result.profileId, importStagingRoot), profileId: result.profileId };
}

async function createImportedCandidateFixture(historical = false) {
  const root = await createPrivateTempRoot();
  const source = await createCandidateLayout(join(root, 'source'));
  const bootstrapped = await runWorkspaceCandidateOperation({
    ...releaseIdentity,
    ...source,
    migrationsDirectory: historical ? await createHistoricalPrefixMigrations(root) : migrationsDirectory,
    operation: 'bootstrapEmpty',
  });
  if (bootstrapped.kind !== 'readiness') throw new Error('invalid fixture');
  const importStagingRoot = join(root, 'import-staging');
  await createPrivateDirectory(importStagingRoot);
  await copyFile(
    source.databaseFilePath,
    join(importStagingRoot, 'profile.sqlite'),
  );
  await writeFile(join(importStagingRoot, 'snapshot-catalog-v1.json'),
    JSON.stringify({ artifacts: [], formatVersion: 1 }), { mode: 0o600 });
  const target = await createCandidateLayout(join(root, 'target'));
  const inspectionRoot = join(target.candidateRoot, 'inspection');
  await createPrivateDirectory(inspectionRoot);
  return {
    importStagingRoot,
    inspectionRoot,
    migrationChainIdentity: bootstrapped.migrationChainIdentity,
    profileId: bootstrapped.profileId,
    target,
  };
}

async function stageClosedWalBackup(
  fixture: Awaited<ReturnType<typeof createImportedCandidateFixture>>,
  mutations: { extraTable?: boolean; removeMetadata?: boolean } = {},
): Promise<void> {
  const sourcePath = join(fixture.importStagingRoot, 'profile.sqlite');
  const snapshotPath = join(fixture.importStagingRoot, 'closed-wal.sqlite');
  const database = new Database(sourcePath, { fileMustExist: true });
  try {
    database.pragma('journal_mode = WAL');
    if (mutations.extraTable) database.exec('CREATE TABLE unexpected (id TEXT)');
    if (mutations.removeMetadata) database.exec('DROP TABLE schema_migration_metadata');
    await database.backup(snapshotPath);
  } finally { database.close(); }
  await rename(snapshotPath, sourcePath);
  for (const suffix of ['-wal', '-shm', '-journal']) {
    await expect(lstat(sourcePath + suffix)).rejects.toMatchObject({ code: 'ENOENT' });
  }
}

function runImportedCandidate(fixture: Awaited<ReturnType<typeof createImportedCandidateFixture>>) {
  return runWorkspaceCandidateOperation({
    ...releaseIdentity, ...fixture.target,
    expectedProfileId: fixture.profileId,
    expectedSourceMigrationChainIdentity: fixture.migrationChainIdentity,
    importStagingRoot: fixture.importStagingRoot,
    inspectionRoot: fixture.inspectionRoot,
    migrationsDirectory, operation: 'migrateBackup',
  });
}

async function createPrivateTempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'eky-workspace-candidate-'));
  if (process.platform !== 'win32') await import('node:fs/promises').then(
    ({ chmod }) => chmod(root, 0o700),
  );
  roots.push(root);
  return root;
}

async function createHistoricalPrefixMigrations(root: string): Promise<string> {
  const historicalMigrations = join(root, 'historical-migrations');
  await cp(migrationsDirectory, historicalMigrations, { recursive: true });
  const migrationNames = (await readdir(historicalMigrations))
    .filter((name) => name.endsWith('.sql'))
    .sort();
  const lastMigrationName = migrationNames.at(-1);
  if (lastMigrationName === undefined) throw new Error('invalid fixture');
  await rm(join(historicalMigrations, lastMigrationName));
  if (process.platform !== 'win32') await chmod(historicalMigrations, 0o755);
  return historicalMigrations;
}

async function sha256(path: string): Promise<string> {
  return createHash('sha256').update(await readFile(path)).digest('hex');
}

async function createCandidateLayout(candidateRoot: string) {
  const databaseFilePath = join(candidateRoot, 'runtime', 'data', 'eky.sqlite');
  const artifactRoot = join(candidateRoot, 'runtime', 'storage', 'invoices');
  await createPrivateDirectory(dirname(databaseFilePath));
  await createPrivateDirectory(artifactRoot);
  return Object.freeze({ artifactRoot, candidateRoot, databaseFilePath });
}

async function createPrivateDirectory(path: string): Promise<void> {
  await mkdir(path, { mode: 0o700, recursive: true });
  if (process.platform !== 'win32') {
    const { chmod } = await import('node:fs/promises');
    await chmod(path, 0o700);
  }
}
