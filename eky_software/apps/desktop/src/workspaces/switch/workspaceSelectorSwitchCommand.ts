import type { CrashSafeFileSlotIdentity } from '../persistence/crashSafeFileSlot.js';
import { sameCrashSafeFileSlotIdentity } from '../persistence/crashSafeFileSlot.js';
import { WorkspaceMaintenanceLeaseBusyError, type WorkspaceMaintenanceLease } from '../maintenance/workspaceMaintenanceLease.js';
import type { WorkspaceRegistryStore } from '../registry/workspaceRegistryStore.js';
import { serializeWorkspaceRegistry } from '../registry/workspaceRegistrySerializer.js';
import type { LocalWorkspaceRegistryV2, WorkspaceId } from '../registry/workspaceRegistryTypes.js';
import type { MainOwnedSelectorWorkspaceLifecycle } from '../runtime/mainOwnedSelectorWorkspaceLifecycle.js';
import { WorkspaceSwitchError } from './workspaceSwitchError.js';
import { serializeVersionedWorkspaceSwitchJournal, type WorkspaceSwitchJournalStore, type WorkspaceSwitchJournalV2 } from './workspaceSwitchJournal.js';
import { captureWorkspaceSelectorSwitchSelection, type WorkspaceSelectorSwitchSelection } from './workspaceSelectorSwitchSelection.js';
import { planWorkspaceSelectorSwitchSlots } from './workspaceSelectorSwitchSlots.js';
import { createWorkspaceSelectorSwitchJournal, createWorkspaceSelectorSwitchRegistryVariants } from './workspaceSelectorSwitchState.js';

export interface WorkspaceSelectorSwitchCommandOptions {
  readonly mode: 'selector';
  readonly activeWorkspaceLifecycle: Pick<MainOwnedSelectorWorkspaceLifecycle,
    'quiesceWrites' | 'stopAndProveHandlesClosed' | 'assertNoActiveWorkspaceRuntime' | 'assertStoppedCurrent'>;
  readonly generateOperationId?: () => string;
  readonly journal: Pick<WorkspaceSwitchJournalStore, 'inspectSlots' | 'writeSelector'>;
  readonly maintenanceLease: WorkspaceMaintenanceLease;
  readonly now?: () => Date;
  readonly registry: Pick<WorkspaceRegistryStore, 'inspectSlots' | 'writeSelected'>;
  readonly relaunchApplication: () => void;
  // Main owns the selector generation and installation/build admission.
  assertCurrent(): void;
}

