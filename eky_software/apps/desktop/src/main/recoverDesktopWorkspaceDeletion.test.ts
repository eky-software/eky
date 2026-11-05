import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi, type TestContext } from 'vitest';
import { deletionTestId, deletionTestJournal } from '../workspaces/deletion/workspaceDeletionDataTestSupport.js';
import * as commandModule from '../workspaces/deletion/workspaceDeletionCommand.js';
import { InMemoryWorkspaceMaintenanceLease } from '../workspaces/maintenance/workspaceMaintenanceLease.js';
import * as admissionModule from '../workspaces/runtime/workspaceColdRecoveryAdmissionComposition.js';
import * as continuationModule from './workspaceDeletionContinuation.js';
import { recoverDesktopWorkspaceDeletion } from './recoverDesktopWorkspaceDeletion.js';

function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

function fixture(test: TestContext) {
  let current = true;
  const work: { pending: boolean; uncertainty?: { reason: unknown } } = { pending: false };
  const journal = deletionTestJournal(), lease = new InMemoryWorkspaceMaintenanceLease();
  const jobs: Promise<unknown>[] = [], gates: ReturnType<typeof gate>[] = [], handles: { release(): Promise<void> }[] = [];
  const check = vi.fn(() => { test.signal.throwIfAborted(); if (!current) throw new Error('SYNTHETIC_MAIN_LOST'); });
  const owned = vi.fn(async () => { check(); });
  const invalidate = vi.fn(() => { current = false; });
  const capture = lease.captureCurrentOwner.bind(lease);
  const acquire = lease.acquire.bind(lease), release = vi.fn(async (held: { release(): Promise<void> }) => { await held.release(); });
  const maintenanceLease = { acquire: vi.fn(async (purpose: Parameters<typeof acquire>[0]) => {
    const held = await acquire(purpose); handles.push(held);
    return { release: () => release(held) };
  }), captureCurrentOwner(purposes: Parameters<typeof capture>[0]) { return capture(purposes, handles.at(-1)); } };
  const selection = { journal, registryState: 'before' as const, registryNeedsRecovery: false,
    buildAdmission: 'exactAcceptedBuild' as const, assertCurrent: () => undefined,
    assertSelected: vi.fn(async () => { check(); }), revoke: vi.fn() };
  const read = vi.spyOn(admissionModule, 'captureColdWorkspaceDeletionAdmissionFromRoot').mockImplementation(async input => {
    input.assertCurrent(); await input.assertOwned(); return selection;
  });
  let assertLease: (() => void) | undefined;
  const completion = { formatVersion: 1 as const, status: 'completed' as const, navigation: 'selector' as const };
  const owner = { assertCurrent: () => { check(); assertLease?.(); }, assertOwned: vi.fn(async () => { check(); assertLease?.(); }),
    recordRemoved: vi.fn(() => completion), close: vi.fn(async () => undefined) };
  const beforeMetadata = vi.fn(async () => undefined);
  const assertReservationOwned = vi.fn(async () => { owner.assertCurrent(); });
  const createOwner = vi.spyOn(continuationModule, 'createWorkspaceDeletionColdContinuation').mockImplementation(input => {
    assertLease = input.assertCurrent; return { owner, beforeMetadata, assertReservationOwned };
  });
  const resume = vi.fn<ReturnType<typeof commandModule.createWorkspaceDeletionCommand>['resumeSelected']>(async (selected, authority) => {
    expect(selected).toEqual(journal); await authority.assertOwned();
    await beforeMetadata(); authority.recordRemoved({ status: 'removed', journal: { ...journal, phase: 'registryPublished' } });
    return completion;
  });
  const createCommand = vi.spyOn(commandModule, 'createWorkspaceDeletionCommand').mockReturnValue({ resumeSelected: resume,
    publish: vi.fn(async () => { throw new Error('SYNTHETIC_UNEXPECTED_PUBLISH'); }),
    resume: vi.fn(async () => { throw new Error('SYNTHETIC_UNEXPECTED_LIVE_RESUME'); }) });
  const record = vi.fn(), time = '2026-10-25T12:00:00.000Z';
  const input = { userDataRoot: join(tmpdir(), 'eky-controlled-startup'),
    buildInfo: { schemaVersion: 1 as const, appVersion: '0.2.81', buildRevision: 'a'.repeat(40), buildCreatedAt: time, buildDirty: false },
    releaseInfo: { schemaVersion: 1 as const, appIdentity: 'Eky' as const, appVersion: '0.2.81', msiProductVersion: '0.2.81',
      buildRevision: 'a'.repeat(40), platform: 'win32' as const, architecture: 'x64' as const,
      releaseChannel: 'pilot' as const, upgradeCode: deletionTestId(50) },
    maintenanceLease, reservation: { assertMainCurrent: check, assertMainOwned: owned, invalidate },
    work, assertStartupCurrent: check, observer: { record } };
  test.onTestFinished(async () => {
    for (const held of gates) held.resolve(); await Promise.allSettled(jobs);
    for (const held of handles) await held.release(); vi.restoreAllMocks();
  });
  return { input, work, lease, maintenanceLease, release, selection, read, createOwner, owner, beforeMetadata,
    createCommand, resume, record, invalidate, completion, assertReservationOwned,
    hold() { const held = gate(); gates.push(held); return held; },
    run() { const job = recoverDesktopWorkspaceDeletion(input); jobs.push(job); return job; },
  };
}

