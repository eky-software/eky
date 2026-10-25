import { existsSync, readFileSync, renameSync, utimesSync, writeFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createBusinessAcceptedBuildMetadata, createSelectorAcceptedBuildMetadata } from './acceptedBuildMetadata.js';
import { acceptedBuildMetadataFileName, AcceptedBuildMetadataStore } from './acceptedBuildMetadataStore.js';

vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, open: vi.fn(actual.open) };
});

const roots: string[] = [];
const platformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform')!;
const source = {
  acceptedAt: '2026-08-11T18:00:00.000Z', appVersion: '0.2.0', buildRevision: 'aaaaaaa',
  formatVersion: 1 as const, releaseChannel: 'pilot' as const,
};
const target = createSelectorAcceptedBuildMetadata(source, {
  ...source, appVersion: '0.3.0', buildRevision: 'bbbbbbb',
});
const emptySlots = { current: undefined, next: undefined, backup: undefined };
const content = (value: unknown) => Buffer.from(`${JSON.stringify(value)}\n`, 'utf8');

afterEach(async ({ task }) => {
  Object.defineProperty(process, 'platform', platformDescriptor);
  vi.mocked(fs.open).mockReset();
  vi.restoreAllMocks();
  const completedRoots = roots.splice(0);
  if (task.result?.state !== 'pass') return;
  await Promise.all(completedRoots.map(root => rm(root, { recursive: true, force: true })));
});

