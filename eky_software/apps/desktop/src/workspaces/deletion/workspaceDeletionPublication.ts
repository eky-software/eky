import type { WorkspaceDeletionPreparationOptions } from '../management/workspaceDeletionPreparation.js';
import type { WorkspaceRegistryStore } from '../registry/workspaceRegistryStore.js';
import type { LocalWorkspaceRegistry } from '../registry/workspaceRegistryTypes.js';
import { sameCrashSafeFileSlotIdentity } from '../persistence/crashSafeFileSlot.js';
import { checkedDeletionAuthority, invalidDeletionData } from './workspaceDeletionDataValidation.js';
import { captureWorkspaceDeletionInventorySources } from './workspaceDeletionInventorySources.js';
import { WorkspaceDeletionInventoryStore } from './workspaceDeletionInventoryStore.js';
import { captureWorkspaceDeletionJournal, serializeWorkspaceDeletionJournal, type WorkspaceDeletionJournal } from './workspaceDeletionJournalCodec.js';
import { WorkspaceDeletionJournalStore } from './workspaceDeletionJournalStore.js';
import { captureWorkspaceDeletionOriginalJournals, type WorkspaceDeletionOriginalJournalSelection } from './workspaceDeletionOriginalJournalSelection.js';
import { captureWorkspaceDeletionRegistryTransition } from './workspaceDeletionRegistrySelection.js';
import { prepareWorkspaceDeletionRemnantBindings } from './workspaceDeletionRemnantCensusSelection.js';

const invalidCode = 'WORKSPACE_DELETE_JOURNAL_CONFLICT';

export type WorkspaceDeletionPublicationHandoff = (
  journal: Readonly<WorkspaceDeletionJournal>,
  afterRegistry: Readonly<LocalWorkspaceRegistry>,
) => Promise<void>;

