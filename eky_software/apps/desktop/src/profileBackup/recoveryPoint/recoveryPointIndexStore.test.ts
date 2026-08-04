import {
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  recoveryPointIndexFileName,
  RecoveryPointIndexStore,
} from './recoveryPointIndexStore.js';

const roots: string[] = [];
const point = {
  artifactId: '11111111-1111-4111-8111-111111111111',
  byteSize: 1_024,
  createdAt: '2026-08-04T12:00:00.000Z',
  kind: 'daily' as const,
  state: 'validatedGood' as const,
  validatedAt: '2026-08-04T12:01:00.000Z',
};

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) =>
      rm(root, { force: true, recursive: true }),
    ),
  );
});

describe('recovery point index store', () => {
  it('round-trips only the strict safe index schema', async () => {
    const root = await createRoot();
    const path = join(root, recoveryPointIndexFileName);
    const store = new RecoveryPointIndexStore(path);
    await store.write({
      formatVersion: 1,
      points: [point],
      revision: 1,
    });

    await expect(store.read()).resolves.toEqual({
      formatVersion: 1,
      points: [point],
      revision: 1,
    });
    expect(await readFile(path, 'utf8')).not.toContain('company');
  });

  it('recovers an interrupted index replacement from the backup slot', async () => {
    const root = await createRoot();
    const path = join(root, recoveryPointIndexFileName);
    const store = new RecoveryPointIndexStore(path);
    await store.write({
      formatVersion: 1,
      points: [point],
      revision: 1,
    });
    await rename(path, `${path}.backup`);

    await expect(store.read()).resolves.toMatchObject({
      points: [point],
      revision: 1,
    });
    await expect(readFile(path, 'utf8')).resolves.toContain(
      point.artifactId,
    );
  });

  it.each([
    {
      formatVersion: 1,
      points: null,
      revision: 0,
    },
    {
      extra: true,
      formatVersion: 1,
      points: [],
      revision: 0,
    },
    {
      formatVersion: 1,
      points: [{ ...point, byteSize: -1 }],
      revision: 1,
    },
  ])('rejects malformed index data %#', async (invalid) => {
    const root = await createRoot();
    const path = join(root, recoveryPointIndexFileName);
    await writeFile(path, JSON.stringify(invalid));

    await expect(
      new RecoveryPointIndexStore(path).read(),
    ).rejects.toMatchObject({
      code: 'RECOVERY_POINT_INDEX_INVALID',
    });
  });
});

async function createRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'eky-recovery-index-'));
  roots.push(root);
  return root;
}
