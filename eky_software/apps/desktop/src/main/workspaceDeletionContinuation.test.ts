import { describe, expect, it, vi } from 'vitest';
import { captureWorkspaceDeletionJournal } from '../workspaces/deletion/workspaceDeletionJournalCodec.js';
import { validateWorkspaceId } from '../workspaces/registry/workspaceIdValidation.js';
import { bindWorkspaceDeletionContinuation, createWorkspaceDeletionResultRuntime,
  type WorkspaceDeletionMainCommand } from './workspaceDeletionContinuation.js';
import { InMemoryWorkspaceMaintenanceLease } from '../workspaces/maintenance/workspaceMaintenanceLease.js';
import { DeferredWorkspaceRuntimeRelaunch } from '../workspaces/runtime/deferredWorkspaceRuntimeRelaunch.js';
import { WorkspaceManagementError } from '../workspaces/management/workspaceManagementError.js';
import type { WorkspaceDeletionExecutionStage } from '../workspaces/management/workspaceManagementService.js';

const operationId = '11111111-1111-4111-8111-111111111111';
const workspaceId = validateWorkspaceId('22222222-2222-4222-8222-222222222222');
const otherWorkspaceId = validateWorkspaceId('33333333-3333-4333-8333-333333333333');

describe('main-only deletion terminal binding', () => {
  it.each([workspaceId, otherWorkspaceId, null])('seals only the active target (%s)', async activeWorkspaceId => {
    const f = fixture(activeWorkspaceId);
    await f.publish();
    expect(f.seal).toHaveBeenCalledTimes(activeWorkspaceId === workspaceId ? 1 : 0);
    expect(f.removed).not.toHaveBeenCalled();
    const owner = f.binding.continuation.captureAuthority(operationId, f.assertLease);
    expect(owner.recordRemoved(f.receipt())).toEqual({ formatVersion: 1, status: 'completed',
      navigation: activeWorkspaceId === otherWorkspaceId ? 'reopenPrevious' : 'selector' });
    expect(f.removed).toHaveBeenCalledTimes(activeWorkspaceId === workspaceId ? 1 : 0);
    expect(() => owner.recordRemoved(f.receipt())).toThrow();
  });

  it('joins an already started marker write and rechecks ownership before publication', async () => {
    const f = fixture();
    let finish!: () => void;
    const gate = new Promise<void>(resolve => { finish = resolve; });
    f.seal.mockImplementationOnce(async () => { await gate; });
    const publishing = f.publish();
    expect(f.seal).toHaveBeenCalledOnce();
    expect(f.command.publish).not.toHaveBeenCalled();
    f.revoke(); finish();
    await expect(publishing).rejects.toThrow();
    expect(f.command.publish).not.toHaveBeenCalled();
    expect(f.removed).not.toHaveBeenCalled();
  });

  it.each(['operation', 'target', 'root', 'registry', 'phase'] as const)('rejects a foreign publication: %s', async changed => {
    const f = fixture();
    f.command.publish.mockImplementationOnce(async () => ({ journal: captureWorkspaceDeletionJournal({ ...f.journal,
      ...(changed === 'operation' ? { target: { ...f.journal.target, operationId: '44444444-4444-4444-8444-444444444444' } } : {}),
      ...(changed === 'target' ? { target: { ...f.journal.target, workspaceId: otherWorkspaceId } } : {}),
      ...(changed === 'registry' ? { registryBeforeSha256: 'f'.repeat(64) } : {}),
      ...(changed === 'phase' ? { phase: 'registryPublished' } : {}),
    }), workspaceRootIdentity: changed === 'root' ? '0'.repeat(64) : f.target.rootIdentity }));
    await expect(f.publish()).rejects.toThrow();
    expect(() => f.binding.continuation.captureAuthority(operationId, f.assertLease)).toThrow();
  });

  it.each(['shutdown', 'lease', 'reentry', 'changedBinding', 'extraField', 'nonterminal'] as const)(
    'rejects an invalid final receipt: %s', async changed => {
      const f = fixture(); await f.publish();
      const owner = f.binding.continuation.captureAuthority(operationId, f.assertLease);
      if (changed === 'shutdown') f.revoke();
      if (changed === 'lease') f.assertLease.mockImplementation(() => { throw new Error('SYNTHETIC_FOREIGN_LEASE'); });
      if (changed === 'reentry') f.assertLease.mockImplementation(() => { f.revoke(); });
      const receipt = f.receipt();
      await expect(Promise.resolve().then(() => owner.recordRemoved({ ...receipt,
        ...(changed === 'extraField' ? { extra: true } : {}),
        journal: { ...receipt.journal,
          ...(changed === 'changedBinding' ? { registryAfterSha256: '0'.repeat(64) } : {}),
          ...(changed === 'nonterminal' ? { phase: 'purged' } : {}),
        },
      }))).rejects.toThrow();
      expect(f.removed).not.toHaveBeenCalled();
    });

  it('captures publisher and consumer methods before collaborators can replace them', async () => {
    const f = fixture();
    const unexpected = vi.fn((): never => { throw new Error('SYNTHETIC_FOREIGN_CALLBACK'); });
    f.command.publish = unexpected;
    f.command.resume = unexpected;
    await f.publish();
    const owner = f.binding.continuation.captureAuthority(operationId, f.assertLease);
    const authority = { ...owner, recordRemoved(value: unknown) { owner.recordRemoved(value); } };
    await f.binding.continuation.resume(operationId, authority);
    expect(unexpected).not.toHaveBeenCalled();
  });

  it.each(['runtime', 'recoveryManagement'] as const)('forwards the live stage observer unchanged as the third bound resume argument in %s', async kind => {
    const f = kind === 'runtime' ? fixture() : recoveryTerminalFixture();
    await f.publish();
    const owner = f.binding.continuation.captureAuthority(operationId, f.assertLease);
    const authority = { ...owner, recordRemoved(value: unknown) { owner.recordRemoved(value); } };
    const observeStage = vi.fn<(stage: WorkspaceDeletionExecutionStage) => void>();
    await expect(f.binding.continuation.resume(operationId, authority, observeStage)).resolves.toEqual({
      formatVersion: 1, status: 'completed', navigation: 'selector',
    });
    expect(f.command.resume).toHaveBeenCalledExactlyOnceWith(operationId, authority, observeStage);
    expect(observeStage).not.toHaveBeenCalled();
    expect(f.removed).toHaveBeenCalledTimes(kind === 'runtime' ? 1 : 0);
  });

  it('forwards the original preparation selection independently of the full publication check', async () => {
    const f = fixture();
    await f.publish();
    expect(f.command.publish.mock.calls[0]).toHaveLength(5);
    expect(f.command.publish.mock.calls[0]![4]).toBe(f.assertPreparationCurrent);
    await f.command.publish.mock.calls[0]![4]();
    f.revoke();
    await expect(f.command.publish.mock.calls[0]![4]()).rejects.toThrow('SYNTHETIC_MAIN_REVOKED');
  });

  it.each(['runtime', 'recoveryManagement'] as const)('forwards the optional preparation read owner unchanged in %s', async kind => {
    const f = kind === 'runtime' ? fixture() : recoveryTerminalFixture();
    const readOwned = vi.fn(f.assertPreparationCurrent);
    await f.binding.publish(f.assertLease, f.assertPreparationCurrent, f.target,
      { operationId, target: f.target, backupDisposition: 'explicitDataLoss' }, f.assertPreparationCurrent, readOwned);
    const args = f.command.publish.mock.calls[0]!;
    expect(args).toHaveLength(6);
    expect(args[4]).toBe(f.assertPreparationCurrent);
    expect(args[5]).toBe(readOwned);
    expect(readOwned).not.toHaveBeenCalled();
    await args[5]!();
    f.revoke();
    await expect(args[5]!()).rejects.toThrow('SYNTHETIC_MAIN_REVOKED');
  });

  it('forwards the recovery-only current proof as the seventh publication argument', async () => {
    const f = recoveryTerminalFixture();
    const readOwned = vi.fn(f.assertPreparationCurrent);
    const readCurrent = vi.fn();
    await f.binding.publish(f.assertLease, f.assertPreparationCurrent, f.target,
      { operationId, target: f.target, backupDisposition: 'explicitDataLoss' },
      f.assertPreparationCurrent, readOwned, readCurrent);
    const args = f.command.publish.mock.calls[0]!;
    expect(args).toHaveLength(7);
    expect(args[5]).toBe(readOwned);
    expect(args[6]).toBe(readCurrent);
    expect(readCurrent).not.toHaveBeenCalled();
  });

  it('rejects a recovery-only current proof from an ordinary runtime before publication', async () => {
    const f = fixture();
    await expect(f.binding.publish(f.assertLease, f.assertPreparationCurrent, f.target,
      { operationId, target: f.target, backupDisposition: 'explicitDataLoss' },
      f.assertPreparationCurrent, f.assertPreparationCurrent, () => undefined))
      .rejects.toThrow('WORKSPACE_DELETE_OWNERSHIP_UNCERTAIN');
    expect(f.command.publish).not.toHaveBeenCalled();
  });

  it('rejects nested terminal delivery from the final lease guard', async () => {
    const f = fixture(); await f.publish();
    const owner = f.binding.continuation.captureAuthority(operationId, f.assertLease);
    const nestedFailures: unknown[] = [];
    f.assertLease.mockImplementationOnce(() => {
      try { owner.recordRemoved(f.receipt()); }
      catch (error) { nestedFailures.push(error); }
    });
    owner.recordRemoved(f.receipt());
    expect(nestedFailures).toHaveLength(1);
    expect(f.removed).toHaveBeenCalledOnce();
  });
});

