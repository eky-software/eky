import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';

import { createBusinessAcceptedBuildMetadata, createSelectorAcceptedBuildMetadata } from '../update/acceptedBuildMetadata.js';
import { planDeferredBusinessLocalUpdateState, type DeferredBusinessLocalUpdateState } from '../update/deferredBusinessLocalUpdateState.js';
import type { ReadOnlyJournalSlots } from '../workspaces/persistence/readOnlyJournalSlots.js';
import { parseWorkspaceRegistryBytes } from '../workspaces/registry/workspaceRegistryBytes.js';
import { createWorkspaceSelectorSwitchJournal } from '../workspaces/switch/workspaceSelectorSwitchState.js';
import type { WorkspaceSelectorSwitchSettlement } from '../workspaces/switch/workspaceSelectorSwitchStartup.js';
import { createDesktopDeferredBusinessStartup, type DesktopSelectorTerminalRequest } from './desktopDeferredBusinessStartup.js';
import { createNodeCrashSafeFileSlotFileSystem } from '../workspaces/persistence/crashSafeFileSlot.js';
import { createWorkspaceFirstStartMigrationJournalPaths } from '../workspaces/update/workspaceFirstStartMigrationJournalPaths.js';
import { WorkspaceFirstStartMigrationJournalStore } from '../workspaces/update/workspaceFirstStartMigrationJournalStore.js';
import { WORKSPACE_FIRST_START_MIGRATION_JOURNAL_MAX_BYTES } from '../workspaces/update/workspaceFirstStartMigrationJournalCodec.js';

const at = '2026-10-26T12:00:00.000Z';
const baseline = { formatVersion: 1 as const, releaseChannel: 'pilot' as const,
  appVersion: '0.2.0', buildRevision: 'a'.repeat(40), acceptedAt: at };
const target = { ...baseline, appVersion: '0.3.0', buildRevision: 'b'.repeat(40) };
const selector = createSelectorAcceptedBuildMetadata(baseline, target);
const business = createBusinessAcceptedBuildMetadata(selector, target);
const chain = 'c'.repeat(64);
const encode = (value: unknown) => Uint8Array.from(Buffer.from(`${JSON.stringify(value)}\n`));
const empty = <T>(): ReadOnlyJournalSlots<T> => ({ current: undefined, next: undefined, backup: undefined });
function record<T>(value: T, ino = 1) {
  const bytes = encode(value);
  return { value, bytes, identity: { dev: 1, ino, size: bytes.length, mtimeMs: 1, ctimeMs: 1 } };
}
function fixture(withSwitch = false) {
  // Only the main handoff is exercised here; disk and real-owner proof lives
  // in desktopRestoreStartup and the selected-persistence integration tests.
  const registry = parseWorkspaceRegistryBytes(encode({ formatVersion: 2,
    activeWorkspaceId: '11111111-1111-4111-8111-111111111111', workspaces: [{
      workspaceId: '11111111-1111-4111-8111-111111111111', workspaceLabel: 'Synthetic',
      layoutVersion: 1, lifecycleState: 'ready', createdAt: at,
      lineageIdentity: { formatVersion: 1, profileId: 'd'.repeat(64) },
    }] }));
  const state: DeferredBusinessLocalUpdateState = {
    metadata: { ...empty(), current: record(selector) }, registry: { ...empty(), current: record(registry) },
    legacyMetadata: empty(), updateJournal: empty(), legacyUpdateJournal: empty(), directSetupRecovery: empty(),
    switchJournal: empty(), firstStartJournal: empty(), runningBuild: target,
  };
  if (withSwitch) Object.assign(state, { switchJournal: { ...empty(), current: record(createWorkspaceSelectorSwitchJournal(
    { ...registry, formatVersion: 2, activeWorkspaceId: null }, registry.activeWorkspaceId!,
    '55555555-5555-4555-8555-555555555555', at)) } });
  const inspectExternal = vi.fn(async (includeMetadata: boolean) => ({
    ...(includeMetadata ? { metadata: state.metadata } : {}), legacyMetadata: state.legacyMetadata,
    updateJournal: state.updateJournal, legacyUpdateJournal: state.legacyUpdateJournal,
    directSetupRecovery: state.directSetupRecovery, switchJournal: state.switchJournal,
  }));
  const assertCurrent = vi.fn();
  const input = { prepared: { ...planDeferredBusinessLocalUpdateState(state), selectedState: structuredClone(state) },
    assertCurrent, inspectExternal };
  const subject = createDesktopDeferredBusinessStartup(input);
  const w6 = { assertDeferredBusinessReady: vi.fn(async (_phase: 'beforeMigrations' | 'beforeAcceptance') => {}) };
  const published = record(business, 2);
  return { input, state, inspectExternal, assertCurrent, subject, w6, published };
}

