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

  it.each(['empty', 'database'] as const)('proves only its own removed %s copy without mutating files', async kind => {
    const f = await fixture();
    await f.copy.prepare(f.cancellation.signal);
    if (kind === 'database') await writeFile(join(f.root, 'profile.sqlite'), 'owned synthetic bytes');
    await f.copy.discardAfterExit(f.authority.assertMainOwned, f.cancellation.signal);
    const removeFile = vi.spyOn(fileSystem, 'unlink');
    const removeDirectory = vi.spyOn(fileSystem, 'rmdir');
    await f.copy.assertRemovedCreationCurrent(f.authority);
    await f.copy.assertRemovedCreationCurrent(f.authority);
    expect(() => f.copy.captureCreationIdentity()).toThrow();
    expect(removeFile).not.toHaveBeenCalled();
    expect(removeDirectory).not.toHaveBeenCalled();
    expect(await readdir(f.parent)).toEqual([]);
  });

  it('does not turn an externally absent copy or a fresh instance into own removal evidence', async () => {
    const f = await fixture();
    await f.copy.prepare(f.cancellation.signal);
    await rm(f.root, { recursive: true });
    await expect(f.copy.assertRemovedCreationCurrent(f.authority)).rejects.toThrow();
    await expect(new WorkspaceCandidateInspectionCopy(f.root).assertRemovedCreationCurrent(f.authority)).rejects.toThrow();
    expect(f.authority.assertMainOwned).not.toHaveBeenCalled();
  });

  it('does not issue removal evidence when its own rmdir acknowledgement failed', async () => {
    const f = await fixture();
    await f.copy.prepare(f.cancellation.signal);
    const remove = fileSystem.rmdir.bind(fileSystem);
    vi.spyOn(fileSystem, 'rmdir').mockImplementationOnce(async path => {
      await remove(path);
      throw new Error('synthetic lost rmdir acknowledgement');
    });
    await expect(f.copy.discardAfterExit(f.authority.assertMainOwned, f.cancellation.signal)).rejects.toThrow();
    await expect(f.copy.assertRemovedCreationCurrent(f.authority)).rejects.toThrow();
    expect(await readdir(f.parent)).toEqual([]);
  });

  it.each(['file', 'directory'] as const)('rejects a %s replacing the removed root and preserves it', async kind => {
    const f = await fixture();
    await f.copy.prepare(f.cancellation.signal);
    await f.copy.discardAfterExit(f.authority.assertMainOwned, f.cancellation.signal);
    if (kind === 'file') await writeFile(f.root, 'foreign replacement');
    else { await mkdir(f.root, { mode: 0o700 }); await writeFile(join(f.root, 'foreign.txt'), 'foreign replacement'); }
    await expect(f.copy.assertRemovedCreationCurrent(f.authority)).rejects.toThrow();
    expect(await readFile(kind === 'file' ? f.root : join(f.root, 'foreign.txt'), 'utf8')).toBe('foreign replacement');
  });

  it('rejects a replaced parent even when the removed copy is still absent', async () => {
    const f = await fixture();
    await f.copy.prepare(f.cancellation.signal);
    await f.copy.discardAfterExit(f.authority.assertMainOwned, f.cancellation.signal);
    const original = f.parent + '-original';
    roots.push(original);
    await rename(f.parent, original);
    await mkdir(f.parent, { mode: 0o700 });
    await writeFile(join(f.parent, 'foreign.txt'), 'preserved parent');
    await expect(f.copy.assertRemovedCreationCurrent(f.authority)).rejects.toThrow();
    expect(await readFile(join(f.parent, 'foreign.txt'), 'utf8')).toBe('preserved parent');
    expect(await readdir(original)).toEqual([]);
  });

  it('rejects a root recreated during the final parent check of removal proof', async () => {
    const f = await fixture();
    await f.copy.prepare(f.cancellation.signal);
    await f.copy.discardAfterExit(f.authority.assertMainOwned, f.cancellation.signal);
    const canonical = fileSystem.realpath.bind(fileSystem);
    let parentReads = 0;
    vi.spyOn(fileSystem, 'realpath').mockImplementation(async path => {
      const value = await canonical(path);
      if (path === f.parent && ++parentReads === 3) {
        await mkdir(f.root, { mode: 0o700 });
        await writeFile(join(f.root, 'foreign.txt'), 'retained during final parent read');
      }
      return value;
    });
    await expect(f.copy.assertRemovedCreationCurrent(f.authority)).rejects.toThrow();
    expect(await readFile(join(f.root, 'foreign.txt'), 'utf8')).toBe('retained during final parent read');
  });

  it.each(['EACCES', 'EIO'])('does not treat a copy path read failure %s as absence', async code => {
    const f = await fixture();
    await f.copy.prepare(f.cancellation.signal);
    await f.copy.discardAfterExit(f.authority.assertMainOwned, f.cancellation.signal);
    const parent = await fileSystem.lstat(f.parent, { bigint: true });
    const failure = Object.assign(new Error('synthetic unreadable copy'), { code });
    vi.spyOn(fileSystem, 'lstat').mockResolvedValueOnce(parent).mockResolvedValueOnce(parent).mockRejectedValueOnce(failure);
    await expect(f.copy.assertRemovedCreationCurrent(f.authority)).rejects.toBe(failure);
  });

  it.each(['cancelled', 'authorityLost'] as const)('rejects %s after a pending absence probe without another read', async mode => {
    const f = await fixture();
    await f.copy.prepare(f.cancellation.signal);
    await f.copy.discardAfterExit(f.authority.assertMainOwned, f.cancellation.signal);
    const parent = await fileSystem.lstat(f.parent, { bigint: true });
    let enter!: () => void;
    let release!: () => void;
    const entered = new Promise<void>(resolve => { enter = resolve; });
    const pending = new Promise<never>((_resolve, reject) => {
      release = () => reject(Object.assign(new Error('synthetic absent copy'), { code: 'ENOENT' }));
    });
    const stat = vi.spyOn(fileSystem, 'lstat').mockResolvedValueOnce(parent).mockResolvedValueOnce(parent)
      .mockImplementationOnce(() => { enter(); return pending; });
    const check = f.copy.assertRemovedCreationCurrent(f.authority);
    const rejected = expect(check).rejects.toThrow();
    try {
      await entered;
      if (mode === 'cancelled') f.cancellation.abort();
      else f.authority.assertCurrent.mockImplementation(() => { throw new Error('lost'); });
    } finally { release(); await rejected; }
    expect(stat).toHaveBeenCalledTimes(3);
  });

  it('rejects a parent replaced during the canonical-path read and preserves both directories', async () => {
    const f = await fixture();
    await f.copy.prepare(f.cancellation.signal);
    await f.copy.discardAfterExit(f.authority.assertMainOwned, f.cancellation.signal);
    const original = f.parent + '-original';
    roots.push(original);
    const canonical = fileSystem.realpath.bind(fileSystem);
    vi.spyOn(fileSystem, 'realpath').mockImplementationOnce(async path => {
      const value = await canonical(path);
      await rename(f.parent, original);
      await mkdir(f.parent, { mode: 0o700 });
      await writeFile(join(f.parent, 'foreign.txt'), 'preserved replacement parent');
      return value;
    });
    await expect(f.copy.assertRemovedCreationCurrent(f.authority)).rejects.toThrow();
    expect(await readFile(join(f.parent, 'foreign.txt'), 'utf8')).toBe('preserved replacement parent');
    expect(await readdir(original)).toEqual([]);
  });

  it('joins an in-flight removal-proof read before rejecting cancellation', async () => {
    const f = await fixture();
    await f.copy.prepare(f.cancellation.signal);
    await f.copy.discardAfterExit(f.authority.assertMainOwned, f.cancellation.signal);
    let release!: () => void;
    let enter!: () => void;
    const entered = new Promise<void>(resolve => { enter = resolve; });
    const finish = new Promise<void>(resolve => { release = resolve; });
    const canonical = fileSystem.realpath.bind(fileSystem);
    vi.spyOn(fileSystem, 'realpath').mockImplementationOnce(async path => {
      const value = await canonical(path);
      enter();
      await finish;
      return value;
    });
    let settled = false;
    const check = f.copy.assertRemovedCreationCurrent(f.authority).finally(() => { settled = true; });
    const rejected = expect(check).rejects.toThrow();
    try { await entered; f.cancellation.abort(); expect(settled).toBe(false); }
    finally { release(); await rejected; }
    expect(await readdir(f.parent)).toEqual([]);
  });

  it.each(['cancelled', 'authorityLost', 'reservationLost'] as const)(
    'performs no filesystem read after removal-proof ownership becomes %s', async mode => {
      const f = await fixture();
      await f.copy.prepare(f.cancellation.signal);
      await f.copy.discardAfterExit(f.authority.assertMainOwned, f.cancellation.signal);
      const stat = vi.spyOn(fileSystem, 'lstat');
      f.authority.assertMainOwned.mockImplementationOnce(async () => {
        if (mode === 'cancelled') f.cancellation.abort();
        else if (mode === 'authorityLost') f.authority.assertCurrent.mockImplementation(() => { throw new Error('lost'); });
        else throw new Error('lost');
      });
      await expect(f.copy.assertRemovedCreationCurrent(f.authority)).rejects.toThrow();
      expect(stat).not.toHaveBeenCalled();
    },
  );
});