describe('main-only deletion result runtime', () => {
  const completed = Object.freeze({ formatVersion: 1 as const, status: 'completed' as const, navigation: 'selector' as const });

  it.each(['available', 'stopped', 'unavailable'] as const)('projects a proven no-effect failure against the actual %s runtime', state => {
    const f = resultRuntimeFixture(state);
    const original = new WorkspaceManagementError('WORKSPACE_MANAGEMENT_BUSY', 'delete');
    expect(f.runtime.projectFailure({ cause: original, sideEffectState: 'none' })).toEqual({
      formatVersion: 1, status: 'failed', errorCode: original.code, sideEffectState: 'none',
      nextAction: state === 'available' ? 'continue' : 'restartRequired',
    });
    expect(f.absent).not.toHaveBeenCalled(); expect(f.owned).not.toHaveBeenCalled();
    expect(f.relaunch).not.toHaveBeenCalled();
  });

  it('never reports no effect for unknown work or infers a safe code from a raw message', () => {
    const f = resultRuntimeFixture('available');
    const original = new Error('WORKSPACE_MANAGEMENT_BUSY synthetic original private detail');
    f.state.current = false;
    const result = f.runtime.projectFailure({ cause: original, sideEffectState: 'unknown' });
    expect(result).toEqual({ formatVersion: 1, status: 'recoveryRequired', errorCode: 'WORKSPACE_DELETE_FAILED',
      sideEffectState: 'unknown', nextAction: 'restartRequired' });
    expect(JSON.stringify(result)).not.toMatch(/synthetic|private|cause|message|stack/);
    expect(f.absent).not.toHaveBeenCalled(); expect(f.owned).not.toHaveBeenCalled();
    expect(f.relaunch).not.toHaveBeenCalled();
  });

  it('does not turn an unresolved ownership guard into a usable runtime because deletion had no effect', () => {
    const f = resultRuntimeFixture('available');
    const original = new WorkspaceManagementError('WORKSPACE_DELETE_OWNERSHIP_UNCERTAIN', 'delete');
    expect(f.runtime.projectFailure({ cause: original, sideEffectState: 'none' })).toEqual({
      formatVersion: 1, status: 'failed', errorCode: original.code,
      sideEffectState: 'none', nextAction: 'restartRequired',
    });
    expect(f.absent).not.toHaveBeenCalled(); expect(f.owned).not.toHaveBeenCalled();
    expect(f.relaunch).not.toHaveBeenCalled();
  });

  it('keeps the original error before a separate current-state failure', () => {
    const f = resultRuntimeFixture('available');
    const original = new WorkspaceManagementError('WORKSPACE_MANAGEMENT_BUSY', 'delete');
    f.state.current = false;
    let failure: unknown;
    try { f.runtime.projectFailure({ cause: original, sideEffectState: 'none' }); }
    catch (error) { failure = error; }
    expect(failure).toMatchObject({ code: original.code, operationKind: 'delete' });
    const causes = (failure as Error).cause as AggregateError;
    expect(causes.cause).toBe(original);
    expect(causes.errors[0]).toBe(original);
    expect(causes.errors[1]).toBe(f.revoked);
    expect(f.relaunch).not.toHaveBeenCalled();
  });

  it.each(['available', 'stopped', 'unavailable'] as const)('observes %s without granting mutation or restart authority', state => {
    const f = resultRuntimeFixture(state);
    if (state === 'available') f.main.mockImplementation(() => { throw new Error('SYNTHETIC_BACKEND_OWNS_RESERVATION'); });
    expect(f.runtime.readNextAction()).toBe(state === 'available' ? 'continue' : 'restartRequired');
    expect(f.main).toHaveBeenCalledTimes(state === 'stopped' ? 1 : 0);
    expect(f.owned).not.toHaveBeenCalled();
    expect(f.absent).not.toHaveBeenCalled();
    expect(f.relaunch).not.toHaveBeenCalled();
  });

  it('requires main ownership for a stopped runtime instead of relying on its state observation', async () => {
    const f = resultRuntimeFixture();
    const first = new Error('SYNTHETIC_STOPPED_MAIN_LOST');
    f.main.mockImplementation(() => { throw first; });
    expect(() => f.runtime.readNextAction()).toThrow(first);
    await expect(f.runtime.complete(completed)).rejects.toBe(first);
    expect(f.owned).not.toHaveBeenCalled();
    expect(f.relaunch).not.toHaveBeenCalled();
  });

  it('does not report continuation while another maintenance operation is still held', async () => {
    const f = resultRuntimeFixture('available');
    const lease = await f.lease.acquire('backup');
    try { expect(f.runtime.readNextAction()).toBe('restartRequired'); }
    finally { await lease.release(); }
  });

  it('does not turn a requested or rejected relaunch into a dispatched return', () => {
    const f = resultRuntimeFixture();
    f.relaunchOwner.request();
    expect(f.runtime.readNextAction()).toBe('restartRequired');
    expect(() => f.relaunchOwner.complete(() => { throw new Error('SYNTHETIC_RETURN_REJECTED'); })).toThrow();
    expect(f.runtime.readNextAction()).toBe('restartRequired');
    expect(f.relaunch).not.toHaveBeenCalled();
  });

  it('requests return only after fresh absence and physical main ownership, once', async () => {
    const f = resultRuntimeFixture();
    await f.runtime.complete(completed);
    expect(f.events).toEqual(['absent', 'owned', 'relaunch']);
    expect(f.relaunchOwner.hasDispatched()).toBe(true);
    expect(f.runtime.readNextAction()).toBe('relaunching');
    await expect(f.runtime.complete(completed)).rejects.toThrow('WORKSPACE_DELETE_OWNERSHIP_UNCERTAIN');
    expect(f.relaunch).toHaveBeenCalledOnce();
  });

  it.each(['absence', 'ownership'] as const)('rejects main-owner loss during the awaited %s proof without retry', async stage => {
    const f = resultRuntimeFixture();
    let enter!: () => void, finish!: () => void;
    const entered = new Promise<void>(resolve => { enter = resolve; });
    const held = new Promise<void>(resolve => { finish = resolve; });
    (stage === 'absence' ? f.absent : f.owned).mockImplementationOnce(async () => { enter(); await held; });
    const outcome = f.runtime.complete(completed).then(value => ({ value }), error => ({ error }));
    try {
      await entered;
      expect(f.relaunch).not.toHaveBeenCalled();
      f.state.current = false;
      finish();
      expect(await outcome).toMatchObject({ error: f.revoked });
      f.state.current = true;
      await expect(f.runtime.complete(completed)).rejects.toThrow('WORKSPACE_DELETE_OWNERSHIP_UNCERTAIN');
      expect(f.relaunch).not.toHaveBeenCalled();
    } finally { finish(); await outcome; }
  });

  it('rechecks runtime state after ownership proof instead of using an earlier stopped observation', async () => {
    const f = resultRuntimeFixture();
    f.owned.mockImplementationOnce(async () => { f.state.runtime = 'unavailable'; });
    await expect(f.runtime.complete(completed)).rejects.toThrow('WORKSPACE_DELETE_OWNERSHIP_UNCERTAIN');
    expect(f.relaunch).not.toHaveBeenCalled();
  });

  it('rejects a new lease observed after physical ownership was read', async () => {
    const f = resultRuntimeFixture();
    let lease: Awaited<ReturnType<typeof f.lease.acquire>> | undefined;
    f.owned.mockImplementationOnce(async () => { lease = await f.lease.acquire('update'); });
    try {
      await expect(f.runtime.complete(completed)).rejects.toThrow('WORKSPACE_DELETE_OWNERSHIP_UNCERTAIN');
      expect(f.relaunch).not.toHaveBeenCalled();
    } finally { await lease?.release(); }
  });

  it.each([
    { formatVersion: 1, status: 'prepared' },
    { formatVersion: 1, status: 'cancelled', nextAction: 'continue' },
    { ...completed, extra: 'private' },
  ])('rejects a non-completion value before physical work at case %#', async value => {
    const f = resultRuntimeFixture();
    await expect(f.runtime.complete(value as never)).rejects.toThrow();
    expect(f.absent).not.toHaveBeenCalled();
    expect(f.owned).not.toHaveBeenCalled();
    expect(f.relaunch).not.toHaveBeenCalled();
  });

  it('retains the actual dispatch failure and never retries the same completion', async () => {
    const first = new Error('SYNTHETIC_DISPATCH_FAILED');
    const f = resultRuntimeFixture();
    f.relaunch.mockImplementationOnce(() => { throw first; });
    await expect(f.runtime.complete(completed)).rejects.toBe(first);
    expect(f.runtime.readNextAction()).toBe('restartRequired');
    await expect(f.runtime.complete(completed)).rejects.toThrow('WORKSPACE_DELETE_OWNERSHIP_UNCERTAIN');
    expect(f.relaunch).toHaveBeenCalledOnce();
  });
});