it('does not reread in-flight metadata and carries the proven writer record into subsequent checks', async () => {
  const f = fixture();
  const authority = await f.subject.firstStartAuthority(f.w6, chain);
  const acceptAfterBackendReady = vi.fn(async () => {
    await authority.assertCurrent();
    expect(f.inspectExternal.mock.lastCall).toEqual([false]);
    Object.assign(f.state, { metadata: { ...empty(), current: f.published } });
    await authority.assertCurrent();
    return f.published;
  });
  await f.subject.accept({ acceptAfterBackendReady }, f.w6);
  expect(f.w6.assertDeferredBusinessReady).toHaveBeenCalledWith('beforeAcceptance');
  expect(f.inspectExternal.mock.lastCall).toEqual([true]);
  await f.subject.assertCurrent();
  await expect(f.subject.accept({ acceptAfterBackendReady }, f.w6)).rejects.toThrow();
  expect(acceptAfterBackendReady).toHaveBeenCalledOnce();
});

it('captures the original W6 callback before the first binding await', async () => {
  const f = fixture();
  const original = f.w6.assertDeferredBusinessReady;
  const replacement = vi.fn(async () => {});
  const read = f.inspectExternal.getMockImplementation()!;
  f.inspectExternal.mockImplementationOnce(async include => {
    f.w6.assertDeferredBusinessReady = replacement;
    return read(include);
  });
  const authority = await f.subject.firstStartAuthority(f.w6, chain);
  await authority.assertCurrent();
  expect(original).toHaveBeenCalledTimes(2);
  expect(replacement).not.toHaveBeenCalled();
});

it.for(['readiness', 'publication'] as const)('captures the original acceptance %s callback before external reads', async which => {
  const f = fixture();
  await f.subject.firstStartAuthority(f.w6, chain);
  const original = new Error('SYNTHETIC_ORIGINAL_CALLBACK_FAILURE');
  const w6 = f.w6.assertDeferredBusinessReady;
  const accept = vi.fn(async () => { throw original; });
  const firstStart = { acceptAfterBackendReady: accept };
  if (which === 'readiness') w6.mockRejectedValue(original);
  const replacementW6 = vi.fn(async () => {});
  const replacementAccept = vi.fn(async (): Promise<never> => { throw new Error('WRONG_CALLBACK'); });
  const read = f.inspectExternal.getMockImplementation()!;
  f.inspectExternal.mockImplementationOnce(async include => {
    f.w6.assertDeferredBusinessReady = replacementW6;
    firstStart.acceptAfterBackendReady = replacementAccept;
    return read(include);
  });
  await expect(f.subject.accept(firstStart, f.w6)).rejects.toBe(original);
  expect(replacementW6).not.toHaveBeenCalled();
  expect(replacementAccept).not.toHaveBeenCalled();
  expect(accept).toHaveBeenCalledTimes(which === 'readiness' ? 0 : 1);
  await expect(f.subject.assertCurrent()).rejects.toThrow();
});

