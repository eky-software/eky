import { readFile, readdir, rmdir, unlink, writeFile } from 'node:fs/promises';
import { setImmediate } from 'node:timers/promises';
import { expect, it, vi, type TestContext } from 'vitest';
import { serializeWorkspaceRegistry } from '../registry/workspaceRegistrySerializer.js';
import { deletionTestId as id } from './workspaceDeletionDataTestSupport.js';
import { createWorkspaceDeletionFinalizer } from './workspaceDeletionFinalization.js';
import { createWorkspaceDeletionFinalizationTestFixture as fixture } from './workspaceDeletionFinalizationTestSupport.js';
import * as metadata from './workspaceDeletionMetadataCleanup.js';
import { rename as rename } from 'node:fs/promises';
import { createWorkspaceDeletionColdContinuation as coldContinuation } from '../../main/workspaceDeletionContinuation.js';
import * as phaseSelection from './workspaceDeletionPhaseSelection.js';
import * as originalSelection from './workspaceDeletionOriginalJournalSelection.js';
import * as externalSelection from '../runtime/workspaceDeletionColdAdmission.js';
import * as retirement from './workspaceDeletionInventoryRetirement.js';
import * as slots from '../persistence/crashSafeFileSlot.js';
import * as finalizerModule from './workspaceDeletionFinalization.js';
import * as originalPayload from './workspaceDeletionOriginalPayloadAbsence.js';
import { createWorkspaceDeletionCommand as createCommand } from './workspaceDeletionCommand.js';
import { WorkspaceDeletionJournalStore as JournalStore } from './workspaceDeletionJournalStore.js';
import { captureWorkspaceDeletionJournal as captureJournal, captureWorkspaceDeletionOriginalJournalProof as captureProof,
  maximumWorkspaceDeletionJournalBytes, serializeWorkspaceDeletionJournal as serializeJournal } from './workspaceDeletionJournalCodec.js';
import { captureWorkspaceRemnantBinding as captureBinding, workspaceRemnantBindingSha256 as bindingHash } from './workspaceRemnantBindingCodec.js';


