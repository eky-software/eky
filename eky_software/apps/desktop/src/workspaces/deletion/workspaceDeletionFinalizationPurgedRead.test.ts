import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { createNodeCrashSafeFileSlotFileSystem } from '../persistence/crashSafeFileSlot.js';
import { createWorkspaceDeletionFinalizer } from './workspaceDeletionFinalization.js';
import { createWorkspaceDeletionFinalizationTestFixture as fixture } from './workspaceDeletionFinalizationTestSupport.js';
import { WorkspaceDeletionInventoryStore } from './workspaceDeletionInventoryStore.js';
import { maximumWorkspaceDeletionJournalBytes } from './workspaceDeletionJournalCodec.js';
import { WorkspaceDeletionJournalStore } from './workspaceDeletionJournalStore.js';
import * as purgedPhase from './workspaceDeletionPhaseSelection.js';
import * as purgedMetadata from './workspaceDeletionMetadataCleanup.js';
import * as purgedFiles from './workspaceDeletionInventoryFile.js';
import { deriveWorkspaceRoot as purgedWorkspaceRoot } from '../registry/deriveWorkspaceRoot.js';
function purgedGate() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}
function purgedLeaves(error: unknown): unknown[] {
  return error instanceof AggregateError ? error.errors.flatMap(purgedLeaves) : [error];
}
it('finalizer purged read compares registry and unchanged physical ownership cadence', async (test) => {
  const f = await fixture(test), stop = new Error('SYNTHETIC_STOP_BEFORE_TERMINAL_PUBLICATION');
  let inRead = false, registryReads = 0, owners = 0, writers = 0, reads = 0;
  let fileGuards = 0, payloadRows = 0, readOwnershipCalls = 0;
  const capture = purgedPhase.captureWorkspaceDeletionPhaseSelection;
  const checkedCycle = async (work: () => Promise<void>) => {
    const inside = inRead, beforeOwners = owners, beforeWriters = writers;
    await work();
    if (inside) {
      readOwnershipCalls++;
      expect(owners - beforeOwners).toBe(4);
      expect(writers - beforeWriters).toBe(2);
    }
  };
  vi.spyOn(purgedPhase, 'captureWorkspaceDeletionPhaseSelection').mockImplementation(async (input) => {
    const selected = await capture(input);
    return { ...selected, assertExternalSelection: () => checkedCycle(selected.assertExternalSelection),
      assertJournalReadOwned: () => checkedCycle(selected.assertJournalReadOwned) };
  });
  const actual = WorkspaceDeletionInventoryStore.prototype.consumeSelectedRecords;
  vi.spyOn(WorkspaceDeletionInventoryStore.prototype, 'consumeSelectedRecords').mockImplementation(async function (this: WorkspaceDeletionInventoryStore, ...args) {
    inRead = true;
    reads++;
    const authority = args[1], row = args[2];
    try {
      return await actual.call(this, args[0], { ...authority, async assertExternalSelection() {
          fileGuards++;
          await authority.assertExternalSelection();
        } }, async (value) => { if (value.role !== 'inspectionEvidence')
        payloadRows++; await row(value); }, args[3]);
    }
    finally {
      inRead = false;
    }
  });
  vi.spyOn(WorkspaceDeletionJournalStore.prototype, 'advance').mockImplementation(async () => { throw stop; });
  const command = createWorkspaceDeletionFinalizer({ userDataRoot: f.root,
    registry: { async inspectSlots(...args: Parameters<typeof f.registry.inspectSlots>) {
        if (inRead)
          registryReads++;
        return f.registry.inspectSlots(...args);
      } }, async assertWritersAbsent() { f.authority.assertCurrent(); if (inRead)
      writers++; },
  });
  const authority = { assertCurrent: f.authority.assertCurrent, async assertOwned() {
      if (inRead)
        owners++;
      await f.authority.assertOwned();
    } };
  const result = await f.track(command(f.header.operationId, authority)).then(() => ({ ok: true }), (error: unknown) => ({ error }));
  expect('error' in result).toBe(true);
  expect((result as {
    error: unknown;
  }).error).toBe(stop);
  expect(reads).toBe(1);
  expect(owners).toBeGreaterThan(0);
  expect(writers).toBeGreaterThan(0);
  expect(owners).toBe(writers * 2);
  expect(readOwnershipCalls).toBe(fileGuards + payloadRows);
  expect(owners).toBe(readOwnershipCalls * 4);
  expect(writers).toBe(readOwnershipCalls * 2);
  expect(registryReads).toBe(0);
  expect(await readFile(f.journalPaths.currentPath)).toEqual(f.journalBytes);
  expect(await readFile(f.inventoryPaths.currentPath)).toEqual(f.inventoryBytes);
  await f.preserved();
});
for (const persistent of [false, true]) {
  it(`finalizer purged read models ${persistent ? 'persistent' : 'fully restored'} registry selection within the read`, async (test) => {
    const f = await fixture(test), first = new Error('SYNTHETIC_REGISTRY_SELECTION_CHANGED'), stop = new Error('SYNTHETIC_STOP_AFTER_COMPLETE_PROOF');
    let changed = false, once = false;
    const capture = purgedPhase.captureWorkspaceDeletionPhaseSelection;
    vi.spyOn(purgedPhase, 'captureWorkspaceDeletionPhaseSelection').mockImplementation(async (input) => {
      const selected = await capture(input);
      return { ...selected, async assertExternalSelection() {
          if (changed)
            throw first;
          await selected.assertExternalSelection();
        } };
    });
    const consume = WorkspaceDeletionInventoryStore.prototype.consumeSelectedRecords;
    vi.spyOn(WorkspaceDeletionInventoryStore.prototype, 'consumeSelectedRecords').mockImplementation(async function (this: WorkspaceDeletionInventoryStore, ...args) {
      if (once)
        return consume.apply(this, args);
      once = true;
      changed = true;
      try {
        return await consume.apply(this, args);
      }
      finally {
        if (!persistent)
          changed = false;
      }
    });
    vi.spyOn(WorkspaceDeletionJournalStore.prototype, 'advance').mockImplementation(async () => { throw stop; });
    const outcome = await f.run().then(() => ({ ok: true }), (error: unknown) => ({ error }));
    expect('error' in outcome).toBe(true);
    expect((outcome as {
      error: unknown;
    }).error).toBe(!persistent ? stop : first);
    expect(once).toBe(true);
    expect(await readFile(f.journalPaths.currentPath)).toEqual(f.journalBytes);
    expect(await readFile(f.inventoryPaths.currentPath)).toEqual(f.inventoryBytes);
    await f.preserved();
  });
}
it('finalizer purged read blocks real changed registry before metadata IO or terminal publication', async (test) => {
  const f = await fixture(test);
  let once = false, metadata = 0, publication = 0;
  const attack = Buffer.from(JSON.stringify(f.after, null, 2) + '\n');
  const otherRoot = purgedWorkspaceRoot(f.root, f.before.workspaces[0]!.workspaceId, 1).workspaceRoot;
  const retained = [join(otherRoot, 'kept'), join(f.root, 'user-export.ekybackup')];
  const bytes = await Promise.all(retained.map(path => readFile(path)));
  const consume = WorkspaceDeletionInventoryStore.prototype.consumeSelectedRecords;
  vi.spyOn(WorkspaceDeletionInventoryStore.prototype, 'consumeSelectedRecords').mockImplementation(async function (this: WorkspaceDeletionInventoryStore, ...args) {
    await consume.apply(this, args);
    if (!once) {
      once = true;
      await writeFile(f.registryPath, attack);
    }
  });
  const absent = purgedMetadata.assertWorkspaceDeletionMetadataAbsent;
  vi.spyOn(purgedMetadata, 'assertWorkspaceDeletionMetadataAbsent').mockImplementation(async (...args) => { metadata++; return absent(...args); });
  vi.spyOn(WorkspaceDeletionJournalStore.prototype, 'advance').mockImplementation(async () => { publication++; throw new Error('UNEXPECTED_PUBLICATION'); });
  await expect(f.run()).rejects.toThrow('WORKSPACE_DELETE_JOURNAL_CONFLICT');
  expect(once).toBe(true);
  expect(metadata).toBe(0);
  expect(publication).toBe(0);
  expect(await readFile(f.registryPath)).toEqual(attack);
  expect(await readFile(f.journalPaths.currentPath)).toEqual(f.journalBytes);
  expect(await readFile(f.inventoryPaths.currentPath)).toEqual(f.inventoryBytes);
  expect(await Promise.all(retained.map(path => readFile(path)))).toEqual(bytes);
});
it('finalizer purged read expires successful callbacks and failure hooks before metadata and during next proof', async (test) => {
  const f = await fixture(test), stop = new Error('SYNTHETIC_STOP_AFTER_SECOND_PROOF');
  const scopes: Parameters<WorkspaceDeletionInventoryStore['consumeSelectedRecords']>[1][] = [];
  const failures: (((error: unknown) => void) | undefined)[] = [];
  let reads = 0, probeBeforeMetadata = false, probeInsideNext = false, checks = 0;
  const read = WorkspaceDeletionInventoryStore.prototype.consumeSelectedRecords;
  vi.spyOn(WorkspaceDeletionInventoryStore.prototype, 'consumeSelectedRecords').mockImplementation(async function (this: WorkspaceDeletionInventoryStore, ...args) {
    reads++;
    scopes.push(args[1]);
    failures.push(args[3]);
    if (reads === 2) {
      const before = checks;
      await expect(scopes[0]!.assertExternalSelection()).rejects.toThrow('WORKSPACE_DELETE_JOURNAL_CONFLICT');
      failures[0]!(new Error('SYNTHETIC_STALE_FAILURE_HOOK'));
      expect(checks).toBe(before);
      probeInsideNext = true;
    }
    return read.apply(this, args);
  });
  const capture = purgedPhase.captureWorkspaceDeletionPhaseSelection;
  vi.spyOn(purgedPhase, 'captureWorkspaceDeletionPhaseSelection').mockImplementation(async (input) => {
    const selected = await capture(input);
    return { ...selected, async assertExternalSelection() {
        if (reads === 1 && !probeBeforeMetadata) {
          const before = checks;
          await expect(scopes[0]!.assertExternalSelection()).rejects.toThrow('WORKSPACE_DELETE_JOURNAL_CONFLICT');
          failures[0]!(new Error('SYNTHETIC_STALE_BEFORE_METADATA'));
          expect(checks).toBe(before);
          probeBeforeMetadata = true;
        }
        checks++;
        await selected.assertExternalSelection();
      }, async assertJournalReadOwned() { checks++; await selected.assertJournalReadOwned(); } };
  });
  vi.spyOn(WorkspaceDeletionJournalStore.prototype, 'advance').mockImplementation(async (_journal, selection) => {
    await selection.assertExternalSelection();
    throw stop;
  });
  const outcome = await f.run().then(() => ({ ok: true }), (error: unknown) => ({ error }));
  expect('error' in outcome).toBe(true);
  expect((outcome as {
    error: unknown;
  }).error).toBe(stop);
  expect(reads).toBe(2);
  expect(scopes[0]).not.toBe(scopes[1]);
  expect(probeBeforeMetadata).toBe(true);
  expect(probeInsideNext).toBe(true);
  expect(await readFile(f.journalPaths.currentPath)).toEqual(f.journalBytes);
  expect(await readFile(f.inventoryPaths.currentPath)).toEqual(f.inventoryBytes);
  await f.preserved();
});
for (const mode of ['read', 'close'] as const)
  for (const kind of ['error', 'undefined'] as const) {
    it(`finalizer purged read joins held actual ${mode} with first ${kind} and independent close`, async (test) => {
      const f = await fixture(test), first = kind === 'error' ? new Error('SYNTHETIC_PURGED_READ_FIRST') : undefined;
      const closing = new Error('SYNTHETIC_PURGED_READ_CLOSE'), held = purgedGate(), entered = purgedGate();
      f.releases.push(held.release);
      let closed = 0, settled = false, consumed = 0;
      let scope: Parameters<WorkspaceDeletionInventoryStore['consumeSelectedRecords']>[1] | undefined;
      const consume = WorkspaceDeletionInventoryStore.prototype.consumeSelectedRecords;
      vi.spyOn(WorkspaceDeletionInventoryStore.prototype, 'consumeSelectedRecords').mockImplementation(async function (this: WorkspaceDeletionInventoryStore, ...args) {
        consumed++;
        scope = args[1];
        return consume.apply(this, args);
      });
      const open = purgedFiles.openWorkspaceDeletionInventoryFile;
      vi.spyOn(purgedFiles, 'openWorkspaceDeletionInventoryFile').mockImplementation(async (...args) => {
        const file = await open(...args);
        if (args[0] !== f.inventoryPaths.currentPath)
          return file;
        return { ...file, async read(...values) {
            await file.read(...values);
            if (mode === 'read') {
              entered.release();
              await held.promise;
            }
            throw first;
          }, async close() {
            if (mode === 'close') {
              entered.release();
              await held.promise;
            }
            await file.close();
            closed++;
            throw closing;
          } };
      });
      const command = createWorkspaceDeletionFinalizer({ userDataRoot: f.root, registry: f.registry,
        async assertWritersAbsent() { f.authority.assertCurrent(); } });
      const outcome = f.track(command(f.header.operationId, f.authority))
        .then(() => ({ ok: true }), (error: unknown) => ({ error })).finally(() => { settled = true; });
      try {
        await Promise.race([entered.promise, outcome.then(() => { throw new Error('PURGED_IO_NOT_HELD'); })]);
        expect(settled).toBe(false);
        expect(closed).toBe(0);
        expect(consumed).toBe(1);
        if (mode === 'close') {
          const rejected = await scope!.assertExternalSelection().then(() => ({ ok: true }), (error: unknown) => ({ error }));
          expect('error' in rejected).toBe(true);
          expect((rejected as {
            error: unknown;
          }).error).toBe(first);
        }
        f.revoke();
        await expect(command(f.header.operationId, f.authority)).rejects.toThrow('WORKSPACE_DELETE_JOURNAL_CONFLICT');
        expect(settled).toBe(false);
      }
      finally {
        held.release();
      }
      const result = await outcome;
      expect('error' in result).toBe(true);
      const error = (result as {
        error: unknown;
      }).error;
      expect(error).toBeInstanceOf(AggregateError);
      expect((error as AggregateError).errors[0]).toBe(first);
      expect((error as AggregateError).errors[1]).toBe(closing);
      expect((error as AggregateError).errors).toEqual([first, closing]);
      expect(purgedLeaves(error)).toEqual([first, closing]);
      expect(closed).toBe(1);
      expect(await readFile(f.journalPaths.currentPath)).toEqual(f.journalBytes);
      expect(await readFile(f.inventoryPaths.currentPath)).toEqual(f.inventoryBytes);
      await f.preserved();
    });
  }