it.for(['binding', 'acceptance'] as const)('rejects overlapping %s and seals the original in-flight request', async phase => {
  const f = fixture();
  if (phase === 'acceptance') await f.subject.firstStartAuthority(f.w6, chain);
  let release!: () => void;
  let entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const pending = new Promise<void>(resolve => { release = resolve; });
  const read = f.inspectExternal.getMockImplementation()!;
  f.inspectExternal.mockImplementationOnce(async include => { entered(); await pending; return read(include); });
  const acceptAfterBackendReady = vi.fn(async () => f.published);
  const invoke = () => phase === 'binding' ? f.subject.firstStartAuthority(f.w6, chain)
    : f.subject.accept({ acceptAfterBackendReady }, f.w6);
  const first = invoke();
  const result = expect(first).rejects.toThrow();
  await started;
  try { await expect(invoke()).rejects.toThrow(); } finally { release(); }
  await result;
  expect(acceptAfterBackendReady).not.toHaveBeenCalled();
});

it('rejects an asynchronous startup authority and does not inspect files', async () => {
  const f = fixture();
  const subject = createDesktopDeferredBusinessStartup({ ...f.input, assertCurrent: async () => {} });
  await expect(subject.assertCurrent()).rejects.toThrow();
  expect(f.inspectExternal).not.toHaveBeenCalled();
});

it('does not adopt changed callback input or a same-byte replacement of the published identity', async () => {
  const f = fixture();
  const authority = await f.subject.firstStartAuthority(f.w6, chain);
  Object.assign(f.input.prepared.selectedState.metadata.current!, { identity: { ...f.published.identity, ino: 9 } });
  await authority.assertCurrent();
  await expect(f.subject.accept({ async acceptAfterBackendReady() {
    Object.assign(f.state, { metadata: { ...empty(), current: { ...f.published,
      identity: { ...f.published.identity, ino: 9 } } } });
    return f.published;
  } }, f.w6)).rejects.toThrow();
  await expect(f.subject.assertCurrent()).rejects.toThrow();
});

it.for(['originalChanged', 'ownerLost', 'registryRejected', 'journalReplaced'] as const)(
  'seals main on a %s switch handoff without adopting a later observation', async fault => {
    const f = fixture(true);
    const before = { registrySlots: structuredClone(f.state.registry), journalSlots: structuredClone(f.state.switchJournal) };
    if (fault === 'originalChanged') {
      Object.assign(before.journalSlots.current!.identity!, { ino: 77 });
      await expect(f.subject.admitSelectorSelection(before)).rejects.toThrow();
    } else {
      await f.subject.admitSelectorSelection(before);
      const current = f.state.switchJournal.current!;
      const journalSlots = { next: undefined, backup: undefined, current: record({ ...current.value, state: 'targetSelected' as const }, 3) };
      const receipt: WorkspaceSelectorSwitchSettlement = { phase: 'startup', before,
        after: { registrySlots: structuredClone(f.state.registry), journalSlots },
        async assertCurrent() { if (fault === 'ownerLost') throw new Error('OWNER_LOST'); } };
      Object.assign(f.state, { switchJournal: fault === 'journalReplaced'
        ? { ...journalSlots, current: { ...journalSlots.current, identity: { ...journalSlots.current.identity, ino: 99 } } }
        : journalSlots });
      const settleSelectorRegistry = vi.fn(async () => { if (fault === 'registryRejected') throw new Error('REGISTRY_REJECTED'); });
      await expect(f.subject.settleSelectorSelection(receipt, { settleSelectorRegistry })).rejects.toThrow();
      expect(settleSelectorRegistry).toHaveBeenCalledTimes(fault === 'registryRejected' ? 1 : 0);
    }
    await expect(f.subject.assertCurrent()).rejects.toThrow();
    await expect(f.subject.firstStartAuthority(f.w6, chain)).rejects.toThrow();
    expect(f.w6.assertDeferredBusinessReady).not.toHaveBeenCalled();
  },
);

