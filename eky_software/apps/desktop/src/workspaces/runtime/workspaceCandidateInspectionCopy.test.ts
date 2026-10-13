import { promises as fileSystem } from 'node:fs';
import { link, lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { WorkspaceCandidateInspectionCopy } from './workspaceCandidateInspectionCopy.js';
import { profileInspectionDocumentBindingsFileName, profileInspectionMaximumCatalogBytes } from '../../runtime/profileInspectionDocumentBindings.js';

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) await rm(root, { force: true, recursive: true });
});

async function fixture(kind?: 'coldRestoreContent') {
  const parent = await mkdtemp(join(tmpdir(), 'eky-owned-inspection-'));
  roots.push(parent);
  const root = join(parent, 'inspection');
  const copy = new WorkspaceCandidateInspectionCopy(root, kind);
  const signal = new AbortController();
  await copy.prepare(signal.signal);
  const assertMainOwned = vi.fn(async () => {});
  return { parent, root, copy, signal, assertMainOwned };
}

describe('workspace candidate main-owned inspection copy', () => {
  it('requires an empty copy for original absence and retains even normally allowed files', async () => {
    const f = await fixture('coldRestoreContent');
    await writeFile(join(f.root, 'profile.sqlite'), 'contradictory database');
    await writeFile(join(f.root, profileInspectionDocumentBindingsFileName), 'contradictory bindings');
    await expect(f.copy.discardAfterExit(f.assertMainOwned, f.signal.signal, true)).rejects.toThrow();
    expect(await readFile(join(f.root, 'profile.sqlite'), 'utf8')).toBe('contradictory database');
    expect(await readFile(join(f.root, profileInspectionDocumentBindingsFileName), 'utf8')).toBe('contradictory bindings');
  });

  it('discards a proven empty original-absence copy without enabling the nonempty branch', async () => {
    const f = await fixture('coldRestoreContent');
    await f.copy.discardAfterExit(f.assertMainOwned, f.signal.signal, true);
    await expect(lstat(f.root)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('retains allowed content arriving after the first original-absence empty check', async () => {
    const f = await fixture('coldRestoreContent');
    f.assertMainOwned.mockImplementationOnce(async () => { await writeFile(join(f.root, 'profile.sqlite'), 'retain'); });
    await expect(f.copy.discardAfterExit(f.assertMainOwned, f.signal.signal, true)).rejects.toThrow();
    expect(await readFile(join(f.root, 'profile.sqlite'), 'utf8')).toBe('retain');
  });

  it('allows only the cold caller to discard its fixed document binding leaf', async () => {
    const cold = await fixture('coldRestoreContent');
    await writeFile(join(cold.root, 'profile.sqlite'), 'copy');
    await writeFile(join(cold.root, profileInspectionDocumentBindingsFileName), 'owned ephemeral output');
    await cold.copy.discardAfterExit(cold.assertMainOwned, cold.signal.signal);
    await expect(lstat(cold.root)).rejects.toMatchObject({ code: 'ENOENT' });
    const portable = await fixture();
    await writeFile(join(portable.root, 'profile.sqlite'), 'copy');
    await writeFile(join(portable.root, profileInspectionDocumentBindingsFileName), 'not portable output');
    await expect(portable.copy.discardAfterExit(portable.assertMainOwned, portable.signal.signal)).rejects.toThrow();
    expect(await readFile(join(portable.root, 'profile.sqlite'), 'utf8')).toBe('copy');
  });

  it('retains an oversized cold binding output', async () => {
    const f = await fixture('coldRestoreContent');
    await writeFile(join(f.root, 'profile.sqlite'), 'copy');
    const handle = await fileSystem.open(join(f.root, profileInspectionDocumentBindingsFileName), 'wx');
    try { await handle.truncate(profileInspectionMaximumCatalogBytes + 1); } finally { await handle.close(); }
    await expect(f.copy.discardAfterExit(f.assertMainOwned, f.signal.signal)).rejects.toThrow();
    expect(await readdir(f.root)).toEqual([profileInspectionDocumentBindingsFileName, 'profile.sqlite']);
  });
  it('discards its unused empty directory only through fresh main ownership', async () => {
    const f = await fixture();
    await f.copy.discardAfterExit(f.assertMainOwned, f.signal.signal);
    await expect(lstat(f.root)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(f.assertMainOwned).toHaveBeenCalledTimes(2);
  });

  it('does not weaken the candidate terminal that requires a database copy', async () => {
    const f = await fixture();
    await expect(f.copy.discard(f.assertMainOwned, f.signal.signal)).rejects.toThrow();
    expect(await readdir(f.root)).toEqual([]);
  });

  it('retains an unused root when an entry arrives during the ownership check', async () => {
    const f = await fixture();
    f.assertMainOwned.mockImplementationOnce(async () => { await writeFile(join(f.root, 'foreign'), 'retain'); });
    await expect(f.copy.discardAfterExit(f.assertMainOwned, f.signal.signal)).rejects.toThrow();
    expect(await readFile(join(f.root, 'foreign'), 'utf8')).toBe('retain');
  });

  it('does not remove an empty root which it did not exclusively create', async () => {
    const f = await fixture();
    const other = new WorkspaceCandidateInspectionCopy(f.root);
    await expect(other.prepare(f.signal.signal)).rejects.toMatchObject({ code: 'EEXIST' });
    await expect(other.discardAfterExit(f.assertMainOwned, f.signal.signal)).rejects.toThrow();
    expect(await readdir(f.root)).toEqual([]);
  });

  it('does not schedule rmdir after cancellation during the final empty-directory read', async () => {
    const f = await fixture();
    let release!: (names: never[]) => void;
    let entered!: () => void;
    const reading = new Promise<void>(resolve => { entered = resolve; });
    const pending = new Promise<never[]>(resolve => { release = resolve; });
    vi.spyOn(fileSystem, 'readdir').mockResolvedValueOnce([]).mockResolvedValueOnce([])
      .mockImplementationOnce(() => { entered(); return pending; });
    const removeDirectory = vi.spyOn(fileSystem, 'rmdir');
    const discarded = f.copy.discardAfterExit(f.assertMainOwned, f.signal.signal);
    const rejected = expect(discarded).rejects.toThrow();
    await reading;
    f.signal.abort();
    release([]);
    await rejected;
    expect(removeDirectory).not.toHaveBeenCalled();
    expect((await lstat(f.root)).isDirectory()).toBe(true);
  });

  it('applies the same strict nonempty WAL-copy allowlist after exit', async () => {
    const f = await fixture();
    await writeFile(join(f.root, 'profile.sqlite'), 'copy');
    await writeFile(join(f.root, 'profile.sqlite-wal'), 'unresolved');
    await expect(f.copy.discardAfterExit(f.assertMainOwned, f.signal.signal)).rejects.toThrow();
    expect(await readFile(join(f.root, 'profile.sqlite-wal'), 'utf8')).toBe('unresolved');
  });

  it('removes only its locally owned closed WAL-copy directory', async () => {
    const f = await fixture();
    await writeFile(join(f.parent, 'original.sqlite'), 'source');
    await writeFile(join(f.root, 'profile.sqlite'), 'copy');
    await writeFile(join(f.root, 'profile.sqlite-wal'), '');
    await writeFile(join(f.root, 'profile.sqlite-shm'), 'shared memory');
    await f.copy.discard(f.assertMainOwned, f.signal.signal);
    await expect(lstat(f.root)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(join(f.parent, 'original.sqlite'), 'utf8')).toBe('source');
    expect(f.assertMainOwned).toHaveBeenCalledTimes(2);
  });

  it.each(['foreign.txt', 'profile.sqlite-journal', 'subdirectory'])(
    'retains the entire copy when an unknown entry %s exists', async name => {
      const f = await fixture();
      await writeFile(join(f.root, 'profile.sqlite'), 'copy');
      if (name === 'subdirectory') await mkdir(join(f.root, name));
      else await writeFile(join(f.root, name), 'unknown');
      const before = await readdir(f.root);
      await expect(f.copy.discard(f.assertMainOwned, f.signal.signal)).rejects.toThrow();
      expect(await readdir(f.root)).toEqual(before);
      expect(await readFile(join(f.root, 'profile.sqlite'), 'utf8')).toBe('copy');
    },
  );

  it('retains nonempty WAL bytes', async () => {
    const f = await fixture();
    await writeFile(join(f.root, 'profile.sqlite-wal'), 'unresolved');
    await expect(f.copy.discard(f.assertMainOwned, f.signal.signal)).rejects.toThrow();
    expect(await readFile(join(f.root, 'profile.sqlite-wal'), 'utf8')).toBe('unresolved');
  });

  it('retains a replaced root instead of treating its path as ownership', async () => {
    const f = await fixture();
    await rename(f.root, f.root + '-retained');
    await mkdir(f.root, { mode: 0o700 });
    await writeFile(join(f.root, 'profile.sqlite'), 'foreign');
    await expect(f.copy.discard(f.assertMainOwned, f.signal.signal)).rejects.toThrow();
    expect(await readFile(join(f.root, 'profile.sqlite'), 'utf8')).toBe('foreign');
    expect((await lstat(f.root + '-retained')).isDirectory()).toBe(true);
  });

  it('retains linked contents', async () => {
    const f = await fixture();
    const path = join(f.root, 'profile.sqlite');
    await writeFile(path, 'shared');
    await link(path, join(f.parent, 'alias.sqlite'));
    await expect(f.copy.discard(f.assertMainOwned, f.signal.signal)).rejects.toThrow();
    expect(await readFile(path, 'utf8')).toBe('shared');
  });

  it('does not delete after losing main ownership at the final assertion', async () => {
    const f = await fixture();
    await writeFile(join(f.root, 'profile.sqlite'), 'copy');
    f.assertMainOwned.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('lost'));
    await expect(f.copy.discard(f.assertMainOwned, f.signal.signal)).rejects.toThrow('lost');
    expect(await readFile(join(f.root, 'profile.sqlite'), 'utf8')).toBe('copy');
  });

  it('retains the entire copy when a foreign entry arrives during the final authority check', async () => {
    const f = await fixture();
    await writeFile(join(f.root, 'profile.sqlite'), 'copy');
    f.assertMainOwned.mockResolvedValueOnce(undefined).mockImplementationOnce(async () => {
      await writeFile(join(f.root, 'foreign.txt'), 'retain');
    });
    await expect(f.copy.discard(f.assertMainOwned, f.signal.signal)).rejects.toThrow();
    expect(await readFile(join(f.root, 'profile.sqlite'), 'utf8')).toBe('copy');
    expect(await readFile(join(f.root, 'foreign.txt'), 'utf8')).toBe('retain');
  });

  it('does not delete after cancellation during a pending final ownership assertion', async () => {
    const f = await fixture();
    await writeFile(join(f.root, 'profile.sqlite'), 'copy');
    let release!: () => void;
    let entered!: () => void;
    const assertionEntered = new Promise<void>(resolve => { entered = resolve; });
    f.assertMainOwned.mockResolvedValueOnce(undefined).mockImplementationOnce(() => {
      entered();
      return new Promise<void>(resolve => { release = resolve; });
    });
    const discard = f.copy.discard(f.assertMainOwned, f.signal.signal);
    const rejected = expect(discard).rejects.toThrow();
    await assertionEntered;
    f.signal.abort();
    release();
    await rejected;
    expect(await readFile(join(f.root, 'profile.sqlite'), 'utf8')).toBe('copy');
  });

  it('does not adopt an exclusive-create collision', async () => {
    const f = await fixture();
    const other = new WorkspaceCandidateInspectionCopy(f.root);
    await expect(other.prepare(f.signal.signal)).rejects.toMatchObject({ code: 'EEXIST' });
    await expect(other.discard(f.assertMainOwned, f.signal.signal)).rejects.toThrow();
    expect((await lstat(f.root)).isDirectory()).toBe(true);
  });

  it('does not schedule further deletion when an in-flight unlink exceeds the cleanup budget', async () => {
    const f = await fixture();
    await writeFile(join(f.root, 'profile.sqlite'), 'copy');
    await writeFile(join(f.root, 'profile.sqlite-shm'), 'shared memory');
    const names = await readdir(f.root);
    const originalUnlink = fileSystem.unlink;
    let release!: () => void;
    let entered!: () => void;
    const unlinkEntered = new Promise<void>(resolve => { entered = resolve; });
    const unlinks = vi.spyOn(fileSystem, 'unlink').mockImplementationOnce(async path => {
      await originalUnlink(path);
      entered();
      await new Promise<void>(resolve => { release = resolve; });
    });
    const removeDirectory = vi.spyOn(fileSystem, 'rmdir');
    const discard = f.copy.discard(f.assertMainOwned, f.signal.signal);
    const rejected = expect(discard).rejects.toThrow();
    await unlinkEntered;
    f.signal.abort();
    release();
    await rejected;
    expect(unlinks).toHaveBeenCalledOnce();
    expect(removeDirectory).not.toHaveBeenCalled();
    expect(await readdir(f.root)).toHaveLength(names.length - 1);
  });
});