function resultRuntimeFixture(runtime: 'available' | 'stopped' | 'unavailable' = 'stopped') {
  const state = { current: true, runtime };
  const revoked = new Error('SYNTHETIC_MAIN_REVOKED');
  const events: string[] = [];
  const lease = new InMemoryWorkspaceMaintenanceLease();
  const absent = vi.fn(async () => { events.push('absent'); });
  const owned = vi.fn(async () => { events.push('owned'); });
  const main = vi.fn();
  const relaunch = vi.fn(() => { events.push('relaunch'); });
  const relaunchOwner = new DeferredWorkspaceRuntimeRelaunch(relaunch);
  const result = createWorkspaceDeletionResultRuntime({
    assertCurrent() { if (!state.current) throw revoked; },
    assertMainCurrent: main,
    assertOwned: owned, assertRuntimeAbsent: absent, readRuntimeState: () => state.runtime,
    maintenanceState: lease, runtimeRelaunch: relaunchOwner,
  });
  return { runtime: result, state, revoked, lease, events, absent, owned, main, relaunch, relaunchOwner };
}

function fixture(activeWorkspaceId: typeof workspaceId | null = workspaceId) {
  let current = true;
  const target = Object.freeze({ workspaceId, workspaceLabel: 'Synthetic', profileId: 'a'.repeat(64),
    lifecycleState: 'ready' as const, previousActiveWorkspaceId: activeWorkspaceId,
    registrySha256: 'b'.repeat(64), registryEntrySha256: 'c'.repeat(64), rootIdentity: 'd'.repeat(64) });
  const journal = captureWorkspaceDeletionJournal({ formatVersion: 1, phase: 'authorized',
    target: { formatVersion: 2, operationId, workspaceId, lineageIdentity: { formatVersion: 1, profileId: target.profileId },
      registryEntrySha256: target.registryEntrySha256 },
    registryBeforeSha256: target.registrySha256, registryAfterSha256: 'e'.repeat(64),
    previousActiveWorkspaceId: activeWorkspaceId, backupDisposition: 'explicitDataLoss',
    inventory: { formatVersion: 2, byteLength: 1, recordCount: 1, sha256: 'f'.repeat(64) },
    inventoryFileIdentity: 'a'.repeat(64), operationRootIdentity: 'b'.repeat(64), operationParentIdentity: 'c'.repeat(64) });
  const assertCurrent = () => { if (!current) throw new Error('SYNTHETIC_MAIN_REVOKED'); };
  const assertPreparationCurrent = async () => { assertCurrent(); };
  const assertLease = vi.fn();
  const seal = vi.fn(async () => undefined);
  const removed = vi.fn();
  const command = { publish: vi.fn<WorkspaceDeletionMainCommand['publish']>(async () => ({ journal, workspaceRootIdentity: target.rootIdentity })),
    resume: vi.fn<WorkspaceDeletionMainCommand['resume']>(async (_id, authority) => {
      authority.recordRemoved({ status: 'removed', journal: { ...journal, phase: 'registryPublished' } });
      return { formatVersion: 1, status: 'completed', navigation: 'selector' };
    }) };
  const binding = bindWorkspaceDeletionContinuation({ command, activeWorkspaceId, assertCurrent,
    async assertOwned() { assertCurrent(); }, sealActiveMarker: seal, recordActiveRemoved: removed });
  return { binding, command, journal, target, assertLease, seal, removed, assertPreparationCurrent,
    revoke() { current = false; },
    receipt: () => ({ status: 'removed', journal: { ...journal, phase: 'registryPublished' } }),
    publish: () => binding.publish(assertCurrent, async () => { assertCurrent(); }, target,
      { operationId, target, backupDisposition: 'explicitDataLoss' }, assertPreparationCurrent),
  };
}

