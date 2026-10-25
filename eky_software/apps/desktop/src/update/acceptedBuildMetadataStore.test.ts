import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';
import { createBusinessAcceptedBuildMetadata, createSelectorAcceptedBuildMetadata, parseAcceptedBuildMetadata } from './acceptedBuildMetadata.js';

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

  it('publishes from the original selected identity and returns the writer identity', async () => {
    const filePath = await createPath();
    const store = new AcceptedBuildMetadataStore(filePath);
    const selector = createSelectorAcceptedBuildMetadata(metadata, { ...metadata, appVersion: '0.3.0' });
    await store.write(selector);
    const selected = (await store.inspectSlots()).current!;
    const published = createBusinessAcceptedBuildMetadata(selector, selector.acceptedBuild);
    const identity = await store.publishSelected(published, {
      selected, assertAuthority() {}, async assertExternalSelection() {},
    });
    const slots = await store.inspectSlots();
    expect(slots.current?.identity).toEqual(identity);
    expect(identity.ino).not.toBe(selected.identity?.ino);
    expect(slots.current?.value).toEqual(published);
    expect(slots.next).toBeUndefined();
    expect(slots.backup).toBeUndefined();
  });

  it.each(['missingIdentity', 'mismatchedValue', 'downgrade', 'authority'] as const)(
    'preserves the selected bytes when publication rejects %s', async fault => {
      const filePath = await createPath();
      const store = new AcceptedBuildMetadataStore(filePath);
      const selector = createSelectorAcceptedBuildMetadata(metadata, { ...metadata, appVersion: '0.3.0' });
      await store.write(selector);
      const original = (await store.inspectSlots()).current!;
      const selected = fault === 'missingIdentity' ? { bytes: original.bytes, value: original.value }
        : fault === 'mismatchedValue' ? { ...original, value: metadata } : original;
      await expect(store.publishSelected(fault === 'downgrade' ? metadata
        : createBusinessAcceptedBuildMetadata(selector, selector.acceptedBuild), {
        selected,
        assertAuthority() { if (fault === 'authority') throw new Error('SYNTHETIC_AUTHORITY_LOST'); },
        async assertExternalSelection() {},
      })).rejects.toThrow();
      const retained = await store.inspectSlots();
      expect(retained.current).toEqual(original);
      expect(retained.next).toBeUndefined();
      expect(retained.backup).toBeUndefined();
    },
  );

  it('retains published current and original backup when external authority expires before cleanup', async () => {
    const filePath = await createPath();
    const store = new AcceptedBuildMetadataStore(filePath);
    const selector = createSelectorAcceptedBuildMetadata(metadata, { ...metadata, appVersion: '0.3.0' });
    await store.write(selector);
    const selected = (await store.inspectSlots()).current!;
    const business = createBusinessAcceptedBuildMetadata(selector, selector.acceptedBuild);
    let expired = false;
    await expect(store.publishSelected(business, {
      selected,
      assertAuthority() { if (expired) throw new Error('SYNTHETIC_AUTHORITY_LOST'); },
      async assertExternalSelection() {
        const current = await readFile(filePath).catch(error => {
          if (error.code === 'ENOENT') return undefined;
          throw error;
        });
        if (current !== undefined && JSON.parse(current.toString()).acceptanceScope === 'business') {
          expired = true;
          throw new Error('SYNTHETIC_AUTHORITY_LOST');
        }
      },
    })).rejects.toThrow('ACCEPTED_BUILD_METADATA_UNAVAILABLE');
    expect(expired).toBe(true);
    expect(JSON.parse((await readFile(filePath)).toString())).toEqual(business);
    expect(await readFile(`${filePath}.backup`)).toEqual(Buffer.from(selected.bytes));
    await expect(readFile(`${filePath}.next`)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it.each(['synchronous', 'external'] as const)(
    'does not replace the captured %s authority during a publication', async kind => {
      const filePath = await createPath();
      const store = new AcceptedBuildMetadataStore(filePath);
      const selector = createSelectorAcceptedBuildMetadata(metadata, { ...metadata, appVersion: '0.3.0' });
      await store.write(selector);
      const selected = (await store.inspectSlots()).current!;
      let current = true;
      const publication = {
        selected,
        assertAuthority() {
          if (kind === 'synchronous' && !current) throw new Error('SYNTHETIC_AUTHORITY_LOST');
        },
        async assertExternalSelection() {
          if (kind === 'external' && !current) throw new Error('SYNTHETIC_AUTHORITY_LOST');
          await Promise.resolve();
          current = false;
          if (kind === 'synchronous') publication.assertAuthority = () => {};
          else publication.assertExternalSelection = async () => {};
        },
      };
      await expect(store.publishSelected(
        createBusinessAcceptedBuildMetadata(selector, selector.acceptedBuild), publication,
      )).rejects.toThrow('ACCEPTED_BUILD_METADATA_UNAVAILABLE');
      expect(current).toBe(false);
      expect((await store.inspectSlots()).current).toEqual(selected);
      await expect(readFile(`${filePath}.next`)).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(readFile(`${filePath}.backup`)).rejects.toMatchObject({ code: 'ENOENT' });
    },
  );
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
