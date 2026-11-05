import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi, type TestContext } from 'vitest';
import { deletionTestId, deletionTestJournal } from '../workspaces/deletion/workspaceDeletionDataTestSupport.js';
import * as phaseSelection from '../workspaces/deletion/workspaceDeletionPhaseSelection.js';
import * as originalSelection from '../workspaces/deletion/workspaceDeletionOriginalJournalSelection.js';
import { createSwitchRegistry } from '../workspaces/switch/workspaceSwitchTestSupport.js';
import * as externalSelection from '../workspaces/runtime/workspaceDeletionColdAdmission.js';
import { createWorkspaceDeletionColdContinuation } from './workspaceDeletionContinuation.js';

function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

// Controlled native ports; no filesystem mutation or process acceptance is implied.
function fixture(test: TestContext, phase: 'authorized' | 'registryPublished' = 'authorized') {
  let current = true;
  const jobs: Promise<unknown>[] = [], gates: ReturnType<typeof gate>[] = [];
  const journal = deletionTestJournal(phase), afterRegistry = { ...createSwitchRegistry(), formatVersion: 2 as const };
  const check = vi.fn((): undefined => { test.signal.throwIfAborted(); if (!current) throw new Error('SYNTHETIC_MAIN_LOST'); return undefined; });
  const owned = vi.fn(async () => { check(); }), writers = vi.fn(async () => { check(); });
  const phaseReceipt = { journal, afterRegistry, registryState: 'before' as const, registryNeedsRecovery: false,
    journalSlots: { current: undefined, backup: undefined, next: undefined },
    registrySlots: { current: undefined, backup: undefined, next: undefined }, assertCurrent: check,
    assertSelected: vi.fn(async () => { check(); }), assertExternalSelection: vi.fn(async () => { check(); }),
    assertJournalSelected: vi.fn(async () => { check(); }),
    async assertJournalReadOwned() { throw new Error('UNEXPECTED_TEST_READ_PORT'); }, revoke: vi.fn() };
  const externalReceipt = { buildAdmission: 'exactAcceptedBuild' as const, assertCurrent: check,
    assertSelected: vi.fn(async () => { check(); }), assertBuildSelected: vi.fn(async () => { check(); }),
    assertForeignAbsent: vi.fn(async () => { check(); }), revoke: vi.fn() };
  const originalReceipt = { userDataRoot: join(tmpdir(), 'eky-controlled-cold'), target: journal.target,
    proofs: [], assertSelected: vi.fn(async () => { check(); }), revoke: vi.fn() };
  const capturePhase = vi.spyOn(phaseSelection, 'captureWorkspaceDeletionPhaseSelection').mockResolvedValue(phaseReceipt);
  const captureExternal = vi.spyOn(externalSelection, 'captureWorkspaceDeletionExternalSelectionFromRoot').mockResolvedValue(externalReceipt);
  const captureOriginal = vi.spyOn(originalSelection, 'captureWorkspaceDeletionOriginalJournalContinuation').mockResolvedValue(originalReceipt);
  const time = '2026-10-25T12:00:00.000Z';
  const input = { userDataRoot: originalReceipt.userDataRoot, journal,
    buildInfo: { schemaVersion: 1 as const, appVersion: '0.2.81', buildRevision: 'a'.repeat(40), buildCreatedAt: time, buildDirty: false },
    releaseInfo: { schemaVersion: 1 as const, appIdentity: 'Eky' as const, appVersion: '0.2.81', msiProductVersion: '0.2.81',
      buildRevision: 'a'.repeat(40), platform: 'win32' as const, architecture: 'x64' as const,
      releaseChannel: 'pilot' as const, upgradeCode: deletionTestId(50) },
    assertCurrent: check, assertOwned: owned, assertWritersAbsent: writers };
  const result = createWorkspaceDeletionColdContinuation(input);
  test.onTestFinished(async () => {
    for (const held of gates) held.resolve();
    await Promise.allSettled(jobs);
    await result.owner.close().catch(() => undefined);
    vi.restoreAllMocks();
  });
  const track = <T>(work: () => Promise<T>) => { const job = work(); jobs.push(job); return job; };
  return { ...result, input, journal, check, owned, writers, phaseReceipt, externalReceipt, originalReceipt,
    capturePhase, captureExternal, captureOriginal, run: track,
    hold() { const held = gate(); gates.push(held); return held; },
    loseMain() { current = false; }, restoreMain() { current = true; },
    terminal: () => ({ status: 'removed', journal: { ...journal, phase: 'registryPublished' } }),
  };
}