describe('selected accepted metadata mutations', () => {
  it('copies into an absent location, publishes selector and then business through the same owner', async () => {
    const { store, path } = await fixture(false);
    await store.write(source, { expectedBytes: undefined, assertAuthority() {} });
    expect(await readFile(path)).toEqual(content(source));
    await store.write(target, { expectedBytes: content(source), assertAuthority() {} });
    expect((await store.inspectSlots()).current?.value).toEqual(target);
    const business = createBusinessAcceptedBuildMetadata(target, target.acceptedBuild);
    await store.write(business, { expectedBytes: content(target), assertAuthority() {} });
    expect((await store.inspectSlots()).current?.value).toEqual(business);
    expect((await store.inspectSlots()).backup).toBeUndefined();
    expect((await store.inspectSlots()).next).toBeUndefined();
  });

  it.each(['write', 'clear'] as const)('captures the %s receipt before any asynchronous read', async operation => {
    const { store } = await fixture();
    const receipt = (await store.inspectSlots()).current!.bytes;
    const selection = { expectedBytes: receipt, assertAuthority() {} };
    const pending = operation === 'write' ? store.write(target, selection) : store.clearSelected(selection);
    receipt.fill(0);
    await pending;
    expect((await store.inspectSlots()).current?.value).toEqual(operation === 'write' ? target : undefined);
  });

  it.each(['current', 'next', 'backup'] as const)('preserves an unexpected %s before publication', async slot => {
    const { store, path } = await fixture();
    const foreign = { ...source, acceptedAt: '2026-08-12T18:00:00.000Z' };
    await writeFile(slot === 'current' ? path : `${path}.${slot}`, content(foreign));
    const before = await bytes(path);
    await expect(store.write(target, { expectedBytes: content(source), assertAuthority() {} }))
      .rejects.toThrow('ACCEPTED_BUILD_METADATA_INVALID');
    expect(await bytes(path)).toEqual(before);
  });

  it.each(['write', 'clear'] as const)('rejects semantically equal but byte-different %s selection', async operation => {
    const { store, path } = await fixture();
    const receipt = content(source);
    await writeFile(path, `${JSON.stringify(source, null, 2)}\n`);
    const before = await bytes(path);
    const selection = { expectedBytes: receipt, assertAuthority() {} };
    await expect(operation === 'write' ? store.write(target, selection) : store.clearSelected(selection))
      .rejects.toThrow('ACCEPTED_BUILD_METADATA_INVALID');
    expect(await bytes(path)).toEqual(before);
  });

  it('rejects a v2 downgrade without creating or removing a slot', async () => {
    const { store, path } = await fixture();
    await store.write(target);
    const before = await bytes(path);
    await expect(store.write(source, { expectedBytes: content(target), assertAuthority() {} }))
      .rejects.toThrow('ACCEPTED_BUILD_METADATA_INVALID');
    expect(await bytes(path)).toEqual(before);
  });

  it('does not mistake a missing selected current for an authorized first write', async () => {
    const { store, path } = await fixture(false);
    await expect(store.write(target, { expectedBytes: content(source), assertAuthority() {} }))
      .rejects.toThrow('ACCEPTED_BUILD_METADATA_INVALID');
    expect(existsSync(dirname(path))).toBe(false);
  });

  it('does not mistake an existing current for an authorized first write', async () => {
    const { store, path } = await fixture();
    await expect(store.write(target, { expectedBytes: undefined, assertAuthority() {} }))
      .rejects.toThrow('ACCEPTED_BUILD_METADATA_INVALID');
    expect(await bytes(path)).toEqual({ ...emptySlots, current: content(source) });
  });

  it.each(['write', 'clear'] as const)('preserves files and original cause on early %s authority failure', async operation => {
    const { store, path } = await fixture();
    const cause = new Error('synthetic authority expired');
    const selection = { expectedBytes: content(source), assertAuthority() { throw cause; } };
    await expect(operation === 'write' ? store.write(target, selection) : store.clearSelected(selection))
      .rejects.toMatchObject({ message: 'ACCEPTED_BUILD_METADATA_UNAVAILABLE', cause });
    expect(await bytes(path)).toEqual({ ...emptySlots, current: content(source) });
  });

  it.each(['emptyNext', 'staged', 'sourceMoved', 'published', 'cleaned'] as const)(
    'retains the actual %s interruption state without guessing rollback or success', async phase => {
      const { store, path } = await fixture();
      const cause = new Error(`synthetic ${phase} interruption`);
      const sourceBytes = content(source);
      const targetBytes = content(target);
      let sawNext = false;
      await expect(store.write(target, { expectedBytes: sourceBytes,
        assertAuthority() {
          const current = readOptionalSync(path);
          const next = readOptionalSync(`${path}.next`);
          const backup = readOptionalSync(`${path}.backup`);
          sawNext ||= next !== undefined;
          const reached = phase === 'emptyNext' ? next?.byteLength === 0 :
            phase === 'staged' ? next?.equals(targetBytes) && current?.equals(sourceBytes) :
            phase === 'sourceMoved' ? current === undefined && backup?.equals(sourceBytes) :
            phase === 'published' ? current?.equals(targetBytes) && backup?.equals(sourceBytes) :
            sawNext && current?.equals(targetBytes) && backup === undefined;
          if (reached) throw cause;
        },
      })).rejects.toMatchObject({ message: 'ACCEPTED_BUILD_METADATA_UNAVAILABLE', cause });
      const retained = await bytes(path);
      expect(retained).toEqual(phase === 'emptyNext'
        ? { current: sourceBytes, next: Buffer.alloc(0), backup: undefined }
        : phase === 'staged'
          ? { current: sourceBytes, next: targetBytes, backup: undefined }
          : phase === 'sourceMoved'
            ? { current: undefined, next: targetBytes, backup: sourceBytes }
            : phase === 'published'
              ? { current: targetBytes, next: undefined, backup: sourceBytes }
              : { current: targetBytes, next: undefined, backup: undefined });
      // Inspect is not recovery. Valid interrupted slots are not promoted or deleted.
      const freshStore = new AcceptedBuildMetadataStore(path);
      if (phase === 'emptyNext') await expect(freshStore.inspectSlots()).rejects.toThrow('ACCEPTED_BUILD_METADATA_INVALID');
      else await freshStore.inspectSlots();
      expect(await bytes(path)).toEqual(retained);
    },
  );

  it.each(['next', 'backup'] as const)('does not remove a changed %s during publication', async slot => {
    const { store, path } = await fixture();
    const foreign = content({ ...source, acceptedAt: '2026-08-12T18:00:00.000Z' });
    let changed = false;
    await expect(store.write(target, { expectedBytes: content(source), assertAuthority() {
      const slotPath = `${path}.${slot}`;
      if (!changed && readOptionalSync(slotPath)?.byteLength) {
        changed = true;
        writeFileSync(slotPath, foreign);
      }
    } })).rejects.toThrow('ACCEPTED_BUILD_METADATA_INVALID');
    expect(changed).toBe(true);
    expect(await readFile(`${path}.${slot}`)).toEqual(foreign);
  });

  it('preserves both the first write failure and a later close failure', async () => {
    const { store, path } = await fixture();
    const first = new Error('synthetic write failure');
    const closing = new Error('synthetic close failure');
    const { open } = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    let closed = false;
    vi.mocked(fs.open).mockImplementation(async (...args) => {
      const file = await open(...args);
      if (args[0] === `${path}.next` && args[1] === 'wx') {
        const close = file.close.bind(file);
        vi.spyOn(file, 'writeFile').mockRejectedValueOnce(first);
        vi.spyOn(file, 'close').mockImplementationOnce(async () => {
          await close();
          closed = true;
          throw closing;
        });
      }
      return file;
    });
    await expect(store.write(target, { expectedBytes: content(source), assertAuthority() {} }))
      .rejects.toMatchObject({
        message: 'ACCEPTED_BUILD_METADATA_UNAVAILABLE',
        cause: { cause: first, errors: [first, closing] },
      });
    expect(closed).toBe(true);
    expect(await bytes(path)).toEqual({ current: content(source), next: Buffer.alloc(0), backup: undefined });
  });

  it.each(['write', 'clear'] as const)('preserves directory sync and close failures after selected %s', async operation => {
    const { store, path } = await fixture();
    const syncing = new Error('synthetic directory sync failure');
    const closing = new Error('synthetic directory close failure');
    const { open } = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    let modeled = false;
    const sync = vi.fn(async () => { throw syncing; });
    const close = vi.fn(async () => {
      Object.defineProperty(process, 'platform', platformDescriptor);
      throw closing;
    });
    vi.mocked(fs.open).mockImplementation(async (...args) => args[0] === dirname(path) && args[1] === 'r'
      ? { sync, close } as unknown as fs.FileHandle : open(...args));
    const selection = { expectedBytes: content(source), assertAuthority() {
      const current = readOptionalSync(path);
      if (!modeled && (operation === 'write' ? current?.equals(content(target)) : current === undefined)) {
        // Model only the non-Windows directory-sync branch. File operations remain real.
        modeled = true;
        Object.defineProperty(process, 'platform', { ...platformDescriptor, value: 'linux' });
      }
    } };
    await expect(operation === 'write' ? store.write(target, selection) : store.clearSelected(selection))
      .rejects.toMatchObject({
        message: 'ACCEPTED_BUILD_METADATA_UNAVAILABLE',
        cause: { cause: syncing, errors: [syncing, closing] },
      });
    expect(sync).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
    expect(await bytes(path)).toEqual(operation === 'clear' ? emptySlots
      : { current: content(target), next: undefined, backup: content(source) });
  });

  it('retains the store lock until a delayed owned close settles', async () => {
    const { store, path } = await fixture();
    const closing = new Error('synthetic delayed close failure');
    const { open } = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    let release = () => {};
    let started = () => {};
    const released = new Promise<void>(resolve => { release = resolve; });
    const closeStarted = new Promise<void>(resolve => { started = resolve; });
    vi.mocked(fs.open).mockImplementation(async (...args) => {
      const file = await open(...args);
      if (args[0] === `${path}.next` && args[1] === 'wx') {
        const close = file.close.bind(file);
        vi.spyOn(file, 'close').mockImplementationOnce(async () => {
          started();
          await released;
          await close();
          throw closing;
        });
      }
      return file;
    });
    const completion = expect(store.write(target, { expectedBytes: content(source), assertAuthority() {} }))
      .rejects.toMatchObject({ message: 'ACCEPTED_BUILD_METADATA_UNAVAILABLE', cause: closing });
    try {
      await closeStarted;
      await expect(store.clear()).rejects.toThrow('ACCEPTED_BUILD_METADATA_UNAVAILABLE');
      expect(await bytes(path)).toEqual({ current: content(source), next: content(target), backup: undefined });
    } finally {
      release();
      await completion;
    }
    expect((await store.inspectSlots()).current?.value).toEqual(source);
  });

  it.each(['replacement', 'timestamp'] as const)('rejects a current identity %s after reading the selected bytes', async change => {
    const { store, path } = await fixture();
    let checks = 0;
    await expect(store.clearSelected({ expectedBytes: content(source), assertAuthority() {
      if (++checks !== 5) return;
      if (change === 'replacement') {
        renameSync(path, `${path}.retained`);
        writeFileSync(path, content(source));
      } else utimesSync(path, new Date('2000-01-01'), new Date('2000-01-01'));
    } })).rejects.toThrow('ACCEPTED_BUILD_METADATA_INVALID');
    expect(await readFile(path)).toEqual(content(source));
    if (change === 'replacement') expect(await readFile(`${path}.retained`)).toEqual(content(source));
  });

  it.each(['current', 'next', 'backup'] as const)('retains changed %s on clear', async slot => {
    const { store, path } = await fixture();
    await writeFile(slot === 'current' ? path : `${path}.${slot}`, content(target));
    const before = await bytes(path);
    await expect(store.clearSelected({ expectedBytes: content(source), assertAuthority() {} }))
      .rejects.toThrow('ACCEPTED_BUILD_METADATA_INVALID');
    expect(await bytes(path)).toEqual(before);
  });

  it('does not claim completion when authority is lost after unlink', async () => {
    const { store, path } = await fixture();
    const cause = new Error('synthetic lost clear acknowledgement');
    await expect(store.clearSelected({ expectedBytes: content(source), assertAuthority() {
      if (!existsSync(path)) throw cause;
    } })).rejects.toMatchObject({ message: 'ACCEPTED_BUILD_METADATA_UNAVAILABLE', cause });
    expect(await store.inspectSlots()).toEqual(emptySlots);
  });

  it('retains a newly observed current during clear readback', async () => {
    const { store, path } = await fixture();
    await expect(store.clearSelected({ expectedBytes: content(source), assertAuthority() {
      if (!existsSync(path)) writeFileSync(path, content(target));
    } })).rejects.toThrow('ACCEPTED_BUILD_METADATA_INVALID');
    expect(await readFile(path)).toEqual(content(target));
  });

  it.each(['async', 'reentrant'] as const)('rejects %s authority without ignoring its promise', async mode => {
    const { store, path } = await fixture();
    const assertAuthority = mode === 'async' ? async () => undefined : () => store.read();
    await expect(store.write(target, { expectedBytes: content(source), assertAuthority }))
      .rejects.toThrow('ACCEPTED_BUILD_METADATA_INVALID');
    expect(await bytes(path)).toEqual({ ...emptySlots, current: content(source) });
  });

  it.each(['read', 'write', 'clear', 'inspectSlots'] as const)('excludes a competing same-store %s throughout publication', async operation => {
    const { store } = await fixture();
    let competing: Promise<unknown> | undefined;
    await store.write(target, { expectedBytes: content(source), assertAuthority() {
      if (competing !== undefined) return;
      const pending = operation === 'write' ? store.write(source) : store[operation]();
      competing = expect(pending).rejects.toThrow('ACCEPTED_BUILD_METADATA_UNAVAILABLE');
    } });
    expect(competing).toBeDefined();
    await competing;
    expect((await store.inspectSlots()).current?.value).toEqual(target);
  });

  it.each([undefined, Buffer.alloc(0), Buffer.alloc(4097)])('rejects an invalid clear receipt without deleting current', async expectedBytes => {
    const { store, path } = await fixture();
    await expect(store.clearSelected({ expectedBytes, assertAuthority() {} }))
      .rejects.toThrow('ACCEPTED_BUILD_METADATA_INVALID');
    expect(await readFile(path)).toEqual(content(source));
  });
});

async function fixture(withCurrent = true) {
  const root = await mkdtemp(join(tmpdir(), 'eky-accepted-selection-'));
  roots.push(root);
  const path = join(root, 'runtime', acceptedBuildMetadataFileName);
  const store = new AcceptedBuildMetadataStore(path);
  if (withCurrent) {
    await mkdir(dirname(path), { mode: 0o700 });
    await writeFile(path, content(source), { mode: 0o600 });
  }
  return { root, path, store };
}

async function bytes(path: string) {
  return { current: readOptionalSync(path), next: readOptionalSync(`${path}.next`), backup: readOptionalSync(`${path}.backup`) };
}

function readOptionalSync(path: string): Buffer | undefined {
  try { return readFileSync(path); }
  catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined;
    throw error;
  }
}