// The source-null branch of the existing switch command. Startup owns recovery
// of interrupted publications; this branch never repairs or deletes evidence.
export async function switchFromWorkspaceSelector(
  options: Readonly<WorkspaceSelectorSwitchCommandOptions>, target: WorkspaceId,
  generateOperationId: () => string, now: () => Date,
): Promise<void> {
  const lease = await options.maintenanceLease.acquire('switch').catch(error => {
    throw new WorkspaceSwitchError(error instanceof WorkspaceMaintenanceLeaseBusyError
      ? 'WORKSPACE_SWITCH_BUSY' : 'WORKSPACE_SWITCH_STORAGE_FAILED', { cause: error });
  });
  let failure: { error: unknown } | undefined;
  let transitionStarted = false;
  let relaunchReady = false;
  try {
    const assertAdmission = () => assertSynchronous(() => options.assertCurrent());
    const assertAuthority = () => {
      assertAdmission();
      assertSynchronous(() => options.activeWorkspaceLifecycle.assertStoppedCurrent());
    };
    const readJournal = () => options.journal.inspectSlots();
    assertAdmission();
    const registrySlots = await options.registry.inspectSlots();
    assertAdmission();
    const journalSlots = await readJournal();
    assertAdmission();
    const registry = registrySlots.current?.value;
    if (registry?.formatVersion !== 2 || registry.activeWorkspaceId !== null ||
      registrySlots.next !== undefined || registrySlots.backup !== undefined ||
      Object.values(journalSlots).some(value => value !== undefined)) invalid();
    let captured = captureWorkspaceSelectorSwitchSelection({ registrySlots, journalSlots,
      readRegistrySlots: () => options.registry.inspectSlots(), assertAuthority });
    const journal = createWorkspaceSelectorSwitchJournal(registry, target, generateOperationId(), now().toISOString());
    const selectedRegistry = createWorkspaceSelectorSwitchRegistryVariants(registry, target).selected;
    const selection = (): WorkspaceSelectorSwitchSelection => ({ registrySlots: captured.registrySlots,
      journalSlots: captured.journalSlots, readRegistrySlots: () => options.registry.inspectSlots(), assertAuthority });
    const assertSelection = async () => {
      assertAuthority();
      await captured.guard.assertExternalSelection();
      captured.assertJournalSelection(await readJournal());
      await captured.guard.assertExternalSelection();
      captured.assertJournalSelection(await readJournal());
    };
    const readBack = async (expectedRegistry: LocalWorkspaceRegistryV2, expectedJournal: WorkspaceSwitchJournalV2,
      changed: 'journal' | 'registry', identity: Readonly<CrashSafeFileSlotIdentity>) => {
      assertAuthority();
      const nextRegistry = await options.registry.inspectSlots();
      assertAuthority();
      const nextJournal = await readJournal();
      assertAuthority();
      if (changed === 'journal') await captured.guard.assertExternalSelection();
      else captured.assertJournalSelection(nextJournal);
      if (nextRegistry.next !== undefined || nextRegistry.backup !== undefined ||
        nextJournal.next !== undefined || nextJournal.backup !== undefined ||
        !Buffer.from(serializeWorkspaceRegistry(expectedRegistry)).equals(nextRegistry.current?.bytes ?? new Uint8Array()) ||
        !Buffer.from(serializeVersionedWorkspaceSwitchJournal(expectedJournal)).equals(nextJournal.current?.bytes ?? new Uint8Array())) invalid();
      const actualIdentity = (changed === 'journal' ? nextJournal : nextRegistry).current?.identity;
      if (actualIdentity === undefined || !sameCrashSafeFileSlotIdentity(identity, actualIdentity)) invalid();
      captured = captureWorkspaceSelectorSwitchSelection({ registrySlots: nextRegistry, journalSlots: nextJournal,
        readRegistrySlots: () => options.registry.inspectSlots(), assertAuthority });
      await assertSelection();
    };

    transitionStarted = true;
    await options.activeWorkspaceLifecycle.quiesceWrites(null);
    assertAdmission();
    const stopped = await options.activeWorkspaceLifecycle.stopAndProveHandlesClosed(null);
    if (stopped.handlesClosed !== true) invalid();
    await options.activeWorkspaceLifecycle.assertNoActiveWorkspaceRuntime();
    await assertSelection();
    const preparedIdentity = await options.journal.writeSelector(journal, selection());
    await readBack(registry, journal, 'journal', preparedIdentity);
    // Validate the same joint publication order as restart, before writing.
    planWorkspaceSelectorSwitchSlots(captured.journalSlots, { ...captured.registrySlots,
      next: { value: selectedRegistry, bytes: serializeWorkspaceRegistry(selectedRegistry) } });
    const selectedIdentity = await options.registry.writeSelected(selectedRegistry, captured.registryGuard(readJournal));
    await readBack(selectedRegistry, journal, 'registry', selectedIdentity);
    const committed = Object.freeze({ ...journal, state: 'targetSelected' as const });
    const committedIdentity = await options.journal.writeSelector(committed, selection());
    await readBack(selectedRegistry, committed, 'journal', committedIdentity);
    await options.activeWorkspaceLifecycle.assertNoActiveWorkspaceRuntime();
    await assertSelection();
    assertAuthority();
    relaunchReady = true;
  } catch (error) {
    failure = { error: transitionStarted
      ? new WorkspaceSwitchError('WORKSPACE_SWITCH_RECOVERY_REQUIRED', { cause: error })
      : error instanceof WorkspaceSwitchError ? error
      : new WorkspaceSwitchError('WORKSPACE_SWITCH_STORAGE_FAILED', { cause: error }) };
  }
  try { await lease.release(); }
  catch (error) { failure ??= { error: new WorkspaceSwitchError('WORKSPACE_SWITCH_RECOVERY_REQUIRED', { cause: error }) }; }
  if (failure !== undefined) throw failure.error;
  if (relaunchReady) {
    try {
      assertSynchronous(() => options.assertCurrent());
      options.relaunchApplication();
    } catch (error) { throw new WorkspaceSwitchError('WORKSPACE_SWITCH_RECOVERY_REQUIRED', { cause: error }); }
  }
}

function assertSynchronous(assertion: () => void): void {
  const result: unknown = assertion();
  if (result !== undefined) {
    void Promise.resolve(result).catch(() => undefined);
    invalid();
  }
}

function invalid(): never { throw new WorkspaceSwitchError('WORKSPACE_SWITCH_INVALID'); }
