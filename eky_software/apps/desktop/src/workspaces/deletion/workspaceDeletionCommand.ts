import type { WorkspaceDeletionPreparationOptions } from '../management/workspaceDeletionPreparation.js';
import type { WorkspaceDeletionCompletion, WorkspaceDeletionExecutionStage, WorkspaceDeletionWorkAuthority } from '../management/workspaceManagementService.js';
import type { WorkspaceRegistryStore } from '../registry/workspaceRegistryStore.js';
import { checkedDeletionAuthority, deletionDataRecord, invalidDeletionData } from './workspaceDeletionDataValidation.js';
import { createWorkspaceDeletionFinalizer, createWorkspaceDeletionTerminalPhaseProducer,
  type WorkspaceDeletionTerminalPhaseObserver } from './workspaceDeletionFinalization.js';
import { captureWorkspaceDeletionJournal, type WorkspaceDeletionJournal } from './workspaceDeletionJournalCodec.js';
import { WorkspaceDeletionJournalStore } from './workspaceDeletionJournalStore.js';
import { createWorkspaceDeletionMetadataCleaner } from './workspaceDeletionMetadataCleanup.js';
import { createWorkspaceDeletionPayloadExecutor } from './workspaceDeletionPayloadExecutor.js';
import { captureWorkspaceDeletionPhaseSelection } from './workspaceDeletionPhaseSelection.js';
import { createWorkspaceDeletionPublisher, type WorkspaceDeletionPublicationHandoff } from './workspaceDeletionPublication.js';
import { createWorkspaceDeletionRegistryPublisher } from './workspaceDeletionRegistryPublication.js';

const invalidCode = 'WORKSPACE_DELETE_JOURNAL_CONFLICT';

