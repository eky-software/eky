import {
  mkdir,
  mkdtemp,
  rm,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { RecoveryPointIndexEntry } from './recoveryPointIndexStore.js';
import {
  recoveryPointRotationJournalFileName,
  RecoveryPointRotationJournalStore,
} from './recoveryPointRotationJournalStore.js';
import { RecoveryPointRotationService } from './recoveryPointRotationService.js';

const roots: string[] = [];
const profileId = 'a'.repeat(64);

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) =>
      rm(root, { force: true, recursive: true }),
    ),
  );
});

describe('recovery point rotation service', () => {
  it('RECOVERY-ROTATION-001 journals and removes old points after a replacement exists', async () => {
    const fixture = await createFixture(
      Array.from({ length: 9 }, (_, index) =>
        createPoint(index + 1),
      ),
    );

    const result = await fixture.service.maintain(profileId);

    expect(result.deletedCount).toBe(2);
    expect(fixture.remove).toHaveBeenCalledTimes(2);
    await expect(fixture.journalStore.read()).resolves.toBeUndefined();
  });

  it('continues a journal safely after an interrupted deletion', async () => {
    const fixture = await createFixture([]);
    const pending = [createPoint(1).artifactId, createPoint(2).artifactId];
    await fixture.journalStore.write({
      formatVersion: 1,
      pendingArtifactIds: pending,
      revision: 4,
    });
    fixture.remove.mockRejectedValueOnce(new Error('interrupted'));

    await expect(
      fixture.service.resumePending(profileId),
    ).rejects.toThrow('interrupted');
    await expect(fixture.journalStore.read()).resolves.toEqual({
      formatVersion: 1,
      pendingArtifactIds: pending,
      revision: 4,
    });

    await expect(
      fixture.service.resumePending(profileId),
    ).resolves.toBe(2);
    await expect(fixture.journalStore.read()).resolves.toBeUndefined();
  });

  it('keeps a journal-protected point across later rotation runs', async () => {
    const points = Array.from({ length: 9 }, (_, index) =>
      createPoint(index + 1),
    );
    const protectedArtifactId = points[0]!.artifactId;
    const fixture = await createFixture(points, {
      readDurableProtectedArtifactIds: async () => [protectedArtifactId],
    });

    await fixture.service.maintain(profileId);

    expect(fixture.remove).not.toHaveBeenCalledWith(
      profileId,
      protectedArtifactId,
    );
  });

  it('fails closed before deletion when durable protection cannot be read', async () => {
    const fixture = await createFixture(
      Array.from({ length: 9 }, (_, index) => createPoint(index + 1)),
      {
        readDurableProtectedArtifactIds: async () => {
          throw new Error('UPDATE_JOURNAL_INVALID');
        },
      },
    );

    await expect(fixture.service.maintain(profileId)).rejects.toThrow(
      'UPDATE_JOURNAL_INVALID',
    );
    expect(fixture.remove).not.toHaveBeenCalled();
    await expect(fixture.journalStore.read()).resolves.toBeUndefined();
  });
});

async function createFixture(
  points: RecoveryPointIndexEntry[],
  options: {
    readDurableProtectedArtifactIds?(
      profileId: string,
    ): Promise<readonly string[]>;
  } = {},
) {
  const recoveryRoot = await mkdtemp(
    join(tmpdir(), 'eky-recovery-rotation-'),
  );
  roots.push(recoveryRoot);
  const profileRoot = join(recoveryRoot, profileId);
  await mkdir(profileRoot, { mode: 0o700, recursive: true });
  const remove = vi.fn(async () => undefined);
  const service = new RecoveryPointRotationService({
    ...options,
    recoveryRoot,
    store: {
      list: vi.fn(async () => points),
      remove,
    },
  });
  return {
    journalStore: new RecoveryPointRotationJournalStore(
      join(profileRoot, recoveryPointRotationJournalFileName),
    ),
    remove,
    service,
  };
}

function createPoint(sequence: number): RecoveryPointIndexEntry {
  const timestamp = new Date(
    Date.UTC(2026, 0, 1, 0, 0, sequence),
  ).toISOString();
  return {
    artifactId: `11111111-1111-4111-8111-${sequence
      .toString(16)
      .padStart(12, '0')}`,
    byteSize: 1,
    createdAt: timestamp,
    kind: 'daily',
    state: 'validatedGood',
    validatedAt: timestamp,
  };
}
