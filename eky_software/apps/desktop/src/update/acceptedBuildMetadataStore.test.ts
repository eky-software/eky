import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';
import { createSelectorAcceptedBuildMetadata, parseAcceptedBuildMetadata } from './acceptedBuildMetadata.js';

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

afterEach(async context => {
  const completedRoots = roots.splice(0);
  if (context.task.result?.state !== 'pass') return;
  await Promise.all(
    completedRoots.map((root) => rm(root, { force: true, recursive: true })),
  );
});

describe('accepted build metadata store', () => {
  it('preserves canonical v1 bytes and reads scoped metadata from the same slots', async () => {
    const filePath = await createPath();
    const store = new AcceptedBuildMetadataStore(filePath);
    await store.write(metadata);
    expect(await readFile(filePath, 'utf8')).toBe(`${JSON.stringify(parseAcceptedBuildMetadata(metadata))}\n`);
    const scoped = createSelectorAcceptedBuildMetadata(metadata, { ...metadata, appVersion: '0.3.0' });
    await store.write(scoped);
    expect(await store.read()).toEqual(scoped);
    expect(await readFile(filePath, 'utf8')).toBe(`${JSON.stringify(scoped)}\n`);
  });

  it.each(['', '.backup', '.next'])('rejects a format downgrade with v2 in %s without deleting evidence', async suffix => {
    const filePath = await createPath();
    const scoped = createSelectorAcceptedBuildMetadata(metadata, { ...metadata, appVersion: '0.3.0' });
    for (const slot of ['', '.backup', '.next']) await writeSlot(`${filePath}${slot}`, slot === suffix ? scoped : metadata);
    const before = await Promise.all(['', '.backup', '.next'].map(slot => readFile(`${filePath}${slot}`)));
    await expect(new AcceptedBuildMetadataStore(filePath).write(metadata)).rejects.toThrow('ACCEPTED_BUILD_METADATA_INVALID');
    expect(await Promise.all(['', '.backup', '.next'].map(slot => readFile(`${filePath}${slot}`)))).toEqual(before);
  });

  it('recovers the scoped baseline from backup without claiming pending next as accepted', async () => {
    const filePath = await createPath();
    const scoped = createSelectorAcceptedBuildMetadata(metadata, { ...metadata, appVersion: '0.3.0' });
    const pending = createSelectorAcceptedBuildMetadata(scoped, { ...metadata, appVersion: '0.4.0' });
    await writeSlot(`${filePath}.backup`, scoped);
    await writeSlot(`${filePath}.next`, pending);
    const store = new AcceptedBuildMetadataStore(filePath);
    expect(await store.read()).toEqual(scoped);
    expect(await store.read()).toEqual(scoped);
  });
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

  it('clears current and interrupted write slots idempotently', async () => {
    const filePath = await createPath();
    await writeSlot(filePath, metadata);
    await writeSlot(`${filePath}.next`, metadata);
    await writeSlot(`${filePath}.backup`, metadata);
    const store = new AcceptedBuildMetadataStore(filePath);

    await store.clear();
    await store.clear();

    await expect(store.read()).resolves.toBeUndefined();
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