type ReadScope = 'metadata' | 'clearAbsence' | 'postAbsence';
async function coldReadFixture(test: TestContext, explicit = true, originalProof: boolean | 'multiple' = false) {
  const f = await fixture(test, true, originalProof !== false);
  if (originalProof === 'multiple') {
    if (f.journal.formatVersion !== 2) throw new Error('EXPECTED_ORIGINAL_PROOF');
    const binding = captureBinding({ formatVersion: 1, owner: 'workspaceLegacyAdoption', operationId: id(224),
      workspaceId: f.header.workspaceId, lineageIdentity: f.header.lineageIdentity });
    // Controlled second commitment tests absence-reader composition only, not
    // admission of an actual interrupted adoption operation.
    const extra = captureProof(f.header, { owner: binding.owner, operationId: binding.operationId,
      bindingSha256: bindingHash(binding), slots: f.journal.originalJournalProofs[0]!.slots });
    f.journal = captureJournal({ ...f.journal, originalJournalProofs: [...f.journal.originalJournalProofs, extra] });
    f.journalBytes = Buffer.from(serializeJournal({ ...f.journal, phase: 'registryPublished' }));
    await writeFile(f.journalPaths.currentPath, f.journalBytes);
  }
  const first = new Error('SYNTHETIC_AGGREGATE_OWNERSHIP_LOST');
  const stop = new Error('SYNTHETIC_AGGREGATE_EXPECTED_STOP');
  const samples: { scope: ReadScope; checks: number }[] = [], trace: string[] = [];
  let checks = 0, full = 0, measuring = false, point = 0, hiddenAt = 0, failingAt = 0;
  let onCheck: ((at: number) => Promise<void>) | undefined;
  let onScope: ((scope: ReadScope, read: () => Promise<void>) => Promise<void>) | undefined;
  let onStable: (() => Promise<void>) | undefined;
  const check = () => { f.authority.assertCurrent(); };
  // Actual cold-continuation owner and alias composition; native observation itself
  // is a controlled boundary here, not an operating-system reservation proof.
  const physical = async () => {
    check(); checks++;
    if (measuring) {
      point++;
      await onCheck?.(point);
      if (point === failingAt || point === hiddenAt) { failingAt = 0; hiddenAt = 0; throw first; }
    }
    check();
  };
  const selected = { ...f.journal, phase: 'registryPublished' as const };
  const noIO = async () => { check(); };
  const phaseSpy = vi.spyOn(phaseSelection, 'captureWorkspaceDeletionPhaseSelection').mockResolvedValue({
    journal: selected, afterRegistry: f.after, registryState: 'after', registryNeedsRecovery: false,
    journalSlots: {}, registrySlots: {}, assertCurrent: check, assertSelected: noIO,
    assertExternalSelection: noIO, assertJournalSelected: noIO, revoke() {},
  } as never);
  const externalSpy = vi.spyOn(externalSelection, 'captureWorkspaceDeletionExternalSelectionFromRoot').mockResolvedValue({
    assertSelected: noIO, assertBuildSelected: noIO, assertForeignAbsent: noIO, revoke() {},
  } as never);
  const originalSpy = vi.spyOn(originalSelection, 'captureWorkspaceDeletionOriginalJournalContinuation').mockResolvedValue({
    assertSelected: noIO, revoke() {},
  } as never);
  const cold = coldContinuation({ userDataRoot: f.root, journal: selected,
    buildInfo: { schemaVersion: 1, appVersion: '0.2.81', buildRevision: 'a'.repeat(40), buildCreatedAt: '2026-11-03T00:00:00.000Z', buildDirty: false },
    releaseInfo: undefined, assertCurrent: check, assertOwned: physical, assertWritersAbsent: physical });
  test.onTestFinished(async () => { await cold.owner.close().catch(() => undefined); });
  try { await cold.owner.assertOwned(); await cold.beforeMetadata(); }
  finally { phaseSpy.mockRestore(); externalSpy.mockRestore(); originalSpy.mockRestore(); }
  const owner = { assertCurrent: check, assertOwned: cold.assertReservationOwned };
  const stable = async () => { full++; trace.push('full'); await onStable?.(); await cold.owner.assertOwned(); };
  let clearing = false, cleared = false;
  const runScope = async (scope: ReadScope, read: () => Promise<void>) => {
    const before = checks, fullBefore = full;
    measuring = true; point = 0;
    try { await read(); }
    finally {
      measuring = false;
      if (full === fullBefore) samples.push({ scope, checks: checks - before });
    }
  };
  const metadataRead = metadata.assertWorkspaceDeletionMetadataAbsent;
  vi.spyOn(metadata, 'assertWorkspaceDeletionMetadataAbsent').mockImplementation((...args) => {
    const external = args[2].assertExternalSelection;
    return metadataRead(args[0], args[1], { ...args[2], async assertExternalSelection() {
      const read = () => runScope('metadata', external);
      if (onScope) await onScope('metadata', read); else await read();
    } });
  });
  const absence = retirement.assertWorkspaceDeletionInventoryRetired;
  vi.spyOn(retirement, 'assertWorkspaceDeletionInventoryRetired').mockImplementation((...args) => {
    const external = args[2].assertExternalSelection;
    const scope: ReadScope | undefined = clearing ? 'clearAbsence' : cleared ? 'postAbsence' : undefined;
    if (scope === undefined) return absence(...args);
    return absence(args[0], args[1], { ...args[2], async assertExternalSelection() {
      const read = () => runScope(scope, external);
      if (onScope) await onScope(scope, read); else await read();
    } });
  });
  const clear = JournalStore.prototype.clearTerminal;
  vi.spyOn(JournalStore.prototype, 'clearTerminal').mockImplementation(async function (this: JournalStore, ...args) {
    clearing = true; trace.push('clear:start');
    try { await clear.apply(this, args); cleared = true; trace.push('clear:complete'); }
    finally { clearing = false; }
  });
  const factory = slots.createNodeCrashSafeFileSlotFileSystem;
  vi.spyOn(slots, 'createNodeCrashSafeFileSlotFileSystem').mockImplementation((paths, maximum) => {
    const fs = factory(paths, maximum);
    const label = paths.directoryPath === f.inventoryPaths.directoryPath ? 'inventory' :
      paths.directoryPath === f.inventoryPaths.parentPath ? 'parent' :
      paths.directoryPath === f.journalPaths.directoryPath ? 'journal' : undefined;
    if (label) for (const name of ['removeSlot', 'syncDirectory'] as const) {
      const method = fs[name].bind(fs);
      (fs[name] as unknown) = async (...args: unknown[]) => {
        const before = full; trace.push(label + ':' + name + ':start');
        const index = name === 'removeSlot' ? 1 : 0;
        const guard = args[index] as slots.CrashSafeFileSlotMutationGuard | undefined;
        if (guard !== undefined) args[index] = { assertAuthority: guard.assertAuthority.bind(guard), async beforeMutation() {
          trace.push(label + ':' + name + ':guard:start');
          await guard.beforeMutation();
          expect(full).toBeGreaterThan(before);
          trace.push(label + ':' + name + ':guard:complete');
        } };
        const result = await (method as (...args: unknown[]) => Promise<unknown>)(...args);
        expect(full).toBeGreaterThan(before);
        trace.push(label + ':' + name + ':complete'); return result;
      };
    }
    return fs;
  });
  const options = { userDataRoot: f.root, registry: f.registry, assertWritersAbsent: physical,
    assertStableSelection: stable, ...(explicit ? { assertColdReadOwned: cold.assertReservationOwned } : {}) };
  const finalize = createWorkspaceDeletionFinalizer(options);

  return { f, cold, first, stop, samples, trace, owner, options, checks: () => checks,
    scope(hook: typeof onScope) { onScope = hook; },
    stableHook(hook: typeof onStable) { onStable = hook; },
    failAt(at: number) { failingAt = at; }, hiddenAt(at: number) { hiddenAt = at; },
    checkHook(hook: typeof onCheck) { onCheck = hook; },
    run() { return f.track(finalize(f.header.operationId, owner)); },
    async retained() {
      expect(await readFile(f.journalPaths.currentPath)).toEqual(f.journalBytes);
      expect(await readFile(f.inventoryPaths.currentPath)).toEqual(f.inventoryBytes); await f.preserved();
    } };
}