// Main supplies admission and the live/cold owner. Both entries use these same physical stages.
export function createWorkspaceDeletionCommand(input: {
  observeTerminalPhase?: WorkspaceDeletionTerminalPhaseObserver;
  userDataRoot: string;
  registry: Pick<WorkspaceRegistryStore, 'inspectSlots' | 'writeSelected' | 'recoverSelected'>;
  assertWritersAbsent(): Promise<void>;
  observeStage?(stage: WorkspaceDeletionExecutionStage): void;
  beforeMetadata?(): Promise<void>;
  beforeJournalPublication?: WorkspaceDeletionPublicationHandoff;
  observePublicationPhase?: import('./workspaceDeletionPublication.js').WorkspaceDeletionPublicationPhaseObserver;
  observeSlotIo?: import('../persistence/crashSafeFileSlot.js').SlotIoObserver;
  coldSelection?: { assertReservationOwned(): Promise<void>; assertStableSelection(): Promise<void> };
}) {
  const observeTerminal = createWorkspaceDeletionTerminalPhaseProducer(input.observeTerminalPhase);
  const root = input.userDataRoot, writers = input.assertWritersAbsent.bind(input);
  const observe = input.observeStage?.bind(input);
  const beforeMetadata = input.beforeMetadata?.bind(input);
  const beforeJournalPublication = input.beforeJournalPublication?.bind(input);
  const suppliedPair = input.coldSelection;
  let coldSelection: { assertReservationOwned(): Promise<void>; assertStableSelection(): Promise<void> } | undefined;
  if (suppliedPair !== undefined) {
    deletionDataRecord(suppliedPair, ['assertReservationOwned', 'assertStableSelection'], invalidCode);
    if (typeof suppliedPair.assertReservationOwned !== 'function' || typeof suppliedPair.assertStableSelection !== 'function') {
      return invalidDeletionData(invalidCode);
    }
    coldSelection = Object.freeze({ assertReservationOwned: suppliedPair.assertReservationOwned.bind(suppliedPair),
      assertStableSelection: suppliedPair.assertStableSelection.bind(suppliedPair) });
  }
  const registry = { inspectSlots: input.registry.inspectSlots.bind(input.registry),
    writeSelected: input.registry.writeSelected.bind(input.registry), recoverSelected: input.registry.recoverSelected.bind(input.registry) };
  const stages = { userDataRoot: root, registry, assertWritersAbsent: writers, ...(coldSelection === undefined ? {} : { assertStableSelection: coldSelection.assertStableSelection }) };
  const publish = createWorkspaceDeletionPublisher({ ...stages,
    ...(input.observePublicationPhase === undefined ? {} : { observePublicationPhase: input.observePublicationPhase }),
    ...(input.observeSlotIo === undefined ? {} : { observeSlotIo: input.observeSlotIo }),
    ...(beforeJournalPublication === undefined ? {} : { beforeJournalPublication }) });
  const payload = createWorkspaceDeletionPayloadExecutor(stages);
  const publishRegistry = createWorkspaceDeletionRegistryPublisher(stages), clearMetadata = createWorkspaceDeletionMetadataCleaner(stages);
  const finalize = createWorkspaceDeletionFinalizer({ ...stages,
    ...(input.observeTerminalPhase === undefined ? {} : { observeTerminalPhase: input.observeTerminalPhase }),
    ...(coldSelection === undefined ? {} : { assertColdReadOwned: coldSelection.assertReservationOwned }) });
  let running = false, published: WorkspaceDeletionJournal | undefined;
  const exclusive = async <T>(work: () => Promise<T>) => {
    if (running) return invalidDeletionData(invalidCode);
    running = true;
    try { return await work(); } finally { running = false; }
  };
  const resumeBound = (operationId: string, authority: WorkspaceDeletionWorkAuthority,
    expectedBinding?: WorkspaceDeletionJournal,
    invocationObserver?: (stage: WorkspaceDeletionExecutionStage) => void): Promise<WorkspaceDeletionCompletion> => exclusive(async () => {
    const stageObserver = invocationObserver ?? observe;
    const observeStage = (stage: WorkspaceDeletionExecutionStage) => {
      try {
        const result: unknown = stageObserver?.(stage);
        if (result !== undefined) void Promise.resolve(result).catch(() => undefined);
      } catch { /* Observation cannot change deletion or its first failure. */ }
    };
    const current = checkedDeletionAuthority(authority.assertCurrent.bind(authority), invalidCode);
    const owned = coldSelection?.assertReservationOwned ?? authority.assertOwned.bind(authority);
    const recordRemoved = authority.recordRemoved.bind(authority);
    let active = true;
    const assertCurrent = () => { if (!active) return invalidDeletionData(invalidCode); current(); };
    const owner = { assertCurrent, async assertOwned() { assertCurrent(); await owned(); assertCurrent(); } };
    const assertStableSelection = async () => {
      assertCurrent();
      const result: unknown = await coldSelection!.assertStableSelection();
      assertCurrent(); if (result !== undefined) return invalidDeletionData(invalidCode);
    };
    try {
      observeStage('deleteAuthorization');
      if (coldSelection !== undefined) await assertStableSelection();
      const selected = await captureWorkspaceDeletionPhaseSelection({ operationId, authority: owner,
        journal: new WorkspaceDeletionJournalStore(root), registry, assertWritersAbsent: writers,
        ...(expectedBinding === undefined ? {} : { expectedBinding }) });
      let binding: WorkspaceDeletionJournal;
      try {
        if (coldSelection !== undefined) await assertStableSelection();
        binding = selected.journal;
      } finally { selected.revoke(); }
      if (binding.phase !== 'registryPublished') {
        observeStage('deletePurge');
        if (coldSelection !== undefined) await assertStableSelection();
        await payload(operationId, owner, binding);
        if (coldSelection !== undefined) await assertStableSelection();
        observeStage('deleteRegistry');
        if (coldSelection !== undefined) await assertStableSelection();
        await publishRegistry(operationId, owner, binding);
        if (coldSelection !== undefined) await assertStableSelection();
      }
      observeStage('deleteCleanup');
      if (beforeMetadata !== undefined) {
        // This awaited authority handoff is not the optional stage observation.
        if (coldSelection === undefined) await owner.assertOwned(); else await assertStableSelection();
        assertCurrent();
        const result: unknown = await beforeMetadata(); assertCurrent();
        if (result !== undefined) return invalidDeletionData(invalidCode);
      }
      if (binding.phase !== 'registryPublished') {
        if (coldSelection !== undefined) await assertStableSelection();
        await clearMetadata(operationId, owner, binding);
        if (coldSelection !== undefined) await assertStableSelection();
      }
      if (coldSelection !== undefined) await assertStableSelection();
      const terminal = await observeTerminal('finalization', () => finalize(operationId, owner, binding));
      if (coldSelection !== undefined) await assertStableSelection();
      const completion = Object.freeze({ formatVersion: 1 as const, status: 'completed' as const,
        navigation: terminal.previousActiveWorkspaceId === null || terminal.previousActiveWorkspaceId === terminal.target.workspaceId
          ? 'selector' as const : 'reopenPrevious' as const });
      // No await or further file work may follow main's synchronous completion receipt.
      assertCurrent();
      checkedDeletionAuthority(() => recordRemoved(Object.freeze({ status: 'removed', journal: terminal })), invalidCode)();
      return completion;
    } finally { active = false; }
  });
  return Object.freeze({
    publish(...args: Parameters<WorkspaceDeletionPreparationOptions['publish']>) {
      return exclusive(async () => {
        if (published !== undefined) return invalidDeletionData(invalidCode);
        const result = await publish(...args);
        published = captureWorkspaceDeletionJournal(result.journal);
        return result;
      });
    },
    resume(operationId: string, authority: WorkspaceDeletionWorkAuthority,
      observeStage?: (stage: WorkspaceDeletionExecutionStage) => void): Promise<WorkspaceDeletionCompletion> {
      return resumeBound(operationId, authority, published, observeStage);
    },
    resumeSelected(journalValue: unknown, authority: WorkspaceDeletionWorkAuthority): Promise<WorkspaceDeletionCompletion> {
      const binding = captureWorkspaceDeletionJournal(journalValue);
      return resumeBound(binding.target.operationId, authority, binding);
    },
  });
}
