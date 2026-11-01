import { chmod, link, mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi, type TestContext } from 'vitest';
import { deletionTestId, deletionTestJournal, deletionTestRecord } from './workspaceDeletionDataTestSupport.js';
import { captureDeletionInventoryPayloadRecord, type WorkspaceDeletionInventoryPayloadRecord } from './workspaceDeletionInventoryCodec.js';
import { deriveWorkspaceDeletionPayloadPaths } from './workspaceDeletionPayloadPaths.js';
import { purgeWorkspaceDeletionPayload, workspaceDeletionPurgeFileSystem as native,
  type WorkspaceDeletionPurgeFileSystem } from './workspaceDeletionPurge.js';

async function fixture(test: TestContext, role: WorkspaceDeletionInventoryPayloadRecord['role'] = 'workspace', secondParent = false) {
  const root = await mkdtemp(join(tmpdir(), 'eky-delete-purge-'));
  await chmod(root, 0o700);
  test.onTestFinished(async () => {
    if (test.task.result?.state === 'pass') await rm(root, { recursive: true, force: true });
  });
  const journal = { ...deletionTestJournal(), phase: 'purgeAuthorized' as const };
  const draft = { ...deletionTestRecord(), role,
    ownerOperationId: role === 'workspace' || role === 'legacyEntry' ? null : deletionTestId(31),
    generationId: role === 'inspection' ? deletionTestId(32) : null,
    member: role === 'legacyEntry' ? 'secrets' : null,
    bindingSha256: role === 'workspace' ? null : deletionTestRecord().bindingSha256 };
  const paths = deriveWorkspaceDeletionPayloadPaths(root, journal.target, draft);
  for (const candidate of paths) for (const parent of candidate.ancestors) {
    await mkdir(parent, { recursive: true, mode: 0o700 }); await chmod(parent, 0o700);
  }
  const selected = paths[secondParent ? 1 : 0]!;
  if (role === 'legacyEntry') await writeFile(selected.quarantinePath, 'synthetic-secret', { mode: 0o600 });
  else {
    await mkdir(selected.quarantinePath, { mode: 0o700 });
    await writeFile(join(selected.quarantinePath, 'a.db'), 'synthetic-corrupt-db', { mode: 0o600 });
    await mkdir(join(selected.quarantinePath, 'z-secrets'), { mode: 0o700 });
    for (const slot of ['current', 'backup', 'next']) {
      await writeFile(join(selected.quarantinePath, 'z-secrets', slot), `synthetic-${slot}`, { mode: 0o600 });
    }
  }
  const other = join(root, 'other-company-and-external-backup');
  await writeFile(other, 'preserve-unrelated-bytes', { mode: 0o600 });
  const record = captureDeletionInventoryPayloadRecord({ ...draft,
    rootIdentity: (await native.entry(selected.quarantinePath, selected.legacyEntry, () => {}))!.identity,
    parentIdentity: await native.ancestor(selected.parentPath, selected.legacyEntry, () => {}) });
  let current = true;
  const authority = {
    assertAuthority() { if (!current) throw new Error('SYNTHETIC_AUTHORITY_LOST'); },
    assertSelected: vi.fn(async () => { authority.assertAuthority(); }),
  };
  const fs = { ...native, unlink: vi.fn(native.unlink), rmdir: vi.fn(native.rmdir), syncParent: vi.fn(native.syncParent) };
  return { root, journal, paths, selected, record, other, authority, fs,
    lose() { current = false; },
    renew() { current = true; },
    run(fileSystem: WorkspaceDeletionPurgeFileSystem = fs) {
      return purgeWorkspaceDeletionPayload(root, journal, record, authority, fileSystem);
    },
    bytes: () => readFile(role === 'legacyEntry' ? selected.quarantinePath : join(selected.quarantinePath, 'a.db'), 'utf8'),
  };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

describe('pre-authorized deletion purge', () => {
  it.for(['workspace', 'legacyEntry', 'replacementImport', 'activationStaging', 'activationRollback',
    'activationFailed', 'importCandidate', 'adoptionCandidate', 'inspection'] as const)(
    'purges only %s and safely resumes its authorized absence', async (role, test) => {
      const f = await fixture(test, role);
      await expect(f.run()).resolves.toBe('purged');
      await expect(native.entry(f.selected.quarantinePath, f.selected.legacyEntry, () => {})).resolves.toBeNull();
      const calls = f.fs.unlink.mock.calls.length + f.fs.rmdir.mock.calls.length;
      await expect(f.run()).resolves.toBe('alreadyAbsent');
      expect(f.fs.unlink.mock.calls.length + f.fs.rmdir.mock.calls.length).toBe(calls);
      expect(f.fs.syncParent).toHaveBeenCalledTimes(2);
      expect(await native.ancestor(f.selected.parentPath, f.selected.legacyEntry, () => {})).toBe(f.record.parentIdentity);
      await expect(readFile(f.other, 'utf8')).resolves.toBe('preserve-unrelated-bytes');
    },
  );

  it('selects the second inspection parent even after the authorized root is absent', async test => {
    const f = await fixture(test, 'inspection', true);
    await expect(f.run()).resolves.toBe('purged');
    await expect(f.run()).resolves.toBe('alreadyAbsent');
    expect(f.fs.syncParent.mock.calls.every(call => call[0] === f.selected.parentPath)).toBe(true);
  });

  it.for(['authorized', 'quarantined', 'purged', 'registryPublished'] as const)(
    'rejects journal phase %s before touching files', async (phase, test) => {
      const f = await fixture(test);
      await expect(purgeWorkspaceDeletionPayload(f.root, { ...f.journal, phase }, f.record, f.authority, f.fs)).rejects.toThrow();
      expect(f.authority.assertSelected).not.toHaveBeenCalled();
      expect(f.fs.unlink).not.toHaveBeenCalled();
      await expect(f.bytes()).resolves.toBe('synthetic-corrupt-db');
    },
  );

  it('does not grant a separate purge for an inspection evidence row', async test => {
    const f = await fixture(test, 'inspection');
    await expect(purgeWorkspaceDeletionPayload(f.root, f.journal, { ...f.record, role: 'inspectionEvidence' }, f.authority, f.fs))
      .rejects.toThrow('WORKSPACE_DELETE_INVENTORY_INVALID');
    expect(f.authority.assertSelected).not.toHaveBeenCalled();
    expect(f.fs.unlink).not.toHaveBeenCalled();
  });

  it.for(['sourceOnly', 'both', 'wrongRoot', 'wrongParent', 'missingParent'] as const)(
    'rejects %s without removing bytes', async (state, test) => {
      const f = await fixture(test);
      if (state === 'sourceOnly') await rename(f.selected.quarantinePath, f.selected.sourcePath);
      if (state === 'both') await mkdir(f.selected.sourcePath, { mode: 0o700 });
      if (state === 'wrongRoot') {
        await rename(f.selected.quarantinePath, `${f.selected.quarantinePath}-original`);
        await mkdir(f.selected.quarantinePath, { mode: 0o700 });
      }
      if (state === 'wrongParent' || state === 'missingParent') {
        await rename(f.selected.parentPath, `${f.selected.parentPath}-original`);
        if (state === 'wrongParent') {
          await mkdir(f.selected.parentPath, { mode: 0o700 });
          await rename(join(`${f.selected.parentPath}-original`, f.selected.quarantinePath.slice(f.selected.parentPath.length + 1)),
            f.selected.quarantinePath);
        }
      }
      await expect(f.run()).rejects.toThrow('WORKSPACE_DELETE_JOURNAL_CONFLICT');
      expect(f.fs.unlink).not.toHaveBeenCalled();
      expect(f.fs.rmdir).not.toHaveBeenCalled();
      await expect(readFile(f.other, 'utf8')).resolves.toBe('preserve-unrelated-bytes');
    },
  );

  it.for(['hardlink', 'junction'] as const)('preflights the whole root and rejects a late %s before deleting earlier files', async (kind, test) => {
    const f = await fixture(test);
    const path = join(f.selected.quarantinePath, 'zz-unsafe');
    if (kind === 'hardlink') await link(f.other, path);
    else await symlink(f.root, path, process.platform === 'win32' ? 'junction' : 'dir');
    await expect(f.run()).rejects.toThrow();
    expect(f.fs.unlink).not.toHaveBeenCalled();
    expect(f.fs.rmdir).not.toHaveBeenCalled();
    await expect(f.bytes()).resolves.toBe('synthetic-corrupt-db');
    await expect(readFile(f.other, 'utf8')).resolves.toBe('preserve-unrelated-bytes');
  });

  it('preserves a partial purge after lost acknowledgement and resumes only remaining contents', async test => {
    const f = await fixture(test);
    const failure = new Error('SYNTHETIC_UNLINK_ACK_LOST');
    f.fs.unlink.mockImplementationOnce(async path => { await native.unlink(path); throw failure; });
    await expect(f.run()).rejects.toBe(failure);
    expect(f.fs.unlink).toHaveBeenCalledTimes(1);
    expect(f.fs.rmdir).not.toHaveBeenCalled();
    expect(f.fs.syncParent).not.toHaveBeenCalled();
    await expect(readFile(join(f.selected.quarantinePath, 'z-secrets', 'current'), 'utf8')).resolves.toBe('synthetic-current');
    await expect(f.run()).resolves.toBe('purged');
    expect(f.fs.unlink).toHaveBeenCalledTimes(4);
    await expect(readFile(f.other, 'utf8')).resolves.toBe('preserve-unrelated-bytes');
  });

  it('does not retry a failed unlink and retains all remaining files', async test => {
    const f = await fixture(test);
    const failure = Object.assign(new Error('SYNTHETIC_FILE_BUSY'), { code: 'EBUSY' });
    f.fs.unlink.mockRejectedValueOnce(failure);
    await expect(f.run()).rejects.toBe(failure);
    expect(f.fs.unlink).toHaveBeenCalledTimes(1);
    expect(f.fs.rmdir).not.toHaveBeenCalled();
    await expect(f.bytes()).resolves.toBe('synthetic-corrupt-db');
  });

  it('does not recursively erase a file arriving after directory enumeration', async test => {
    const f = await fixture(test);
    f.fs.rmdir.mockImplementation(async path => {
      if (path === f.selected.quarantinePath) await writeFile(join(path, 'late.txt'), 'late-preserved-bytes');
      await native.rmdir(path);
    });
    await expect(f.run()).rejects.toMatchObject({ code: 'ENOTEMPTY' });
    await expect(readFile(join(f.selected.quarantinePath, 'late.txt'), 'utf8')).resolves.toBe('late-preserved-bytes');
    expect(f.fs.syncParent).not.toHaveBeenCalled();
  });

  it.for(['unlink', 'rmdir', 'syncParent'] as const)('joins an active %s before reporting authority loss', async (stage, test) => {
    const f = await fixture(test);
    const entered = deferred(), release = deferred();
    const hold = async (work: () => Promise<void>) => { entered.resolve(); await release.promise; await work(); };
    if (stage === 'unlink') f.fs.unlink.mockImplementationOnce(path => hold(() => native.unlink(path)));
    else if (stage === 'rmdir') f.fs.rmdir.mockImplementationOnce(path => hold(() => native.rmdir(path)));
    else f.fs.syncParent.mockImplementationOnce((...args) => hold(() => native.syncParent(...args)));
    let settled = false;
    const result = f.run().then(() => { settled = true; return undefined; }, error => { settled = true; return error; });
    try {
      await Promise.race([entered.promise, result.then(() => { throw new Error('SYNTHETIC_OPERATION_NOT_PENDING'); })]);
      f.lose();
      await Promise.resolve();
      expect(settled).toBe(false);
    } finally { release.resolve(); await result; }
    expect(await result).toMatchObject({ message: 'SYNTHETIC_AUTHORITY_LOST' });
    f.renew();
    await expect(f.run()).resolves.toBe(stage === 'syncParent' ? 'alreadyAbsent' : 'purged');
  });

  it('requires sync again when the root was removed but parent sync failed', async test => {
    const f = await fixture(test);
    const failure = new Error('SYNTHETIC_SYNC_FAILED');
    f.fs.syncParent.mockRejectedValueOnce(failure);
    await expect(f.run()).rejects.toBe(failure);
    const count = f.fs.unlink.mock.calls.length;
    await expect(f.run()).resolves.toBe('alreadyAbsent');
    expect(f.fs.unlink).toHaveBeenCalledTimes(count);
    expect(f.fs.syncParent).toHaveBeenCalledTimes(2);
  });

  it.for(['nestedParent', 'sharedParent', 'sourceReappears', 'journalSelection'] as const)(
    'rejects %s changed during the final entry read with the lease still valid', async (change, test) => {
      const f = await fixture(test);
      await native.unlink(join(f.selected.quarantinePath, 'a.db'));
      let calls = 0, armed = false, changed = false, selected = true;
      f.authority.assertSelected.mockImplementation(async () => {
        if (!selected) throw new Error('SYNTHETIC_SELECTION_LOST');
        if (++calls === 4) armed = true;
      });
      const child = join(f.selected.quarantinePath, 'z-secrets', 'backup');
      const readEntry: typeof native.readEntry = async (...args) => {
        const result = await native.readEntry(...args);
        if (armed && !changed && args[0] === child) {
          changed = true;
          if (change === 'nestedParent') {
            const parent = join(f.selected.quarantinePath, 'z-secrets');
            const saved = join(f.root, 'preserved-secrets');
            await rename(parent, saved);
            await mkdir(parent, { mode: 0o700 });
            await rename(join(saved, 'backup'), child);
          } else if (change === 'sharedParent') {
            const saved = `${f.selected.parentPath}-original`;
            await rename(f.selected.parentPath, saved);
            await mkdir(f.selected.parentPath, { mode: 0o700 });
            await rename(join(saved, f.selected.quarantinePath.slice(f.selected.parentPath.length + 1)), f.selected.quarantinePath);
          } else if (change === 'sourceReappears') await mkdir(f.selected.sourcePath, { mode: 0o700 });
          else selected = false;
        }
        return result;
      };
      await expect(f.run({ ...f.fs, readEntry })).rejects.toThrow(
        change === 'journalSelection' ? 'SYNTHETIC_SELECTION_LOST' : 'WORKSPACE_DELETE_JOURNAL_CONFLICT');
      expect(changed).toBe(true);
      expect(() => f.authority.assertAuthority()).not.toThrow();
      expect(f.fs.unlink).not.toHaveBeenCalled();
      expect(f.fs.rmdir).not.toHaveBeenCalled();
      await expect(readFile(child, 'utf8')).resolves.toBe('synthetic-backup');
      await expect(readFile(f.other, 'utf8')).resolves.toBe('preserve-unrelated-bytes');
    },
  );

  it.for(['fileChanged', 'fileDisappeared'] as const)('rejects %s after the leaf was selected', async (change, test) => {
    const f = await fixture(test);
    let calls = 0, armed = false, changed = false;
    f.authority.assertSelected.mockImplementation(async () => { if (++calls === 4) armed = true; });
    const path = join(f.selected.quarantinePath, 'a.db');
    const readEntry: typeof native.readEntry = async (...args) => {
      if (armed && !changed && args[0] === path) {
        changed = true;
        if (change === 'fileChanged') await writeFile(path, 'different-synthetic-content');
        else await rename(path, join(f.root, 'preserved.db'));
      }
      return native.readEntry(...args);
    };
    await expect(f.run({ ...f.fs, readEntry })).rejects.toThrow('WORKSPACE_DELETE_JOURNAL_CONFLICT');
    expect(changed).toBe(true);
    expect(f.fs.unlink).not.toHaveBeenCalled();
    expect(f.fs.rmdir).not.toHaveBeenCalled();
    await expect(readFile(join(f.selected.quarantinePath, 'z-secrets', 'current'), 'utf8')).resolves.toBe('synthetic-current');
  });

  it.for(['open', 'read', 'close'] as const)('joins directory %s and closes its handle after revocation', async (stage, test) => {
    const f = await fixture(test);
    const entered = deferred(), release = deferred();
    let closes = 0;
    const fs: WorkspaceDeletionPurgeFileSystem = { ...f.fs, directoryReads: { ...native.directoryReads,
      async openDirectory(path) {
        const directory = await native.directoryReads.openDirectory(path);
        if (stage === 'open') { entered.resolve(); await release.promise; }
        return {
          async read() {
            if (stage === 'read') { entered.resolve(); await release.promise; }
            return directory.read();
          },
          async close() {
            closes++;
            if (stage === 'close') { entered.resolve(); await release.promise; }
            await directory.close();
          },
        };
      },
    } };
    let settled = false;
    const result = f.run(fs).then(() => { settled = true; return undefined; }, error => { settled = true; return error; });
    try {
      await Promise.race([entered.promise, result.then(() => { throw new Error('SYNTHETIC_READ_NOT_PENDING'); })]);
      f.lose();
      await Promise.resolve();
      expect(settled).toBe(false);
    } finally { release.resolve(); await result; }
    expect(await result).toMatchObject({ message: 'SYNTHETIC_AUTHORITY_LOST' });
    expect(closes).toBe(1);
    expect(f.fs.unlink).not.toHaveBeenCalled();
    expect(f.fs.rmdir).not.toHaveBeenCalled();
    await expect(f.bytes()).resolves.toBe('synthetic-corrupt-db');
  });

  it('preserves the original read error before a secondary directory-close error', async test => {
    const f = await fixture(test);
    const first = new Error('SYNTHETIC_READ_FAILED'), second = new Error('SYNTHETIC_CLOSE_FAILED');
    let closes = 0;
    const fs: WorkspaceDeletionPurgeFileSystem = { ...f.fs, directoryReads: { ...native.directoryReads,
      async openDirectory(path) {
        const directory = await native.directoryReads.openDirectory(path);
        return { async read() { throw first; }, async close() { closes++; await directory.close(); throw second; } };
      },
    } };
    await expect(f.run(fs)).rejects.toMatchObject({ errors: [first, second] });
    expect(closes).toBe(1);
    expect(f.fs.unlink).not.toHaveBeenCalled();
    expect(f.fs.rmdir).not.toHaveBeenCalled();
    await expect(f.bytes()).resolves.toBe('synthetic-corrupt-db');
  });
});