it('does not publish deferred business acceptance before the successful switch-clear handoff', async () => {
  const f = fixture(true);
  const before = { registrySlots: structuredClone(f.state.registry), journalSlots: structuredClone(f.state.switchJournal) };
  await f.subject.admitSelectorSelection(before);
  const journalSlots = { next: undefined, backup: undefined, current: record({ ...f.state.switchJournal.current!.value, state: 'targetSelected' as const }, 3) };
  Object.assign(f.state, { switchJournal: journalSlots });
  await f.subject.settleSelectorSelection({ phase: 'startup', before,
    after: { registrySlots: structuredClone(f.state.registry), journalSlots }, async assertCurrent() {} },
  { async settleSelectorRegistry() {} });
  await f.subject.firstStartAuthority(f.w6, chain);
  const acceptAfterBackendReady = vi.fn(async () => f.published);
  await expect(f.subject.accept({ acceptAfterBackendReady }, f.w6)).rejects.toThrow();
  expect(acceptAfterBackendReady).not.toHaveBeenCalled();
});

it('does not bind FirstStart for a pending switch without its original selection admission', async () => {
  const f = fixture(true);
  await expect(f.subject.firstStartAuthority(f.w6, chain)).rejects.toThrow();
  expect(f.w6.assertDeferredBusinessReady).not.toHaveBeenCalled();
  await expect(f.subject.assertCurrent()).rejects.toThrow();
});

async function terminalFixture(purpose: DesktopSelectorTerminalRequest['purpose'] = 'selectorReturn') {
  const f = fixture(true);
  const before = { registrySlots: structuredClone(f.state.registry), journalSlots: structuredClone(f.state.switchJournal) };
  await f.subject.admitSelectorSelection(before);
  const journalSlots = { next: undefined, backup: undefined, current: record({ ...f.state.switchJournal.current!.value,
    state: 'targetSelected' as const }, 3) };
  Object.assign(f.state, { switchJournal: journalSlots });
  const settled = { registrySlots: structuredClone(f.state.registry), journalSlots };
  await f.subject.settleSelectorSelection({ phase: 'startup', before, after: settled, async assertCurrent() {} },
    { async settleSelectorRegistry() {} });
  if (purpose === 'acceptedTarget') await f.subject.firstStartAuthority(f.w6, chain);
  const w6 = { ...f.w6, cancelBeforeSelectorReturn: vi.fn(async (_authority: Readonly<{
    assertCurrent(): void; assertTerminal(): Promise<void>;
  }>) => {}) };
  const request: DesktopSelectorTerminalRequest = { purpose,
    registry: structuredClone(f.input.prepared.sourceRegistry),
    journal: structuredClone(journalSlots.current.value) as DesktopSelectorTerminalRequest['journal'] };
  const runtime = { assertCurrent: vi.fn(), assertExternal: vi.fn(async () => {}) };
  const proveRuntime = vi.fn(async (_request: DesktopSelectorTerminalRequest) => runtime);
  return { ...f, w6, request, runtime, proveRuntime, settled };
}

it('cancels unprepared W6 only after runtime proof and repeats assertions, not terminal work', async () => {
  const f = await terminalFixture();
  f.w6.cancelBeforeSelectorReturn.mockImplementation(async authority => {
    expect(f.proveRuntime).toHaveBeenCalledOnce();
    authority.assertCurrent();
    await authority.assertTerminal();
    await authority.assertTerminal();
  });
  const proof = await f.subject.proveSelectorTerminal(f.request, f.w6, f.proveRuntime);
  expect(f.w6.cancelBeforeSelectorReturn).toHaveBeenCalledOnce();
  expect(f.w6.assertDeferredBusinessReady).not.toHaveBeenCalled();
  expect(f.proveRuntime).toHaveBeenCalledOnce();
  expect(f.runtime.assertExternal).toHaveBeenCalledTimes(4);
  Object.assign(f.state, { switchJournal: empty(), registry: { ...empty(), current: record({
    ...f.request.registry, activeWorkspaceId: null,
  }) } });
  expect(() => proof.assertCurrent()).not.toThrow();
  const publication = vi.fn(async () => f.published);
  await expect(f.subject.accept({ acceptAfterBackendReady: publication }, f.w6)).rejects.toThrow();
  expect(publication).not.toHaveBeenCalled();
  expect(() => proof.assertCurrent()).toThrow();
});

