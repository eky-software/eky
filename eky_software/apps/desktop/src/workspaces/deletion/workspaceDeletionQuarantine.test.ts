import { chmod, link, mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi, type TestContext } from 'vitest';
import { deletionTestId, deletionTestJournal, deletionTestRecord } from './workspaceDeletionDataTestSupport.js';
import { captureDeletionInventoryPayloadRecord, type WorkspaceDeletionInventoryPayloadRecord } from './workspaceDeletionInventoryCodec.js';
import { deriveWorkspaceDeletionPayloadPaths } from './workspaceDeletionPayloadPaths.js';
import { quarantineWorkspaceDeletionPayload, workspaceDeletionQuarantineFileSystem as nodeFileSystem,
  type WorkspaceDeletionQuarantineFileSystem } from './workspaceDeletionQuarantine.js';

async function fixture(test: TestContext, role: WorkspaceDeletionInventoryPayloadRecord['role'] = 'workspace') {
  const root = await mkdtemp(join(tmpdir(), 'eky-delete-move-'));
  await chmod(root, 0o700);
  test.onTestFinished(async () => {
    if (test.task.result?.state === 'pass') await rm(root, { recursive: true, force: true });
  });
  const journal = deletionTestJournal();
  const draft = { ...deletionTestRecord(), role,
    ownerOperationId: role === 'workspace' || role === 'legacyEntry' ? null : deletionTestId(31),
    generationId: role === 'inspection' ? deletionTestId(32) : null,
    member: role === 'legacyEntry' ? 'secrets' : null,
    bindingSha256: role === 'workspace' ? null : deletionTestRecord().bindingSha256 };
  const paths = deriveWorkspaceDeletionPayloadPaths(root, journal.target, draft);
  for (const candidate of paths) {
    for (const parent of candidate.ancestors) { await mkdir(parent, { recursive: true, mode: 0o700 }); await chmod(parent, 0o700); }
  }
  const selected = paths[0]!;
  if (role === 'legacyEntry') await writeFile(selected.sourcePath, 'synthetic-secret-bytes', { mode: 0o600 });
  else {
    await mkdir(selected.sourcePath, { mode: 0o700 });
    await writeFile(join(selected.sourcePath, 'original.txt'), 'synthetic-company-bytes', { mode: 0o600 });
  }
  const other = join(root, 'untouched.txt');
  await writeFile(other, 'other-company-and-external-backup', { mode: 0o600 });
  const record = captureDeletionInventoryPayloadRecord({ ...draft,
    rootIdentity: (await nodeFileSystem.entry(selected.sourcePath, selected.legacyEntry, () => {}))!.identity,
    parentIdentity: await nodeFileSystem.ancestor(selected.parentPath, selected.legacyEntry, () => {}) });
  let current = true;
  const authority = {
    assertAuthority() { if (!current) throw new Error('SYNTHETIC_AUTHORITY_LOST'); },
    assertSelected: vi.fn(async () => { authority.assertAuthority(); }),
  };
  const fileSystem = { ...nodeFileSystem, move: vi.fn(nodeFileSystem.move), syncParent: vi.fn(nodeFileSystem.syncParent) };
  return { root, paths, selected, other, record, journal, authority, fileSystem,
    lose() { current = false; },
    run(fs: WorkspaceDeletionQuarantineFileSystem = fileSystem) {
      return quarantineWorkspaceDeletionPayload(root, journal, record, authority, fs);
    },
    sourceBytes: () => readFile(role === 'legacyEntry' ? selected.sourcePath : join(selected.sourcePath, 'original.txt'), 'utf8'),
    movedBytes: () => readFile(role === 'legacyEntry' ? selected.quarantinePath : join(selected.quarantinePath, 'original.txt'), 'utf8'),
  };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

describe('deletion quarantine row boundary', () => {
  it.for(['workspace', 'legacyEntry', 'replacementImport', 'activationStaging', 'activationRollback',
    'activationFailed', 'importCandidate', 'adoptionCandidate', 'inspection'] as const)(
    'moves only the selected %s and resumes without another rename', async (role, test) => {
    const f = await fixture(test, role);
    const before = await f.sourceBytes();
    await expect(f.run()).resolves.toBe('moved');
    await expect(f.movedBytes()).resolves.toBe(before);
    await expect(f.sourceBytes()).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(f.run()).resolves.toBe('alreadyMoved');
    expect(f.fileSystem.move).toHaveBeenCalledTimes(1);
    expect(f.fileSystem.syncParent).toHaveBeenCalledTimes(2);
    await expect(readFile(f.other, 'utf8')).resolves.toBe('other-company-and-external-backup');
  });

  it('does not fall back to copying or retrying a failed cross-device rename', async test => {
    const f = await fixture(test);
    const failure = Object.assign(new Error('SYNTHETIC_CROSS_DEVICE'), { code: 'EXDEV' });
    f.fileSystem.move.mockRejectedValueOnce(failure);
    await expect(f.run()).rejects.toBe(failure);
    expect(f.fileSystem.move).toHaveBeenCalledTimes(1);
    expect(f.fileSystem.syncParent).not.toHaveBeenCalled();
    await expect(f.sourceBytes()).resolves.toBe('synthetic-company-bytes');
    await expect(f.movedBytes()).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('does not advance on a lost rename acknowledgement; a new invocation verifies and syncs the moved root', async test => {
    const f = await fixture(test);
    const failure = new Error('SYNTHETIC_RENAME_ACK_LOST');
    f.fileSystem.move.mockImplementationOnce(async (...args) => { await nodeFileSystem.move(...args); throw failure; });
    await expect(f.run()).rejects.toBe(failure);
    expect(f.fileSystem.syncParent).not.toHaveBeenCalled();
    await expect(f.run()).resolves.toBe('alreadyMoved');
    expect(f.fileSystem.move).toHaveBeenCalledTimes(1);
    expect(f.fileSystem.syncParent).toHaveBeenCalledTimes(1);
    await expect(f.movedBytes()).resolves.toBe('synthetic-company-bytes');
  });

  it.for([false, true])('retains the root if parent sync fails (already moved: %s)', async (resumed, test) => {
    const f = await fixture(test);
    if (resumed) await rename(f.selected.sourcePath, f.selected.quarantinePath);
    const failure = new Error('SYNTHETIC_PARENT_SYNC_FAILED');
    f.fileSystem.syncParent.mockRejectedValueOnce(failure);
    await expect(f.run()).rejects.toBe(failure);
    await expect(f.movedBytes()).resolves.toBe('synthetic-company-bytes');
    await expect(f.run()).resolves.toBe('alreadyMoved');
  });

  it.for(['move', 'sync'] as const)('waits for pending %s after authority is revoked', async (stage, test) => {
    const f = await fixture(test);
    const entered = deferred(), release = deferred();
    if (stage === 'move') f.fileSystem.move.mockImplementationOnce(async (...args) => {
      entered.resolve(); await release.promise; await nodeFileSystem.move(...args);
    });
    else f.fileSystem.syncParent.mockImplementationOnce(async () => { entered.resolve(); await release.promise; });
    let settled = false;
    const result = f.run().then(() => { settled = true; return undefined; }, error => { settled = true; return error; });
    try {
      await Promise.race([entered.promise, result.then(() => { throw new Error('SYNTHETIC_OPERATION_NOT_PENDING'); })]);
      f.lose();
      await Promise.resolve();
      expect(settled).toBe(false);
    } finally { release.resolve(); await result; }
    expect(await result).toMatchObject({ message: 'SYNTHETIC_AUTHORITY_LOST' });
    expect(f.fileSystem.move).toHaveBeenCalledTimes(1);
    await expect(f.movedBytes()).resolves.toBe('synthetic-company-bytes');
  });

  it('stops before moving if the final authority selection rejects', async test => {
    const f = await fixture(test);
    f.authority.assertSelected.mockImplementationOnce(async () => {}).mockRejectedValueOnce(new Error('SYNTHETIC_JOURNAL_CHANGED'));
    await expect(f.run()).rejects.toThrow('SYNTHETIC_JOURNAL_CHANGED');
    expect(f.fileSystem.move).not.toHaveBeenCalled();
    await expect(f.sourceBytes()).resolves.toBe('synthetic-company-bytes');
  });

  it('rejects revocation during the last filesystem read before mutation', async test => {
    const f = await fixture(test);
    let calls = 0;
    const ancestor = vi.fn(async (...args: Parameters<typeof nodeFileSystem.ancestor>) => {
      const result = await nodeFileSystem.ancestor(...args);
      if (++calls === f.selected.ancestors.length * 4) f.lose();
      return result;
    });
    await expect(f.run({ ...f.fileSystem, ancestor })).rejects.toThrow('SYNTHETIC_AUTHORITY_LOST');
    expect(f.fileSystem.move).not.toHaveBeenCalled();
    await expect(f.sourceBytes()).resolves.toBe('synthetic-company-bytes');
  });

  it.for(['beforeMove', 'beforeSync', 'beforeReturn'] as const)(
    'rechecks journal selection after the final ancestor read %s even while the lease remains valid', async (boundary, test) => {
      const f = await fixture(test);
      let selected = true;
      let calls = 0;
      const observation = { beforeMove: 2, beforeSync: 3, beforeReturn: 4 }[boundary];
      const failure = new Error('SYNTHETIC_JOURNAL_SELECTION_LOST');
      f.authority.assertSelected.mockImplementation(async () => { if (!selected) throw failure; });
      const ancestor = async (...args: Parameters<typeof nodeFileSystem.ancestor>) => {
        const identity = await nodeFileSystem.ancestor(...args);
        if (++calls === f.selected.ancestors.length * 2 * observation) selected = false;
        return identity;
      };
      await expect(f.run({ ...f.fileSystem, ancestor })).rejects.toBe(failure);
      expect(() => f.authority.assertAuthority()).not.toThrow();
      expect(selected).toBe(false);
      expect(f.fileSystem.move).toHaveBeenCalledTimes(boundary === 'beforeMove' ? 0 : 1);
      expect(f.fileSystem.syncParent).toHaveBeenCalledTimes(boundary === 'beforeReturn' ? 1 : 0);
      await expect(boundary === 'beforeMove' ? f.sourceBytes() : f.movedBytes()).resolves.toBe('synthetic-company-bytes');
    },
  );

  it.for(['both', 'neither', 'wrongRoot', 'wrongDestination', 'wrongParent'] as const)(
    'rejects %s without changing the selected or unrelated bytes', async (state, test) => {
    const f = await fixture(test);
    if (state === 'both') await mkdir(f.selected.quarantinePath, { mode: 0o700 });
    if (state === 'neither' || state === 'wrongRoot' || state === 'wrongDestination') {
      await rename(f.selected.sourcePath, join(f.selected.parentPath, 'preserved-original'));
      if (state === 'wrongRoot') await mkdir(f.selected.sourcePath, { mode: 0o700 });
      if (state === 'wrongDestination') await mkdir(f.selected.quarantinePath, { mode: 0o700 });
    }
    if (state === 'wrongParent') {
      const originalParent = `${f.selected.parentPath}-original`;
      await rename(f.selected.parentPath, originalParent);
      await mkdir(f.selected.parentPath, { mode: 0o700 });
      await rename(join(originalParent, f.journal.target.workspaceId), f.selected.sourcePath);
    }
    await expect(f.run()).rejects.toThrow('WORKSPACE_DELETE_JOURNAL_CONFLICT');
    expect(f.fileSystem.move).not.toHaveBeenCalled();
    await expect(readFile(f.other, 'utf8')).resolves.toBe('other-company-and-external-backup');
  });

  it('rejects an ancestor swap during entry inspection before mutation', async test => {
    const f = await fixture(test);
    let swapped = false;
    const entry = async (...args: Parameters<typeof nodeFileSystem.entry>) => {
      const value = await nodeFileSystem.entry(...args);
      if (!swapped && args[0] === f.selected.quarantinePath) {
        swapped = true;
        const old = `${f.selected.parentPath}-original`;
        await rename(f.selected.parentPath, old);
        await mkdir(f.selected.parentPath, { mode: 0o700 });
        await rename(join(old, f.journal.target.workspaceId), f.selected.sourcePath);
      }
      return value;
    };
    await expect(f.run({ ...f.fileSystem, entry })).rejects.toThrow('WORKSPACE_DELETE_JOURNAL_CONFLICT');
    expect(f.fileSystem.move).not.toHaveBeenCalled();
    await expect(f.sourceBytes()).resolves.toBe('synthetic-company-bytes');
  });

  it('does not accept an inspection copy or quarantine in both allowed parents', async test => {
    const f = await fixture(test, 'inspection');
    await mkdir(f.paths[1]!.quarantinePath, { mode: 0o700 });
    await expect(f.run()).rejects.toThrow('WORKSPACE_DELETE_JOURNAL_CONFLICT');
    expect(f.fileSystem.move).not.toHaveBeenCalled();
    await expect(f.sourceBytes()).resolves.toBe('synthetic-company-bytes');
  });

  it('does not mistake an unreadable alternate location for absence', async test => {
    const f = await fixture(test, 'inspection');
    const failure = Object.assign(new Error('SYNTHETIC_READ_DENIED'), { code: 'EACCES' });
    const entry = (...args: Parameters<typeof nodeFileSystem.entry>) => args[0] === f.paths[1]!.quarantinePath
      ? Promise.reject(failure) : nodeFileSystem.entry(...args);
    await expect(f.run({ ...f.fileSystem, entry })).rejects.toBe(failure);
    expect(f.fileSystem.move).not.toHaveBeenCalled();
  });

  it.for(['quarantined', 'purgeAuthorized', 'purged', 'registryPublished'] as const)('cannot start a new move in %s', async (phase, test) => {
    const f = await fixture(test);
    await expect(quarantineWorkspaceDeletionPayload(f.root, { ...f.journal, phase }, f.record, f.authority, f.fileSystem))
      .rejects.toThrow('WORKSPACE_DELETE_JOURNAL_CONFLICT');
    expect(f.fileSystem.move).not.toHaveBeenCalled();
    expect(f.authority.assertSelected).not.toHaveBeenCalled();
  });

  it('rejects inspection evidence at the physical boundary before any filesystem access', async test => {
    const f = await fixture(test, 'inspection');
    await expect(quarantineWorkspaceDeletionPayload(f.root, f.journal, { ...f.record, role: 'inspectionEvidence' }, f.authority, f.fileSystem))
      .rejects.toThrow('WORKSPACE_DELETE_INVENTORY_INVALID');
    expect(f.authority.assertSelected).not.toHaveBeenCalled();
    expect(f.fileSystem.move).not.toHaveBeenCalled();
  });

  it('refuses hardlinked legacy content', async test => {
    const f = await fixture(test, 'legacyEntry');
    await link(f.selected.sourcePath, join(f.root, 'external-hardlink'));
    await expect(f.run()).rejects.toThrow();
    expect(f.fileSystem.move).not.toHaveBeenCalled();
    await expect(f.sourceBytes()).resolves.toBe('synthetic-secret-bytes');
  });

  it('does not follow a linked payload root', async test => {
    const f = await fixture(test);
    const saved = join(f.selected.parentPath, 'preserved-original');
    await rename(f.selected.sourcePath, saved);
    await symlink(saved, f.selected.sourcePath, process.platform === 'win32' ? 'junction' : 'dir');
    await expect(f.run()).rejects.toThrow();
    expect(f.fileSystem.move).not.toHaveBeenCalled();
    await expect(readFile(join(saved, 'original.txt'), 'utf8')).resolves.toBe('synthetic-company-bytes');
  });
});