function recoveryTerminalFixture(persisted: typeof workspaceId | null = workspaceId) {
  const f = fixture(persisted);
  const state = { current: true, owned: true, absent: true };
  const first = new Error('SYNTHETIC_RECOVERY_TERMINAL_OWNER_LOST');
  const main = vi.fn(() => { if (!state.current) throw first; });
  const mainOwned = vi.fn(async () => { main(); if (!state.owned) throw first; });
  const runtimeCurrent = vi.fn(() => { if (!state.absent) throw first; });
  const runtimeAbsent = vi.fn(async () => { runtimeCurrent(); });
  const options = { kind: 'recoveryManagement' as const, command: f.command,
    persistedActiveWorkspaceId: persisted, assertCurrent: main, assertOwned: mainOwned,
    assertRuntimeCurrent: runtimeCurrent, assertRuntimeAbsent: runtimeAbsent };
  const binding = bindWorkspaceDeletionContinuation(options);
  return { ...f, state, first, main, mainOwned, runtimeCurrent, runtimeAbsent, options, binding,
    publish() { return binding.publish(main, async () => { main(); }, f.target,
      { operationId, target: f.target, backupDisposition: 'explicitDataLoss' }, f.assertPreparationCurrent); } };
}

it.each([workspaceId, otherWorkspaceId, null])('recovery terminal preserves %s without imaginary live-marker calls', async persisted => {
  const f = recoveryTerminalFixture(persisted); await f.publish();
  const owner = f.binding.continuation.captureAuthority(operationId, f.assertLease);
  await owner.assertOwned();
  expect(owner.recordRemoved(f.receipt())).toEqual({ formatVersion: 1, status: 'completed',
    navigation: persisted === otherWorkspaceId ? 'reopenPrevious' : 'selector' });
  expect(f.seal).not.toHaveBeenCalled(); expect(f.removed).not.toHaveBeenCalled();
  expect(f.runtimeAbsent).toHaveBeenCalled();
});