it('keeps accepted-target proof valid through its exact switch clearance and business publication', async () => {
  const f = await terminalFixture('acceptedTarget');
  const proof = await f.subject.proveSelectorTerminal(f.request, f.w6, f.proveRuntime);
  expect(f.w6.cancelBeforeSelectorReturn).not.toHaveBeenCalled();
  expect(f.w6.assertDeferredBusinessReady).toHaveBeenLastCalledWith('beforeMigrations');
  Object.assign(f.state, { switchJournal: empty() });
  await f.subject.settleSelectorSelection({ phase: 'acceptedTarget', before: f.settled,
    after: { registrySlots: f.settled.registrySlots, journalSlots: empty() }, async assertCurrent() {} },
    { async settleSelectorRegistry() { throw new Error('UNEXPECTED_REGISTRY_SETTLEMENT'); } });
  proof.assertCurrent();
  await f.subject.accept({ async acceptAfterBackendReady() {
    Object.assign(f.state, { metadata: { ...empty(), current: f.published } });
    return f.published;
  } }, f.w6);
  proof.assertCurrent();
});

it.for(['journal', 'registry', 'unboundAcceptance'] as const)('rejects wrong terminal %s before runtime work', async fault => {
  const f = await terminalFixture();
  const request = structuredClone(f.request);
  if (fault === 'journal') Object.assign(request.journal!, { operationId: '66666666-6666-4666-8666-666666666666' });
  if (fault === 'registry') Object.assign(request.registry, { activeWorkspaceId: null });
  if (fault === 'unboundAcceptance') Object.assign(request, { purpose: 'acceptedTarget' });
  await expect(f.subject.proveSelectorTerminal(request, f.w6, f.proveRuntime)).rejects.toThrow();
  expect(f.proveRuntime).not.toHaveBeenCalled();
  expect(f.w6.cancelBeforeSelectorReturn).not.toHaveBeenCalled();
  await expect(f.subject.assertCurrent()).rejects.toThrow();
});

it.for(['runtime', 'external', 'cancel', 'cancelLostReply'] as const)('seals a %s terminal failure without reissuing proof', async fault => {
  const f = await terminalFixture();
  const failure = new Error('SYNTHETIC_TERMINAL_FAILURE');
  if (fault === 'runtime') f.proveRuntime.mockRejectedValue(failure);
  if (fault === 'external') f.runtime.assertExternal.mockRejectedValue(failure);
  f.w6.cancelBeforeSelectorReturn.mockImplementation(async authority => {
    if (fault === 'cancelLostReply') await authority.assertTerminal();
    throw failure;
  });
  await expect(f.subject.proveSelectorTerminal(f.request, f.w6, f.proveRuntime)).rejects.toBe(failure);
  await expect(f.subject.proveSelectorTerminal(f.request, f.w6, f.proveRuntime)).rejects.toThrow();
  expect(f.proveRuntime).toHaveBeenCalledOnce();
  expect(f.w6.cancelBeforeSelectorReturn).toHaveBeenCalledTimes(fault.startsWith('cancel') ? 1 : 0);
});

it('captures request and W6 callbacks before awaits and does not adopt replacement callbacks', async () => {
  const f = await terminalFixture();
  const originalCancel = f.w6.cancelBeforeSelectorReturn;
  const replacement = vi.fn(async () => {});
  const read = f.inspectExternal.getMockImplementation()!;
  f.inspectExternal.mockImplementationOnce(async include => {
    Object.assign(f.request, { purpose: 'acceptedTarget' });
    f.w6.cancelBeforeSelectorReturn = replacement;
    return read(include);
  });
  await f.subject.proveSelectorTerminal(f.request, f.w6, f.proveRuntime);
  expect(f.proveRuntime.mock.lastCall?.[0].purpose).toBe('selectorReturn');
  expect(originalCancel).toHaveBeenCalledOnce();
  expect(replacement).not.toHaveBeenCalled();
});

