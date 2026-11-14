import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi, type Mock } from 'vitest';
import { createSwitchRegistry } from '../switch/workspaceSwitchTestSupport.js';
import { createWorkspaceDeletionCommand } from './workspaceDeletionCommand.js';
import { deletionTestJournal } from './workspaceDeletionDataTestSupport.js';
import type { WorkspaceDeletionExecutionStage, WorkspaceDeletionWorkAuthority } from '../management/workspaceManagementService.js';
import * as phase from './workspaceDeletionPhaseSelection.js';
import * as payload from './workspaceDeletionPayloadExecutor.js';
import * as registry from './workspaceDeletionRegistryPublication.js';
import * as metadata from './workspaceDeletionMetadataCleanup.js';
import * as finalizer from './workspaceDeletionFinalization.js';

afterEach(() => vi.restoreAllMocks());

// Controlled stage ports isolate command binding/lifetime, not native deletion or cold admission.
function fixture(state: 'authorized' | 'registryPublished' = 'authorized', beforeMetadata?: () => Promise<void>,
  coldSelection?: NonNullable<Parameters<typeof createWorkspaceDeletionCommand>[0]['coldSelection']>) {
  const journal = deletionTestJournal(state), terminal = deletionTestJournal('registryPublished');
  const revokeSelection = vi.fn();
  const select = vi.spyOn(phase, 'captureWorkspaceDeletionPhaseSelection').mockResolvedValue({
    journal, registryState: 'before', registryNeedsRecovery: false,
    afterRegistry: { ...createSwitchRegistry(), formatVersion: 2 },
    journalSlots: { current: undefined, next: undefined, backup: undefined },
    registrySlots: { current: undefined, next: undefined, backup: undefined },
    assertCurrent() {}, async assertSelected() {}, async assertExternalSelection() {},
    async assertJournalSelected() {}, async assertJournalReadOwned() { throw new Error('UNEXPECTED_TEST_READ_PORT'); }, revoke: revokeSelection,
  });
  const execute = vi.fn<ReturnType<typeof payload.createWorkspaceDeletionPayloadExecutor>>(async () => journal);
  const publishRegistry = vi.fn<ReturnType<typeof registry.createWorkspaceDeletionRegistryPublisher>>(async () => ({ journal, registryState: 'after' }));
  const clean = vi.fn<ReturnType<typeof metadata.createWorkspaceDeletionMetadataCleaner>>(async () => journal);
  const finish = vi.fn<ReturnType<typeof finalizer.createWorkspaceDeletionFinalizer>>(async () => terminal);
  vi.spyOn(payload, 'createWorkspaceDeletionPayloadExecutor').mockReturnValue(execute);
  vi.spyOn(registry, 'createWorkspaceDeletionRegistryPublisher').mockReturnValue(publishRegistry);
  vi.spyOn(metadata, 'createWorkspaceDeletionMetadataCleaner').mockReturnValue(clean);
  vi.spyOn(finalizer, 'createWorkspaceDeletionFinalizer').mockReturnValue(finish);
  const never = async (): Promise<never> => { throw new Error('UNEXPECTED_NATIVE_COMMAND_PORT'); };
  const authority = { assertCurrent: vi.fn(() => {}), assertOwned: vi.fn(async () => {}), recordRemoved: vi.fn() };
  const observeStage = vi.fn();
  const command = createWorkspaceDeletionCommand({ userDataRoot: join(tmpdir(), 'eky-selected-command-ports'),
    registry: { inspectSlots: never, writeSelected: never, recoverSelected: never }, assertWritersAbsent: never, observeStage,
    ...(beforeMetadata === undefined ? {} : { beforeMetadata }), ...(coldSelection === undefined ? {} : { coldSelection }) });
  return { command, journal, terminal, select, execute, publishRegistry, clean, finish, authority, observeStage, revokeSelection };
}