it.each(['current', 'owned', 'mainOwned'] as const)('recovery terminal never revives after %s fails', async change => {
  const f = recoveryTerminalFixture(otherWorkspaceId); await f.publish();
  const owner = f.binding.continuation.captureAuthority(operationId, f.assertLease);
  if (change === 'current') f.state.absent = false;
  else (change === 'owned' ? f.runtimeAbsent : f.mainOwned).mockRejectedValueOnce(f.first);
  await expect(owner.assertOwned()).rejects.toBe(f.first);
  f.state.absent = true;
  expect(owner.assertCurrent).toThrow(f.first);
  expect(() => owner.recordRemoved(f.receipt())).toThrow(f.first);
  expect(f.seal).not.toHaveBeenCalled(); expect(f.removed).not.toHaveBeenCalled();
});

it('recovery terminal pins its persisted pointer and runtime callbacks before publication', async () => {
  const f = recoveryTerminalFixture(otherWorkspaceId);
  Object.assign(f.options, { persistedActiveWorkspaceId: null, assertRuntimeCurrent() {}, async assertRuntimeAbsent() {} });
  f.state.absent = false;
  await expect(f.publish()).rejects.toBe(f.first);
  expect(f.command.publish).not.toHaveBeenCalled(); expect(f.seal).not.toHaveBeenCalled();
});