for (const kind of ['error', 'undefined'] as const) {
  it(`finalizer purged read native backup guard retains first ${kind} and actual close after normalization`, async (test) => {
    const f = await fixture(test), first = kind === 'error' ? new Error('SYNTHETIC_NATIVE_PURGED_FIRST') : undefined;
    const closing = new Error('SYNTHETIC_NATIVE_PURGED_CLOSE'), fs = journalSystem(f);
    let armed = false, closed = 0, normalized: unknown, rejected = false;
    const remove = fs.removeSlot.bind(fs);
    fs.removeSlot = async (...args) => {
      if (args[0] !== 'backup')
        return remove(...args);
      armed = true;
      try {
        return await remove(...args);
      }
      catch (error) {
        rejected = true;
        normalized = error;
        throw error;
      }
      finally {
        armed = false;
      }
    };
    const advance = WorkspaceDeletionJournalStore.prototype.advance;
    vi.spyOn(WorkspaceDeletionJournalStore.prototype, 'advance').mockImplementationOnce((...args) => advance.apply(new WorkspaceDeletionJournalStore(f.root, fs), args));
    const open = purgedFiles.openWorkspaceDeletionInventoryFile;
    vi.spyOn(purgedFiles, 'openWorkspaceDeletionInventoryFile').mockImplementation(async (...args) => {
      const file = await open(...args);
      if (!armed || args[0] !== f.inventoryPaths.currentPath)
        return file;
      return { ...file, async read(...values) { await file.read(...values); throw first; },
        async close() { await file.close(); closed++; throw closing; } };
    });
    const outcome = await f.run().then(() => ({ ok: true }), (error: unknown) => ({ error }));
    expect('error' in outcome).toBe(true);
    expect(rejected).toBe(true);
    expect(normalized).toMatchObject({ name: 'CrashSafeFileSlotError', message: 'CRASH_SAFE_FILE_SLOT_UNAVAILABLE', failure: 'unavailable' });
    const error = (outcome as {
      error: unknown;
    }).error;
    expect(error).toBeInstanceOf(AggregateError);
    expect((error as AggregateError).errors).toHaveLength(2);
    expect((error as AggregateError).errors[0]).toBe(first);
    expect((error as AggregateError).errors[1]).toBe(closing);
    expect(closed).toBe(1);
    const selected = await f.store.inspect(f.authority.assertCurrent);
    expect(selected.slots.current?.value.phase).toBe('registryPublished');
    expect(selected.slots.next).toBeUndefined();
    expect(selected.slots.backup?.value.phase).toBe('purged');
    expect(Buffer.from(selected.slots.backup!.bytes)).toEqual(f.journalBytes);
    expect(await readFile(f.inventoryPaths.currentPath)).toEqual(f.inventoryBytes);
    await f.preserved();
  });
}

function journalSystem(f: Awaited<ReturnType<typeof fixture>>) {
  return createNodeCrashSafeFileSlotFileSystem(f.journalPaths, maximumWorkspaceDeletionJournalBytes);
}
