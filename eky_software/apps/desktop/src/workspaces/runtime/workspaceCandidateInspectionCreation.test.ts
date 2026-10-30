import { promises as fileSystem } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { readWorkspaceProcessReservationIdentity } from '../../runtime/workspaceProcessReservation.js';
import { WorkspaceCandidateInspectionCopy } from './workspaceCandidateInspectionCopy.js';

const roots: string[] = [];
afterEach(async context => {
  vi.restoreAllMocks();
  const owned = roots.splice(0);
  if (context.task.result?.state === 'pass') await Promise.all(owned.map(root => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const parent = await mkdtemp(join(tmpdir(), 'eky-inspection-creation-'));
  roots.push(parent);
  const root = join(parent, 'copy');
  const copy = new WorkspaceCandidateInspectionCopy(root);
  const cancellation = new AbortController();
  const authority = { signal: cancellation.signal, assertCurrent: vi.fn(), assertMainOwned: vi.fn(async () => {}) };
  return { parent, root, copy, cancellation, authority };
}

describe('inspection copy original creation identity', () => {
  it('exposes only a frozen identity captured by the successfully creating owner', async () => {
    const f = await fixture();
    expect(() => f.copy.captureCreationIdentity()).toThrow();
    await f.copy.prepare(f.cancellation.signal);
    const identity = f.copy.captureCreationIdentity();
    expect(identity).toEqual({ rootIdentity: await readWorkspaceProcessReservationIdentity(f.root),
      parentIdentity: await readWorkspaceProcessReservationIdentity(f.parent) });
    expect(Object.isFrozen(identity)).toBe(true);
    expect(Reflect.ownKeys(identity)).toEqual(['rootIdentity', 'parentIdentity']);
    expect(Reflect.set(identity, 'rootIdentity', 'f'.repeat(64))).toBe(false);
    expect(f.copy.captureCreationIdentity()).toBe(identity);
    await f.copy.assertEmptyCreationCurrent(f.authority);
    expect(f.authority.assertMainOwned).toHaveBeenCalledTimes(2);
    expect(await readdir(f.root)).toEqual([]);
  });

  it('never creates a receipt for a colliding owner or grants its cleanup', async () => {
    const f = await fixture();
    await f.copy.prepare(f.cancellation.signal);
    const other = new WorkspaceCandidateInspectionCopy(f.root);
    await expect(other.prepare(f.cancellation.signal)).rejects.toMatchObject({ code: 'EEXIST' });
    expect(() => other.captureCreationIdentity()).toThrow();
    await expect(other.assertEmptyCreationCurrent(f.authority)).rejects.toThrow();
    await expect(other.discardAfterExit(f.authority.assertMainOwned, f.cancellation.signal)).rejects.toThrow();
    expect(await readdir(f.root)).toEqual([]);
  });

  it('retains the original receipt and rejects an empty replacement at the same path', async () => {
    const f = await fixture();
    await f.copy.prepare(f.cancellation.signal);
    const original = f.copy.captureCreationIdentity();
    await rename(f.root, f.root + '-original');
    await mkdir(f.root, { mode: 0o700 });
    expect(f.copy.captureCreationIdentity()).toBe(original);
    expect(await readWorkspaceProcessReservationIdentity(f.root)).not.toBe(original.rootIdentity);
    await expect(f.copy.assertEmptyCreationCurrent(f.authority)).rejects.toThrow();
    expect(await readdir(f.parent)).toEqual(['copy', 'copy-original']);
  });

  it('rejects a changed parent without adopting its new empty copy', async () => {
    const f = await fixture();
    await f.copy.prepare(f.cancellation.signal);
    const original = f.copy.captureCreationIdentity();
    const retained = f.parent + '-original';
    roots.push(retained);
    await rename(f.parent, retained);
    await mkdir(f.parent, { mode: 0o700 });
    await mkdir(f.root, { mode: 0o700 });
    expect(f.copy.captureCreationIdentity()).toBe(original);
    await expect(f.copy.assertEmptyCreationCurrent(f.authority)).rejects.toThrow();
    expect(await readdir(retained)).toEqual(['copy']);
    expect(await readdir(f.parent)).toEqual(['copy']);
  });

  it('retains payload appearing during the final main ownership check', async () => {
    const f = await fixture();
    await f.copy.prepare(f.cancellation.signal);
    f.authority.assertMainOwned.mockResolvedValueOnce(undefined).mockImplementationOnce(async () => {
      await writeFile(join(f.root, 'profile.sqlite'), 'not yet authorized payload');
    });
    await expect(f.copy.assertEmptyCreationCurrent(f.authority)).rejects.toThrow();
    expect(await readFile(join(f.root, 'profile.sqlite'), 'utf8')).toBe('not yet authorized payload');
  });

  it('rejects a replacement arriving while the final empty-directory read settles', async () => {
    const f = await fixture();
    await f.copy.prepare(f.cancellation.signal);
    vi.spyOn(fileSystem, 'readdir').mockResolvedValueOnce([]).mockImplementationOnce(async () => {
      await rename(f.root, f.root + '-original');
      await mkdir(f.root, { mode: 0o700 });
      await writeFile(join(f.root, 'foreign.txt'), 'retained foreign payload');
      return [];
    });
    await expect(f.copy.assertEmptyCreationCurrent(f.authority)).rejects.toThrow();
    expect(await readFile(join(f.root, 'foreign.txt'), 'utf8')).toBe('retained foreign payload');
    expect(await readdir(f.root + '-original')).toEqual([]);
  });

  it('rejects a root replaced during the final canonical-path read', async () => {
    const f = await fixture();
    await f.copy.prepare(f.cancellation.signal);
    const canonical = fileSystem.realpath.bind(fileSystem);
    let rootReads = 0;
    vi.spyOn(fileSystem, 'realpath').mockImplementation(async path => {
      const value = await canonical(path);
      if (path === f.root && ++rootReads === 3) {
        await rename(f.root, f.root + '-original');
        await mkdir(f.root, { mode: 0o700 });
        await writeFile(join(f.root, 'foreign.txt'), 'retained during canonical read');
      }
      return value;
    });
    await expect(f.copy.assertEmptyCreationCurrent(f.authority)).rejects.toThrow();
    expect(rootReads).toBe(3);
    expect(await readFile(join(f.root, 'foreign.txt'), 'utf8')).toBe('retained during canonical read');
    expect(await readdir(f.root + '-original')).toEqual([]);
  });

  it('performs no filesystem read after authority expires during main ownership verification', async () => {
    const f = await fixture();
    await f.copy.prepare(f.cancellation.signal);
    const failure = new Error('synthetic original owner lost');
    const stat = vi.spyOn(fileSystem, 'lstat');
    const names = vi.spyOn(fileSystem, 'readdir');
    f.authority.assertMainOwned.mockImplementationOnce(async () => {
      f.authority.assertCurrent.mockImplementation(() => { throw failure; });
    });
    await expect(f.copy.assertEmptyCreationCurrent(f.authority)).rejects.toBe(failure);
    expect(stat).not.toHaveBeenCalled();
    expect(names).not.toHaveBeenCalled();
  });

  it('joins its pending readonly check and rejects cancellation without changing the copy', async () => {
    const f = await fixture();
    await f.copy.prepare(f.cancellation.signal);
    let release!: (names: never[]) => void;
    let enter!: () => void;
    const entered = new Promise<void>(resolve => { enter = resolve; });
    const pending = new Promise<never[]>(resolve => { release = resolve; });
    vi.spyOn(fileSystem, 'readdir').mockImplementationOnce(() => { enter(); return pending; });
    const check = f.copy.assertEmptyCreationCurrent(f.authority);
    const rejected = expect(check).rejects.toThrow();
    try { await entered; f.cancellation.abort(); }
    finally { release([]); await rejected; }
    expect(await readdir(f.root)).toEqual([]);
  });

  it('retires the receipt after successful own cleanup without changing ordinary deletion rules', async () => {
    const f = await fixture();
    await f.copy.prepare(f.cancellation.signal);
    await f.copy.discardAfterExit(f.authority.assertMainOwned, f.cancellation.signal);
    expect(() => f.copy.captureCreationIdentity()).toThrow();
    await expect(f.copy.assertEmptyCreationCurrent(f.authority)).rejects.toThrow();
    await mkdir(f.root, { mode: 0o700 });
    await writeFile(join(f.root, 'profile.sqlite'), 'foreign next owner');
    await expect(f.copy.discardAfterExit(f.authority.assertMainOwned, f.cancellation.signal)).rejects.toThrow();
    expect(await readFile(join(f.root, 'profile.sqlite'), 'utf8')).toBe('foreign next owner');
  });
});