describe('main cold deletion continuation owner', () => {
  it('constructs without I/O and initializes only once under owned guards', async test => {
    const f = fixture(test);
    expect(f.capturePhase).not.toHaveBeenCalled(); expect(f.owned).not.toHaveBeenCalled();
    await f.run(() => f.owner.assertOwned()); await f.run(() => f.owner.assertOwned());
    expect(f.capturePhase).toHaveBeenCalledOnce(); expect(f.captureExternal).toHaveBeenCalledOnce();
    expect(f.captureOriginal).toHaveBeenCalledOnce(); expect(f.phaseReceipt.revoke).toHaveBeenCalledOnce();
    const originalGuard = f.captureOriginal.mock.calls[0]![3];
    const phaseCalls = f.phaseReceipt.assertSelected.mock.calls.length;
    await f.run(() => originalGuard.assertExternalSelection());
    expect(f.phaseReceipt.assertSelected).toHaveBeenCalledTimes(phaseCalls);
    expect(f.originalReceipt.revoke).not.toHaveBeenCalled();
  });

  it('retains the admitted build/foreign/original cadence without nested full external passes', async test => {
    const f = fixture(test); await f.run(() => f.owner.assertOwned());
    const order: string[] = [];
    f.externalReceipt.assertSelected.mockImplementation(async () => { order.push('full'); });
    f.externalReceipt.assertBuildSelected.mockImplementation(async () => { order.push('build'); });
    f.externalReceipt.assertForeignAbsent.mockImplementation(async () => { order.push('foreign'); });
    f.originalReceipt.assertSelected.mockImplementation(async () => { order.push('original'); });
    await f.run(() => f.owner.assertOwned());
    expect(order).toEqual(['build', 'foreign', 'original', 'foreign', 'build']);
    order.length = 0; await f.run(f.beforeMetadata);
    expect(order).toEqual(['build', 'foreign', 'original', 'foreign', 'build']);
    order.length = 0; await f.run(() => f.owner.assertOwned());
    expect(order).toEqual(['build', 'foreign', 'foreign', 'build']);
  });

  it.for(['authorized', 'registryPublished'] as const)('finishes the original proof before %s metadata or finalization', async (phase, test) => {
    const f = fixture(test, phase);
    await f.run(() => f.owner.assertOwned());
    const reads = f.originalReceipt.assertSelected.mock.calls.length;
    await f.run(f.beforeMetadata);
    expect(f.originalReceipt.assertSelected).toHaveBeenCalledTimes(reads + 1);
    expect(f.originalReceipt.revoke).toHaveBeenCalledOnce();
    await f.run(() => f.owner.assertOwned());
    expect(f.originalReceipt.assertSelected).toHaveBeenCalledTimes(reads + 1);
    expect(f.owner.recordRemoved(f.terminal())).toEqual({ formatVersion: 1, status: 'completed', navigation: 'selector' });
    expect(f.owner.assertCurrent()).toBeUndefined();
    const closing = f.owner.close(); expect(f.owner.close()).toBe(closing); await closing;
    expect(f.externalReceipt.revoke).toHaveBeenCalledOnce(); expect(f.originalReceipt.revoke).toHaveBeenCalledOnce();
    expect(() => f.owner.assertCurrent()).toThrow();
  });

  it('awaits a held final original read before granting metadata authority', async test => {
    const f = fixture(test); await f.run(() => f.owner.assertOwned());
    const entered = f.hold(), release = f.hold();
    f.originalReceipt.assertSelected.mockImplementationOnce(async () => { entered.resolve(); await release.promise; });
    let settled = false;
    const work = f.run(f.beforeMetadata).finally(() => { settled = true; });
    await entered.promise;
    expect(settled).toBe(false); expect(f.originalReceipt.revoke).not.toHaveBeenCalled();
    release.resolve(); await work;
    expect(f.originalReceipt.revoke).toHaveBeenCalledOnce();
    expect(f.owner.recordRemoved(f.terminal()).status).toBe('completed');
  });

  it('retains a changed original proof and forbids later authority or a terminal receipt', async test => {
    const f = fixture(test); await f.run(() => f.owner.assertOwned());
    const first = new Error('SYNTHETIC_ORIGINAL_CHANGED');
    f.originalReceipt.assertSelected.mockRejectedValueOnce(first);
    await expect(f.run(f.beforeMetadata)).rejects.toBe(first);
    expect(() => f.owner.assertCurrent()).toThrow(first);
    await expect(f.run(() => f.owner.assertOwned())).rejects.toBe(first);
    expect(() => f.owner.recordRemoved(f.terminal())).toThrow(first);
    await f.owner.close();
    expect(f.originalReceipt.revoke).toHaveBeenCalledOnce();
  });

  it('excludes a reentrant read before invoking the handoff admission guard', async test => {
    const f = fixture(test); await f.run(() => f.owner.assertOwned());
    const held = f.hold(); let entered = false, nested: Promise<void> | undefined;
    f.originalReceipt.assertSelected.mockImplementationOnce(async () => { entered = true; await held.promise; });
    f.check.mockImplementationOnce(() => undefined).mockImplementationOnce(() => {
      nested = f.run(() => f.owner.assertOwned()); void nested.catch(() => undefined);
    });
    const handoff = f.run(f.beforeMetadata); void handoff.catch(() => undefined);
    // Release only for deterministic cleanup if the exclusion regresses.
    await Promise.resolve(); held.resolve();
    await expect(handoff).rejects.toThrow('WORKSPACE_DELETE_OWNERSHIP_UNCERTAIN');
    expect(nested).toBeDefined(); await expect(nested!).rejects.toThrow('WORKSPACE_DELETE_OWNERSHIP_UNCERTAIN');
    expect(entered).toBe(false); expect(f.originalReceipt.revoke).not.toHaveBeenCalled();
    expect(() => f.owner.recordRemoved(f.terminal())).toThrow();
  });

  it('joins an original read and revokes a late receipt before close can settle', async test => {
    const f = fixture(test), entered = f.hold(), release = f.hold();
    f.captureOriginal.mockImplementationOnce(async () => { entered.resolve(); await release.promise; return f.originalReceipt; });
    const work = f.run(() => f.owner.assertOwned());
    const rejected = expect(work).rejects.toThrow();
    await entered.promise;
    const closing = f.owner.close();
    const closed = expect(closing).rejects.toThrow('WORKSPACE_DELETION_CLOSE_FAILED');
    let settled = false; void closing.then(() => { settled = true; }, () => { settled = true; });
    await Promise.resolve(); expect(settled).toBe(false);
    expect(f.externalReceipt.revoke).toHaveBeenCalledOnce(); expect(f.originalReceipt.revoke).not.toHaveBeenCalled();
    release.resolve(); await rejected; await closed;
    expect(f.originalReceipt.revoke).toHaveBeenCalledOnce(); expect(f.phaseReceipt.revoke).toHaveBeenCalledOnce();
    expect(f.owner.close()).toBe(closing);
  });

  it('closes a newly returned receipt after main ownership is lost without reviving', async test => {
    const f = fixture(test);
    f.captureExternal.mockImplementationOnce(async () => { f.loseMain(); return f.externalReceipt; });
    await expect(f.run(() => f.owner.assertOwned())).rejects.toThrow('SYNTHETIC_MAIN_LOST');
    f.restoreMain(); expect(() => f.owner.assertCurrent()).toThrow('SYNTHETIC_MAIN_LOST');
    await f.owner.close();
    expect(f.phaseReceipt.revoke).toHaveBeenCalledOnce(); expect(f.externalReceipt.revoke).toHaveBeenCalledOnce();
    expect(f.captureOriginal).not.toHaveBeenCalled();
  });

  it('rejects a different selected phase before capturing any external authority', async test => {
    const f = fixture(test);
    f.capturePhase.mockResolvedValueOnce({ ...f.phaseReceipt, journal: deletionTestJournal('purged') });
    await expect(f.run(() => f.owner.assertOwned())).rejects.toThrow('WORKSPACE_DELETE_OWNERSHIP_UNCERTAIN');
    await f.owner.close();
    expect(f.phaseReceipt.revoke).toHaveBeenCalledOnce(); expect(f.captureExternal).not.toHaveBeenCalled();
  });

  it('keeps a failed revoke as cleanup uncertainty while attempting the other owners', async test => {
    const f = fixture(test); await f.run(() => f.owner.assertOwned());
    const first = new Error('SYNTHETIC_REVOKE_FAILED');
    f.originalReceipt.revoke.mockImplementationOnce(() => { throw first; });
    await expect(f.run(f.beforeMetadata)).rejects.toBe(first);
    const closing = f.owner.close();
    await expect(closing).rejects.toMatchObject({ cause: first });
    expect(f.owner.close()).toBe(closing); expect(f.originalReceipt.revoke).toHaveBeenCalledOnce();
    expect(f.externalReceipt.revoke).toHaveBeenCalledOnce();
  });

  it.for(['beforeInitialization', 'beforeHandoff', 'duplicateHandoff', 'duplicateReceipt', 'binding', 'extra', 'phase'] as const)(
    'rejects an invalid transition or terminal receipt (%s)', async (variant, test) => {
      const f = fixture(test);
      if (variant === 'beforeInitialization') {
        await expect(f.run(f.beforeMetadata)).rejects.toThrow(); expect(f.capturePhase).not.toHaveBeenCalled(); return;
      }
      await f.run(() => f.owner.assertOwned());
      if (variant === 'beforeHandoff') { expect(() => f.owner.recordRemoved(f.terminal())).toThrow(); return; }
      await f.run(f.beforeMetadata);
      if (variant === 'duplicateHandoff') { await expect(f.run(f.beforeMetadata)).rejects.toThrow(); return; }
      if (variant === 'duplicateReceipt') {
        f.owner.recordRemoved(f.terminal()); expect(() => f.owner.recordRemoved(f.terminal())).toThrow(); return;
      }
      const value = f.terminal();
      expect(() => f.owner.recordRemoved({ ...value, ...(variant === 'extra' ? { extra: true } : {}), journal: {
        ...value.journal, ...(variant === 'binding' ? { registryAfterSha256: 'f'.repeat(64) } : {}),
        ...(variant === 'phase' ? { phase: 'purged' } : {}),
      } })).toThrow();
    });

  it('rejects a swallowed nested failure during the final synchronous main check', async test => {
    const f = fixture(test); await f.run(() => f.owner.assertOwned()); await f.run(f.beforeMetadata);
    f.check.mockImplementationOnce(() => { try { f.owner.recordRemoved(f.terminal()); } catch { /* Deliberate swallowed reentry. */ } });
    expect(() => f.owner.recordRemoved(f.terminal())).toThrow('WORKSPACE_DELETE_OWNERSHIP_UNCERTAIN');
    expect(() => f.owner.assertCurrent()).toThrow('WORKSPACE_DELETE_OWNERSHIP_UNCERTAIN');
  });

  it('captures input and callbacks before collaborators can replace them', async test => {
    const f = fixture(test), unexpected = vi.fn((): never => { throw new Error('SYNTHETIC_REPLACED_CALLBACK'); });
    f.input.journal = deletionTestJournal('purged'); f.input.assertCurrent = unexpected;
    f.input.assertOwned = unexpected; f.input.assertWritersAbsent = unexpected;
    f.input.buildInfo.buildRevision = 'b'.repeat(40);
    await f.run(() => f.owner.assertOwned());
    expect(f.capturePhase.mock.calls[0]![0].expectedBinding).toEqual(f.journal);
    expect(f.captureExternal.mock.calls[0]![0].buildInfo.buildRevision).toBe('a'.repeat(40));
    expect(unexpected).not.toHaveBeenCalled();
  });
});

