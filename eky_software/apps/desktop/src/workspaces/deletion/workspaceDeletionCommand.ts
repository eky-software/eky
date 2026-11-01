import type { WorkspaceDeletionPreparationOptions } from '../management/workspaceDeletionPreparation.js';
import type { WorkspaceDeletionCompletion, WorkspaceDeletionWorkAuthority } from '../management/workspaceManagementService.js';
import type { WorkspaceRegistryStore } from '../registry/workspaceRegistryStore.js';
import { checkedDeletionAuthority, invalidDeletionData } from './workspaceDeletionDataValidation.js';
import { createWorkspaceDeletionFinalizer } from './workspaceDeletionFinalization.js';
import { captureWorkspaceDeletionJournal, type WorkspaceDeletionJournalV1 } from './workspaceDeletionJournalCodec.js';
import { WorkspaceDeletionJournalStore } from './workspaceDeletionJournalStore.js';
import { createWorkspaceDeletionMetadataCleaner } from './workspaceDeletionMetadataCleanup.js';
import { createWorkspaceDeletionPayloadExecutor } from './workspaceDeletionPayloadExecutor.js';
import { captureWorkspaceDeletionPhaseSelection } from './workspaceDeletionPhaseSelection.js';
import { createWorkspaceDeletionPublisher } from './workspaceDeletionPublication.js';
import { createWorkspaceDeletionRegistryPublisher } from './workspaceDeletionRegistryPublication.js';

const invalidCode = 'WORKSPACE_DELETE_JOURNAL_CONFLICT';

// Main supplies admission and the live/cold owner. Both entries use these same physical stages.
export function createWorkspaceDeletionCommand(input: {
  userDataRoot: string;
  registry: Pick<WorkspaceRegistryStore, 'inspectSlots' | 'writeSelected' | 'recoverSelected'>;
  assertWritersAbsent(): Promise<void>;
}) {
  const root = input.userDataRoot, writers = input.assertWritersAbsent.bind(input);
  const registry = { inspectSlots: input.registry.inspectSlots.bind(input.registry),
    writeSelected: input.registry.writeSelected.bind(input.registry), recoverSelected: input.registry.recoverSelected.bind(input.registry) };
  const stages = { userDataRoot: root, registry, assertWritersAbsent: writers };
  const publish = createWorkspaceDeletionPublisher(stages), payload = createWorkspaceDeletionPayloadExecutor(stages);
  const publishRegistry = createWorkspaceDeletionRegistryPublisher(stages), clearMetadata = createWorkspaceDeletionMetadataCleaner(stages);
  const finalize = createWorkspaceDeletionFinalizer(stages);
  let running = false, published: WorkspaceDeletionJournalV1 | undefined;
  const exclusive = async <T>(work: () => Promise<T>) => {
    if (running) return invalidDeletionData(invalidCode);
    running = true;
    try { return await work(); } finally { running = false; }
  };
  return Object.freeze({
    publish(...args: Parameters<WorkspaceDeletionPreparationOptions['publish']>) {
      return exclusive(async () => {
        if (published !== undefined) return invalidDeletionData(invalidCode);
        const result = await publish(...args);
        published = captureWorkspaceDeletionJournal(result.journal);
        return result;
      });
    },
    resume(operationId: string, authority: WorkspaceDeletionWorkAuthority): Promise<WorkspaceDeletionCompletion> {
      return exclusive(async () => {
        const current = checkedDeletionAuthority(authority.assertCurrent.bind(authority), invalidCode);
        const owned = authority.assertOwned.bind(authority), recordRemoved = authority.recordRemoved.bind(authority);
        let active = true;
        const assertCurrent = () => { if (!active) return invalidDeletionData(invalidCode); current(); };
        const owner = { assertCurrent, async assertOwned() { assertCurrent(); await owned(); assertCurrent(); } };
        try {
          const selected = await captureWorkspaceDeletionPhaseSelection({ operationId, authority: owner,
            journal: new WorkspaceDeletionJournalStore(root), registry, assertWritersAbsent: writers,
            ...(published === undefined ? {} : { expectedBinding: published }) });
          const binding = selected.journal;
          selected.revoke();
          if (binding.phase !== 'registryPublished') {
            await payload(operationId, owner, binding);
            await publishRegistry(operationId, owner, binding);
            await clearMetadata(operationId, owner, binding);
          }
          const terminal = await finalize(operationId, owner, binding);
          const completion = Object.freeze({ formatVersion: 1 as const, status: 'completed' as const,
            navigation: terminal.previousActiveWorkspaceId === null || terminal.previousActiveWorkspaceId === terminal.target.workspaceId
              ? 'selector' as const : 'reopenPrevious' as const });
          // No await or further file work may follow main's synchronous completion receipt.
          assertCurrent();
          checkedDeletionAuthority(() => recordRemoved(Object.freeze({ status: 'removed', journal: terminal })), invalidCode)();
          return completion;
        } finally { active = false; }
      });
    },
  });
}
