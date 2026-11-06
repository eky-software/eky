import { expect, it, vi } from 'vitest';
import { clearAbsentWorkspaceDeletionBinding } from './workspaceDeletionBindingCleanup.js';
import { deletionTestHeader as target } from './workspaceDeletionDataTestSupport.js';
import { workspaceDeletionRemnantReads as nativeReads } from './workspaceDeletionRemnantCensus.js';
import { remnantBindingFixture } from './workspaceRemnantBindingTestSupport.js';
import { WorkspaceRemnantBindingStore } from './workspaceRemnantBindingStore.js';

const owners = ['workspaceReplacement', 'workspaceActivationMigration', 'workspaceImport', 'workspaceLegacyAdoption'] as const;

it.for(owners)('uses one complete selection-writer-selection bracket at the first %s source read', async (owner, context) => {
  const f = await remnantBindingFixture(context, owner);
  await f.store().publish(f.binding, f.authority);
  const events: string[] = [];
  let inspected = false, mutationInspected = false;
  const authority = {
    assertAuthority() { context.signal.throwIfAborted(); f.authority.assertAuthority(); },
    async assertExternalSelection() { events.push('selection'); await f.authority.assertExternalSelection(); },
    async assertWritersAbsent() { events.push('writers'); },
  };
  const originalClear = WorkspaceRemnantBindingStore.prototype.clearAfterPayloadsAbsent;
  vi.spyOn(WorkspaceRemnantBindingStore.prototype, 'clearAfterPayloadsAbsent').mockImplementation(async function (
    this: WorkspaceRemnantBindingStore, value, proof,
  ) {
    events.length = 0;
    await proof.assertExternalSelection();
    expect(events).toEqual(['selection', 'writers', 'selection']);
    mutationInspected = true;
    return originalClear.call(this, value, proof);
  });
  const work = clearAbsentWorkspaceDeletionBinding(f.root, target, f.binding, authority, { fileSystem: f.fileSystem,
    reads: { ...nativeReads, async directoryIdentity(path, guard) {
      if (!inspected) {
        inspected = true;
        expect(events).toEqual(['selection', 'writers', 'selection']);
      }
      return nativeReads.directoryIdentity(path, guard);
    } },
  });
  context.onTestFinished(async () => { await work.catch(() => undefined); vi.restoreAllMocks(); });
  await work;
  expect(inspected).toBe(true); expect(mutationInspected).toBe(true);
  expect((await f.store().inspect(f.authority)).mode).toBe('absent');
});

for (const failureAt of ['selection', 'writers', 'afterWriters'] as const) {
  it.for(owners)(`retains the original ${failureAt} failure before %s source reads and mutations`, async (owner, context) => {
    const f = await remnantBindingFixture(context, owner);
    await f.store().publish(f.binding, f.authority);
    const before = await f.snapshot();
    const failure = new Error(`SYNTHETIC_${failureAt}_FAILED`);
    let writerObserved = false, reads = 0, removals = 0;
    const authority = {
      assertAuthority() { context.signal.throwIfAborted(); f.authority.assertAuthority(); },
      async assertExternalSelection() {
        if (failureAt === 'selection' || (failureAt === 'afterWriters' && writerObserved)) throw failure;
        await f.authority.assertExternalSelection();
      },
      async assertWritersAbsent() { writerObserved = true; if (failureAt === 'writers') throw failure; },
    };
    const work = clearAbsentWorkspaceDeletionBinding(f.root, target, f.binding, authority, {
      fileSystem: {
        prepareDirectory: guard => f.fileSystem.prepareDirectory(guard),
        readSlot: (...args) => f.fileSystem.readSlot(...args),
        createNextWriter: guard => f.fileSystem.createNextWriter(guard),
        moveSlot: (...args) => f.fileSystem.moveSlot(...args),
        syncDirectory: guard => f.fileSystem.syncDirectory(guard),
        async removeSlot(...args) { removals++; return f.fileSystem.removeSlot(...args); },
      },
      reads: { ...nativeReads, async directoryIdentity(...args) { reads++; return nativeReads.directoryIdentity(...args); } },
    });
    context.onTestFinished(async () => { await work.catch(() => undefined); });
    await expect(work).rejects.toBe(failure);
    expect(reads).toBe(0); expect(removals).toBe(0);
    expect(await f.snapshot()).toEqual(before);
  });
}

it.for(owners)('retains a one-shot source selection error inside %s removal', async (owner, context) => {
  const f = await remnantBindingFixture(context, owner);
  await f.store().publish(f.binding, f.authority);
  const before = await f.snapshot(), failure = new Error('SYNTHETIC_ONCE_SOURCE_SELECTION_FAILED');
  let removalStarted = false, injectionUsed = false, failNextSelection = false, failures = 0;
  const authority = {
    assertAuthority() { context.signal.throwIfAborted(); f.authority.assertAuthority(); },
    async assertExternalSelection() {
      if (failNextSelection) { failNextSelection = false; failures++; throw failure; }
      await f.authority.assertExternalSelection();
    },
    async assertWritersAbsent() {},
  };
  const work = clearAbsentWorkspaceDeletionBinding(f.root, target, f.binding, authority, {
    fileSystem: {
      prepareDirectory: guard => f.fileSystem.prepareDirectory(guard),
      readSlot: (...args) => f.fileSystem.readSlot(...args),
      createNextWriter: guard => f.fileSystem.createNextWriter(guard),
      moveSlot: (...args) => f.fileSystem.moveSlot(...args),
      syncDirectory: guard => f.fileSystem.syncDirectory(guard),
      removeSlot(slot, guard) {
        return f.fileSystem.removeSlot(slot, {
          assertAuthority: () => guard!.assertAuthority(),
          async beforeMutation() { removalStarted = true; await guard!.beforeMutation(); },
        });
      },
    },
    reads: { ...nativeReads, async directoryIdentity(path, guard) {
      const identity = await nativeReads.directoryIdentity(path, guard);
      if (removalStarted && !injectionUsed) { injectionUsed = true; failNextSelection = true; }
      return identity;
    } },
  });
  context.onTestFinished(async () => { await work.catch(() => undefined); });
  await expect(work).rejects.toBe(failure);
  expect(injectionUsed).toBe(true); expect(failures).toBe(1);
  expect(await f.snapshot()).toEqual(before);
});
