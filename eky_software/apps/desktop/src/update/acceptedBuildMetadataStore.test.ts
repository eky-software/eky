import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  acceptedBuildMetadataFileName,
  AcceptedBuildMetadataStore,
} from './acceptedBuildMetadataStore.js';

const roots: string[] = [];
const metadata = {
  acceptedAt: '2026-08-11T18:00:00.000Z',
  appVersion: '0.2.0-alpha.1',
  buildRevision: 'abcdef012345',
  formatVersion: 1 as const,
  releaseChannel: 'pilot' as const,
};

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

describe('accepted build metadata store', () => {
  it('writes and reads only the bounded installation identity', async () => {
    const filePath = await createPath();
    const store = new AcceptedBuildMetadataStore(filePath);
    await store.write(metadata);
    await expect(store.read()).resolves.toEqual(metadata);
    expect(JSON.stringify(await store.read())).not.toContain('profile');
  });

  it('recovers a backup but fails closed on corrupt current metadata', async () => {
    const backupPath = await createPath();
    await writeSlot(`${backupPath}.backup`, metadata);
    await expect(
      new AcceptedBuildMetadataStore(backupPath).read(),
    ).resolves.toEqual(metadata);

    const corruptPath = await createPath();
    await writeSlot(corruptPath, { ...metadata, profilePath: 'private' });
    await writeSlot(`${corruptPath}.backup`, metadata);
    await expect(
      new AcceptedBuildMetadataStore(corruptPath).read(),
    ).rejects.toThrow('ACCEPTED_BUILD_METADATA_INVALID');
  });

  it('promotes a complete next slot after first-write interruption', async () => {
    const filePath = await createPath();
    await writeSlot(`${filePath}.next`, metadata);
    await expect(
      new AcceptedBuildMetadataStore(filePath).read(),
    ).resolves.toEqual(metadata);
    expect(JSON.parse(await readFile(filePath, 'utf8'))).toEqual(metadata);
  });

  it('rejects unknown fields, unsafe versions and relative storage paths', async () => {
    const filePath = await createPath();
    const store = new AcceptedBuildMetadataStore(filePath);
    await expect(
      store.write({ ...metadata, installerPath: 'C:/private.msi' } as never),
    ).rejects.toThrow('ACCEPTED_BUILD_METADATA_INVALID');
    await expect(
      store.write({ ...metadata, appVersion: 'v0.2.0' }),
    ).rejects.toThrow('ACCEPTED_BUILD_METADATA_INVALID');
    expect(() => new AcceptedBuildMetadataStore('accepted-build-v1.json')).toThrow(
      'ACCEPTED_BUILD_METADATA_UNAVAILABLE',
    );
  });
});

async function createPath(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'eky-accepted-build-'));
  roots.push(root);
  return join(root, 'runtime', acceptedBuildMetadataFileName);
}

async function writeSlot(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value)}\n`, { mode: 0o600 });
}