it('recovery terminal rejects false absence and a later otherwise valid receipt', async () => {
  const f = recoveryTerminalFixture(otherWorkspaceId);
  f.runtimeAbsent.mockResolvedValueOnce(false as never);
  await expect(f.publish()).rejects.toThrow('WORKSPACE_DELETE_OWNERSHIP_UNCERTAIN');
  expect(f.command.publish).not.toHaveBeenCalled();
  const valid = recoveryTerminalFixture(otherWorkspaceId); await valid.publish();
  const owner = valid.binding.continuation.captureAuthority(operationId, valid.assertLease);
  let first: unknown;
  try { owner.recordRemoved({ ...valid.receipt(), status: 'wrong' }); } catch (cause) { first = cause; }
  expect(first).toBeInstanceOf(Error);
  expect(() => owner.recordRemoved(valid.receipt())).toThrow(first as Error);
  expect(valid.removed).not.toHaveBeenCalled();
});

function recoveryResultFixture(state: 'available' | 'stopped' | 'unavailable' = 'stopped') {
  const f = resultRuntimeFixture(state);
  const options = { kind: 'recoveryManagement' as const,
    assertCurrent() { if (!f.state.current) throw f.revoked; }, assertMainCurrent: f.main,
    assertOwned: f.owned, assertRuntimeAbsent: f.absent, readRuntimeState: () => f.state.runtime, maintenanceState: f.lease };
  return { ...f, options, runtime: createWorkspaceDeletionResultRuntime(options) };
}
const recoveryCompleted = Object.freeze({ formatVersion: 1 as const, status: 'completed' as const, navigation: 'reopenPrevious' as const });

