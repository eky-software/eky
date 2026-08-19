import {
  chmod,
  copyFile,
  cp,
  lstat,
  mkdir,
  mkdtemp,
  open,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import Database from 'better-sqlite3';

import { runWorkspaceCandidateOperation } from './runWorkspaceCandidateOperation.js';

const migrationsDirectory = fileURLToPath(
  new URL('../../database/migrations/', import.meta.url),
);
const releaseIdentity = Object.freeze({
  appVersion: '0.2.6',
  buildRevision: 'a'.repeat(40),
});
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

describe('runWorkspaceCandidateOperation', () => {
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
    const migrated = await runWorkspaceCandidateOperation({
      ...releaseIdentity,
      ...target,
      expectedProfileId: bootstrapped.profileId,
      expectedSourceMigrationChainIdentity:
        bootstrapped.migrationChainIdentity,
      importStagingRoot,
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
      await mkdir(writableMigrations, { mode: 0o777 });
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
        migrationsDirectory,
        operation: 'migrateBackup',
      }),
    ).rejects.toThrow('WORKSPACE_CANDIDATE_OPERATION_FAILED');

    await expect(
      rm(fixture.target.candidateRoot, { recursive: true }),
    ).resolves.toBeUndefined();
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

async function createImportedCandidateFixture() {
  const root = await createPrivateTempRoot();
  const source = await createCandidateLayout(join(root, 'source'));
  const bootstrapped = await runWorkspaceCandidateOperation({
    ...releaseIdentity,
    ...source,
    migrationsDirectory,
    operation: 'bootstrapEmpty',
  });
  if (bootstrapped.kind !== 'readiness') throw new Error('invalid fixture');
  const importStagingRoot = join(root, 'import-staging');
  await createPrivateDirectory(importStagingRoot);
  await copyFile(
    source.databaseFilePath,
    join(importStagingRoot, 'profile.sqlite'),
  );
  return {
    importStagingRoot,
    migrationChainIdentity: bootstrapped.migrationChainIdentity,
    profileId: bootstrapped.profileId,
    target: await createCandidateLayout(join(root, 'target')),
  };
}

async function createPrivateTempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'eky-workspace-candidate-'));
  if (process.platform !== 'win32') await import('node:fs/promises').then(
    ({ chmod }) => chmod(root, 0o700),
  );
  roots.push(root);
  return root;
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