it('rejects a conflicting in-flight terminal request and seals the first request too', async () => {
  const f = await terminalFixture();
  let entered!: () => void;
  let release!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const pending = new Promise<void>(resolve => { release = resolve; });
  f.proveRuntime.mockImplementation(async () => { entered(); await pending; return f.runtime; });
  const first = f.subject.proveSelectorTerminal(f.request, f.w6, f.proveRuntime);
  const rejected = expect(first).rejects.toThrow();
  await started;
  try { await expect(f.subject.proveSelectorTerminal(f.request, f.w6, f.proveRuntime)).rejects.toThrow(); }
  finally { release(); }
  await rejected;
  expect(f.w6.cancelBeforeSelectorReturn).not.toHaveBeenCalled();
});

it.for(['startup', 'runtime', 'asynchronousRuntime'] as const)('rejects retained proof after %s authority loss', async fault => {
  const f = await terminalFixture();
  const proof = await f.subject.proveSelectorTerminal(f.request, f.w6, f.proveRuntime);
  if (fault === 'startup') f.assertCurrent.mockImplementation(() => { throw new Error('EXPIRED'); });
  else if (fault === 'runtime') f.runtime.assertCurrent.mockImplementation(() => { throw new Error('EXPIRED'); });
  else f.runtime.assertCurrent.mockImplementation(async () => {});
  expect(() => proof.assertCurrent()).toThrow();
  f.assertCurrent.mockReset();
  f.runtime.assertCurrent.mockReset();
  expect(() => proof.assertCurrent()).toThrow();
});

it('preserves prepared journal when runtime authority expires after the final file-identity await', async test => {
  const f = await terminalFixture();
  const root = await mkdtemp(join(tmpdir(), 'eky-selector-terminal-'));
  test.onTestFinished(async () => { if (test.task.result?.state === 'pass') await rm(root, { recursive: true }); });
  const fileSystem = createNodeCrashSafeFileSlotFileSystem(createWorkspaceFirstStartMigrationJournalPaths(root),
    WORKSPACE_FIRST_START_MIGRATION_JOURNAL_MAX_BYTES);
  let runtimeCurrent = true;
  let interrupted = false;
  f.runtime.assertCurrent.mockImplementation(() => { if (!runtimeCurrent) throw new Error('RUNTIME_EXPIRED'); });
  const remove = fileSystem.removeSlot.bind(fileSystem);
  const store = new WorkspaceFirstStartMigrationJournalStore({ userDataPath: root, fileSystem });
  await store.write({ formatVersion: 1, operationId: f.subject.operationIdFactory(), state: 'prepared',
    sourceBuild: { appVersion: baseline.appVersion, buildRevision: baseline.buildRevision },
    targetBuild: { appVersion: target.appVersion, buildRevision: target.buildRevision },
    activeWorkspaceId: f.request.registry.activeWorkspaceId!, passiveRecoveryWorkspaceIds: [],
    sourceRegistrySha256: 'a'.repeat(64), transitionedRegistrySha256: 'b'.repeat(64), createdAt: at, updatedAt: at });
  const selected = (await store.inspect())!;
  fileSystem.removeSlot = (slot, guard) => remove(slot, guard === undefined ? undefined : {
    ...guard, assertAuthority() {
      // The real adapter has completed its final identity read at this point.
      interrupted = true;
      runtimeCurrent = false;
      guard.assertAuthority();
    },
  });
  f.w6.cancelBeforeSelectorReturn.mockImplementation(authority => store.discardPrepared(selected.value.operationId, {
    selected, assertCurrent: authority.assertCurrent, assertExternalSelection: authority.assertTerminal,
  }));
  await expect(f.subject.proveSelectorTerminal(f.request, f.w6, f.proveRuntime)).rejects.toThrow();
  expect(interrupted).toBe(true);
  expect(await store.inspect()).toEqual(selected);
});