describe('main deletion startup composition', () => {
  it('leaves ordinary startup untouched when every deletion slot is absent', async test => {
    const f = fixture(test); f.read.mockResolvedValueOnce(undefined);
    await expect(f.run()).resolves.toBeUndefined();
    expect(f.maintenanceLease.acquire).not.toHaveBeenCalled(); expect(f.createOwner).not.toHaveBeenCalled();
    expect(f.createCommand).not.toHaveBeenCalled(); expect(f.invalidate).not.toHaveBeenCalled();
    expect(f.work).toEqual({ pending: false });
  });

  it('uses the real shared service and lease with the selected command and awaited handoff', async test => {
    const f = fixture(test); await expect(f.run()).resolves.toEqual(f.completion);
    expect(f.read).toHaveBeenCalledTimes(2); expect(f.maintenanceLease.acquire).toHaveBeenCalledExactlyOnceWith('delete');
    expect(f.createOwner).toHaveBeenCalledOnce(); expect(f.createCommand).toHaveBeenCalledOnce();
    expect(f.createCommand.mock.calls[0]![0].beforeMetadata).toBe(f.beforeMetadata);
    expect(f.resume).toHaveBeenCalledOnce(); expect(f.owner.close).toHaveBeenCalledOnce();
    expect(f.owner.close.mock.invocationCallOrder[0]).toBeLessThan(f.release.mock.invocationCallOrder[0]!);
    expect(f.lease.readState()).toBe('idle'); expect(f.work).toEqual({ pending: false });
    expect(f.invalidate).not.toHaveBeenCalled(); expect(f.record).not.toHaveBeenCalled();
  });

  it('does not turn malformed deletion evidence into an absent ordinary path', async test => {
    const f = fixture(test), first = new Error('SYNTHETIC_MALFORMED_DELETION'); f.read.mockRejectedValueOnce(first);
    await expect(f.run()).rejects.toBe(first);
    expect(f.createCommand).not.toHaveBeenCalled(); expect(f.work.pending).toBe(false);
  });

  it('keeps main work pending until the actual owner close settles', async test => {
    const f = fixture(test), entered = f.hold(), held = f.hold();
    f.owner.close.mockImplementationOnce(async () => { entered.resolve(); await held.promise; });
    const task = f.run(); await entered.promise;
    expect(f.work.pending).toBe(true); expect(f.release).not.toHaveBeenCalled();
    expect(f.lease.readState()).toBe('busy'); held.resolve(); await task;
    expect(f.work.pending).toBe(false); expect(f.lease.readState()).toBe('idle');
  });

  it.for(['close', 'release'] as const)('invalidates physical main before ending pending work on %s failure', async (variant, test) => {
    const f = fixture(test), first = new Error('SYNTHETIC_TERMINAL_CLEANUP_FAILURE');
    if (variant === 'close') f.owner.close.mockRejectedValueOnce(first); else f.release.mockRejectedValueOnce(first);
    f.invalidate.mockImplementationOnce(() => { expect(f.work.pending).toBe(true); expect(f.work.uncertainty?.reason).toBe(first); });
    await expect(f.run()).rejects.toThrow();
    expect(f.invalidate).toHaveBeenCalledOnce(); expect(f.work.pending).toBe(false);
    expect(f.work.uncertainty?.reason).toBe(first); expect(f.lease.readState()).toBe('busy');
    if (variant === 'close') expect(f.release).not.toHaveBeenCalled();
    expect(f.record).toHaveBeenCalledWith(expect.objectContaining({ stage: 'deleteCleanup', sideEffectState: 'unknown' }));
  });

  it('keeps a command first cause distinct from close failure and never retries', async test => {
    const f = fixture(test), first = new Error('SYNTHETIC_COMMAND_FIRST'), cleanup = new Error('SYNTHETIC_CLOSE_SECOND');
    f.resume.mockRejectedValueOnce(first); f.owner.close.mockRejectedValueOnce(cleanup);
    const failure = await f.run().catch(cause => cause);
    expect(failure.cause).toMatchObject({ cause: first });
    expect(f.resume).toHaveBeenCalledOnce(); expect(f.read).toHaveBeenCalledTimes(2);
    expect(f.record).toHaveBeenCalledTimes(2); expect(f.work.uncertainty?.reason).toBe(cleanup);
    expect(f.invalidate).toHaveBeenCalledOnce();
  });

  it('refuses a second startup while the original one still owns work', async test => {
    const f = fixture(test), entered = f.hold(), held = f.hold();
    f.read.mockImplementationOnce(async () => { entered.resolve(); await held.promise; return undefined; });
    const first = f.run(); await entered.promise;
    await expect(f.run()).rejects.toThrow('WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED');
    expect(f.work.pending).toBe(true); expect(f.read).toHaveBeenCalledOnce();
    held.resolve(); await first; expect(f.work.pending).toBe(false);
  });
});