describe('cold deletion reservation and content guards', () => {
  it('separates physical work from full content reads without changing the full proof', async test => {
    const f = fixture(test); await f.run(() => f.owner.assertOwned());
    const counts = () => [f.externalReceipt.assertBuildSelected.mock.calls.length,
      f.externalReceipt.assertForeignAbsent.mock.calls.length, f.originalReceipt.assertSelected.mock.calls.length] as const;
    const before = counts(), owned = f.owned.mock.calls.length, writers = f.writers.mock.calls.length;
    for (let index = 0; index < 16; index++) await f.run(f.assertReservationOwned);
    expect(counts()).toEqual(before);
    expect(f.owned).toHaveBeenCalledTimes(owned + 32); expect(f.writers).toHaveBeenCalledTimes(writers + 16);
    await f.run(() => f.owner.assertOwned());
    expect(counts()).toEqual([before[0] + 2, before[1] + 2, before[2] + 1]);
    expect(f.capturePhase).toHaveBeenCalledOnce(); expect(f.captureOriginal).toHaveBeenCalledOnce();
  });

  it('rejects raw work before initialization and retains that first failure', async test => {
    const f = fixture(test);
    const first = await f.run(f.assertReservationOwned).catch(error => error);
    expect(first).toBeInstanceOf(Error);
    await expect(f.run(() => f.owner.assertOwned())).rejects.toBe(first);
    expect(f.capturePhase).not.toHaveBeenCalled(); expect(f.owned).not.toHaveBeenCalled();
  });

  it('rejects raw work while initialization is still reading', async test => {
    const f = fixture(test), entered = f.hold(), release = f.hold();
    f.captureOriginal.mockImplementationOnce(async () => { entered.resolve(); await release.promise; return f.originalReceipt; });
    const initializing = f.run(() => f.owner.assertOwned()); void initializing.catch(() => undefined);
    await entered.promise;
    const first = await f.run(f.assertReservationOwned).catch(error => error);
    release.resolve(); await expect(initializing).rejects.toBe(first);
    expect(f.originalReceipt.revoke).not.toHaveBeenCalled();
    await f.owner.close(); expect(f.originalReceipt.revoke).toHaveBeenCalledOnce();
  });

  it.for(['owned', 'writers'] as const)('joins held raw %s work before close settles', async (port, test) => {
    const f = fixture(test); await f.run(() => f.owner.assertOwned());
    const entered = f.hold(), release = f.hold();
    f[port].mockImplementationOnce(async () => { entered.resolve(); await release.promise; });
    const pending = f.run(f.assertReservationOwned); void pending.catch(() => undefined);
    await entered.promise;
    const closing = f.owner.close(); void closing.catch(() => undefined);
    let settled = false; void closing.then(() => { settled = true; }, () => { settled = true; });
    await Promise.resolve(); expect(settled).toBe(false); expect(f.owner.close()).toBe(closing);
    release.resolve(); await expect(pending).rejects.toThrow('WORKSPACE_DELETE_OWNERSHIP_UNCERTAIN');
    await expect(closing).rejects.toThrow('WORKSPACE_DELETION_CLOSE_FAILED');
    expect(f.originalReceipt.revoke).toHaveBeenCalledOnce(); expect(f.externalReceipt.revoke).toHaveBeenCalledOnce();
  });

  it.for(['owned', 'writers'] as const)('burns raw and full authority after a %s failure', async (port, test) => {
    const f = fixture(test); await f.run(() => f.owner.assertOwned());
    const first = new Error('SYNTHETIC_PRIVATE_RAW_FAILURE'); f[port].mockRejectedValueOnce(first);
    await expect(f.run(f.assertReservationOwned)).rejects.toBe(first);
    await expect(f.run(f.assertReservationOwned)).rejects.toBe(first);
    await expect(f.run(() => f.owner.assertOwned())).rejects.toBe(first);
    expect(() => f.owner.recordRemoved(f.terminal())).toThrow(first);
  });

  it('retains the raw first failure separately from a later close failure', async test => {
    const f = fixture(test); await f.run(() => f.owner.assertOwned());
    const entered = f.hold(), release = f.hold(), first = new Error('SYNTHETIC_PRIVATE_RAW_FIRST');
    const cleanup = new Error('SYNTHETIC_PRIVATE_CLOSE_SECOND');
    f.owned.mockImplementationOnce(async () => { entered.resolve(); await release.promise; throw first; });
    const pending = f.run(f.assertReservationOwned); void pending.catch(() => undefined);
    await entered.promise; f.originalReceipt.revoke.mockImplementationOnce(() => { throw cleanup; });
    const closing = f.owner.close(); void closing.catch(() => undefined);
    release.resolve(); await expect(pending).rejects.toBe(first);
    await expect(closing).rejects.toMatchObject({ cause: cleanup, errors: expect.arrayContaining([first, cleanup]) });
    await expect(f.run(f.assertReservationOwned)).rejects.toBe(first);
    expect(f.externalReceipt.revoke).toHaveBeenCalledOnce();
  });

  it('excludes raw reentry during metadata handoff before a new I/O task starts', async test => {
    const f = fixture(test); await f.run(() => f.owner.assertOwned());
    let nested: Promise<void> | undefined;
    f.check.mockImplementationOnce(() => undefined).mockImplementationOnce(() => {
      nested = f.run(f.assertReservationOwned); void nested.catch(() => undefined);
    });
    const before = f.owned.mock.calls.length;
    await expect(f.run(f.beforeMetadata)).rejects.toThrow('WORKSPACE_DELETE_OWNERSHIP_UNCERTAIN');
    expect(nested).toBeDefined(); await expect(nested!).rejects.toThrow('WORKSPACE_DELETE_OWNERSHIP_UNCERTAIN');
    expect(f.owned).toHaveBeenCalledTimes(before); expect(f.originalReceipt.revoke).not.toHaveBeenCalled();
  });

  it('does not give metadata handoff or terminal authority to the raw proof', async test => {
    const f = fixture(test); await f.run(() => f.owner.assertOwned()); await f.run(f.assertReservationOwned);
    expect(() => f.owner.recordRemoved(f.terminal())).toThrow('WORKSPACE_DELETE_OWNERSHIP_UNCERTAIN');
  });

  it('allows repeated raw work but rejects it after terminal publication', async test => {
    const f = fixture(test); await f.run(() => f.owner.assertOwned()); await f.run(f.beforeMetadata);
    await f.run(f.assertReservationOwned); await f.run(f.assertReservationOwned);
    f.owner.recordRemoved(f.terminal());
    await expect(f.run(f.assertReservationOwned)).rejects.toThrow('WORKSPACE_DELETE_OWNERSHIP_UNCERTAIN');
  });
});

