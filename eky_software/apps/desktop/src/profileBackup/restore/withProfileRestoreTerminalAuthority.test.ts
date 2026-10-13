import { randomUUID } from 'node:crypto';
import { promises as fileSystem } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { readWorkspaceProcessReservationIdentity } from '../../runtime/workspaceProcessReservation.js';
import { profileInspectionShutdownMilliseconds, profileInspectionWorkMilliseconds } from '../../runtime/profileInspectionMessages.js';
import { InMemoryWorkspaceMaintenanceLease } from '../../workspaces/maintenance/workspaceMaintenanceLease.js';
import type { ProfileSnapshotInspectionClient } from '../profileSnapshotInspectionClient.js';
import { ProfileRestoreActivationJournalStore, profileRestoreActivationJournalFileName } from './profileRestoreActivationJournalStore.js';
import { ProfileRestoreActivationTransaction, type ProfileRestoreTerminalMutationAuthority } from './profileRestoreActivationTransaction.js';
import { withProfileRestoreTerminalAuthority } from './withProfileRestoreTerminalAuthority.js';
import * as cleanupCensus from './profileRestoreTerminalCleanupCensus.js';

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe('live restore terminal authority', () => {
  it.each([false, true])('binds a C prefix to its exact original chain before cleanup (accepted: %s)', async accepted => {
    const f = await fixture(accepted, true);
    const assertCurrent = vi.fn(async () => {});
    await withProfileRestoreTerminalAuthority({ ...f.input, beforeUpdateRollbackMigrations: {
      expectedMigrationChainIdentity: 'c'.repeat(64), assertCurrent,
    } }, f.use);
    expect(assertCurrent).toHaveBeenCalled();
    expect(await f.journalStore.peek()).toBeUndefined();
    expect(f.snapshotClient.createRestoredProfileSnapshot).toHaveBeenCalledWith(expect.any(String));
    expect(f.snapshotClient.createProfileSnapshot).not.toHaveBeenCalled();
  });

  it.each([false, true])('retains a C journal on a mismatching fresh original chain (accepted: %s)', async accepted => {
    const f = await fixture(accepted, true);
    await expect(withProfileRestoreTerminalAuthority({ ...f.input, beforeUpdateRollbackMigrations: {
      expectedMigrationChainIdentity: 'f'.repeat(64), assertCurrent: async () => {},
    } }, f.use)).rejects.toThrow('PROFILE_RESTORE_RECOVERY_REQUIRED');
    expect(f.use).not.toHaveBeenCalled();
    expect(f.claims).toHaveLength(0);
    expect(await f.journalStore.peek()).toEqual(f.selected);
    expect(f.remove).not.toHaveBeenCalled();
    expect(f.invalidated).toHaveBeenCalledOnce();
  });

  it('rejects C ownership that changes during the awaited inspection', async () => {
    const f = await fixture(false, true);
    let current = true;
    const inspect = f.snapshotClient.validateProfileSnapshot.getMockImplementation()!;
    f.snapshotClient.validateProfileSnapshot.mockImplementation(async id => {
      const value = await inspect(id);
      current = false;
      return value;
    });
    await expect(withProfileRestoreTerminalAuthority({ ...f.input, beforeUpdateRollbackMigrations: {
      expectedMigrationChainIdentity: 'c'.repeat(64), assertCurrent: async () => {
        if (!current) throw new Error('UPDATE_BUSINESS_ROLLBACK_RECOVERY_REQUIRED');
      },
    } }, f.use)).rejects.toThrow('PROFILE_RESTORE_RECOVERY_REQUIRED');
    expect(f.use).not.toHaveBeenCalled();
    expect(await f.journalStore.peek()).toEqual(f.selected);
    expect(f.remove).not.toHaveBeenCalled();
  });

  it.each([false, true])('keeps the live backend and snapshot fence through named cleanup (accepted: %s)', async accepted => {
    const f = await fixture(accepted);
    await withProfileRestoreTerminalAuthority(f.input, f.use);
    expect(await f.journalStore.peek()).toBeUndefined();
    expect(await readFile(f.database, 'utf8')).toBe('new database');
    expect(f.events).toEqual(['begin', 'snapshot', 'inspect', 'snapshotUse', 'claim:rollback', 'claim:staging',
      'finish', 'close:staging', 'close:rollback', 'snapshotRemove', 'end']);
    expect(f.snapshotId()).not.toBe(f.selected.operationId);
    expect(f.lease.readState()).toBe('idle');
    expect(f.stationary).toHaveBeenCalled();
    expect(f.input.assertLineage).toHaveBeenCalledWith(f.profileId);
    expect(f.invalidated).not.toHaveBeenCalled();
  });

  it('does not recreate or claim a root already removed from an accepted operation', async () => {
    const f = await fixture(true);
    await rm(join(f.rollback, f.selected.operationId), { recursive: true });
    await withProfileRestoreTerminalAuthority(f.input, f.use);
    expect(f.claims.map(claim => claim.role)).toEqual(['staging']);
    await expect(readdir(join(f.rollback, f.selected.operationId))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('never enters terminal writes under a competing installation lease', async () => {
    const f = await fixture();
    const owner = await f.lease.acquire('backup');
    try {
      await expect(withProfileRestoreTerminalAuthority(f.input, f.use)).rejects.toThrow('PROFILE_RESTORE_RECOVERY_REQUIRED');
      expect(f.begin).not.toHaveBeenCalled();
      expect(f.use).not.toHaveBeenCalled();
      expect(await f.journalStore.peek()).toEqual(f.selected);
    } finally { await owner.release(); }
  });

  it('revalidates its captured census after a claim rather than adopting changed bytes', async () => {
    const f = await fixture();
    const acquire = f.input.acquireReservation;
    f.input.acquireReservation = async (...args) => {
      const owner = await acquire(...args);
      await writeFile(join(f.rollback, f.selected.operationId, 'data', 'eky.sqlite'), 'changed old evidence');
      return owner;
    };
    await expect(withProfileRestoreTerminalAuthority(f.input, f.use)).rejects.toThrow('PROFILE_RESTORE_RECOVERY_REQUIRED');
    expect(f.use).not.toHaveBeenCalled();
    expect(await f.journalStore.peek()).toEqual(f.selected);
    expect(await readFile(join(f.rollback, f.selected.operationId, 'data', 'eky.sqlite'), 'utf8')).toBe('changed old evidence');
    expect(f.invalidated).toHaveBeenCalledOnce();
    expect(f.end).not.toHaveBeenCalled();
  });

  it('releases only its first settled claim when the second acquisition fails', async () => {
    const f = await fixture();
    const first = new Error('synthetic claim refusal');
    const acquire = f.input.acquireReservation;
    f.input.acquireReservation = async (...args) => {
      if (f.claims.length === 1) throw first;
      return acquire(...args);
    };
    await expect(withProfileRestoreTerminalAuthority(f.input, f.use)).rejects.toMatchObject({ cause: first });
    expect(f.claims).toHaveLength(1);
    expect(f.claims[0]!.close).toHaveBeenCalledOnce();
    expect(f.use).not.toHaveBeenCalled();
    expect(f.remove).not.toHaveBeenCalled();
    expect(f.lease.readState()).toBe('idle');
  });

  it('rejects a stale journal after native claims before granting mutations', async () => {
    const f = await fixture();
    const acquire = f.input.acquireReservation;
    f.input.acquireReservation = async (...args) => {
      const owner = await acquire(...args);
      await f.journalStore.write({ ...f.selected, revision: f.selected.revision + 2 });
      return owner;
    };
    await expect(withProfileRestoreTerminalAuthority(f.input, f.use)).rejects.toThrow('PROFILE_RESTORE_RECOVERY_REQUIRED');
    expect(f.use).not.toHaveBeenCalled();
    expect(f.remove).not.toHaveBeenCalled();
  });

  it('does not grant writes when the fresh receipt belongs to a foreign lineage', async () => {
    const f = await fixture();
    f.input.assertLineage.mockImplementation(() => { throw new Error('synthetic foreign lineage'); });
    await expect(withProfileRestoreTerminalAuthority(f.input, f.use)).rejects.toThrow('PROFILE_RESTORE_RECOVERY_REQUIRED');
    expect(f.claims).toHaveLength(0);
    expect(f.use).not.toHaveBeenCalled();
  });

  it('preserves accepted data and its journal when a deletion grant expires', async () => {
    const f = await fixture();
    f.use.mockImplementation(async authority => {
      const accepted = await f.transaction.commitAcceptance(f.selected, undefined, authority);
      f.fence.mockRejectedValue(new Error('synthetic expired fence'));
      await f.transaction.clearAccepted(accepted, undefined, authority);
    });
    await expect(withProfileRestoreTerminalAuthority(f.input, f.use)).rejects.toThrow('synthetic expired fence');
    expect(await f.journalStore.peek()).toMatchObject({ phase: 'accepted' });
    expect(await readFile(f.database, 'utf8')).toBe('new database');
    expect(f.remove).not.toHaveBeenCalled();
    expect(f.end).not.toHaveBeenCalled();
    expect(f.invalidated).toHaveBeenCalledOnce();
  });

  it('rejects deletion when the live fence is lost during an awaited entry identity check', async () => {
    const f = await fixture();
    const first = new Error('synthetic expired fence during entry check');
    let leafCheckReached = false;
    let acceptedBytes: string | undefined;
    const journalPath = join(f.root, profileRestoreActivationJournalFileName);
    const unlink = vi.spyOn(fileSystem, 'unlink');
    const rmdir = vi.spyOn(fileSystem, 'rmdir');
    f.use.mockImplementation(async authority => {
      const accepted = await f.transaction.commitAcceptance(f.selected, undefined, authority);
      acceptedBytes = await readFile(journalPath, 'utf8');
      let readingCensus = false;
      const checkCensus = f.transaction.assertTerminalCleanupCensus.bind(f.transaction);
      vi.spyOn(f.transaction, 'assertTerminalCleanupCensus').mockImplementation(async (...args) => {
        readingCensus = true;
        try { await checkCensus(...args); }
        finally { readingCensus = false; }
      });
      const checkIdentity = cleanupCensus.assertProfileRestoreCleanupEntryIdentity;
      vi.spyOn(cleanupCensus, 'assertProfileRestoreCleanupEntryIdentity').mockImplementation(async entry => {
        await checkIdentity(entry);
        // Census admission must pass; expire only within a named leaf's deletion path.
        if (!readingCensus && !leafCheckReached) {
          leafCheckReached = true;
          f.fence.mockRejectedValue(first);
        }
      });
      await f.transaction.clearAccepted(accepted, undefined, authority);
    });
    await expect(withProfileRestoreTerminalAuthority(f.input, f.use)).rejects.toBe(first);
    expect(leafCheckReached).toBe(true);
    expect(acceptedBytes).toBeDefined();
    expect(await readFile(journalPath, 'utf8')).toBe(acceptedBytes);
    expect(await f.journalStore.peek()).toMatchObject({ phase: 'accepted' });
    expect(unlink).not.toHaveBeenCalled();
    expect(rmdir).not.toHaveBeenCalled();
    expect(await readFile(f.database, 'utf8')).toBe('new database');
    expect(await readFile(join(f.root, 'storage', 'invoices', 'new.pdf'), 'utf8')).toBe('new pdf');
    expect(await readFile(join(f.rollback, f.selected.operationId, 'data', 'eky.sqlite'), 'utf8')).toBe('old database');
    expect(await readFile(join(f.rollback, f.selected.operationId, 'storage', 'invoices', 'old.pdf'), 'utf8')).toBe('old pdf');
    expect(f.claims).toHaveLength(2);
    for (const claim of f.claims) expect(claim.close).toHaveBeenCalledOnce();
    expect(f.remove).not.toHaveBeenCalled();
    expect(f.end).not.toHaveBeenCalled();
    expect(f.invalidated).toHaveBeenCalledOnce();
    expect(f.lease.readState()).toBe('idle');
  });

  it('keeps the first failure before claim-close and fence-invalidation failures', async () => {
    const f = await fixture();
    const first = new Error('synthetic terminal failure');
    const close = new Error('synthetic close failure');
    const invalidate = new Error('synthetic fence failure');
    f.use.mockImplementation(async () => {
      f.claims[1]!.close.mockRejectedValue(close);
      throw first;
    });
    f.invalidated.mockRejectedValue(invalidate);
    await expect(withProfileRestoreTerminalAuthority(f.input, f.use)).rejects.toMatchObject({
      cause: { errors: [first, close, invalidate] },
    });
    expect(f.claims.every(claim => claim.close.mock.calls.length === 1)).toBe(true);
    expect(f.remove).not.toHaveBeenCalled();
    expect(f.lease.readState()).toBe('idle');
  });

  it('retains the selected journal when the captured lease owner changes', async () => {
    const f = await fixture();
    let current!: Awaited<ReturnType<typeof f.lease.acquire>>;
    const acquire = f.lease.acquire.bind(f.lease);
    vi.spyOn(f.lease, 'acquire').mockImplementation(async purpose => { current = await acquire(purpose); return current; });
    f.use.mockImplementation(async authority => {
      await current.release();
      await f.lease.acquire('restore');
      await f.transaction.commitAcceptance(f.selected, undefined, authority);
    });
    await expect(withProfileRestoreTerminalAuthority(f.input, f.use)).rejects.toThrow('WORKSPACE_MAINTENANCE_BUSY');
    expect(await f.journalStore.peek()).toEqual(f.selected);
    expect(f.remove).not.toHaveBeenCalled();
    expect(f.end).not.toHaveBeenCalled();
    expect(f.lease.readState()).toBe('busy');
    await current.release();
  });

  it('invalidates the fence before a stalled claim close exhausts its cleanup budget', async () => {
    const f = await fixture();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const entered = deferred<void>();
    const closeEntered = deferred<void>();
    const close = deferred<void>();
    f.use.mockImplementation(async () => {
      f.claims[1]!.close.mockImplementation(async () => { closeEntered.resolve(); await close.promise; });
      entered.resolve();
      throw new Error('synthetic first failure');
    });
    const outcome = withProfileRestoreTerminalAuthority(f.input, f.use).catch(error => error);
    await entered.promise;
    await closeEntered.promise;
    expect(f.invalidated).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(profileInspectionShutdownMilliseconds);
    expect(await outcome).toMatchObject({ message: 'PROFILE_RESTORE_RECOVERY_REQUIRED' });
    expect(f.remove).not.toHaveBeenCalled();
    expect(f.end).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    close.resolve();
  });

  it('does not use a reservation returned after the work deadline', async () => {
    const f = await fixture();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const entered = deferred<void>();
    const returned = deferred<Awaited<ReturnType<typeof f.input.acquireReservation>>>();
    const acquire = f.input.acquireReservation;
    const owner = await acquire(join(f.rollback, f.selected.operationId),
      await readWorkspaceProcessReservationIdentity(join(f.rollback, f.selected.operationId)));
    f.claims.splice(0);
    f.input.acquireReservation = async () => { entered.resolve(); return returned.promise; };
    const outcome = withProfileRestoreTerminalAuthority(f.input, f.use).catch(error => error);
    await entered.promise;
    await vi.advanceTimersByTimeAsync(profileInspectionWorkMilliseconds);
    expect(await outcome).toMatchObject({ message: 'PROFILE_RESTORE_RECOVERY_REQUIRED' });
    returned.resolve(owner);
    for (let index = 0; index < 20; index += 1) await Promise.resolve();
    expect(owner.invalidate).toHaveBeenCalled();
    expect(f.use).not.toHaveBeenCalled();
    expect(f.remove).not.toHaveBeenCalled();
    expect(f.end).not.toHaveBeenCalled();
    expect(await f.journalStore.peek()).toEqual(f.selected);
    expect(vi.getTimerCount()).toBe(0);
  });
});

async function fixture(accepted = false, beforeUpdateRollbackMigrations = false) {
  const root = await mkdtemp(join(tmpdir(), 'eky-terminal-authority-'));
  roots.push(root);
  const operationId = randomUUID();
  const profileId = randomUUID();
  const database = join(root, 'data', 'eky.sqlite');
  const documents = join(root, 'storage', 'invoices');
  const staging = join(root, 'staging');
  const rollback = join(root, 'rollback');
  for (const path of [dirname(database), documents, join(staging, operationId, 'activation', 'storage', 'invoices')]) {
    await mkdir(path, { recursive: true });
  }
  await writeFile(database, 'old database');
  await writeFile(join(documents, 'old.pdf'), 'old pdf');
  await writeFile(join(staging, operationId, 'profile.sqlite'), 'new database');
  await writeFile(join(staging, operationId, 'activation', 'storage', 'invoices', 'new.pdf'), 'new pdf');
  const journalStore = new ProfileRestoreActivationJournalStore(join(root, profileRestoreActivationJournalFileName));
  const transaction = new ProfileRestoreActivationTransaction({ journalStore,
    paths: { activeDatabasePath: database, activeDocumentsRoot: documents, stagingRoot: staging, rollbackRoot: rollback, failedRoot: join(root, 'failed') } });
  await transaction.prepare(operationId);
  let selected = await transaction.advanceToValidation();
  if (accepted) selected = await transaction.commitAcceptance(selected);
  const events: string[] = [];
  const lease = new InMemoryWorkspaceMaintenanceLease();
  let snapshotId: string | undefined;
  const begin = vi.fn(async (id: string) => { snapshotId = id; events.push('begin'); return 'busy' as const; });
  const fence = vi.fn(async (id: string) => { expect(id).toBe(snapshotId); return 'busy' as const; });
  const stationary = vi.fn(async () => { await readdir(join(staging, snapshotId!)); });
  const migrationPolicy = beforeUpdateRollbackMigrations ? 'restoreCompatible' as const : 'exactCurrentManifest' as const;
  const receipt = Object.freeze({ profileId, migrationPolicy,
    databaseHealth: 'healthy' as const, migrationChainIdentity: 'c'.repeat(64), artifactIdentity: 'd'.repeat(64),
    artifactCount: 1, artifactTotalByteSize: 7, database: { byteSize: 12, sha256: 'a'.repeat(64) },
    artifactCatalog: { byteSize: 2, sha256: 'b'.repeat(64) } });
  const remove = vi.fn(async (id: string) => { events.push('snapshotRemove'); await rm(join(staging, id), { recursive: true }); });
  const end = vi.fn(async (_id: string) => { events.push('end'); return 'normal' as const; });
  const invalidated = vi.fn(async (_id: string) => 'busy' as const);
  const snapshotClient = {
    beginRestoreMaintenance: begin, assertRestoreMaintenance: fence, endRestoreMaintenance: end,
    invalidateRestoreMaintenance: invalidated, removeProfileSnapshot: remove,
    createProfileSnapshot: vi.fn<ProfileSnapshotInspectionClient['createProfileSnapshot']>(async (id, policy) => {
      expect(policy).toBe(migrationPolicy); events.push('snapshot');
      await mkdir(join(staging, id));
      return { type: 'profileSnapshot', artifactCatalog: { logicalPath: 'snapshot-catalog-v1.json', catalogByteSize: 2,
        sha256: 'b'.repeat(64), artifactCount: 1, artifactTotalByteSize: 7 },
      database: { logicalPath: 'profile.sqlite', databaseByteSize: 12, sha256: 'a'.repeat(64), totalPages: 1 } };
    }),
    createRestoredProfileSnapshot: vi.fn<ProfileSnapshotInspectionClient['createRestoredProfileSnapshot']>(async id => {
      expect(migrationPolicy).toBe('restoreCompatible'); events.push('snapshot');
      await mkdir(join(staging, id));
      return { type: 'profileSnapshot', artifactCatalog: { logicalPath: 'snapshot-catalog-v1.json', catalogByteSize: 2,
        sha256: 'b'.repeat(64), artifactCount: 1, artifactTotalByteSize: 7 },
      database: { logicalPath: 'profile.sqlite', databaseByteSize: 12, sha256: 'a'.repeat(64), totalPages: 1 } };
    }),
    validateProfileSnapshot: vi.fn<ProfileSnapshotInspectionClient['validateProfileSnapshot']>(async () => {
      events.push('inspect'); return { type: 'profileSnapshotValidation', activeProfileIsEmpty: false,
        profileMatchesActive: true, ...receipt };
    }),
    withProfileSnapshot: (async (_id, use) => { events.push('snapshotUse'); return use(receipt, stationary); }) as
      ProfileSnapshotInspectionClient['withProfileSnapshot'],
  };
  type Owner = Awaited<ReturnType<Parameters<typeof withProfileRestoreTerminalAuthority>[0]['acquireReservation']>>;
  const claims: { role: string; close: ReturnType<typeof vi.fn<Owner['close']>> }[] = [];
  const input = { journal: selected, transaction, maintenanceLease: lease, snapshotClient,
    assertAuthority: vi.fn(() => {}), assertLineage: vi.fn((id: string) => { expect(id).toBe(profileId); }),
    async acquireReservation(path: string, identity: string): Promise<Owner> {
      expect(await readWorkspaceProcessReservationIdentity(path)).toBe(identity);
      const role = path.startsWith(rollback) ? 'rollback' : 'staging';
      events.push(`claim:${role}`);
      const close = vi.fn(async () => { events.push(`close:${role}`); });
      claims.push({ role, close });
      return { close, invalidate: vi.fn(), assertMainCurrent: vi.fn(),
        async assertMainOwned() { expect(await readWorkspaceProcessReservationIdentity(path)).toBe(identity); },
        bind() { throw new Error('terminal cleanup never transfers the claim'); } };
    },
  };
  const use = vi.fn(async (authority: ProfileRestoreTerminalMutationAuthority) => {
    events.push('finish');
    const current = selected.phase === 'accepted' ? selected : await transaction.commitAcceptance(selected, undefined, authority);
    await transaction.clearAccepted(current, undefined, authority);
  });
  return { input, selected, root, transaction, journalStore, database, staging, rollback, profileId, events, lease, claims,
    begin, fence, stationary, invalidated, end, remove, use, snapshotClient, snapshotId: () => snapshotId };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(fulfill => { resolve = fulfill; });
  return { promise, resolve };
}