it('cold adapter binds both ports to the real service lifetime without replacing admission', async test => {
  const f = fixture(test), resume = f.resume.getMockImplementation()!;
  let retained: { assertReservationOwned(): Promise<void>; assertStableSelection(): Promise<void> } | undefined;
  f.resume.mockImplementationOnce(async (...args) => {
    retained = f.createCommand.mock.calls[0]![0].coldSelection;
    expect(retained).toBeDefined(); expect(f.owner.assertOwned).toHaveBeenCalled();
    expect(f.selection.assertSelected).toHaveBeenCalled(); expect(f.selection.revoke).toHaveBeenCalled();
    const raw = f.assertReservationOwned.mock.calls.length, full = f.owner.assertOwned.mock.calls.length;
    await retained!.assertReservationOwned();
    expect(f.assertReservationOwned).toHaveBeenCalledTimes(raw + 1); expect(f.owner.assertOwned).toHaveBeenCalledTimes(full);
    await retained!.assertStableSelection(); expect(f.owner.assertOwned).toHaveBeenCalledTimes(full + 1);
    return resume(...args);
  });
  await expect(f.run()).resolves.toEqual(f.completion);
  const raw = f.assertReservationOwned.mock.calls.length, full = f.owner.assertOwned.mock.calls.length;
  await expect(retained!.assertReservationOwned()).rejects.toThrow();
  await expect(retained!.assertStableSelection()).rejects.toThrow();
  expect(f.assertReservationOwned).toHaveBeenCalledTimes(raw); expect(f.owner.assertOwned).toHaveBeenCalledTimes(full);
  expect(f.lease.readState()).toBe('idle'); expect(f.work.pending).toBe(false);
});

it.for(['raw', 'full'] as const)('cold adapter checks service authority after held %s work', async (kind, test) => {
  const f = fixture(test), entered = f.hold(), release = f.hold();
  let selected: Promise<void> | undefined;
  f.resume.mockImplementationOnce(async () => {
    const pair = f.createCommand.mock.calls[0]![0].coldSelection!;
    const method = kind === 'raw' ? f.assertReservationOwned : f.owner.assertOwned;
    method.mockImplementationOnce(async () => { entered.resolve(); await release.promise; });
    selected = kind === 'raw' ? pair.assertReservationOwned() : pair.assertStableSelection();
    return await selected.then(() => { throw new Error('SYNTHETIC_PAIR_DID_NOT_RECHECK'); });
  });
  const work = f.run(); void work.catch(() => undefined); await entered.promise;
  expect(f.work.pending).toBe(true); expect(f.owner.close).not.toHaveBeenCalled(); expect(f.release).not.toHaveBeenCalled();
  f.invalidate(); release.resolve();
  await expect(selected!).rejects.toThrow('SYNTHETIC_MAIN_LOST'); await expect(work).rejects.toThrow();
  expect(f.owner.recordRemoved).not.toHaveBeenCalled(); expect(f.owner.close).toHaveBeenCalledOnce();
  expect(f.work.pending).toBe(false);
});

it('cold adapter captures the raw method before command collaborators replace the receipt', async test => {
  const f = fixture(test), resume = f.resume.getMockImplementation()!, unexpected = vi.fn(async (): Promise<never> => {
    throw new Error('SYNTHETIC_REPLACED_OWNER_PORT');
  });
  f.resume.mockImplementationOnce(async (...args) => {
    const result = f.createOwner.mock.results[0]!.value;
    result.assertReservationOwned = unexpected;
    await f.createCommand.mock.calls[0]![0].coldSelection!.assertReservationOwned();
    return resume(...args);
  });
  await expect(f.run()).resolves.toEqual(f.completion);
  expect(f.assertReservationOwned).toHaveBeenCalledOnce(); expect(unexpected).not.toHaveBeenCalled();
});
