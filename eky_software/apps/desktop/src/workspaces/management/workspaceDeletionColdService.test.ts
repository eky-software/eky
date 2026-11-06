import { describe, expect, it, vi } from 'vitest';
import { rmdir, unlink } from 'node:fs/promises';
import { createWorkspaceDeletionFinalizationTestFixture } from '../deletion/workspaceDeletionFinalizationTestSupport.js';
import { createWorkspaceDeletionCommand } from '../deletion/workspaceDeletionCommand.js';
import * as retirement from '../deletion/workspaceDeletionInventoryRetirement.js';
import { WorkspaceDeletionJournalStore } from '../deletion/workspaceDeletionJournalStore.js';

import { deletionTestJournal } from '../deletion/workspaceDeletionDataTestSupport.js';
import { InMemoryWorkspaceMaintenanceLease, type WorkspaceMaintenanceLeaseHandle } from '../maintenance/workspaceMaintenanceLease.js';
import { WorkspaceManagementService, type WorkspaceDeletionRecoveryOptions,
  type WorkspaceDeletionWorkAuthority } from './workspaceManagementService.js';
import { WorkspaceManagementError } from './workspaceManagementError.js';
import type { WorkspaceManagementOperationEvent } from './workspaceManagementTypes.js';

// Real lease, controlled selection/command/close ports. Native file admission is
// tested separately; these controls do not enable the startup consumer.
function fixture(phase: 'authorized' | 'registryPublished' = 'authorized') {
  const journal = deletionTestJournal(phase), lease = new InMemoryWorkspaceMaintenanceLease();
  const handles = new Map<WorkspaceMaintenanceLeaseHandle, WorkspaceMaintenanceLeaseHandle>();
  let stopping = false, mainCurrent = true, ownerClosed = false;
  let initialActive = true, freshActive = true;
  const completion = Object.freeze({ formatVersion: 1 as const, status: 'completed' as const, navigation: 'selector' as const });
  const initial = { journal, assertSelected: vi.fn(async () => {
    if (!initialActive) throw new Error('SYNTHETIC_INITIAL_REVOKED');
  }), revoke: vi.fn(() => { initialActive = false; }) };
  const fresh = { journal, assertSelected: vi.fn(async () => {
    if (!freshActive) throw new Error('SYNTHETIC_FRESH_REVOKED');
  }), revoke: vi.fn(() => { freshActive = false; }) };
  const release = vi.fn(async (held: WorkspaceMaintenanceLeaseHandle) => { await held.release(); });
  const acquire = vi.fn(async (purpose: Parameters<typeof lease.acquire>[0]) => {
    const held = await lease.acquire(purpose);
    const visible = { release: () => release(held) };
    handles.set(visible, held);
    return visible;
  });
  const capture = vi.fn((purposes: Parameters<typeof lease.captureCurrentOwner>[0], visible?: WorkspaceMaintenanceLeaseHandle) => {
    const held = visible === undefined ? undefined : handles.get(visible);
    if (held === undefined) throw new Error('SYNTHETIC_UNEXPECTED_LEASE');
    return lease.captureCurrentOwner(purposes, held);
  });
  let checkLease: (() => void) | undefined;
  const owner = {
    assertCurrent: vi.fn(() => {
      if (ownerClosed || !mainCurrent || stopping) throw new WorkspaceManagementError('WORKSPACE_DELETE_OWNERSHIP_UNCERTAIN', 'deleteResume');
      checkLease?.();
    }),
    assertOwned: vi.fn(async () => { owner.assertCurrent(); }),
    recordRemoved: vi.fn(() => { owner.assertCurrent(); return completion; }),
    close: vi.fn(async () => { ownerClosed = true; }),
  };
  const captureSelection = vi.fn<WorkspaceDeletionRecoveryOptions['captureSelection']>(async assertLease => {
    assertLease(); return fresh;
  });
  const captureAuthority = vi.fn<WorkspaceDeletionRecoveryOptions['captureAuthority']>(async (_journal, assertLease) => {
    checkLease = assertLease; assertLease(); return owner;
  });
  const resume = vi.fn<WorkspaceDeletionRecoveryOptions['resumeSelected']>(async (_journal, authority, observe) => {
    observe('deletePurge'); await authority.assertOwned();
    observe('deleteRegistry'); authority.assertCurrent();
    observe('deleteCleanup'); authority.recordRemoved({ status: 'removed', journal: deletionTestJournal('registryPublished') });
    return completion;
  });
  const events: WorkspaceManagementOperationEvent[] = [];
  const record = vi.fn((event: WorkspaceManagementOperationEvent) => { events.push(event); });
  const onUncertain = vi.fn((_cause: unknown) => {});
  const options: WorkspaceDeletionRecoveryOptions = {
    selection: initial, maintenanceLease: { acquire, captureCurrentOwner: capture },
    captureSelection, captureAuthority, resumeSelected: resume,
    assertCurrent() { if (!mainCurrent) throw new Error('SYNTHETIC_MAIN_LOST'); },
    isStopping: () => stopping, onUncertain, observer: { record },
  };
  return { journal, options, initial, fresh, owner, lease, release, acquire, capture, completion,
    captureSelection, captureAuthority, resume, events, record, onUncertain,
    stop: () => { stopping = true; }, loseMain: () => { mainCurrent = false; }, restoreMain: () => { mainCurrent = true; },
    async releaseHeld() { for (const held of handles.values()) await held.release(); },
  };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

async function awaitEntry(entered: Promise<void>, work: Promise<unknown>): Promise<void> {
  await Promise.race([entered, work.then(() => { throw new Error('SYNTHETIC_EXPECTED_ENTRY_NOT_REACHED'); })]);
}

describe('cold deletion service entry', () => {
  it('revokes the initial selection even if the first injected timing read throws', async () => {
    const f = fixture(), original = new Error('SYNTHETIC_CLOCK_FAILURE');
    await expect(WorkspaceManagementService.recoverDeletionBeforeRuntime({ ...f.options,
      now() { throw original; } })).rejects.toMatchObject({ cause: original });
    expect(f.initial.revoke).toHaveBeenCalledOnce(); expect(f.acquire).not.toHaveBeenCalled();
    expect(f.resume).not.toHaveBeenCalled(); expect(f.lease.readState()).toBe('idle');
    expect(f.events).toEqual([]);
  });
  it.each(['authorized', 'registryPublished'] as const)('hands the exact %s selection to one lease and the shared continuation', async phase => {
    const f = fixture(phase);
    await expect(WorkspaceManagementService.recoverDeletionBeforeRuntime(f.options)).resolves.toEqual(f.completion);
    expect(f.acquire).toHaveBeenCalledExactlyOnceWith('delete');
    expect(f.capture).toHaveBeenCalledExactlyOnceWith(['delete'], expect.anything());
    expect(f.resume).toHaveBeenCalledExactlyOnceWith(f.journal, expect.anything(), expect.any(Function));
    expect(f.initial.assertSelected).toHaveBeenCalledTimes(4);
    expect(f.fresh.assertSelected).toHaveBeenCalledTimes(2);
    expect(f.initial.revoke).toHaveBeenCalledOnce(); expect(f.fresh.revoke).toHaveBeenCalledOnce();
    expect(f.owner.close).toHaveBeenCalledOnce(); expect(f.release).toHaveBeenCalledOnce();
    expect(f.owner.close.mock.invocationCallOrder[0]).toBeLessThan(f.release.mock.invocationCallOrder[0]!);
    expect(f.lease.readState()).toBe('idle'); expect(f.events).toEqual([]); expect(f.onUncertain).not.toHaveBeenCalled();
  });

  it('does not acquire a lease after an initial selection failure', async () => {
    const f = fixture(), original = new Error('SYNTHETIC_INITIAL_NATIVE_CHANGE');
    f.initial.assertSelected.mockRejectedValueOnce(original);
    await expect(WorkspaceManagementService.recoverDeletionBeforeRuntime(f.options)).rejects.toMatchObject({ cause: original });
    expect(f.acquire).not.toHaveBeenCalled(); expect(f.captureSelection).not.toHaveBeenCalled();
    expect(f.initial.revoke).toHaveBeenCalledOnce(); expect(f.events).toMatchObject([
      { operationKind: 'deleteResume', stage: 'admission', sideEffectState: 'unknown', errorCode: 'WORKSPACE_DELETE_FAILED' },
    ]);
  });

  it('keeps an unrelated busy lease and reports resumed admission as unknown, not none', async () => {
    const f = fixture(), held = await f.lease.acquire('backup');
    try {
      await expect(WorkspaceManagementService.recoverDeletionBeforeRuntime(f.options)).rejects.toMatchObject({ code: 'WORKSPACE_MANAGEMENT_BUSY' });
      expect(f.captureSelection).not.toHaveBeenCalled(); expect(f.release).not.toHaveBeenCalled();
      expect(f.lease.readState()).toBe('busy');
      expect(f.events).toMatchObject([{ stage: 'admission', operationKind: 'deleteResume',
        errorCode: 'WORKSPACE_MANAGEMENT_BUSY', retryable: true, sideEffectState: 'unknown' }]);
    } finally { await held.release(); }
  });

  it.each(['absent', 'phase', 'binding'] as const)('rejects a changed fresh selection (%s) without adopting it', async change => {
    const f = fixture();
    if (change === 'absent') f.captureSelection.mockResolvedValueOnce(undefined);
    else f.fresh.journal = change === 'phase' ? deletionTestJournal('purged')
      : { ...f.journal, inventory: { ...f.journal.inventory, sha256: 'f'.repeat(64) } };
    await expect(WorkspaceManagementService.recoverDeletionBeforeRuntime(f.options)).rejects.toBeInstanceOf(WorkspaceManagementError);
    expect(f.captureAuthority).not.toHaveBeenCalled(); expect(f.resume).not.toHaveBeenCalled();
    expect(f.initial.revoke).toHaveBeenCalledOnce(); expect(f.fresh.revoke).toHaveBeenCalledTimes(change === 'absent' ? 0 : 1);
    expect(f.lease.readState()).toBe('idle');
  });

  it('rechecks the original receipt after fresh capture rather than rebasing native identities', async () => {
    const f = fixture(), original = new Error('SYNTHETIC_SAME_BYTES_NEW_NATIVE_IDENTITY');
    f.captureSelection.mockImplementationOnce(async assertLease => {
      assertLease(); f.initial.assertSelected.mockRejectedValueOnce(original); return f.fresh;
    });
    await expect(WorkspaceManagementService.recoverDeletionBeforeRuntime(f.options)).rejects.toMatchObject({ cause: original });
    expect(f.fresh.assertSelected).toHaveBeenCalledOnce(); expect(f.captureAuthority).not.toHaveBeenCalled();
    expect(f.resume).not.toHaveBeenCalled(); expect(f.lease.readState()).toBe('idle');
  });

  it('closes a captured owner if the final handoff selection fails', async () => {
    const f = fixture(), original = new Error('SYNTHETIC_HANDOFF_CHANGE');
    f.captureAuthority.mockImplementationOnce(async () => {
      f.fresh.assertSelected.mockRejectedValueOnce(original); return f.owner;
    });
    await expect(WorkspaceManagementService.recoverDeletionBeforeRuntime(f.options)).rejects.toMatchObject({ cause: original });
    expect(f.owner.close).toHaveBeenCalledOnce(); expect(f.resume).not.toHaveBeenCalled();
    expect(f.lease.readState()).toBe('idle');
  });

  it('does not release or authorize a replacement lease acquired during authority capture', async () => {
    const f = fixture();
    let replacement: WorkspaceMaintenanceLeaseHandle | undefined;
    f.captureAuthority.mockImplementationOnce(async () => {
      await f.releaseHeld(); replacement = await f.lease.acquire('delete'); return f.owner;
    });
    try {
      await expect(WorkspaceManagementService.recoverDeletionBeforeRuntime(f.options)).rejects.toBeInstanceOf(WorkspaceManagementError);
      expect(f.resume).not.toHaveBeenCalled(); expect(f.owner.close).toHaveBeenCalledOnce();
      expect(f.lease.readState()).toBe('busy');
    } finally { await replacement?.release(); await f.releaseHeld(); }
  });

  it('marks a failed selection revoke uncertain and still attempts every other captured close', async () => {
    const f = fixture(), original = new Error('SYNTHETIC_REVOKE_FAILURE');
    f.initial.revoke.mockImplementationOnce(() => { throw original; });
    await expect(WorkspaceManagementService.recoverDeletionBeforeRuntime(f.options)).rejects.toMatchObject({ cause: original });
    expect(f.fresh.revoke).toHaveBeenCalledOnce(); expect(f.owner.close).toHaveBeenCalledOnce();
    expect(f.resume).not.toHaveBeenCalled(); expect(f.onUncertain).toHaveBeenCalledExactlyOnceWith(original);
    expect(f.release).toHaveBeenCalledOnce(); expect(f.lease.readState()).toBe('idle');
  });

  it('registers a fresh receipt for close even if main ownership is lost as its capture returns', async () => {
    const f = fixture();
    f.captureSelection.mockImplementationOnce(async () => { f.loseMain(); return f.fresh; });
    await expect(WorkspaceManagementService.recoverDeletionBeforeRuntime(f.options)).rejects.toMatchObject({ cause: expect.any(Error) });
    expect(f.initial.revoke).toHaveBeenCalledOnce(); expect(f.fresh.revoke).toHaveBeenCalledOnce();
    expect(f.resume).not.toHaveBeenCalled(); expect(f.lease.readState()).toBe('idle');
  });

  it('does not revive the admission guard after a collaborator observes and catches ownership loss', async () => {
    const f = fixture();
    let original: Error | undefined;
    f.captureSelection.mockImplementationOnce(async assertLease => {
      f.loseMain();
      try { assertLease(); } catch (cause) {
        if (!(cause instanceof Error)) throw cause;
        original = cause;
      }
      f.restoreMain();
      expect(assertLease).toThrow(original);
      return f.fresh;
    });
    const error = await WorkspaceManagementService.recoverDeletionBeforeRuntime(f.options).catch(cause => cause);
    expect(original).toBeInstanceOf(Error); expect(error.cause).toBe(original);
    expect(f.captureAuthority).not.toHaveBeenCalled(); expect(f.resume).not.toHaveBeenCalled();
    expect(f.fresh.revoke).toHaveBeenCalledOnce(); expect(f.lease.readState()).toBe('idle');
  });

  it('burns the original admission callback before starting owner cleanup after a command error', async () => {
    const f = fixture(), original = new Error('SYNTHETIC_COMMAND_FAILURE');
    let retained: (() => void) | undefined;
    f.captureSelection.mockImplementationOnce(async check => { retained = check; return f.fresh; });
    f.resume.mockRejectedValueOnce(original);
    f.owner.close.mockImplementationOnce(async () => { expect(retained!).toThrow(original); });
    await expect(WorkspaceManagementService.recoverDeletionBeforeRuntime(f.options)).rejects.toMatchObject({ cause: original });
    expect(f.owner.close).toHaveBeenCalledOnce(); expect(retained!).toThrow(original);
    expect(f.lease.readState()).toBe('idle');
  });

  it('keeps the lease and joins the original command before reacting to shutdown', async () => {
    const f = fixture(), entered = deferred(), held = deferred();
    let retained: WorkspaceDeletionWorkAuthority | undefined;
    f.resume.mockImplementationOnce(async (_journal, authority) => {
      retained = authority; entered.resolve(); await held.promise; authority.assertCurrent(); return f.completion;
    });
    const work = WorkspaceManagementService.recoverDeletionBeforeRuntime(f.options);
    const observed = work.catch(error => error);
    try {
      await awaitEntry(entered.promise, work); f.stop();
      expect(f.lease.readState()).toBe('busy'); expect(f.release).not.toHaveBeenCalled();
      expect(f.owner.close).not.toHaveBeenCalled(); held.resolve();
      expect(await observed).toMatchObject({ code: 'WORKSPACE_DELETE_OWNERSHIP_UNCERTAIN' });
      expect(retained!.assertCurrent).toThrow(); expect(f.owner.close).toHaveBeenCalledOnce();
      expect(f.lease.readState()).toBe('idle');
    } finally { held.resolve(); await Promise.allSettled([work]); await f.releaseHeld(); }
  });

  it('keeps pending work and the lease until the original owner close settles', async () => {
    const f = fixture(), entered = deferred(), held = deferred();
    f.owner.close.mockImplementationOnce(async () => { entered.resolve(); await held.promise; });
    let settled = false;
    const work = WorkspaceManagementService.recoverDeletionBeforeRuntime(f.options).finally(() => { settled = true; });
    try {
      await awaitEntry(entered.promise, work); expect(settled).toBe(false);
      expect(f.release).not.toHaveBeenCalled(); expect(f.lease.readState()).toBe('busy');
      held.resolve(); await expect(work).resolves.toEqual(f.completion);
      expect(f.lease.readState()).toBe('idle');
    } finally { held.resolve(); await Promise.allSettled([work]); await f.releaseHeld(); }
  });

  it.each([false, true])('preserves first failure and marks uncertainty before returning on owner close failure (primary: %s)', async primary => {
    const f = fixture(), original = new Error('SYNTHETIC_ORIGINAL'), closeFailure = new Error('SYNTHETIC_CLOSE');
    if (primary) f.resume.mockImplementationOnce(async (_journal, _authority, observe) => { observe('deleteRegistry'); throw original; });
    f.owner.close.mockRejectedValueOnce(closeFailure);
    try {
      const error = await WorkspaceManagementService.recoverDeletionBeforeRuntime(f.options).catch(error => error);
      expect(error).toMatchObject({ code: primary ? 'WORKSPACE_DELETE_FAILED' : 'WORKSPACE_DELETE_CLEANUP_FAILED' });
      if (primary) expect(error.cause.errors).toEqual([original, closeFailure]);
      else expect(error.cause).toBe(closeFailure);
      expect(f.release).not.toHaveBeenCalled(); expect(f.lease.readState()).toBe('busy');
      expect(f.onUncertain).toHaveBeenCalledExactlyOnceWith(closeFailure);
      expect(f.events.map(event => [event.stage, event.errorCode])).toEqual(primary
        ? [['deleteRegistry', 'WORKSPACE_DELETE_FAILED'], ['deleteCleanup', 'WORKSPACE_DELETE_CLEANUP_FAILED']]
        : [['deleteCleanup', 'WORKSPACE_DELETE_CLEANUP_FAILED']]);
      expect(new Set(f.events.map(event => event.correlationId)).size).toBe(1);
    } finally { await f.releaseHeld(); }
  });

  it.each([false, true])('does not return success after a lease release failure (already released: %s)', async released => {
    const f = fixture(), original = new Error('SYNTHETIC_RELEASE');
    f.release.mockImplementationOnce(async held => { if (released) await held.release(); throw original; });
    let pending = true;
    f.onUncertain.mockImplementation(() => { expect(pending).toBe(true); });
    try {
      await expect(WorkspaceManagementService.recoverDeletionBeforeRuntime(f.options)
        .finally(() => { pending = false; })).rejects.toMatchObject({ code: 'WORKSPACE_DELETE_CLEANUP_FAILED', cause: original });
      expect(f.onUncertain).toHaveBeenCalledExactlyOnceWith(original);
      expect(f.events).toMatchObject([{ stage: 'deleteCleanup', sideEffectState: 'unknown' }]);
      expect(f.lease.readState()).toBe(released ? 'idle' : 'busy');
    } finally { await f.releaseHeld(); }
  });

  it.each(['sync', 'async'] as const)('does not let a failed %s primary observer suppress close, cleanup reporting or the original failure', async mode => {
    const f = fixture(), original = new Error('SYNTHETIC_PRIMARY'), closeFailure = new Error('SYNTHETIC_CLOSE');
    f.resume.mockRejectedValueOnce(original); f.owner.close.mockRejectedValueOnce(closeFailure);
    f.record.mockImplementationOnce(() => {
      const error = new Error('SYNTHETIC_WRITER');
      if (mode === 'async') return Promise.reject(error);
      throw error;
    });
    try {
      const error = await WorkspaceManagementService.recoverDeletionBeforeRuntime(f.options).catch(error => error);
      expect(error.cause.errors).toEqual([original, closeFailure]); expect(f.record).toHaveBeenCalledTimes(2);
      expect(f.events).toMatchObject([{ stage: 'deleteCleanup', errorCode: 'WORKSPACE_DELETE_CLEANUP_FAILED' }]);
    } finally { await f.releaseHeld(); }
  });

  it('captures collaborators and journal bytes before waits, and ignores late phase observations', async () => {
    const f = fixture(), original = new Error('SYNTHETIC_PHASE_ERROR');
    let late: Parameters<WorkspaceDeletionRecoveryOptions['resumeSelected']>[2] | undefined;
    f.captureSelection.mockImplementationOnce(async () => {
      f.options.resumeSelected = async () => { throw new Error('SYNTHETIC_REPLACED_CALLBACK'); };
      f.initial.journal = { ...f.journal, inventory: { ...f.journal.inventory, sha256: 'f'.repeat(64) } };
      return f.fresh;
    });
    f.resume.mockImplementationOnce(async (journal, _authority, observe) => {
      expect(journal).toEqual(f.journal); late = observe; observe('deletePurge'); throw original;
    });
    await expect(WorkspaceManagementService.recoverDeletionBeforeRuntime(f.options)).rejects.toMatchObject({ cause: original });
    expect(f.events).toMatchObject([{ stage: 'deletePurge' }]);
    late!('deleteRegistry'); expect(f.events).toMatchObject([{ stage: 'deletePurge' }]);
    expect(f.owner.close).toHaveBeenCalledOnce(); expect(f.lease.readState()).toBe('idle');
  });
});

it.for([false, true])('joins actual post-clear failure and close (closeFailure: %s)', async (failClose, test) => {
  const files = await createWorkspaceDeletionFinalizationTestFixture(test, true, true), f = fixture('registryPublished');
  await unlink(files.inventoryPaths.currentPath); await rmdir(files.inventoryPaths.directoryPath);
  const terminal = { ...files.journal, phase: 'registryPublished' as const };
  f.initial.journal = terminal; f.fresh.journal = terminal;
  const first = new Error('SYNTHETIC_REAL_POST_CLEAR_FAILURE'), second = new Error('SYNTHETIC_POST_CLEAR_CLOSE_FAILURE');
  let post = false, physical = false, pending = true;
  const clear = WorkspaceDeletionJournalStore.prototype.clearTerminal, absent = retirement.assertWorkspaceDeletionInventoryRetired;
  vi.spyOn(WorkspaceDeletionJournalStore.prototype, 'clearTerminal').mockImplementation(async function (this: WorkspaceDeletionJournalStore, ...args) {
    const result = await clear.apply(this, args); post = true; return result;
  });
  vi.spyOn(retirement, 'assertWorkspaceDeletionInventoryRetired').mockImplementation(async (...args) => {
    const result = await absent(...args);
    if (post) { physical = true; throw first; }
    return result;
  });
  const entered = deferred(), held = deferred(); files.releases.push(held.resolve);
  f.owner.close.mockImplementationOnce(async () => {
    expect(physical).toBe(true); expect(f.owner.recordRemoved).not.toHaveBeenCalled();
    entered.resolve(); await held.promise; if (failClose) throw second;
  });
  const command = createWorkspaceDeletionCommand({ userDataRoot: files.root, registry: files.registry,
    async assertWritersAbsent() { files.authority.assertCurrent(); },
    coldSelection: { assertReservationOwned: files.authority.assertOwned, assertStableSelection: files.fullProof } });
  f.resume.mockImplementation((journal, authority) => command.resumeSelected(journal, authority));
  const observed = WorkspaceManagementService.recoverDeletionBeforeRuntime(f.options).then(
    () => { pending = false; return undefined; }, error => { pending = false; return error; });
  files.track(observed);
  try {
    await awaitEntry(entered.promise, observed);
    expect(pending).toBe(true); expect(f.lease.readState()).toBe('busy'); expect(f.release).not.toHaveBeenCalled();
    expect((await files.store.inspect(files.authority.assertCurrent)).plan.mode).toBe('absent');
    held.resolve(); const error = await observed;
    expect(error).toMatchObject({ code: 'WORKSPACE_DELETE_FAILED' });
    if (failClose) {
      expect(error.cause.errors[0]).toBe(first); expect(error.cause.errors[1]).toBe(second);
      expect(f.release).not.toHaveBeenCalled(); expect(f.lease.readState()).toBe('busy');
      expect(f.onUncertain).toHaveBeenCalledExactlyOnceWith(second);
    } else {
      expect(error.cause).toBe(first); expect(f.release).toHaveBeenCalledOnce(); expect(f.lease.readState()).toBe('idle');
      expect(f.owner.close.mock.invocationCallOrder[0]).toBeLessThan(f.release.mock.invocationCallOrder[0]!);
    }
    expect(f.owner.recordRemoved).not.toHaveBeenCalled(); await files.preserved();
  } finally { held.resolve(); await observed; await f.releaseHeld(); }
});