it.for(['authorized', 'registryPublished'] as const)('uses the same stages for the selected %s binding', async state => {
  const f = fixture(state);
  await expect(f.command.resumeSelected(f.journal, f.authority)).resolves.toEqual({ formatVersion: 1, status: 'completed', navigation: 'selector' });
  expect(f.select).toHaveBeenCalledWith(expect.objectContaining({ operationId: f.journal.target.operationId, expectedBinding: f.journal }));
  for (const stage of [f.execute, f.publishRegistry, f.clean]) {
    expect(stage).toHaveBeenCalledTimes(state === 'registryPublished' ? 0 : 1);
    if (state !== 'registryPublished') expect(stage).toHaveBeenCalledWith(f.journal.target.operationId, expect.anything(), f.journal);
  }
  expect(f.finish).toHaveBeenCalledWith(f.journal.target.operationId, expect.anything(), f.journal);
  expect(f.authority.recordRemoved).toHaveBeenCalledExactlyOnceWith({ status: 'removed', journal: f.terminal });
  expect(f.authority.recordRemoved.mock.invocationCallOrder[0]).toBeGreaterThan(f.finish.mock.invocationCallOrder[0]!);
  expect(f.observeStage.mock.calls.map(([stage]) => stage)).toEqual(state === 'registryPublished'
    ? ['deleteAuthorization', 'deleteCleanup']
    : ['deleteAuthorization', 'deletePurge', 'deleteRegistry', 'deleteCleanup']);
});

it.for(['authorized', 'registryPublished'] as const)('reports current live %s stages only to the invocation observer and retains the cold observer', async state => {
  const f = fixture(state);
  const observeStage = vi.fn<(stage: WorkspaceDeletionExecutionStage) => void>();
  const selection = f.select.getMockImplementation()!;
  f.select.mockImplementationOnce(async input => {
    expect(observeStage.mock.calls.at(-1)).toEqual(['deleteAuthorization']);
    return selection(input);
  });
  const checkStage = <T>(name: WorkspaceDeletionExecutionStage,
    stage: Mock<(...args: Parameters<typeof f.execute>) => Promise<T>>) => {
    const original = stage.getMockImplementation()!;
    stage.mockImplementationOnce(async (...args) => {
      expect(observeStage.mock.calls.at(-1)).toEqual([name]);
      return original(...args);
    });
  };
  checkStage('deletePurge', f.execute); checkStage('deleteRegistry', f.publishRegistry);
  checkStage('deleteCleanup', f.clean); checkStage('deleteCleanup', f.finish);
  const expected = state === 'registryPublished' ? ['deleteAuthorization', 'deleteCleanup']
    : ['deleteAuthorization', 'deletePurge', 'deleteRegistry', 'deleteCleanup'];
  await expect(f.command.resume(f.journal.target.operationId, f.authority, observeStage)).resolves.toEqual({
    formatVersion: 1, status: 'completed', navigation: 'selector',
  });
  expect(observeStage.mock.calls.map(([stage]) => stage)).toEqual(expected);
  expect(f.observeStage).not.toHaveBeenCalled();
  expect(f.authority.recordRemoved).toHaveBeenCalledExactlyOnceWith({ status: 'removed', journal: f.terminal });
  await expect(f.command.resumeSelected(f.journal, f.authority)).resolves.toMatchObject({ status: 'completed' });
  expect(f.observeStage.mock.calls.map(([stage]) => stage)).toEqual(expected);
  expect(observeStage.mock.calls.map(([stage]) => stage)).toEqual(expected);
});

