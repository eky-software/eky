import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { deletionTestJournal } from './workspaceDeletionDataTestSupport.js';
import { observeDeletionCommandFailures } from './workspaceDeletionCommandEvidenceTestSupport.js';
import { createWorkspaceDeletionCommand } from './workspaceDeletionCommand.js';
import { createSwitchRegistry } from '../switch/workspaceSwitchTestSupport.js';
import * as metadata from './workspaceDeletionMetadataCleanup.js';
import * as payload from './workspaceDeletionPayloadExecutor.js';
import * as phase from './workspaceDeletionPhaseSelection.js';
import * as publication from './workspaceDeletionPublication.js';
import { WorkspaceDeletionInventoryStore } from './workspaceDeletionInventoryStore.js';
import { deletionTestRecords } from './workspaceDeletionDataTestSupport.js';
import { validateWorkspaceId } from '../registry/workspaceIdValidation.js';

it('observes the actual factory result without changing its promise, arguments or first error', async test => {
  const journal = deletionTestJournal('purged');
  let release!: (value: typeof journal) => void;
  const pending = new Promise<typeof journal>(resolve => { release = resolve; });
  const work = vi.fn<ReturnType<typeof metadata.createWorkspaceDeletionMetadataCleaner>>(() => pending);
  vi.spyOn(metadata, 'createWorkspaceDeletionMetadataCleaner').mockReturnValue(work);
  const sink = { record: vi.fn(), flush: vi.fn(async () => undefined) };
  const observed = observeDeletionCommandFailures(test, sink);
  const root = join(tmpdir(), 'eky-deletion-evidence-fixture');
  observed.preparedRoot(root);
  const never = async () => { throw new Error('SYNTHETIC_UNEXPECTED_PORT'); };
  const input = { userDataRoot: root, registry: { inspectSlots: never }, assertWritersAbsent: never };
  const authority = { assertCurrent() { }, async assertOwned() { } };
  const result = metadata.createWorkspaceDeletionMetadataCleaner(input)(journal.target.operationId, authority, journal);
  expect(result).toBe(pending);
  expect(work).toHaveBeenCalledWith(journal.target.operationId, authority, journal);
  expect(observed.phase()).toBe('metadata');
  const first = new Error('SYNTHETIC_FIRST_FAILURE', { cause: new Error('SYNTHETIC_ORIGINAL_CAUSE') });
  observed.record(first); observed.record(new Error('SYNTHETIC_LATER_CLEANUP_FAILURE'));
  expect(sink.record).toHaveBeenCalledTimes(1);
  expect(sink.record.mock.calls[0]?.[0]).toMatchObject({ phase: 'workspaceDeletionRoles_metadata', error: first });
  expect(sink.record.mock.calls[0]?.[0].error).toBe(first);
  expect(sink.record.mock.calls[0]?.[0].testId).toBe(`${test.task.id}:${root}`);
  expect(sink.record.mock.calls[0]?.[0].retryCount).toBe(test.task.result?.retryCount);
  expect(sink.record.mock.calls[0]?.[0].repeatCount).toBe(test.task.result?.repeatCount);
  expect(sink.flush).not.toHaveBeenCalled();
  release(journal); expect(await result).toBe(journal);
});

it('keeps a preparation failure when the optional sink itself throws', async test => {
  const sink = {
    record: vi.fn(() => { throw new Error('SYNTHETIC_EVIDENCE_UNAVAILABLE'); }),
    flush: vi.fn(async () => undefined)
  };
  const observed = observeDeletionCommandFailures(test, sink);
  const first = new Error('SYNTHETIC_PREPARATION_FAILED');
  expect(() => observed.record(first)).not.toThrow();
  expect(() => observed.record(new Error('SYNTHETIC_LATER_FAILURE'))).not.toThrow();
  expect(sink.record).toHaveBeenCalledTimes(1);
  expect(observed.phase()).toBe('preparation');
});