it.for([false, true])('completes all three scopes (proof: %s)', async (proof, test) => {
  const t = await coldReadFixture(test, true, proof);
  expect((await t.run()).phase).toBe('registryPublished');
  for (const scope of ['metadata', 'clearAbsence', 'postAbsence']) {
    const rows = t.samples.filter(row => row.scope === scope);
    expect(rows.length).toBeGreaterThan(0); expect(rows.every(row => row.checks === (3))).toBe(true);
  }
  expect((await t.f.store.inspect(t.f.authority.assertCurrent)).plan.mode).toBe('absent');
  await expect(readdir(t.f.inventoryPaths.directoryPath)).rejects.toMatchObject({ code: 'ENOENT' });
  await t.f.preserved();
});

it('leaves the stable-only default unchanged', async test => {
  const t = await coldReadFixture(test, false);
  t.scope(async (scope, read) => { await read(); throw t.stop; });
  await expect(t.run()).rejects.toBe(t.stop);
  expect(t.samples[0]?.checks).toBe(7); await t.retained();
});

it.for([1, 2, 3])('rejects aggregate check %s', async (at, test) => {
  const t = await coldReadFixture(test); t.failAt(at);
  await expect(t.run()).rejects.toBe(t.first);
  // The controlled failure was one-shot. A distinct later current-owner error
  // must not replace the error retained by the actual cold continuation.
  t.f.revoke();
  await expect(t.cold.assertReservationOwned()).rejects.toBe(t.first);
  expect(t.trace.some(row => row.includes('removeSlot:complete'))).toBe(false); await t.retained();
});