it.for([
  { port: 'select', stages: ['deleteAuthorization'] },
  { port: 'execute', stages: ['deleteAuthorization', 'deletePurge'] },
  { port: 'publishRegistry', stages: ['deleteAuthorization', 'deletePurge', 'deleteRegistry'] },
  { port: 'clean', stages: ['deleteAuthorization', 'deletePurge', 'deleteRegistry', 'deleteCleanup'] },
  { port: 'finish', stages: ['deleteAuthorization', 'deletePurge', 'deleteRegistry', 'deleteCleanup'] },
] as const)('retains the current live stage and original failure at $port', async ({ port, stages }) => {
  const f = fixture(), original = new Error('SYNTHETIC_LIVE_STAGE_FAILED');
  const observeStage = vi.fn<(stage: WorkspaceDeletionExecutionStage) => void>();
  f[port].mockImplementationOnce(async () => {
    expect(observeStage.mock.calls.at(-1)).toEqual([stages.at(-1)]);
    throw original;
  });
  await expect(f.command.resume(f.journal.target.operationId, f.authority, observeStage)).rejects.toBe(original);
  expect(observeStage.mock.calls.map(([stage]) => stage)).toEqual(stages);
  expect(f.observeStage).not.toHaveBeenCalled(); expect(f.authority.recordRemoved).not.toHaveBeenCalled();
  const ports = [f.select, f.execute, f.publishRegistry, f.clean, f.finish];
  for (const later of ports.slice(ports.indexOf(f[port]) + 1)) expect(later).not.toHaveBeenCalled();
});

it.for(['sync', 'async'] as const)('isolates a failed %s live observer without falling back or replacing the original failure', async mode => {
  const failObservation = () => {
    const error = new Error('SYNTHETIC_LIVE_OBSERVER_FAILED');
    if (mode === 'async') return Promise.reject(error);
    throw error;
  };
  const f = fixture(), observeSuccess = vi.fn(failObservation);
  await expect(f.command.resume(f.journal.target.operationId, f.authority, observeSuccess)).resolves.toMatchObject({ status: 'completed' });
  expect(observeSuccess.mock.calls).toHaveLength(4); expect(f.observeStage).not.toHaveBeenCalled();
  expect(f.authority.recordRemoved).toHaveBeenCalledExactlyOnceWith({ status: 'removed', journal: f.terminal });
  const g = fixture(), original = new Error('SYNTHETIC_LIVE_REGISTRY_FAILED'), observeFailure = vi.fn(failObservation);
  g.publishRegistry.mockRejectedValueOnce(original);
  await expect(g.command.resume(g.journal.target.operationId, g.authority, observeFailure)).rejects.toBe(original);
  expect(observeFailure.mock.calls).toEqual([['deleteAuthorization'], ['deletePurge'], ['deleteRegistry']]);
  expect(g.observeStage).not.toHaveBeenCalled(); expect(g.clean).not.toHaveBeenCalled();
  expect(g.finish).not.toHaveBeenCalled(); expect(g.authority.recordRemoved).not.toHaveBeenCalled();
});

it.for(['authorized', 'registryPublished'] as const)('falls back to the construction observer for live %s execution without an invocation observer', async state => {
  const f = fixture(state);
  await expect(f.command.resume(f.journal.target.operationId, f.authority)).resolves.toMatchObject({ status: 'completed' });
  expect(f.observeStage.mock.calls.map(([stage]) => stage)).toEqual(state === 'registryPublished'
    ? ['deleteAuthorization', 'deleteCleanup']
    : ['deleteAuthorization', 'deletePurge', 'deleteRegistry', 'deleteCleanup']);
  expect(f.authority.recordRemoved).toHaveBeenCalledExactlyOnceWith({ status: 'removed', journal: f.terminal });
});

it.for(['sync', 'async'] as const)('does not let a failed %s stage observation replace command success or its original error', async mode => {
  const f = fixture();
  const failObservation = () => {
    const error = new Error('SYNTHETIC_OBSERVER_FAILED');
    if (mode === 'async') return Promise.reject(error);
    throw error;
  };
  f.observeStage.mockImplementation(failObservation);
  await expect(f.command.resumeSelected(f.journal, f.authority)).resolves.toMatchObject({ status: 'completed' });
  const g = fixture(), original = new Error('SYNTHETIC_PAYLOAD_FAILURE');
  g.observeStage.mockImplementation(failObservation);
  g.execute.mockRejectedValueOnce(original);
  await expect(g.command.resumeSelected(g.journal, g.authority)).rejects.toBe(original);
  expect(g.observeStage.mock.calls.at(-1)).toEqual(['deletePurge']);
  expect(g.publishRegistry).not.toHaveBeenCalled(); expect(g.authority.recordRemoved).not.toHaveBeenCalled();
});