it('recovery terminal burns a rejected persisted-pointer publication before any correct retry', async () => {
  const f = recoveryTerminalFixture(otherWorkspaceId);
  const target = { ...f.target, previousActiveWorkspaceId: null };
  const first = await f.binding.publish(f.main, async () => { f.main(); }, target,
    { operationId, target, backupDisposition: 'explicitDataLoss' }, f.assertPreparationCurrent).catch(cause => cause);
  expect(first).toMatchObject({ message: 'WORKSPACE_DELETE_OWNERSHIP_UNCERTAIN' });
  await expect(f.publish()).rejects.toBe(first); expect(f.command.publish).not.toHaveBeenCalled();
});

it('recovery terminal rejects a false main-owned proof and never accepts a later proof', async () => {
  const f = recoveryTerminalFixture(otherWorkspaceId); await f.publish();
  const owner = f.binding.continuation.captureAuthority(operationId, f.assertLease);
  f.mainOwned.mockResolvedValueOnce(false as never);
  const first = await owner.assertOwned().catch(cause => cause);
  expect(first).toMatchObject({ message: 'WORKSPACE_DELETE_OWNERSHIP_UNCERTAIN' });
  await expect(owner.assertOwned()).rejects.toBe(first);
  expect(() => owner.recordRemoved(f.receipt())).toThrow(first);
});

it.each(['captureOperation', 'captureLease', 'ownerLease'] as const)('recovery terminal burns %s rejection', async boundary => {
  const f = recoveryTerminalFixture(otherWorkspaceId); await f.publish();
  let first: unknown;
  if (boundary === 'ownerLease') {
    const owner = f.binding.continuation.captureAuthority(operationId, f.assertLease);
    f.assertLease.mockImplementationOnce(() => { throw f.first; });
    try { owner.assertCurrent(); } catch (cause) { first = cause; }
    expect(first).toBe(f.first); expect(owner.assertCurrent).toThrow(f.first);
  } else {
    if (boundary === 'captureLease') f.assertLease.mockImplementationOnce(() => { throw f.first; });
    try { f.binding.continuation.captureAuthority(boundary === 'captureOperation' ? '44444444-4444-4444-8444-444444444444' : operationId, f.assertLease); }
    catch (cause) { first = cause; }
    expect(first).toBeInstanceOf(Error);
    expect(() => f.binding.continuation.captureAuthority(operationId, f.assertLease)).toThrow(first as Error);
  }
  expect(f.removed).not.toHaveBeenCalled();
});

