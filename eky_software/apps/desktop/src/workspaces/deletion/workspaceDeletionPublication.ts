import type { WorkspaceDeletionPreparationOptions } from '../management/workspaceDeletionPreparation.js';
import type { WorkspaceRegistryStore } from '../registry/workspaceRegistryStore.js';
import { sameCrashSafeFileSlotIdentity } from '../persistence/crashSafeFileSlot.js';
import { checkedDeletionAuthority, invalidDeletionData } from './workspaceDeletionDataValidation.js';
import { captureWorkspaceDeletionInventorySources } from './workspaceDeletionInventorySources.js';
import { WorkspaceDeletionInventoryStore } from './workspaceDeletionInventoryStore.js';
import { captureWorkspaceDeletionJournal, serializeWorkspaceDeletionJournal } from './workspaceDeletionJournalCodec.js';
import { WorkspaceDeletionJournalStore } from './workspaceDeletionJournalStore.js';
import { captureWorkspaceDeletionRegistryTransition } from './workspaceDeletionRegistrySelection.js';
import { prepareWorkspaceDeletionRemnantBindings } from './workspaceDeletionRemnantCensusSelection.js';

const invalidCode = 'WORKSPACE_DELETE_JOURNAL_CONFLICT';

/** Publishes authorization only. Payload, registry and durable continuation belong to later owners. */
export function createWorkspaceDeletionPublisher(input: {
  userDataRoot: string;
  registry: Pick<WorkspaceRegistryStore, 'inspectSlots'>;
  assertWritersAbsent(): Promise<void>;
}) {
  const root = input.userDataRoot;
  const readRegistry = input.registry.inspectSlots.bind(input.registry);
  const assertWritersAbsent = input.assertWritersAbsent.bind(input);
  let running = false;
  return async (...args: Parameters<WorkspaceDeletionPreparationOptions['publish']>) => {
    if (running) return invalidDeletionData(invalidCode);
    running = true;
    let active = true;
    try {
      const [assertAuthority, assertPublicationCurrent, target, context, assertPreparationCurrent] = args;
      const check = checkedDeletionAuthority(assertAuthority, invalidCode);
      const guard = () => { if (!active) return invalidDeletionData(invalidCode); check(); };
      const assertExternalSelection = async () => {
        guard(); await assertPreparationCurrent(); guard();
        await assertWritersAbsent(); guard();
        await assertPreparationCurrent(); guard();
      };
      const authority = { assertAuthority: guard, assertExternalSelection,
        async assertWritersAbsent() { guard(); await assertWritersAbsent(); guard(); } };
      // Remnant owners already bracket their writer proof with this original selection.
      const sourceAuthority = { ...authority, async assertExternalSelection() {
        guard(); await assertPreparationCurrent(); guard();
      } };
      if (context.target !== target) return invalidDeletionData(invalidCode);
      await assertExternalSelection();
      const transition = captureWorkspaceDeletionRegistryTransition(await readRegistry(guard), context);
      await assertExternalSelection();
      const journalStore = new WorkspaceDeletionJournalStore(root);
      const initial = await journalStore.inspect(guard);
      if (initial.plan.mode !== 'absent') return invalidDeletionData(invalidCode);
      await assertExternalSelection();
      const inventoryStore = new WorkspaceDeletionInventoryStore(root, context.operationId);
      let source: Awaited<ReturnType<typeof captureWorkspaceDeletionInventorySources>> | undefined;
      async function* records() {
        // Store-owned directories must exist before the immutable source selection is captured.
        const prepared = await prepareWorkspaceDeletionRemnantBindings(root, transition.target, sourceAuthority);
        source = await captureWorkspaceDeletionInventorySources(root, transition.target, target.rootIdentity, sourceAuthority);
        await prepared.assertUnchanged();
        yield* source.records();
      }
      const inventory = await inventoryStore.publish(transition.target, records(), authority);
      const selectedSource = source;
      if (selectedSource === undefined) return invalidDeletionData(invalidCode);
      const journal = captureWorkspaceDeletionJournal({ formatVersion: 1, phase: 'authorized', ...inventory,
        previousActiveWorkspaceId: target.previousActiveWorkspaceId, backupDisposition: context.backupDisposition,
        registryBeforeSha256: transition.registryBeforeSha256, registryAfterSha256: transition.registryAfterSha256 });
      const publishedIdentity = await journalStore.publish(journal, { ...authority, slots: initial.slots }, async () => {
        await inventoryStore.assertRecords(inventory, selectedSource.records(), authority);
        await assertPublicationCurrent(); guard();
        // This is the final source validation, not preparation that requests another backup reread.
        await inventoryStore.assertRecords(inventory, selectedSource.records(), authority);
      });
      await inventoryStore.assertRecords(inventory, selectedSource.records(), authority);
      await assertExternalSelection();
      const published = await journalStore.inspect(guard);
      if (published.plan.mode !== 'published' || published.slots.current === undefined ||
          published.slots.next !== undefined || published.slots.backup !== undefined ||
          published.slots.current.identity === undefined ||
          !sameCrashSafeFileSlotIdentity(publishedIdentity, published.slots.current.identity) ||
          !Buffer.from(published.slots.current.bytes).equals(serializeWorkspaceDeletionJournal(journal))) {
        return invalidDeletionData(invalidCode);
      }
      await assertExternalSelection();
      return Object.freeze({ journal, workspaceRootIdentity: target.rootIdentity });
    } finally { active = false; running = false; }
  };
}
