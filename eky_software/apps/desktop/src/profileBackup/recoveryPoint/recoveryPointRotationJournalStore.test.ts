import {
  mkdir,
  mkdtemp,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  recoveryPointRotationJournalFileName,
  RecoveryPointRotationJournalStore,
} from './recoveryPointRotationJournalStore.js';

const roots: string[] = [];
const artifactId = '11111111-1111-4111-8111-111111111111';

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) =>
      rm(root, { force: true, recursive: true }),
    ),
  );
});

describe('recovery point rotation journal store', () => {
  it('round-trips a strict versioned journal and clears all slots', async () => {
    const fixture = await createFixture();
    const journal = {
      formatVersion: 1 as const,
      pendingArtifactIds: [artifactId],
      revision: 3,
    };

    await fixture.store.write(journal);

    await expect(fixture.store.read()).resolves.toEqual(journal);
    await fixture.store.clear();
    await expect(fixture.store.read()).resolves.toBeUndefined();
  });

  it.each([
    'null',
    JSON.stringify({
      formatVersion: 1,
      pendingArtifactIds: [artifactId],
      revision: 0,
      unknown: true,
    }),
    JSON.stringify({
      formatVersion: 1,
      pendingArtifactIds: [null],
      revision: 0,
    }),
  ])('rejects malformed or widened journal input', async (contents) => {
    const fixture = await createFixture();
    await writeFile(fixture.filePath, contents, 'utf8');

    await expect(fixture.store.read()).rejects.toThrow(
      'RECOVERY_POINT_ROTATION_JOURNAL_INVALID',
    );
  });

  it('recovers a valid backup slot after an interrupted replacement', async () => {
    const fixture = await createFixture();
    const journal = {
      formatVersion: 1 as const,
      pendingArtifactIds: [artifactId],
      revision: 7,
    };
    await fixture.store.write(journal);
    await rename(fixture.filePath, `${fixture.filePath}.backup`);

    await expect(fixture.store.read()).resolves.toEqual(journal);
  });
});

async function createFixture(): Promise<{
  filePath: string;
  store: RecoveryPointRotationJournalStore;
}> {
  const root = await mkdtemp(join(tmpdir(), 'eky-rotation-journal-'));
  roots.push(root);
  const profileRoot = join(root, 'profile');
  await mkdir(profileRoot, { mode: 0o700, recursive: true });
  const filePath = join(
    profileRoot,
    recoveryPointRotationJournalFileName,
  );
  return {
    filePath,
    store: new RecoveryPointRotationJournalStore(filePath),
  };
}