it('recovery terminal burns a caught nested terminal rejection before the outer record can succeed', async () => {
  const f = recoveryTerminalFixture(otherWorkspaceId); await f.publish();
  const owner = f.binding.continuation.captureAuthority(operationId, f.assertLease);
  let nestedFailure: unknown;
  f.assertLease.mockImplementationOnce(() => {
    try { owner.recordRemoved(f.receipt()); } catch (cause) { nestedFailure = cause; }
  });
  expect(() => owner.recordRemoved(f.receipt())).toThrow();
  expect(nestedFailure).toBeInstanceOf(Error);
  expect(owner.assertCurrent).toThrow(nestedFailure as Error);
  expect(f.removed).not.toHaveBeenCalled();
});

it('recovery result requires fresh idle ownership without borrowing the released delete lease or relaunching', async () => {
  const f = recoveryResultFixture();
  const lease = await f.lease.acquire('delete'), old = f.lease.captureCurrentOwner(['delete'], lease);
  await lease.release(); expect(old).toThrow('WORKSPACE_MAINTENANCE_BUSY');
  await f.runtime.complete(recoveryCompleted);
  expect(f.events).toEqual(['absent', 'owned']); expect(f.runtime.readNextAction()).toBe('restartRequired');
  expect(f.relaunchOwner.isRequested()).toBe(false); expect(f.relaunch).not.toHaveBeenCalled();
  await expect(f.runtime.complete(recoveryCompleted)).rejects.toThrow('WORKSPACE_DELETE_OWNERSHIP_UNCERTAIN');
});

it.each(['available', 'stopped', 'unavailable'] as const)('recovery result validates physical main observation in %s state', state => {
  const f = recoveryResultFixture(state);
  const first = new Error('SYNTHETIC_RECOVERY_RESULT_MAIN_LOST');
  f.main.mockImplementationOnce(() => { throw first; });
  expect(() => f.runtime.readNextAction()).toThrow(first);
  expect(() => f.runtime.readNextAction()).toThrow(first);
  expect(f.main).toHaveBeenCalledOnce(); expect(f.relaunch).not.toHaveBeenCalled();
});

it.each(['absent', 'owned'] as const)('recovery result rejects false %s proof and retains the first error', async failed => {
  const f = recoveryResultFixture();
  f[failed].mockResolvedValueOnce(false as never);
  const error = await f.runtime.complete(recoveryCompleted).catch(cause => cause);
  expect(error).toMatchObject({ message: 'WORKSPACE_DELETE_OWNERSHIP_UNCERTAIN' });
  expect(() => f.runtime.readNextAction()).toThrow(error);
  await expect(f.runtime.complete(recoveryCompleted)).rejects.toBe(error);
  expect(f.relaunch).not.toHaveBeenCalled();
});

it('recovery result joins held absence before reporting external shutdown', async () => {
  const f = recoveryResultFixture();
  let enter!: () => void, release!: () => void, settled = false;
  const entered = new Promise<void>(resolve => { enter = resolve; });
  const held = new Promise<void>(resolve => { release = resolve; });
  f.absent.mockImplementationOnce(async () => { enter(); await held; });
  const work = f.runtime.complete(recoveryCompleted).catch(cause => cause).finally(() => { settled = true; });
  try {
    await entered; f.state.current = false;
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(settled).toBe(false); expect(f.owned).not.toHaveBeenCalled();
    release(); expect(await work).toBe(f.revoked);
    f.state.current = true;
    expect(() => f.runtime.readNextAction()).toThrow(f.revoked);
    expect(f.relaunch).not.toHaveBeenCalled();
  } finally { release(); await work; }
});