it.for([1, 2, 3])('joins held aggregate check %s after revocation', async (at, test) => {
  const t = await coldReadFixture(test);
  let enter!: () => void, release!: () => void, settled = false, closed = false, closeError: unknown;
  const entered = new Promise<void>(done => { enter = done; }), held = new Promise<void>(done => { release = done; });
  t.f.releases.push(release);
  t.checkHook(async point => { if (point === at) { enter(); await held; } });
  const outcome = t.run().then(() => { settled = true; return undefined; }, error => { settled = true; return error; });
  let closing: Promise<void> | undefined;
  try {
    await Promise.race([entered, outcome.then(() => { throw new Error('EXPECTED_HELD_CHECK_NOT_ENTERED'); })]);
    t.f.revoke(); closing = t.cold.owner.close();
    void closing.then(() => { closed = true; }, error => { closed = true; closeError = error; });
    await setImmediate(); expect(settled).toBe(false); expect(closed).toBe(false);
  } finally { release(); await outcome; await closing?.catch(() => undefined); }
  expect(await outcome).toBe(t.f.first); expect(closed).toBe(true);
  expect(closeError).toMatchObject({ message: 'WORKSPACE_DELETION_CLOSE_FAILED', cause: t.f.first });
  await t.retained();
});

it('rejects persistent registry change before mutation', async test => {
  const t = await coldReadFixture(test); let changed = false;
  t.scope(async (scope, read) => {
    if (!changed) { changed = true; await writeFile(t.f.registryPath, serializeWorkspaceRegistry(t.f.before)); }
    await read();
  });
  await expect(t.run()).rejects.toThrow('WORKSPACE_DELETE_JOURNAL_CONFLICT');
  expect(changed).toBe(true); expect(t.trace.some(row => row.includes('removeSlot:complete'))).toBe(false);
  expect(await readFile(t.f.journalPaths.currentPath)).toEqual(t.f.journalBytes);
  expect(await readFile(t.f.inventoryPaths.currentPath)).toEqual(t.f.inventoryBytes);
});

it('characterizes the removed modeled fourth observation', async test => {
  const t = await coldReadFixture(test); t.hiddenAt(4);
  t.scope(async (scope, read) => { await read(); throw t.stop; });
  await expect(t.run()).rejects.toBe(t.stop);
  expect(t.samples[0]?.checks).toBe(3); await t.retained();
});

it('captures the named port and rejects nonvoid results', async test => {
  const t = await coldReadFixture(test); let called = 0;
  const input = { ...t.options, async assertColdReadOwned(): Promise<void> { expect(this).toBe(input); called++; return 'invalid' as never; } };
  const finalize = createWorkspaceDeletionFinalizer(input);
  input.assertColdReadOwned = async () => { throw new Error('REPLACED_PORT_USED'); };
  await expect(t.f.track(finalize(t.f.header.operationId, t.owner))).rejects.toThrow('WORKSPACE_DELETE_JOURNAL_CONFLICT');
  expect(called).toBe(1); await t.retained();
});

it('rejects malformed explicit ports before work', async test => {
  const t = await coldReadFixture(test);
  for (const port of [null, true, 0, {}]) {
    expect(() => createWorkspaceDeletionFinalizer({ ...t.options, assertColdReadOwned: port } as never)).toThrow('WORKSPACE_DELETE_JOURNAL_CONFLICT');
  }
  await t.retained();
});

it('forwards the captured port only to the finalizer', async test => {
  const t = await coldReadFixture(test);
  const finalizer = vi.spyOn(finalizerModule, 'createWorkspaceDeletionFinalizer');
  const pair: { assertReservationOwned(): Promise<void>; assertStableSelection(): Promise<void> } = {
    assertReservationOwned: vi.fn(async () => undefined), assertStableSelection: vi.fn(async () => undefined) };
  createCommand({ ...t.options, coldSelection: pair });
  const input = finalizer.mock.calls.at(-1)![0] as typeof t.options;
  expect(typeof input.assertColdReadOwned).toBe('function');
  {
    pair.assertReservationOwned = async () => { throw new Error('REPLACED_COLD_PAIR_USED'); };
    await input.assertColdReadOwned!();
  }
  await t.retained();
});