it('retains the original failure from the actual command composition and its observed stage', async test => {
  const journal = deletionTestJournal();
  const first = new Error('SYNTHETIC_COMPOSED_PAYLOAD_FAILURE');
  vi.spyOn(payload, 'createWorkspaceDeletionPayloadExecutor').mockReturnValue(async () => { throw first; });
  vi.spyOn(phase, 'captureWorkspaceDeletionPhaseSelection').mockResolvedValue({
    journal, registryState: 'before', registryNeedsRecovery: false,
    afterRegistry: { ...createSwitchRegistry(), formatVersion: 2 },
    journalSlots: { current: undefined, next: undefined, backup: undefined },
    registrySlots: { current: undefined, next: undefined, backup: undefined },
    assertCurrent() {}, async assertSelected() {}, async assertExternalSelection() {},
    async assertJournalSelected() {}, async assertJournalReadOwned() { throw new Error('UNEXPECTED_TEST_READ_PORT'); }, revoke() {},
  });
  const sink = { record: vi.fn(), flush: vi.fn(async () => undefined) };
  const observed = observeDeletionCommandFailures(test, sink);
  const never = async () => { throw new Error('SYNTHETIC_UNEXPECTED_PORT'); };
  const command = createWorkspaceDeletionCommand({ userDataRoot: join(tmpdir(), 'eky-evidence-composition'),
    registry: { inspectSlots: never, writeSelected: never, recoverSelected: never }, assertWritersAbsent: never });
  const removed = vi.fn();
  observed.admission();
  const result = await command.resume(journal.target.operationId, {
    assertCurrent() {}, async assertOwned() {}, recordRemoved: removed,
  }).catch(error => { observed.record(error); return error; });
  expect(result).toBe(first);
  expect(observed.phase()).toBe('payload');
  expect(sink.record.mock.calls[0]?.[0].error).toBe(first);
  expect(sink.record.mock.calls[0]?.[0].phase).toBe('workspaceDeletionRoles_payload');
  expect(removed).not.toHaveBeenCalled();
});

function evidenceGate<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

it.for(['publicationInventoryWrite', 'publicationComparison1', 'publicationComparison2', 'publicationComparison3'] as const)(
  'preserves the original promise and failure through the composed $0 observation', async (detail, test) => {
    const journal = deletionTestJournal(), root = join(tmpdir(), 'eky-evidence-publication');
    const selected = { target: journal.target, inventory: journal.inventory,
      inventoryFileIdentity: journal.inventoryFileIdentity, operationRootIdentity: journal.operationRootIdentity,
      operationParentIdentity: journal.operationParentIdentity };
    const write = evidenceGate<typeof selected>(), read = evidenceGate<undefined>(), entered = evidenceGate<void>();
    let comparisons = 0;
    const writeResult = detail === 'publicationInventoryWrite' ? write.promise : Promise.resolve(selected);
    const publish = vi.fn<WorkspaceDeletionInventoryStore['publish']>(() => {
      if (detail === 'publicationInventoryWrite') entered.resolve();
      return writeResult;
    });
    const compareResults: Promise<undefined>[] = [];
    const compare = vi.fn<WorkspaceDeletionInventoryStore['assertRecords']>(() => {
      const hit = detail === `publicationComparison${++comparisons}`;
      const result = hit ? read.promise : Promise.resolve(undefined);
      compareResults.push(result); if (hit) entered.resolve(); return result;
    });
    vi.spyOn(WorkspaceDeletionInventoryStore.prototype, 'publish').mockImplementation(publish);
    vi.spyOn(WorkspaceDeletionInventoryStore.prototype, 'assertRecords').mockImplementation(compare);
    const authority = { assertAuthority() {}, async assertExternalSelection() {} };
    vi.spyOn(publication, 'createWorkspaceDeletionPublisher').mockReturnValue(async () => {
      const inventory = new WorkspaceDeletionInventoryStore(root, journal.target.operationId);
      const writing = inventory.publish(journal.target, deletionTestRecords(), authority);
      expect(writing).toBe(writeResult); await writing;
      for (let index = 0; index < 3; index++) {
        const reading = inventory.assertRecords(selected, deletionTestRecords(), authority);
        expect(reading).toBe(compareResults[index]); await reading;
      }
      return { journal, workspaceRootIdentity: journal.inventoryFileIdentity };
    });
    const sink = { record: vi.fn(), flush: vi.fn(async () => undefined) };
    const observed = observeDeletionCommandFailures(test, sink);
    observed.preparedRoot(root);
    const never = async () => { throw new Error('SYNTHETIC_UNEXPECTED_PORT'); };
    const command = createWorkspaceDeletionCommand({ userDataRoot: root,
      registry: { inspectSlots: never, writeSelected: never, recoverSelected: never }, assertWritersAbsent: never });
    const target = { workspaceId: validateWorkspaceId(journal.target.workspaceId), workspaceLabel: 'Synthetic company',
      profileId: journal.target.lineageIdentity.profileId, lifecycleState: 'ready' as const,
      previousActiveWorkspaceId: journal.previousActiveWorkspaceId, registrySha256: journal.registryBeforeSha256,
      registryEntrySha256: journal.target.registryEntrySha256, rootIdentity: journal.inventoryFileIdentity };
    const first = new Error('SYNTHETIC_C_ORIGINAL', { cause: new Error('SYNTHETIC_C_CAUSE') });
    const outcome = command.publish(() => {}, async () => {}, target,
      { operationId: journal.target.operationId, target, backupDisposition: 'explicitDataLoss' }, async () => {})
      .catch(error => { observed.record(error); return error; });
    try {
      await Promise.race([entered.promise, outcome.then(() => { throw new Error('SYNTHETIC_DETAIL_NOT_ENTERED'); })]);
      expect(observed.phase()).toBe(detail); expect(sink.flush).not.toHaveBeenCalled();
      if (detail === 'publicationInventoryWrite') write.reject(first); else read.reject(first);
      expect(await outcome).toBe(first);
      observed.record(new Error('SYNTHETIC_LATE_CLEANUP'));
      expect(sink.record).toHaveBeenCalledTimes(1);
      expect(sink.record.mock.calls[0]?.[0].error).toBe(first);
      expect(sink.record.mock.calls[0]?.[0].phase).toBe(`workspaceDeletionRoles_${detail}`);
      expect(publish).toHaveBeenCalledWith(journal.target, expect.anything(), authority);
    } finally { write.resolve(selected); read.resolve(undefined); await outcome; }
  });

