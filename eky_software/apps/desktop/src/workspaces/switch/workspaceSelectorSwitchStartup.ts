import type { ReadOnlyJournalSlots } from '../persistence/readOnlyJournalSlots.js';
import { sameCrashSafeFileSlotIdentity, type CrashSafeFileSlotIdentity } from '../persistence/crashSafeFileSlot.js';
import type { WorkspaceRegistryStore } from '../registry/workspaceRegistryStore.js';
import { serializeWorkspaceRegistry } from '../registry/workspaceRegistrySerializer.js';
import type { LocalWorkspaceRegistry, LocalWorkspaceRegistryV2 } from '../registry/workspaceRegistryTypes.js';
import type { WorkspaceSelectorActivationAuthority } from '../update/workspaceActivationMigrationGuard.js';
import { WorkspaceSwitchError } from './workspaceSwitchError.js';
import {
  serializeVersionedWorkspaceSwitchJournal,
  type WorkspaceSwitchJournalStore,
  type WorkspaceSwitchJournalV2,
  type WorkspaceSwitchJournal,
} from './workspaceSwitchJournal.js';
import {
  captureWorkspaceSelectorSwitchSelection,
  type WorkspaceSelectorSwitchSelection,
} from './workspaceSelectorSwitchSelection.js';
import { planWorkspaceSelectorSwitchSlots } from './workspaceSelectorSwitchSlots.js';
import { createWorkspaceSelectorSwitchRegistryVariants } from './workspaceSelectorSwitchState.js';

export interface WorkspaceSelectorSwitchStartupAuthority {
  // Bound by main to the current startup generation and installation admission.
  assertCurrent(): void;
  admitSelection?(selection: WorkspaceSelectorSwitchObservation): Promise<void>;
  didSettleSelection?(receipt: WorkspaceSelectorSwitchSettlement): Promise<void>;
  proveTerminal(request: Readonly<{
    purpose: 'selectorReturn' | 'acceptedTarget';
    journal: Readonly<WorkspaceSwitchJournalV2> | undefined;
    registry: Readonly<LocalWorkspaceRegistryV2>;
  }>): Promise<Readonly<{ assertCurrent(): void }>>;
}

export interface WorkspaceSelectorSwitchObservation {
  readonly registrySlots: ReadOnlyJournalSlots<LocalWorkspaceRegistry>;
  readonly journalSlots: ReadOnlyJournalSlots<WorkspaceSwitchJournal>;
}

export interface WorkspaceSelectorSwitchSettlement {
  readonly phase: 'startup' | 'acceptedTarget';
  readonly before: WorkspaceSelectorSwitchObservation;
  readonly after: WorkspaceSelectorSwitchObservation;
  assertCurrent(): Promise<void>;
}

export interface WorkspaceSelectorStartupSelection {
  readonly mode: 'selector';
  readonly registry: Readonly<LocalWorkspaceRegistryV2>;
  assertCurrent(): Promise<void>;
}