it('rejects same-byte registry identity replacement', async test => {
  const t = await coldReadFixture(test); let changed = false;
  const bytes = await readFile(t.f.registryPath), displaced = t.f.registryPath + '.displaced';
  t.scope(async (scope, read) => {
    if (!changed) { changed = true; await rename(t.f.registryPath, displaced); await writeFile(t.f.registryPath, bytes); }
    await read();
  });
  await expect(t.run()).rejects.toThrow('WORKSPACE_DELETE_JOURNAL_CONFLICT');
  expect(await readFile(displaced)).toEqual(bytes);
  expect(t.trace.some(row => row.includes('removeSlot:complete'))).toBe(false);
  await t.retained();
});

it.for(['metadata', 'clearAbsence', 'postAbsence'] as const)(
  'expires %s callback before later full selection', async (target, test) => {
    const t = await coldReadFixture(test); let saved: (() => Promise<void>) | undefined, checked = false;
    t.scope(async (scope, read) => { if (scope === target) saved = read; await read(); });
    t.stableHook(async () => {
      if (saved === undefined || checked) return;
      checked = true; await expect(saved()).rejects.toThrow('WORKSPACE_DELETE_JOURNAL_CONFLICT'); throw t.stop;
    });
    await expect(t.run()).rejects.toBe(t.stop); expect(checked).toBe(true);
    await t.f.preserved();
  });

it('checks multiple original commitments before stopping', async test => {
  const t = await coldReadFixture(test, true, 'multiple');
  expect(t.f.journal.formatVersion === 2 && t.f.journal.originalJournalProofs.length).toBe(2);
  const captured = vi.spyOn(originalPayload, 'captureWorkspaceDeletionOriginalPayloadAbsence');
  t.scope(async (scope, read) => { await read(); throw t.stop; });
  await expect(t.run()).rejects.toBe(t.stop);
  const actual = captured.mock.calls.map(args => {
    const binding = captureBinding(args[1]); return [binding.owner, binding.operationId];
  });
  if (t.f.journal.formatVersion !== 2) throw new Error('EXPECTED_MULTIPLE_PROOFS');
  expect(actual).toEqual(t.f.journal.originalJournalProofs.map(proof => [proof.owner, proof.operationId]));
  expect(t.samples[0]?.checks).toBe(3); await t.retained();
});

it.for([false, true, 'multiple'] as const)('retains original absence and stable cadence around terminal prefix (proof: %s)', async (proof, test) => {
  const t = await coldReadFixture(test, true, proof), stop = new Error('EXPECTED_TERMINAL_PREFIX_COMPARISON');
  const original = originalPayload.captureWorkspaceDeletionOriginalPayloadAbsence;
  vi.spyOn(originalPayload, 'captureWorkspaceDeletionOriginalPayloadAbsence').mockImplementation(async (...args) => {
    const absence = await original(...args), owner = captureBinding(args[1]).owner;
    return { ...absence, async assertAbsent() { t.trace.push(`original:${owner}`); await absence.assertAbsent(); } };
  });
  const retire = retirement.retireWorkspaceDeletionInventory;
  let observed: unknown;
  vi.spyOn(retirement, 'retireWorkspaceDeletionInventory').mockImplementation((root, journal, authority, fs, read, notice) => {
    expect(typeof read?.assertBeforeSlotRead).toBe('function');
    const before = t.trace.length;
    const selectedJournal = slots.createNodeCrashSafeFileSlotFileSystem(t.f.journalPaths, maximumWorkspaceDeletionJournalBytes);
    const readSlot = selectedJournal.readSlot.bind(selectedJournal);
    selectedJournal.readSlot = (...args) => { t.trace.push(`journal:${args[0]}`); return readSlot(...args); };
    return retire(root, journal, authority, { ...fs, journal: selectedJournal, directories: {
      async identity() {
        observed = t.trace.slice(before);
        throw stop;
      }, async names() { throw new Error('UNEXPECTED_NAMES'); },
    } }, read, notice);
  });
  await expect(t.run()).rejects.toBe(stop);
  const owners = t.f.journal.formatVersion === 2 ? t.f.journal.originalJournalProofs.map(row => row.owner) : [];
  const selected = ['full', ...owners.map(owner => `original:${owner}`), 'full'];
  expect(observed).toEqual([...selected, 'journal:current', 'journal:backup', 'journal:next', ...selected]); await t.retained();
});
