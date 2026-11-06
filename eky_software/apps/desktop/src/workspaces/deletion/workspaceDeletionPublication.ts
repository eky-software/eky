import type { WorkspaceDeletionPreparationOptions } from '../management/workspaceDeletionPreparation.js';
import type { WorkspaceRegistryStore } from '../registry/workspaceRegistryStore.js';
import { sameCrashSafeFileSlotIdentity } from '../persistence/crashSafeFileSlot.js';
import { checkedDeletionAuthority, invalidDeletionData } from './workspaceDeletionDataValidation.js';
import { captureWorkspaceDeletionInventorySources } from './workspaceDeletionInventorySources.js';
import { WorkspaceDeletionInventoryStore } from './workspaceDeletionInventoryStore.js';
import { captureWorkspaceDeletionJournal, serializeWorkspaceDeletionJournal } from './workspaceDeletionJournalCodec.js';
import { WorkspaceDeletionJournalStore } from './workspaceDeletionJournalStore.js';
import { captureWorkspaceDeletionOriginalJournals, type WorkspaceDeletionOriginalJournalSelection } from './workspaceDeletionOriginalJournalSelection.js';
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
    let originals: WorkspaceDeletionOriginalJournalSelection | undefined;
    try {
      const [assertAuthority, assertPublicationCurrent, target, context, assertPreparationCurrent, assertPreparationReadOwned] = args;
      const check = checkedDeletionAuthority(assertAuthority, invalidCode);
      const guard = () => { if (!active) return invalidDeletionData(invalidCode); check(); };
      const assertExternalSelection = async () => {
        guard(); await assertPreparationCurrent(); guard();
        await assertWritersAbsent(); guard();
        await assertPreparationCurrent(); guard();
      };
      const assertOriginalSelection = async () => {
        await assertExternalSelection(); guard();
        await originals?.assertSelected(); guard();
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
      originals = await captureWorkspaceDeletionOriginalJournals(root, transition.target, sourceAuthority, assertPreparationReadOwned);
      const selectedOriginals = originals;
      const inventoryStore = new WorkspaceDeletionInventoryStore(root, context.operationId);
      let source: Awaited<ReturnType<typeof captureWorkspaceDeletionInventorySources>> | undefined;
      async function* records() {
        // Store-owned directories must exist before the immutable source selection is captured.
        // Each complete source read brackets the original receipt itself; nested reads keep the base selection.
        const prepared = await prepareWorkspaceDeletionRemnantBindings(root, transition.target, sourceAuthority, undefined, selectedOriginals);
        source = await captureWorkspaceDeletionInventorySources(root, transition.target, target.rootIdentity, sourceAuthority, undefined, selectedOriginals, prepared);
        yield* source.records();
      }
      const inventory = await inventoryStore.publish(transition.target, records(), authority);
      const selectedSource = source;
      if (selectedSource === undefined) return invalidDeletionData(invalidCode);
      const journal = captureWorkspaceDeletionJournal({ formatVersion: 2, originalJournalProofs: selectedOriginals.proofs,
        phase: 'authorized', ...inventory,
        previousActiveWorkspaceId: target.previousActiveWorkspaceId, backupDisposition: context.backupDisposition,
        registryBeforeSha256: transition.registryBeforeSha256, registryAfterSha256: transition.registryAfterSha256 });
      const compareSources = async () => {
        let reading = true;
        const expire = (_error: unknown) => { reading = false; };
        const readGuard = () => {
          if (!reading) return invalidDeletionData(invalidCode);
          try { guard(); } catch (error) { expire(error); throw error; }
        };
        const readAuthority = {
          assertAuthority: readGuard,
          async assertExternalSelection() {
            try { readGuard(); await assertWritersAbsent(); readGuard(); }
            catch (error) { expire(error); throw error; }
          },
        };
        try {
          await assertOriginalSelection();
          // The source retains its original authority; this finite scope belongs only to inventory reads.
          await inventoryStore.assertRecords(inventory, selectedSource.records(), readAuthority, expire);
          await assertOriginalSelection();
        } catch (error) { expire(error); throw error; }
        finally { reading = false; }
      };
      const publishedIdentity = await journalStore.publish(journal, {
        ...authority, assertExternalSelection: assertOriginalSelection, slots: initial.slots,
      }, async () => {
        await compareSources();
        await assertPublicationCurrent(); guard();
        // This is the final source validation, not preparation that requests another backup reread.
        await compareSources();
      });
      await compareSources();
      await assertOriginalSelection();
      const published = await journalStore.inspect(guard);
      if (published.plan.mode !== 'published' || published.slots.current === undefined ||
          published.slots.next !== undefined || published.slots.backup !== undefined ||
          published.slots.current.identity === undefined ||
          !sameCrashSafeFileSlotIdentity(publishedIdentity, published.slots.current.identity) ||
          !Buffer.from(published.slots.current.bytes).equals(serializeWorkspaceDeletionJournal(journal))) {
        return invalidDeletionData(invalidCode);
      }
      await assertOriginalSelection();
      return Object.freeze({ journal, workspaceRootIdentity: target.rootIdentity });
    } finally { active = false; originals?.revoke(); running = false; }
  };
}