it.for(['authorized', 'registryPublished'] as const)('awaits the metadata authority handoff for %s before cleanup or finalization', async state => {
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; }), held = new Promise<void>(resolve => { release = resolve; });
  const beforeMetadata = vi.fn(async () => { entered(); await held; });
  const f = fixture(state, beforeMetadata);
  const work = f.command.resumeSelected(f.journal, f.authority);
  try {
    await Promise.race([started, work.then(() => { throw new Error('SYNTHETIC_METADATA_HANDOFF_NOT_REACHED'); })]);
    expect(f.clean).not.toHaveBeenCalled(); expect(f.finish).not.toHaveBeenCalled();
    expect(f.authority.recordRemoved).not.toHaveBeenCalled();
    expect(f.execute).toHaveBeenCalledTimes(state === 'registryPublished' ? 0 : 1);
    expect(f.publishRegistry).toHaveBeenCalledTimes(state === 'registryPublished' ? 0 : 1);
    release(); await expect(work).resolves.toMatchObject({ status: 'completed' });
    expect(beforeMetadata).toHaveBeenCalledOnce(); expect(f.finish).toHaveBeenCalledOnce();
  } finally { release(); await Promise.allSettled([work]); }
});

it.for(['authorized', 'registryPublished'] as const)('preserves a failed %s metadata handoff and refuses later stages', async state => {
  const original = new Error('SYNTHETIC_ORIGINAL_PROOF_CHANGED');
  const beforeMetadata = vi.fn(async () => { throw original; });
  const f = fixture(state, beforeMetadata);
  await expect(f.command.resumeSelected(f.journal, f.authority)).rejects.toBe(original);
  expect(f.clean).not.toHaveBeenCalled(); expect(f.finish).not.toHaveBeenCalled();
  expect(f.authority.recordRemoved).not.toHaveBeenCalled();
  expect(f.observeStage.mock.calls.at(-1)).toEqual(['deleteCleanup']);
});

it('rechecks current authority after an awaited metadata handoff', async () => {
  const original = new Error('SYNTHETIC_LOST_DURING_HANDOFF');
  const beforeMetadata = vi.fn(async () => {
    f.authority.assertCurrent.mockImplementation(() => { throw original; });
  });
  const f = fixture('authorized', beforeMetadata);
  await expect(f.command.resumeSelected(f.journal, f.authority)).rejects.toBe(original);
  expect(f.clean).not.toHaveBeenCalled(); expect(f.finish).not.toHaveBeenCalled();
  expect(f.authority.recordRemoved).not.toHaveBeenCalled();
});

it('copies the supplied binding before the first owned wait', async () => {
  const f = fixture(), supplied = { ...f.journal, target: { ...f.journal.target } };
  f.authority.assertOwned.mockImplementation(async () => { supplied.target.registryEntrySha256 = 'f'.repeat(64); });
  // The selected phase owner is held here to reproduce the first asynchronous ownership check.
  f.select.mockImplementationOnce(async input => {
    await input.authority.assertOwned();
    expect(input.expectedBinding).toEqual(f.journal);
    return { journal: f.journal, registryState: 'before', registryNeedsRecovery: false,
      afterRegistry: { ...createSwitchRegistry(), formatVersion: 2 }, journalSlots: { current: undefined, next: undefined, backup: undefined },
      registrySlots: { current: undefined, next: undefined, backup: undefined }, assertCurrent() {}, async assertSelected() {},
      async assertExternalSelection() {}, async assertJournalSelected() {},
      async assertJournalReadOwned() { throw new Error('UNEXPECTED_TEST_READ_PORT'); }, revoke() {} };
  });
  await f.command.resumeSelected(supplied, f.authority);
  expect(supplied.target.registryEntrySha256).toBe('f'.repeat(64));
});