it('does not let an older publication completion replace a newer pending detail', async test => {
  const journal = deletionTestJournal(), write = evidenceGate<never>(), read = evidenceGate<undefined>();
  const selected = { target: journal.target, inventory: journal.inventory,
    inventoryFileIdentity: journal.inventoryFileIdentity, operationRootIdentity: journal.operationRootIdentity,
    operationParentIdentity: journal.operationParentIdentity };
  const completedWrite = evidenceGate<typeof selected>();
  vi.spyOn(WorkspaceDeletionInventoryStore.prototype, 'publish').mockReturnValue(completedWrite.promise);
  vi.spyOn(WorkspaceDeletionInventoryStore.prototype, 'assertRecords').mockReturnValue(read.promise);
  let published!: Promise<typeof selected>, compared!: Promise<void>;
  vi.spyOn(publication, 'createWorkspaceDeletionPublisher').mockReturnValue(() => write.promise);
  const observed = observeDeletionCommandFailures(test, { record: vi.fn(), flush: vi.fn(async () => undefined) });
  const root = join(tmpdir(), 'eky-evidence-stale-completion');
  const never = async () => { throw new Error('SYNTHETIC_UNEXPECTED_PORT'); };
  const publisher = publication.createWorkspaceDeletionPublisher({ userDataRoot: root,
    registry: { inspectSlots: never }, assertWritersAbsent: never });
  const target = { workspaceId: validateWorkspaceId(journal.target.workspaceId), workspaceLabel: 'Synthetic company',
    profileId: journal.target.lineageIdentity.profileId, lifecycleState: 'ready' as const,
    previousActiveWorkspaceId: journal.previousActiveWorkspaceId, registrySha256: journal.registryBeforeSha256,
    registryEntrySha256: journal.target.registryEntrySha256, rootIdentity: journal.inventoryFileIdentity };
  const pending = publisher(() => {}, async () => {}, target,
    { operationId: journal.target.operationId, target, backupDisposition: 'explicitDataLoss' }, async () => {});
  const store = new WorkspaceDeletionInventoryStore(root, journal.target.operationId);
  const authority = { assertAuthority() {}, async assertExternalSelection() {} };
  try {
    published = store.publish(journal.target, deletionTestRecords(), authority);
    compared = store.assertRecords(selected, deletionTestRecords(), authority);
    expect(observed.phase()).toBe('publicationComparison1');
    completedWrite.resolve(selected); await published;
    expect(observed.phase()).toBe('publicationComparison1');
    read.resolve(undefined); await compared;
    expect(observed.phase()).toBe('publication');
  } finally {
    completedWrite.resolve(selected); read.resolve(undefined); write.reject(new Error('SYNTHETIC_END_OBSERVATION'));
    await Promise.allSettled([published, compared, pending]);
  }
});