/** Publishes authorization only. Payload, registry and durable continuation belong to later owners. */
export function createWorkspaceDeletionPublisher(input: {
  userDataRoot: string;
  registry: Pick<WorkspaceRegistryStore, 'inspectSlots'>;
  assertWritersAbsent(): Promise<void>;
  beforeJournalPublication?: WorkspaceDeletionPublicationHandoff;
  observePublicationPhase?: WorkspaceDeletionPublicationPhaseObserver;
  observeSlotIo?: import('../persistence/crashSafeFileSlot.js').SlotIoObserver;
}) {
  const root = input.userDataRoot;
  const observe = createWorkspaceDeletionPublicationPhaseProducer(input.observePublicationPhase);
  const observeSlotIo = input.observeSlotIo;
  const readRegistry = input.registry.inspectSlots.bind(input.registry);
  const assertWritersAbsent = input.assertWritersAbsent.bind(input);
  const beforeJournalPublication = input.beforeJournalPublication?.bind(input);
  let running = false, handoffStarted = false;
  return async (...args: Parameters<WorkspaceDeletionPreparationOptions['publish']>) => {
    if (running || handoffStarted) return invalidDeletionData(invalidCode);
    running = true;
    let active = true;
    let originals: WorkspaceDeletionOriginalJournalSelection | undefined;
    try {
      const [assertAuthority, assertPublicationCurrent, target, context, assertPreparationCurrent,
        assertPreparationReadOwned, assertRecoverySourceReadCurrent] = args;
      if (assertRecoverySourceReadCurrent !== undefined &&
          (typeof assertRecoverySourceReadCurrent !== 'function' || assertPreparationReadOwned === undefined)) {
        return invalidDeletionData(invalidCode);
      }
      const check = checkedDeletionAuthority(assertAuthority, invalidCode);
      const guard = () => { if (!active) return invalidDeletionData(invalidCode); check(); };
      const assertExternalSelection = async () => {
        guard(); await assertPreparationCurrent(); guard();
        await assertWritersAbsent(); guard();
        await assertPreparationCurrent(); guard();
      };
      const assertOriginalSelection = () => observe('fullSelection', async () => {
        await assertExternalSelection(); guard();
        await originals?.assertSelected(); guard();
      });
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
      const journalStore = new WorkspaceDeletionJournalStore(root, undefined, observeSlotIo);
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
      const compareSources = () => observe('sourceComparison', async () => {
        let reading = true;
        let failed = false;
        let firstFailure: unknown;
        const expire = (error: unknown) => { if (!failed) { failed = true; firstFailure = error; } reading = false; };
        const readGuard = () => {
          if (failed && assertPreparationReadOwned !== undefined) throw firstFailure;
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
        const checkRecoveryReadCurrent = assertRecoverySourceReadCurrent === undefined ? undefined :
          checkedDeletionAuthority(assertRecoverySourceReadCurrent, invalidCode);
        const sourceReadAuthority = assertPreparationReadOwned === undefined ? undefined : {
          assertAuthority: readGuard, onFailure: expire,
          async assertExternalSelection() {
            try {
              readGuard(); const result: unknown = await assertPreparationReadOwned(); readGuard();
              if (result !== undefined) return invalidDeletionData(invalidCode);
            } catch (error) { expire(error); throw error; }
          },
          assertWritersAbsent: authority.assertWritersAbsent,
          ...(checkRecoveryReadCurrent === undefined ? {} : { assertRecoverySourceReadCurrent: () => {
            try { readGuard(); checkRecoveryReadCurrent(); readGuard(); }
            catch (error) { expire(error); throw error; }
          } }),
        };
        // The original receipt already brackets its reads with the full preparation selection.
        const assertComparisonSelection = handoffStarted && checkRecoveryReadCurrent !== undefined
          ? () => observe('fullSelection', async () => {
            readGuard(); await selectedOriginals.assertSelected(); readGuard();
          })
          : assertOriginalSelection;
        try {
          await assertComparisonSelection();
          const selectedRecords = sourceReadAuthority === undefined ? selectedSource.records() : selectedSource.records(sourceReadAuthority);
          await inventoryStore.assertRecords(inventory, selectedRecords, readAuthority, expire);
          await assertComparisonSelection();
        } catch (error) { expire(error); throw error; }
        finally { reading = false; }
      });
      if (beforeJournalPublication !== undefined) {
        await compareSources(); guard();
        handoffStarted = true;
        const result: unknown = await observe('selectionHandoff', () => beforeJournalPublication(journal, transition.after));
        guard();
        if (result !== undefined) return invalidDeletionData(invalidCode);
      }
      const publishJournal = async () => {
        const publicationCurrent = async () => {
          await compareSources();
          await assertPublicationCurrent(); guard();
          await compareSources();
        };
        if (assertPreparationReadOwned === undefined) {
          return journalStore.publish(journal, {
            ...authority, assertExternalSelection: assertOriginalSelection, slots: initial.slots,
          }, publicationCurrent);
        }
        let reading = true;
        let firstFailure: { cause: unknown } | undefined;
        const retain = (cause: unknown) => { firstFailure ??= { cause }; return firstFailure.cause; };
        const assertReading = () => {
          if (!reading) return invalidDeletionData(invalidCode);
          if (firstFailure !== undefined) throw firstFailure.cause;
          try { guard(); } catch (cause) { throw retain(cause); }
        };
        const checkedRead = async (work: () => Promise<void>) => {
          try {
            assertReading(); const value: unknown = await work(); assertReading();
            if (value !== undefined) return invalidDeletionData(invalidCode);
          } catch (cause) { throw retain(cause); }
        };
        const readSelection = { async assertBeforeSlotRead() {
          await checkedRead(assertPreparationReadOwned);
          await checkedRead(assertWritersAbsent);
        } };
        try {
          return await journalStore.publish(journal, {
            slots: initial.slots, assertAuthority: assertReading,
            assertExternalSelection: () => checkedRead(assertOriginalSelection),
          }, publicationCurrent, readSelection);
        } catch (cause) {
          if (firstFailure !== undefined) {
            if (cause instanceof AggregateError) throw new AggregateError([firstFailure.cause, cause], invalidCode);
            throw firstFailure.cause;
          }
          throw cause;
        } finally { reading = false; }
      };
      const publishedIdentity = await publishJournal();
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

export type WorkspaceDeletionPublicationPhaseEvent = Readonly<{
  phase: 'sourceComparison' | 'selectionHandoff' | 'fullSelection';
  event: 'entered' | 'fulfilled' | 'rejected'; callId: number;
}>;
export type WorkspaceDeletionPublicationPhaseObserver = (event: WorkspaceDeletionPublicationPhaseEvent) => void;

export function createWorkspaceDeletionPublicationPhaseProducer(observer?: WorkspaceDeletionPublicationPhaseObserver) {
  let nextCallId = 0;
  return function observe<T>(phase: WorkspaceDeletionPublicationPhaseEvent['phase'], work: () => Promise<T>): Promise<T> {
    if (observer === undefined) return work();
    const callId = ++nextCallId;
    const emit = (event: WorkspaceDeletionPublicationPhaseEvent['event']) => {
      try { observer(Object.freeze({ phase, event, callId })); }
      catch { /* Observation cannot replace the original outcome. */ }
    };
    emit('entered');
    let originalPromise: Promise<T>;
    try { originalPromise = work(); }
    catch (cause) { emit('rejected'); throw cause; }
    try { void Promise.prototype.then.call(originalPromise, () => emit('fulfilled'), () => emit('rejected')); }
    catch { /* A missing finish observation is unknown, not a new work outcome. */ }
    return originalPromise;
  };
}