it('rejects an invalid selected journal before a stage or ownership call', () => {
  const f = fixture();
  expect(() => f.command.resumeSelected({ ...f.journal, target: undefined }, f.authority)).toThrow('WORKSPACE_DELETE_JOURNAL_CONFLICT');
  expect(f.select).not.toHaveBeenCalled(); expect(f.execute).not.toHaveBeenCalled();
  expect(f.authority.assertOwned).not.toHaveBeenCalled(); expect(f.authority.recordRemoved).not.toHaveBeenCalled();
});

it('joins an owned selected operation, rejects concurrent entry, and burns its callback on error', async () => {
  const f = fixture();
  let release!: () => void, entered!: () => void, retained: WorkspaceDeletionWorkAuthority | undefined;
  const held = new Promise<void>(resolve => { release = resolve; }), started = new Promise<void>(resolve => { entered = resolve; });
  const failure = new Error('SYNTHETIC_SELECTED_COMMAND_ORIGINAL');
  f.execute.mockImplementationOnce(async (_id, owner) => {
    retained = { ...owner, recordRemoved() {} }; entered(); await held; throw failure;
  });
  const work = f.command.resumeSelected(f.journal, f.authority);
  try {
    await Promise.race([started, work.then(() => { throw new Error('SYNTHETIC_SELECTED_STAGE_NOT_ENTERED'); })]);
    await expect(f.command.resumeSelected(f.journal, f.authority)).rejects.toThrow('WORKSPACE_DELETE_JOURNAL_CONFLICT');
    expect(f.authority.recordRemoved).not.toHaveBeenCalled(); release();
    await expect(work).rejects.toBe(failure);
    expect(retained!.assertCurrent).toThrow('WORKSPACE_DELETE_JOURNAL_CONFLICT');
    expect(f.clean).not.toHaveBeenCalled(); expect(f.finish).not.toHaveBeenCalled();
  } finally { release(); await Promise.allSettled([work]); }
});

