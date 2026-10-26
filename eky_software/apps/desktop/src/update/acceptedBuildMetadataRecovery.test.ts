import { lstat, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi, type TestContext } from 'vitest';

import type { CrashSafeByteSlotSelection } from '../workspaces/persistence/crashSafeByteSlotStore.js';
import { createBusinessAcceptedBuildMetadata, createSelectorAcceptedBuildMetadata, type VersionedAcceptedBuildMetadata } from './acceptedBuildMetadata.js';
import { acceptedBuildMetadataFileName, AcceptedBuildMetadataStore } from './acceptedBuildMetadataStore.js';

const source = { formatVersion: 1 as const, releaseChannel: 'pilot' as const,
  appVersion: '0.2.0', buildRevision: 'a'.repeat(40), acceptedAt: '2026-10-26T12:00:00.000Z' };
const selector = createSelectorAcceptedBuildMetadata(source, { ...source, appVersion: '0.3.0', buildRevision: 'b'.repeat(40) });
const business = createBusinessAcceptedBuildMetadata(selector, selector.acceptedBuild);
const encode = (value: unknown) => Buffer.from(`${JSON.stringify(value)}\n`);
const names = ['current', 'next', 'backup'] as const;

async function fixture(context: TestContext,
  values: Partial<Record<typeof names[number], VersionedAcceptedBuildMetadata>> = { current: selector, next: business }) {
  const root = await mkdtemp(join(tmpdir(), 'eky-metadata-recovery-'));
  context.onTestFinished(async ({ task }) => {
    if (task.result?.state === 'pass') await rm(root, { recursive: true, force: true });
  });
  await mkdir(join(root, 'runtime'), { mode: 0o700 });
  const path = join(root, 'runtime', acceptedBuildMetadataFileName);
  const paths = { current: path, next: `${path}.next`, backup: `${path}.backup` };
  for (const name of names) if (values[name] !== undefined) await writeFile(paths[name], encode(values[name]), { mode: 0o600 });
  const store = new AcceptedBuildMetadataStore(path);
  const slots = await store.inspectSlots();
  const selection: CrashSafeByteSlotSelection = {
    expectedSlots: { current: slots.current?.bytes, next: slots.next?.bytes, backup: slots.backup?.bytes },
    expectedIdentities: { current: slots.current?.identity, next: slots.next?.identity, backup: slots.backup?.identity },
    assertAuthority: vi.fn(), assertExternalSelection: vi.fn(async () => {}),
  };
  async function contents() {
    return Promise.all(names.map(name => readFile(paths[name]).catch(error => {
      if (error.code === 'ENOENT') return undefined;
      throw error;
    })));
  }
  return { root, paths, store, slots, selection, contents };
}

it.for([
  { current: selector }, { current: selector, next: business },
  { backup: selector, next: business }, { current: business, backup: selector },
])('recovers admitted metadata publication %# with the tracked selected identity', async (values, context) => {
  const f = await fixture(context, values);
  const repairingRead = vi.spyOn(f.store, 'read');
  const identity = await f.store.recoverSelected(f.selection);
  const actual = await f.store.inspectSlots();
  expect(actual.current?.value).toEqual(values.current ?? selector);
  expect(actual.current?.identity).toEqual(identity);
  expect(identity.ino).toBe((f.slots.current ?? f.slots.backup)!.identity?.ino);
  expect(actual.next).toBeUndefined();
  expect(actual.backup).toBeUndefined();
  expect(repairingRead).not.toHaveBeenCalled();
  expect(f.selection.assertAuthority).toHaveBeenCalled();
  expect(f.selection.assertExternalSelection).toHaveBeenCalled();
});

it.for(['current', 'next', 'backup'] as const)('rejects a same-byte replacement of selected %s', async (slot, context) => {
  const f = await fixture(context, slot === 'backup' ? { backup: selector, next: business } : undefined);
  const bytes = await readFile(f.paths[slot]);
  await rename(f.paths[slot], `${f.paths[slot]}.retained`);
  await writeFile(f.paths[slot], bytes, { mode: 0o600 });
  const before = await f.contents();
  await expect(f.store.recoverSelected(f.selection)).rejects.toThrow();
  expect(await f.contents()).toEqual(before);
  expect(await readFile(`${f.paths[slot]}.retained`)).toEqual(bytes);
});

it.for(['synchronous', 'external', 'late', 'replacedCallback'] as const)(
  'retains original slots when recovery authority fails: %s', async (fault, context) => {
    const f = await fixture(context);
    const before = await f.contents();
    let valid = true;
    f.selection.assertAuthority = () => { if (!valid || fault === 'synchronous') throw new Error('SYNTHETIC_LOSS'); };
    f.selection.assertExternalSelection = async () => {
      if (fault === 'external') throw new Error('SYNTHETIC_LOSS');
      await Promise.resolve();
      valid = false;
      if (fault === 'replacedCallback') f.selection.assertAuthority = () => {};
    };
    await expect(f.store.recoverSelected(f.selection)).rejects.toThrow();
    expect(await f.contents()).toEqual(before);
  },
);

it('rejects a newly appeared slot before any recovery mutation', async context => {
  const f = await fixture(context, { current: selector });
  await writeFile(f.paths.next, encode(business));
  const before = await f.contents();
  await expect(f.store.recoverSelected(f.selection)).rejects.toThrow();
  expect(await f.contents()).toEqual(before);
});

it('does not promote a next-only acceptance under selected recovery', async context => {
  const f = await fixture(context, { next: business });
  const before = await f.contents();
  await expect(f.store.recoverSelected(f.selection)).rejects.toThrow();
  expect(await f.contents()).toEqual(before);
});

it('does not adopt altered caller bytes while an external guard is pending', async context => {
  const f = await fixture(context);
  const before = await f.contents();
  f.selection.assertExternalSelection = async () => {
    await Promise.resolve();
    (f.selection.expectedSlots.current as Uint8Array).fill(0);
  };
  await f.store.recoverSelected(f.selection);
  expect(await readFile(f.paths.current)).toEqual(before[0]);
});

it('retains the recoverable backup if authority expires after next cleanup', async context => {
  const f = await fixture(context, { backup: selector, next: business });
  const before = await f.contents();
  f.selection.assertExternalSelection = async () => {
    try { await readFile(f.paths.next); }
    catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') throw new Error('SYNTHETIC_LOSS');
      throw error;
    }
  };
  await expect(f.store.recoverSelected(f.selection)).rejects.toThrow();
  const retained = await f.contents();
  expect(retained).toEqual([undefined, undefined, before[2]]);
});

it.for(['invalidUtf8', 'duplicateKey', 'tooLarge'] as const)('does not remove malformed %s evidence', async (fault, context) => {
  const f = await fixture(context);
  const invalid = fault === 'invalidUtf8' ? Buffer.from([0xff]) : fault === 'tooLarge' ? Buffer.alloc(4097, 32)
    : Buffer.from(encode(business).toString().replace('"formatVersion":2', '"formatVersion":1,"formatVersion":2'));
  await writeFile(f.paths.next, invalid);
  const identity = await lstat(f.paths.next);
  const before = await f.contents();
  await expect(f.store.recoverSelected({ ...f.selection,
    expectedSlots: { ...f.selection.expectedSlots, next: invalid },
    expectedIdentities: { ...f.selection.expectedIdentities, next: {
      dev: identity.dev, ino: identity.ino, size: identity.size, mtimeMs: identity.mtimeMs, ctimeMs: identity.ctimeMs,
    } },
  })).rejects.toThrow();
  expect(await f.contents()).toEqual(before);
});
