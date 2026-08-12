import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createProfileBackupSourceEntries } from '../createProfileBackupSourceEntries.js';
import { RecoveryPointKeyProtector } from './recoveryPointKeyProtector.js';
import { recoveryPointIndexFileName } from './recoveryPointIndexStore.js';
import {
  recoveryPointFileExtension,
  RecoveryPointStore,
} from './recoveryPointStore.js';

const roots: string[] = [];
const artifactId = '11111111-1111-4111-8111-111111111111';
const inspectionOperationId =
  '22222222-2222-4222-8222-222222222222';
const restoreOperationId =
  '33333333-3333-4333-8333-333333333333';
const profileId = 'a'.repeat(64);
const migrationChainIdentity = 'b'.repeat(64);
const snapshotCreatedAt = '2026-04-05T12:00:00.000Z';

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) =>
      rm(root, { force: true, recursive: true }),
    ),
  );
});

describe('recovery point store', () => {
  it('creates, self-validates, indexes and removes an encrypted point', async () => {
    const fixture = await createFixture();
    const point = await fixture.store.create({
      entries: fixture.entries,
      kind: 'manual',
      manifest: {
        appVersion: '0.1.0-alpha.1',
        createdAtEpochMilliseconds: BigInt(
          Date.parse(snapshotCreatedAt),
        ),
        migrationChainIdentity,
        profileId,
      },
      validatedAt: '2026-08-04T12:01:00.000Z',
    });

    expect(point).toEqual({
      artifactId,
      byteSize: expect.any(Number),
      createdAt: snapshotCreatedAt,
      kind: 'manual',
      state: 'validatedGood',
      validatedAt: '2026-08-04T12:01:00.000Z',
    });
    await expect(fixture.store.list(profileId)).resolves.toEqual([
      point,
    ]);
    const container = await readFile(
      join(
        fixture.recoveryRoot,
        profileId,
        `${artifactId}${recoveryPointFileExtension}`,
      ),
    );
    expect(container.subarray(0, 8).toString()).toBe('EKYRCV01');
    expect(container.toString('utf8')).not.toContain(
      'synthetic-sqlite-profile',
    );
    expect(container.toString('utf8')).not.toContain(profileId);
    expect(fixture.encrypt).toHaveBeenCalledTimes(1);
    expect(fixture.decrypt).toHaveBeenCalledTimes(1);

    await fixture.store.remove(profileId, artifactId);
    await expect(fixture.store.list(profileId)).resolves.toEqual([]);
  });

  it('fails closed and leaves no indexed point when key protection is unavailable', async () => {
    const fixture = await createFixture({
      failKeyProtection: true,
    });

    await expect(
      fixture.store.create({
        entries: fixture.entries,
        kind: 'daily',
        manifest: {
          appVersion: '0.1.0-alpha.1',
          createdAtEpochMilliseconds: BigInt(
            Date.parse(snapshotCreatedAt),
          ),
          migrationChainIdentity,
          profileId,
        },
        validatedAt: '2026-08-04T12:01:00.000Z',
      }),
    ).rejects.toThrow();
    await expect(fixture.store.list(profileId)).resolves.toEqual([]);
  });

  it('stages only the exact validated pre-update point for restore', async () => {
    const fixture = await createFixture();
    await fixture.store.create({
      entries: fixture.entries,
      kind: 'preUpdate',
      manifest: {
        appVersion: '0.1.0-alpha.1',
        createdAtEpochMilliseconds: BigInt(
          Date.parse(snapshotCreatedAt),
        ),
        migrationChainIdentity,
        profileId,
      },
      validatedAt: '2026-08-04T12:01:00.000Z',
    });

    const staged = await fixture.store.stageForRestore({
      artifactId,
      expectedMigrationChainIdentity: migrationChainIdentity,
      operationId: restoreOperationId,
    });

    expect(staged).toMatchObject({
      appVersion: '0.1.0-alpha.1',
      documentCount: 0,
      migrationChainIdentity,
      profileId,
      profileMatchesActive: true,
    });
    await expect(
      readFile(join(staged.operationRoot, 'profile.sqlite'), 'utf8'),
    ).resolves.toBe('synthetic-sqlite-profile');
  });

  it('revalidates the exact protected point without activating it and cleans staging', async () => {
    const fixture = await createFixture();
    await fixture.store.create({
      entries: fixture.entries,
      kind: 'preUpdate',
      manifest: {
        appVersion: '0.1.0-alpha.1',
        createdAtEpochMilliseconds: BigInt(
          Date.parse(snapshotCreatedAt),
        ),
        migrationChainIdentity,
        profileId,
      },
      validatedAt: '2026-08-04T12:01:00.000Z',
    });

    await expect(
      fixture.store.validateProtectedRecoveryPoint({
        expectedMigrationChainIdentity: migrationChainIdentity,
        recoveryPointReference: artifactId,
      }),
    ).resolves.toBeUndefined();
    await expect(
      access(join(fixture.stagingRoot, inspectionOperationId)),
    ).rejects.toMatchObject({ code: 'ENOENT' });
    expect(fixture.validateProfileSnapshot).toHaveBeenCalledTimes(2);
  });

  it('rejects a changed chain, foreign active profile and changed container before use', async () => {
    const fixture = await createFixture();
    await fixture.store.create({
      entries: fixture.entries,
      kind: 'preUpdate',
      manifest: {
        appVersion: '0.1.0-alpha.1',
        createdAtEpochMilliseconds: BigInt(
          Date.parse(snapshotCreatedAt),
        ),
        migrationChainIdentity,
        profileId,
      },
      validatedAt: '2026-08-04T12:01:00.000Z',
    });

    await expect(
      fixture.store.validateProtectedRecoveryPoint({
        expectedMigrationChainIdentity: 'c'.repeat(64),
        recoveryPointReference: artifactId,
      }),
    ).rejects.toThrow('RECOVERY_POINT_PROTECTED_VALIDATION_FAILED');

    const foreignFixture = await createFixture({
      profileMatchesActive: false,
    });
    await foreignFixture.store.create({
      entries: foreignFixture.entries,
      kind: 'preUpdate',
      manifest: {
        appVersion: '0.1.0-alpha.1',
        createdAtEpochMilliseconds: BigInt(
          Date.parse(snapshotCreatedAt),
        ),
        migrationChainIdentity,
        profileId,
      },
      validatedAt: '2026-08-04T12:01:00.000Z',
    });
    await expect(
      foreignFixture.store.validateProtectedRecoveryPoint({
        expectedMigrationChainIdentity: migrationChainIdentity,
        recoveryPointReference: artifactId,
      }),
    ).rejects.toThrow('RECOVERY_POINT_PROTECTED_VALIDATION_FAILED');

    const changedIndex = JSON.parse(
      await readFile(fixture.indexPath, 'utf8'),
    ) as { points: Array<{ byteSize: number }> };
    changedIndex.points[0]!.byteSize += 1;
    await writeFile(
      fixture.indexPath,
      `${JSON.stringify(changedIndex)}\n`,
      'utf8',
    );
    await expect(
      fixture.store.validateProtectedRecoveryPoint({
        expectedMigrationChainIdentity: migrationChainIdentity,
        recoveryPointReference: artifactId,
      }),
    ).rejects.toThrow('RECOVERY_POINT_PROTECTED_VALIDATION_FAILED');
  });

  it('rejects a missing key envelope and cleans validation staging', async () => {
    const fixture = await createFixture();
    await fixture.store.create({
      entries: fixture.entries,
      kind: 'preUpdate',
      manifest: {
        appVersion: '0.1.0-alpha.1',
        createdAtEpochMilliseconds: BigInt(
          Date.parse(snapshotCreatedAt),
        ),
        migrationChainIdentity,
        profileId,
      },
      validatedAt: '2026-08-04T12:01:00.000Z',
    });
    await rm(fixture.keyEnvelopePath);

    await expect(
      fixture.store.validateProtectedRecoveryPoint({
        expectedMigrationChainIdentity: migrationChainIdentity,
        recoveryPointReference: artifactId,
      }),
    ).rejects.toThrow('RECOVERY_POINT_PROTECTED_VALIDATION_FAILED');
    await expect(
      access(join(fixture.stagingRoot, inspectionOperationId)),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects a non-pre-update point from protected validation and restore', async () => {
    const fixture = await createFixture();
    await fixture.store.create({
      entries: fixture.entries,
      kind: 'manual',
      manifest: {
        appVersion: '0.1.0-alpha.1',
        createdAtEpochMilliseconds: BigInt(
          Date.parse(snapshotCreatedAt),
        ),
        migrationChainIdentity,
        profileId,
      },
      validatedAt: '2026-08-04T12:01:00.000Z',
    });

    await expect(
      fixture.store.validateProtectedRecoveryPoint({
        expectedMigrationChainIdentity: migrationChainIdentity,
        recoveryPointReference: artifactId,
      }),
    ).rejects.toThrow('RECOVERY_POINT_PROTECTED_VALIDATION_FAILED');
    await expect(
      fixture.store.stageForRestore({
        artifactId,
        expectedMigrationChainIdentity: migrationChainIdentity,
        operationId: restoreOperationId,
      }),
    ).rejects.toThrow('RECOVERY_POINT_RESTORE_SOURCE_INVALID');
  });
});

async function createFixture(options: {
  failKeyProtection?: boolean;
  profileMatchesActive?: boolean;
} = {}) {
  const root = await mkdtemp(join(tmpdir(), 'eky-recovery-store-'));
  roots.push(root);
  const recoveryRoot = join(root, 'runtime', 'recovery-points');
  const stagingRoot = join(root, 'runtime', 'staging');
  const quarantineRoot = join(root, 'runtime', 'quarantine');
  const sourceRoot = join(root, 'snapshot');
  await Promise.all([
    mkdir(stagingRoot, { mode: 0o700, recursive: true }),
    mkdir(quarantineRoot, { mode: 0o700, recursive: true }),
    mkdir(sourceRoot, { mode: 0o700, recursive: true }),
  ]);
  await writeFile(
    join(sourceRoot, 'profile.sqlite'),
    'synthetic-sqlite-profile',
  );
  await writeFile(
    join(sourceRoot, 'snapshot-catalog-v1.json'),
    '{"artifacts":[]}',
  );
  const entries = await createProfileBackupSourceEntries(sourceRoot);
  let protectedKey = '';
  const encrypt = vi.fn(async (value: string) => {
    if (options.failKeyProtection) {
      throw new Error('safeStorage unavailable');
    }
    protectedKey = value;
    return Uint8Array.from(Buffer.from(`protected:${value}`));
  });
  const decrypt = vi.fn(async () => ({
    shouldReEncrypt: false,
    value: protectedKey,
  }));
  const keyProtector = new RecoveryPointKeyProtector({
    decrypt,
    encrypt,
  });
  const validateProfileSnapshot = vi.fn(async () => ({
    activeProfileIsEmpty: false,
    artifactCount: 0,
    artifactTotalByteSize: 0,
    databaseHealth: 'healthy' as const,
    migrationChainIdentity,
    profileId,
    profileMatchesActive: options.profileMatchesActive ?? true,
    type: 'profileSnapshotValidation' as const,
  }));
  const store = new RecoveryPointStore({
    artifactIdFactory: () => artifactId,
    inspectionOperationIdFactory: () => inspectionOperationId,
    keyProtector,
    quarantineRoot,
    recoveryRoot,
    stagingRoot,
    validator: {
      validateProfileSnapshot,
    },
  });

  return {
    containerPath: join(
      recoveryRoot,
      profileId,
      `${artifactId}${recoveryPointFileExtension}`,
    ),
    decrypt,
    encrypt,
    entries,
    indexPath: join(
      recoveryRoot,
      profileId,
      recoveryPointIndexFileName,
    ),
    keyEnvelopePath: join(
      recoveryRoot,
      profileId,
      `${artifactId}.key.json`,
    ),
    recoveryRoot,
    stagingRoot,
    store,
    validateProfileSnapshot,
  };
}
