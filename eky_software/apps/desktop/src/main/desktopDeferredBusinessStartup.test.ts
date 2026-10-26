import { expect, it, vi } from 'vitest';

import { createBusinessAcceptedBuildMetadata, createSelectorAcceptedBuildMetadata } from '../update/acceptedBuildMetadata.js';
import { planDeferredBusinessLocalUpdateState, type DeferredBusinessLocalUpdateState } from '../update/deferredBusinessLocalUpdateState.js';
import type { ReadOnlyJournalSlots } from '../workspaces/persistence/readOnlyJournalSlots.js';
import { parseWorkspaceRegistryBytes } from '../workspaces/registry/workspaceRegistryBytes.js';
import { createDesktopDeferredBusinessStartup } from './desktopDeferredBusinessStartup.js';

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
function fixture() {
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