// The v2 branch of the existing switch owner. It owns no process or migration:
// terminal authority must come from those owners before a return or acceptance.
export async function resolveWorkspaceSelectorSwitchStartup(input: Readonly<{
  registry: Pick<WorkspaceRegistryStore, 'inspectSlots' | 'recoverSelected' | 'writeSelected'>;
  journal: Pick<WorkspaceSwitchJournalStore, 'inspectSlots' | 'recoverSelector' | 'writeSelector' | 'clearSelector'>;
  selection: WorkspaceSelectorSwitchSelection;
  authority: WorkspaceSelectorSwitchStartupAuthority;
}>) {
  let usable = true;
  let busy = false;
  const assertStartup = input.authority.assertCurrent.bind(input.authority);
  const assertInitialSelection = input.selection.assertAuthority.bind(input.selection);
  const proveTerminal = input.authority.proveTerminal.bind(input.authority);
  const admitSelection = input.authority.admitSelection?.bind(input.authority);
  const didSettleSelection = input.authority.didSettleSelection?.bind(input.authority);
  const assertAuthority = () => {
    if (!usable) invalid();
    assertSynchronous(assertStartup);
    assertSynchronous(assertInitialSelection);
  };
  let captured = captureWorkspaceSelectorSwitchSelection({ ...input.selection, assertAuthority });
  const observation = (): WorkspaceSelectorSwitchObservation => structuredClone({
    registrySlots: captured.registrySlots, journalSlots: captured.journalSlots,
  });
  let lastObservation = observation();
  const readJournal = () => input.journal.inspectSlots();
  const selection = (): WorkspaceSelectorSwitchSelection => ({
    journalSlots: captured.journalSlots, registrySlots: captured.registrySlots,
    readRegistrySlots: () => input.registry.inspectSlots(), assertAuthority,
  });
  const assertSelection = async () => {
    assertAuthority();
    await captured.guard.assertExternalSelection();
    captured.assertJournalSelection(await readJournal());
    await captured.guard.assertExternalSelection();
    captured.assertJournalSelection(await readJournal());
  };
  const deliverSettlement = async (phase: WorkspaceSelectorSwitchSettlement['phase']) => {
    try {
      await assertSelection();
      const after = observation();
      const receiptSelection = captured;
      const assertReceiptCurrent = async () => {
        try {
          if (captured !== receiptSelection) invalid();
          await assertSelection();
          if (captured !== receiptSelection) invalid();
        } catch (error) { usable = false; throw error; }
      };
      await didSettleSelection?.(Object.freeze({ phase, before: structuredClone(lastObservation),
        after: structuredClone(after), assertCurrent: assertReceiptCurrent }));
      await assertSelection();
      lastObservation = after;
    } catch (error) { usable = false; throw error; }
  };
  const readBack = async (
    expectedRegistry: LocalWorkspaceRegistryV2,
    expectedJournal: WorkspaceSwitchJournalV2 | undefined,
    changed: 'registry' | 'journal',
    publishedIdentity?: Readonly<CrashSafeFileSlotIdentity>,
  ) => {
    assertAuthority();
    const registrySlots = await input.registry.inspectSlots();
    assertAuthority();
    const journalSlots = await readJournal();
    assertAuthority();
    if (changed === 'journal') {
      await captured.guard.assertExternalSelection();
    } else {
      captured.assertJournalSelection(journalSlots);
    }
    requirePublishedBytes(registrySlots, serializeWorkspaceRegistry(expectedRegistry));
    requirePublishedBytes(journalSlots, expectedJournal === undefined
      ? undefined : serializeVersionedWorkspaceSwitchJournal(expectedJournal));
    const changedIdentity = (changed === 'journal' ? journalSlots : registrySlots).current?.identity;
    if (publishedIdentity === undefined ? changedIdentity !== undefined
      : changedIdentity === undefined || !sameCrashSafeFileSlotIdentity(publishedIdentity, changedIdentity)) invalid();
    captured = captureWorkspaceSelectorSwitchSelection({
      journalSlots, registrySlots, readRegistrySlots: () => input.registry.inspectSlots(), assertAuthority,
    });
    await assertSelection();
  };
  const terminal = async (purpose: 'selectorReturn' | 'acceptedTarget',
    registry: LocalWorkspaceRegistryV2, journal: WorkspaceSwitchJournalV2 | undefined) => {
    await assertSelection();
    const proof = await proveTerminal(Object.freeze({ purpose, registry, journal }));
    const assertProof = proof.assertCurrent.bind(proof);
    const assertCurrent = () => {
      assertAuthority();
      assertSynchronous(assertProof);
    };
    assertCurrent();
    await assertSelection();
    assertCurrent();
    return { purpose, assertCurrent };
  };
  const exclusive = async <T>(operation: () => Promise<T>): Promise<T> => {
    if (busy) invalid();
    assertAuthority();
    busy = true;
    try { return await operation(); }
    catch (error) { usable = false; throw error; }
    finally { busy = false; }
  };
  const selectorResult = (registry: LocalWorkspaceRegistryV2, assertTerminal: () => void): WorkspaceSelectorStartupSelection =>
    Object.freeze({ mode: 'selector', registry, async assertCurrent() {
      assertTerminal();
      await assertSelection();
      assertTerminal();
    } });

  await assertSelection();
  await admitSelection?.(observation());
  await assertSelection();
  if (Object.values(captured.journalSlots).every(value => value === undefined)) {
    const registry = captured.registrySlots.current?.value;
    if (registry?.formatVersion !== 2 || registry.activeWorkspaceId !== null ||
        captured.registrySlots.next !== undefined || captured.registrySlots.backup !== undefined) invalid();
    const proof = await terminal('selectorReturn', registry, undefined);
    return selectorResult(registry, proof.assertCurrent);
  }

  let plan = planWorkspaceSelectorSwitchSlots(captured.journalSlots, captured.registrySlots);
  if (plan.mode === 'recoveryRequired') recoveryRequired();
  if (unsettled(captured.registrySlots)) {
    const identity = await input.registry.recoverSelected(captured.registryGuard(readJournal));
    // Joint admission forbids two unsettled owners at once.
    await readBack(plan.registry, plan.journal, 'registry', identity);
  } else if (unsettled(captured.journalSlots) && plan.mode !== 'unpublishedPreparation') {
    const identity = await input.journal.recoverSelector(selection());
    await readBack(plan.registry, plan.journal, 'journal', identity);
  }
  plan = planWorkspaceSelectorSwitchSlots(captured.journalSlots, captured.registrySlots);
  if (plan.mode === 'completeSelection') {
    const next = Object.freeze({ ...plan.journal, state: 'targetSelected' as const });
    const identity = await input.journal.writeSelector(next, selection());
    await readBack(plan.registry, next, 'journal', identity);
    plan = planWorkspaceSelectorSwitchSlots(captured.journalSlots, captured.registrySlots);
  }
  await deliverSettlement('startup');
  if (plan.mode !== 'validateTarget') {
    const proof = await terminal('selectorReturn', plan.registry, plan.journal);
    if (plan.mode === 'completeReturn') {
      const next = Object.freeze({ ...plan.journal, state: 'rollbackSelected' as const });
      const identity = await input.journal.writeSelector(next, { ...selection(), assertAuthority: proof.assertCurrent });
      await readBack(plan.registry, next, 'journal', identity);
    }
    await input.journal.clearSelector(selection(), proof);
    await readBack(plan.registry, undefined, 'journal');
    proof.assertCurrent();
    return selectorResult(plan.registry, proof.assertCurrent);
  }

  const { journal, registry } = plan;
  const workspace = registry.workspaces.find(entry => entry.workspaceId === journal.targetWorkspaceId);
  if (workspace === undefined || workspace.lifecycleState !== 'ready') invalid();
  const assertCanAccept = (profileId: string) => {
    assertAuthority();
    if (profileId !== workspace.lineageIdentity.profileId) invalid();
  };
  const activationSelection = captureWorkspaceSelectorSwitchSelection(selection());
  const activationAuthority: WorkspaceSelectorActivationAuthority = Object.freeze({
    selection: { ...selection(), journalSlots: activationSelection.journalSlots,
      registrySlots: activationSelection.registrySlots }, readJournalSlots: readJournal,
  });
  const returnToSelector = (rejectTarget: boolean) => exclusive(async () => {
    const proof = await terminal('selectorReturn', registry, journal);
    const variants = createWorkspaceSelectorSwitchRegistryVariants(registry, journal.targetWorkspaceId);
    const nextRegistry = rejectTarget ? variants.rejected : variants.before;
    const guard = captured.registryGuard(readJournal);
    const registryIdentity = await input.registry.writeSelected(nextRegistry, { ...guard, assertAuthority: proof.assertCurrent });
    await readBack(nextRegistry, journal, 'registry', registryIdentity);
    const next = Object.freeze({ ...journal, state: 'rollbackSelected' as const });
    const journalIdentity = await input.journal.writeSelector(next, { ...selection(), assertAuthority: proof.assertCurrent });
    await readBack(nextRegistry, next, 'journal', journalIdentity);
    proof.assertCurrent();
    usable = false;
    return 'relaunchRequired' as const;
  });
  return Object.freeze({
    mode: 'targetValidation' as const,
    workspace,
    context: Object.freeze({
      operationId: journal.operationId, sourceWorkspaceId: null,
      targetWorkspaceId: journal.targetWorkspaceId,
    }),
    selectorActivationAuthority: activationAuthority,
    assertCanAccept,
    accept: (profileId: string) => exclusive(async () => {
      assertCanAccept(profileId);
      const proof = await terminal('acceptedTarget', registry, journal);
      await input.journal.clearSelector(selection(), proof);
      await readBack(registry, undefined, 'journal');
      proof.assertCurrent();
      await deliverSettlement('acceptedTarget');
      proof.assertCurrent();
      usable = false;
    }),
    rejectInvalidTarget: () => returnToSelector(true),
    recoverFromFailure: () => returnToSelector(false),
    requireRecovery: () => exclusive(async () => {
      await assertSelection();
      const next = Object.freeze({ ...journal, state: 'recoveryRequired' as const });
      const identity = await input.journal.writeSelector(next, selection());
      await readBack(registry, next, 'journal', identity);
      usable = false;
      return 'recoveryRequired' as const;
    }),
  });
}

function requirePublishedBytes<T>(slots: ReadOnlyJournalSlots<T>, expected: Uint8Array | undefined): void {
  if (slots.next !== undefined || slots.backup !== undefined) invalid();
  const actual = slots.current?.bytes;
  if (expected === undefined ? actual !== undefined
    : actual === undefined || !Buffer.from(expected).equals(actual)) invalid();
}

function unsettled<T>(slots: ReadOnlyJournalSlots<T>): boolean {
  return slots.current === undefined || slots.next !== undefined || slots.backup !== undefined;
}

function assertSynchronous(assertion: () => void): void {
  const result: unknown = assertion();
  if (result !== undefined) {
    void Promise.resolve(result).catch(() => undefined);
    invalid();
  }
}

function invalid(): never { throw new WorkspaceSwitchError('WORKSPACE_SWITCH_INVALID'); }
function recoveryRequired(): never { throw new WorkspaceSwitchError('WORKSPACE_SWITCH_RECOVERY_REQUIRED'); }