selectedCommandGuardTests();
function selectedCommandGuardTests() {
  it.for(['authorized', 'registryPublished'] as const)('guards each %s stage without full proof per inner read', async state => {
    const order: string[] = [];
    const pair = { assertReservationOwned: vi.fn(async () => { order.push('raw'); }),
      assertStableSelection: vi.fn(async () => { order.push('stable'); }) };
    const f = fixture(state, undefined, pair);
    const receipt = await f.select.getMockImplementation()!({} as never);
    f.select.mockImplementationOnce(async input => {
      order.push('select');
      for (let index = 0; index < 16; index++) await input.authority.assertOwned();
      return receipt;
    });
    const wrapStage = <T>(name: string, stage: Mock<(...args: Parameters<typeof f.execute>) => Promise<T>>) => {
      const original = stage.getMockImplementation()!;
      stage.mockImplementationOnce(async (...args) => {
        order.push(name); const owner = args[1];
        for (let index = 0; index < 16; index++) await owner.assertOwned();
        return original(...args);
      });
    };
    wrapStage('payload', f.execute); wrapStage('registry', f.publishRegistry);
    wrapStage('metadata', f.clean); wrapStage('terminal', f.finish);
    f.authority.recordRemoved.mockImplementation(() => { order.push('receipt'); });
    await f.command.resumeSelected(f.journal, f.authority);
    expect(f.authority.assertOwned).not.toHaveBeenCalled();
    expect(order.at(-1)).toBe('receipt');
    expect(pair.assertReservationOwned).toHaveBeenCalledTimes(state === 'registryPublished' ? 32 : 80);
    expect(pair.assertStableSelection).toHaveBeenCalledTimes(state === 'registryPublished' ? 4 : 10);
    const logical = order.filter(value => value !== 'raw');
    expect(logical).toEqual(state === 'registryPublished'
      ? ['stable', 'select', 'stable', 'stable', 'terminal', 'stable', 'receipt']
      : ['stable', 'select', 'stable', 'stable', 'payload', 'stable', 'stable', 'registry', 'stable',
        'stable', 'metadata', 'stable', 'stable', 'terminal', 'stable', 'receipt']);
  });

  it.for(['rawMissing', 'stableMissing', 'wrongRaw', 'extra', 'null'] as const)('rejects incomplete or malformed pair (%s)', variant => {
    const raw = async () => {}, stable = async () => {};
    const value = variant === 'rawMissing' ? { assertStableSelection: stable }
      : variant === 'stableMissing' ? { assertReservationOwned: raw }
      : variant === 'wrongRaw' ? { assertReservationOwned: false, assertStableSelection: stable }
      : variant === 'null' ? null : { assertReservationOwned: raw, assertStableSelection: stable, extra: true };
    expect(() => fixture('authorized', undefined, value as never)).toThrow('WORKSPACE_DELETE_JOURNAL_CONFLICT');
  });

  it('captures callbacks and binding before the first stable wait', async () => {
    const unexpected = vi.fn(async (): Promise<never> => { throw new Error('SYNTHETIC_PAIR_REPLACED'); });
    const raw = vi.fn(async () => {});
    const pair = { assertReservationOwned: raw, assertStableSelection: vi.fn(async () => {
      pair.assertReservationOwned = unexpected; pair.assertStableSelection = unexpected;
    }) };
    const f = fixture('authorized', undefined, pair), supplied = { ...f.journal, target: { ...f.journal.target } };
    const receipt = await f.select.getMockImplementation()!({} as never);
    f.select.mockImplementationOnce(async input => { await input.authority.assertOwned(); return receipt; });
    pair.assertStableSelection.mockImplementationOnce(async () => {
      supplied.target.registryEntrySha256 = 'f'.repeat(64);
      pair.assertReservationOwned = unexpected; pair.assertStableSelection = unexpected;
    });
    await f.command.resumeSelected(supplied, f.authority);
    expect(f.select.mock.calls[0]![0].expectedBinding).toEqual(f.journal);
    expect(raw).toHaveBeenCalled(); expect(unexpected).not.toHaveBeenCalled();
  });

  it.for(['beforeSelect', 'afterSelect', 'afterFinal'] as const)('retains a full selection failure %s', async variant => {
    const first = new Error('SYNTHETIC_STABLE_PAIR_CHANGED'); let count = 0;
    const pair = { async assertReservationOwned() {}, async assertStableSelection() {
      if (++count === (variant === 'beforeSelect' ? 1 : variant === 'afterSelect' ? 2 : 4)) throw first;
    } };
    const f = fixture('registryPublished', undefined, pair);
    await expect(f.command.resumeSelected(f.journal, f.authority)).rejects.toBe(first);
    expect(f.authority.recordRemoved).not.toHaveBeenCalled();
    expect(f.select).toHaveBeenCalledTimes(variant === 'beforeSelect' ? 0 : 1);
    expect(f.revokeSelection).toHaveBeenCalledTimes(variant === 'beforeSelect' ? 0 : 1);
    expect(f.finish).toHaveBeenCalledTimes(variant === 'afterFinal' ? 1 : 0);
  });

  it('burns a retained raw callback after the command ends', async () => {
    const pair = { async assertReservationOwned() {}, async assertStableSelection() {} };
    const f = fixture('registryPublished', undefined, pair);
    const receipt = await f.select.getMockImplementation()!({} as never);
    let retained: { assertOwned(): Promise<void> } | undefined;
    f.select.mockImplementationOnce(async input => { retained = input.authority; return receipt; });
    await f.command.resumeSelected(f.journal, f.authority);
    await expect(retained!.assertOwned()).rejects.toThrow('WORKSPACE_DELETE_JOURNAL_CONFLICT');
  });
}