it('rechecks physical ownership after the writer check without content reads', async test => {
  const f = fixture(test); await f.run(() => f.owner.assertOwned());
  let physical = true;
  const first = new Error('SYNTHETIC_PHYSICAL_LOST_AFTER_WRITER_CHECK'), order: string[] = [];
  const before = f.externalReceipt.assertBuildSelected.mock.calls.length;
  f.owned.mockImplementation(async () => { order.push('physical'); if (!physical) throw first; });
  f.writers.mockImplementation(async () => { order.push('writers'); physical = false; });
  await expect(f.run(f.assertReservationOwned)).rejects.toBe(first);
  expect(order).toEqual(['physical', 'writers', 'physical']);
  expect(f.externalReceipt.assertBuildSelected).toHaveBeenCalledTimes(before);
  expect(() => f.owner.assertCurrent()).toThrow(first);
});

it('drains held raw work after a concurrent full failure is already latched', async test => {
  const f = fixture(test); await f.run(() => f.owner.assertOwned());
  const entered = f.hold(), release = f.hold(), first = new Error('SYNTHETIC_FULL_FAILURE_BEFORE_CLOSE');
  const cleanup = new Error('SYNTHETIC_REVOKE_AFTER_FIRST_FAILURE');
  f.owned.mockImplementationOnce(async () => { entered.resolve(); await release.promise; });
  const raw = f.run(f.assertReservationOwned); void raw.catch(() => undefined); await entered.promise;
  f.originalReceipt.assertSelected.mockRejectedValueOnce(first);
  await expect(f.run(() => f.owner.assertOwned())).rejects.toBe(first);
  expect(() => f.owner.assertCurrent()).toThrow(first);
  f.originalReceipt.revoke.mockImplementationOnce(() => { throw cleanup; });
  const closing = f.owner.close(); void closing.catch(() => undefined);
  let settled = false; void closing.then(() => { settled = true; }, () => { settled = true; });
  await Promise.resolve(); expect(settled).toBe(false);
  release.resolve(); await expect(raw).rejects.toBe(first);
  await expect(closing).rejects.toMatchObject({ cause: cleanup, errors: expect.arrayContaining([first, cleanup]) });
  await expect(f.run(f.assertReservationOwned)).rejects.toBe(first);
  expect(f.externalReceipt.revoke).toHaveBeenCalledOnce();
});
