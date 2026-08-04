import { randomUUID } from 'node:crypto';
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { ConsistentProfileSnapshotService } from './createConsistentProfileSnapshot.js';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((path) =>
      rm(path, { force: true, recursive: true }),
    ),
  );
});

describe('consistent profile snapshot', () => {
  it('returns database and artifact metadata as one result', async () => {
    const fixture = await createFixture();
    const service = new ConsistentProfileSnapshotService({
      artifactStager: {
        async stageArtifacts() {
          return {
            artifactCount: 1,
            artifactTotalByteSize: 100,
            catalogByteSize: 200,
            logicalPath: 'snapshot-catalog-v1.json',
            sha256: 'b'.repeat(64),
          };
        },
      },
      sqliteSnapshotService: fixture.sqliteSnapshotService,
      stagingRoot: fixture.stagingRoot,
    });

    await expect(
      service.createProfileSnapshot({
        operationId: fixture.operationId,
        signal: new AbortController().signal,
      }),
    ).resolves.toEqual({
      artifactCatalog: {
        artifactCount: 1,
        artifactTotalByteSize: 100,
        catalogByteSize: 200,
        logicalPath: 'snapshot-catalog-v1.json',
        sha256: 'b'.repeat(64),
      },
      database: expect.objectContaining({
        logicalPath: 'profile.sqlite',
      }),
    });
  });

  it('discards the complete operation staging when artifact staging fails', async () => {
    const fixture = await createFixture();
    const service = new ConsistentProfileSnapshotService({
      artifactStager: {
        async stageArtifacts() {
          throw new Error('private source path');
        },
      },
      sqliteSnapshotService: fixture.sqliteSnapshotService,
      stagingRoot: fixture.stagingRoot,
    });

    await expect(
      service.createProfileSnapshot({
        operationId: fixture.operationId,
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow('PROFILE_SNAPSHOT_ARTIFACTS_FAILED');
    await expect(
      lstat(join(fixture.stagingRoot, fixture.operationId)),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('does not remove unknown staging when database snapshot creation fails', async () => {
    const fixture = await createFixture();
    const operationRoot = join(
      fixture.stagingRoot,
      fixture.operationId,
    );
    await mkdir(operationRoot, { mode: 0o700 });
    await writeFile(join(operationRoot, 'sentinel.txt'), 'keep', 'utf8');
    const service = new ConsistentProfileSnapshotService({
      artifactStager: {
        async stageArtifacts() {
          throw new Error('must not run');
        },
      },
      sqliteSnapshotService: {
        async createSqliteSnapshot() {
          throw new Error('PROFILE_SNAPSHOT_DATABASE_FAILED');
        },
      },
      stagingRoot: fixture.stagingRoot,
    });

    await expect(
      service.createProfileSnapshot({
        operationId: fixture.operationId,
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow('PROFILE_SNAPSHOT_DATABASE_FAILED');
    await expect(
      lstat(join(operationRoot, 'sentinel.txt')),
    ).resolves.toMatchObject({ size: 4 });
  });
});

async function createFixture(): Promise<{
  operationId: string;
  sqliteSnapshotService: {
    createSqliteSnapshot(): Promise<{
      databaseByteSize: number;
      logicalPath: 'profile.sqlite';
      sha256: string;
      totalPages: number;
    }>;
  };
  stagingRoot: string;
}> {
  const stagingRoot = await mkdtemp(
    join(tmpdir(), 'eky-consistent-snapshot-'),
  );
  temporaryRoots.push(stagingRoot);
  await chmod(stagingRoot, 0o700);
  const operationId = randomUUID();

  return {
    operationId,
    sqliteSnapshotService: {
      async createSqliteSnapshot() {
        const operationRoot = join(stagingRoot, operationId);
        await mkdir(operationRoot, { mode: 0o700 });
        await writeFile(join(operationRoot, 'profile.sqlite'), 'sqlite');
        return {
          databaseByteSize: 6,
          logicalPath: 'profile.sqlite',
          sha256: 'a'.repeat(64),
          totalPages: 1,
        };
      },
    },
    stagingRoot,
  };
}
