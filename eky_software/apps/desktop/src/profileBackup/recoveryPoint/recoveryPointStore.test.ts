import {
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
import {
  recoveryPointFileExtension,
  RecoveryPointStore,
} from './recoveryPointStore.js';

const roots: string[] = [];
const artifactId = '11111111-1111-4111-8111-111111111111';
const inspectionOperationId =
  '22222222-2222-4222-8222-222222222222';
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
});

async function createFixture(options: {
  failKeyProtection?: boolean;
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
  const store = new RecoveryPointStore({
    artifactIdFactory: () => artifactId,
    inspectionOperationIdFactory: () => inspectionOperationId,
    keyProtector,
    quarantineRoot,
    recoveryRoot,
    stagingRoot,
    validator: {
      validateProfileSnapshot: vi.fn(async () => ({
        artifactCount: 0,
        artifactTotalByteSize: 0,
        databaseHealth: 'healthy' as const,
        migrationChainIdentity,
        profileId,
        profileMatchesActive: true,
        type: 'profileSnapshotValidation' as const,
      })),
    },
  });

  return {
    decrypt,
    encrypt,
    entries,
    recoveryRoot,
    store,
  };
}
