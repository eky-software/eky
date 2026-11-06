import { sameCrashSafeFileSlotIdentity } from '../persistence/crashSafeFileSlot.js';
import type { CrashSafeByteSlotSelection, ObservedRecoverySelection } from '../persistence/crashSafeByteSlotStore.js';
import type { ReadOnlyJournalSlots } from '../persistence/readOnlyJournalSlots.js';
import type { WorkspaceMaintenanceLeaseHandle } from '../maintenance/workspaceMaintenanceLease.js';
import { WorkspaceManagementRecoveryRequiredError } from '../management/workspaceManagementOperationGuard.js';
import { WorkspaceRemnantBindingStore } from '../deletion/workspaceRemnantBindingStore.js';
import type { WorkspaceRemnantBindingV1 } from '../deletion/workspaceRemnantBindingCodec.js';
import { appendRecoveredWorkspaceEntry } from '../registry/workspaceRegistryMutations.js';
import { serializeWorkspaceRegistry } from '../registry/workspaceRegistrySerializer.js';
import type { LocalWorkspaceRegistry } from '../registry/workspaceRegistryTypes.js';
import { validateWorkspaceRegistry } from '../registry/workspaceRegistryValidation.js';
import type { WorkspaceRuntimeAbsencePort } from '../runtime/workspaceRuntimeAbsencePort.js';
import type { ColdImportJournalPort, ColdImportRegistryPort, WorkspaceBackupImportColdOwner } from './workspaceBackupImportColdOwner.js';
import { createImportedWorkspaceEntry } from './workspaceBackupImportRegistry.js';
import { deriveWorkspaceBackupImportPaths } from './workspaceBackupImportPaths.js';
import type { WorkspaceBackupImportRootStore, WorkspaceImportMutationAuthority } from './workspaceBackupImportRootStore.js';
import type { WorkspaceBackupImportJournal } from './workspaceBackupImportTypes.js';
import { serializeWorkspaceBackupImportJournal } from './workspaceBackupImportJournalSerializer.js';
import { WorkspaceBackupImportError } from './workspaceBackupImportError.js';

type ActiveStore = 'journal' | 'registry' | 'binding';
type BindingObservation = Awaited<ReturnType<WorkspaceRemnantBindingStore['inspect']>>;

// One cold import's authority and acknowledged metadata, not a recovery manager.
// WorkspaceBackupImportRecovery continues to own the existing branch matrix.
export class WorkspaceBackupImportColdContext {
  private journalSelection: ObservedRecoverySelection | undefined;
  private registrySelection: ObservedRecoverySelection | undefined;
  private journalValue: Readonly<WorkspaceBackupImportJournal> | undefined;
  private registryValue: Readonly<LocalWorkspaceRegistry> | undefined;
  private bindingStore: WorkspaceRemnantBindingStore | undefined;
  private binding: BindingObservation | undefined;
  private payloadClosed = false;
  private journalCleared = false;
  private registryWritten = false;
  private pending = 0;
  private first: { error: unknown } | undefined;
  private cleanup: { error: unknown } | undefined;
  private readonly owner: WorkspaceBackupImportColdOwner;

  constructor(private readonly options: Readonly<{
    owner: WorkspaceBackupImportColdOwner;
    importJournal: ColdImportJournalPort;
    registry: ColdImportRegistryPort;
    rootStore: WorkspaceBackupImportRootStore;
    workspaceRuntimeAbsence: WorkspaceRuntimeAbsencePort;
    userDataRoot: string;
  }>) {
    const owner = options.owner;
    this.owner = Object.freeze({ assertCurrent: owner.assertCurrent.bind(owner), assertMainOwned: owner.assertMainOwned.bind(owner),
      assertRecoveryConflicts: owner.assertRecoveryConflicts.bind(owner), onUncertain: owner.onUncertain.bind(owner) });
    this.assertCurrent();
  }

  recordFailure(error: unknown): void {
    if (this.first !== undefined) return;
    this.first = { error };
    try { this.owner.onUncertain(error); } catch { /* Keep the first cause. */ }
  }

  private assertCurrent = (): void => {
    if (this.first !== undefined) throw this.first.error;
    try { assertSync(this.owner.assertCurrent); }
    catch (error) { this.recordFailure(error); throw error; }
  };

  private async mainOwned(): Promise<void> {
    this.assertCurrent(); await this.owner.assertMainOwned(); this.assertCurrent();
    await this.options.workspaceRuntimeAbsence.assertNoActiveWorkspaceRuntime(); this.assertCurrent();
  }

  async initialize(): Promise<void> {
    await this.work(async () => {
      await this.mainOwned();
      const journal = await this.options.importJournal.inspectRecoverySelection(this.assertCurrent);
      this.assertCurrent(); this.journalSelection = captureObservation(journal); this.journalValue = journal.value;
      if (journal.value === undefined) return;
      if (journal.value.formatVersion !== 2) throw new WorkspaceManagementRecoveryRequiredError();
      const registry = await this.options.registry.inspectRecoverySelection(this.assertCurrent);
      this.assertCurrent();
      if (registry.value === undefined) throw new WorkspaceManagementRecoveryRequiredError();
      this.registrySelection = captureObservation(registry); this.registryValue = validateWorkspaceRegistry(registry.value);
      this.bindingStore = new WorkspaceRemnantBindingStore(this.options.userDataRoot,
        { owner: 'workspaceImport', operationId: journal.value.operationId });
      const binding = await this.inspectBinding();
      if (binding.mode === 'published' && (binding.value.workspaceId !== journal.value.workspaceId ||
        (journal.value.lineageIdentity !== null && binding.value.lineageIdentity.profileId !== journal.value.lineageIdentity.profileId))) {
        throw new WorkspaceManagementRecoveryRequiredError();
      }
      this.binding = captureBinding(binding);
      await this.guard();
      const journalReceipt = await this.options.importJournal.recoverObservedSelection(this.journalSelection, this.authority('journal'));
      this.assertCurrent(); this.journalSelection = normalized(journalReceipt); this.journalValue = journalReceipt.value;
      await this.guard();
      const registryReceipt = await this.options.registry.recoverObservedSelection(this.registrySelection!, this.authority('registry'));
      this.assertCurrent(); this.registrySelection = normalized(registryReceipt); this.registryValue = registryReceipt.value;
      await this.guard();
    });
  }

  async readJournal() {
    await this.guard();
    return this.journalCleared ? undefined : this.journalValue;
  }

  async readRegistry() { await this.guard(); return this.registryValue; }

  async assertPayloadCurrent(): Promise<void> {
    if (this.payloadClosed) throw new WorkspaceManagementRecoveryRequiredError();
    await this.guard();
  }

  readonly mutationAuthority: WorkspaceImportMutationAuthority = {
    assertCurrent: () => this.captureFailure(() => this.assertPayloadCurrent()),
    assertMutationCurrent: () => { this.assertCurrent(); if (this.payloadClosed) throw new WorkspaceManagementRecoveryRequiredError(); },
  };

  async work<T>(work: () => Promise<T>): Promise<T> {
    this.assertCurrent(); this.pending++;
    try { const result = await work(); this.assertCurrent(); return result; }
    catch (error) { this.recordFailure(error); throw this.first!.error; }
    finally { this.pending--; }
  }

  async writeJournal(next: Readonly<WorkspaceBackupImportJournal>) {
    return this.work(async () => {
      const identity = await this.options.importJournal.writeSelected(next, this.selection('journal'));
      this.assertCurrent();
      const selected = await this.options.importJournal.inspectRecoverySelection(this.assertCurrent);
      this.assertReceipt(selected, identity, serializeWorkspaceBackupImportJournal(next));
      this.journalSelection = captureObservation(selected); this.journalValue = selected.value;
      await this.guard();
      return next;
    });
  }

  async writeRegistry(value: unknown) {
    return this.work(async () => {
      const journal = this.journalValue;
      if (this.registryWritten || !journal || !this.registryValue || journal.state !== 'rootPublished' || journal.lineageIdentity === null) {
        throw new WorkspaceManagementRecoveryRequiredError();
      }
      const expected = appendRecoveredWorkspaceEntry(this.registryValue, createImportedWorkspaceEntry({
        workspaceId: journal.workspaceId, workspaceLabel: journal.workspaceLabel,
        lineageIdentity: journal.lineageIdentity, createdAt: journal.createdAt,
      }));
      const next = validateWorkspaceRegistry(value);
      if (!Buffer.from(serializeWorkspaceRegistry(next)).equals(Buffer.from(serializeWorkspaceRegistry(expected)))) {
        throw new WorkspaceManagementRecoveryRequiredError();
      }
      const identity = await this.options.registry.writeSelected(next, this.selection('registry'));
      this.assertCurrent();
      const selected = await this.options.registry.inspectRecoverySelection(this.assertCurrent);
      this.assertReceipt(selected, identity, serializeWorkspaceRegistry(next));
      this.registrySelection = captureObservation(selected); this.registryValue = selected.value; this.registryWritten = true;
      await this.guard();
    });
  }

  async clearJournal(beforePublication: boolean): Promise<void> {
    await this.work(async () => {
      const journal = this.journalValue;
      if (!journal || !this.binding || !this.bindingStore) throw new WorkspaceManagementRecoveryRequiredError();
      await this.assertPayloadCurrent();
      await this.assertPayloadsAbsent();
      if (this.binding.mode === 'published') {
        await this.bindingStore.clearAfterPayloadsAbsent(this.binding.value, {
          mode: 'owner', bindingSha256: this.binding.bindingSha256, expectedOwnerSlots: this.binding.slots,
          assertAuthority: this.assertCurrent, assertExternalSelection: () => this.captureFailure(() => this.guard('binding')),
          assertPayloadsAbsent: () => this.captureFailure(() => this.assertPayloadsAbsent()),
        });
        this.assertCurrent();
      }
      const absent = await this.inspectBinding();
      if (absent.mode !== 'absent') throw new WorkspaceManagementRecoveryRequiredError();
      this.binding = captureBinding(absent); this.payloadClosed = true;
      const selection = this.selection('journal', true);
      if (beforePublication) await this.options.importJournal.discardBeforePublicationSelected(journal.operationId, selection);
      else await this.options.importJournal.removeSelected(journal.operationId, selection);
      this.assertCurrent();
      const after = await this.options.importJournal.inspectRecoverySelection(this.assertCurrent);
      if (after.source !== undefined || Object.values(after.identities).some(value => value !== undefined)) throw new WorkspaceManagementRecoveryRequiredError();
      this.journalSelection = captureObservation(after); this.journalCleared = true;
      await this.guard(); await this.assertPayloadsAbsent();
    });
  }

  async release(lease: WorkspaceMaintenanceLeaseHandle): Promise<Readonly<{ failed: boolean; error?: unknown }>> {
    try {
      if (this.pending !== 0) throw new WorkspaceManagementRecoveryRequiredError();
      // This physical proof is independent from the revoked mutation scope.
      // The candidate owner invalidates it if exit/callback/reclaim is uncertain.
      await this.owner.assertMainOwned();
      await lease.release();
      return { failed: false };
    } catch (error) {
      this.cleanup = { error };
      if (this.first === undefined) this.recordFailure(error);
      else try { this.owner.onUncertain(error); } catch { /* Retain separate cleanup evidence. */ }
      return { failed: true, error };
    }
  }

  get failureEvidence() { return { first: this.first, cleanup: this.cleanup }; }

  private async assertPayloadsAbsent() {
    await this.mainOwned();
    if (this.pending > 1 || !this.journalValue) throw new WorkspaceManagementRecoveryRequiredError();
    await this.options.rootStore.assertOperationAbsent(deriveWorkspaceBackupImportPaths(this.options.userDataRoot,
      this.journalValue.operationId, this.journalValue.workspaceId), this.assertCurrent);
    this.assertCurrent();
  }

  private authority(active: ActiveStore) {
    return { assertAuthority: this.assertCurrent, assertExternalSelection: () => this.captureFailure(() => this.guard(active)),
      onUncertain: (error: unknown) => this.recordFailure(error) };
  }

  private selection(active: 'journal' | 'registry', absentPayloads = false): CrashSafeByteSlotSelection {
    const selected = active === 'journal' ? this.journalSelection : this.registrySelection;
    if (!selected || selected.source !== 'current' || !selected.bytes || selected.identities.next || selected.identities.backup) {
      throw new WorkspaceManagementRecoveryRequiredError();
    }
    return { expectedSlots: { current: selected.bytes, next: undefined, backup: undefined }, expectedIdentities: selected.identities,
      assertAuthority: this.assertCurrent, assertExternalSelection: () => this.captureFailure(async () => {
        await this.guard(active); if (absentPayloads) await this.assertPayloadsAbsent();
      }) };
  }

  private async inspectBinding(active?: ActiveStore) {
    if (!this.bindingStore) throw new WorkspaceManagementRecoveryRequiredError();
    return this.bindingStore.inspect({ assertAuthority: this.assertCurrent, assertExternalSelection: () => this.captureFailure(async () => {
      await this.mainOwned();
      if (active !== 'journal') await this.assertSelected('journal');
      if (active !== 'registry') await this.assertSelected('registry');
      await this.mainOwned();
    }) });
  }

  // Capture before a nested store converts a guard failure to its safe code.
  private async captureFailure<T>(work: () => Promise<T>): Promise<T> {
    try { return await work(); }
    catch (error) { this.recordFailure(error); throw this.first!.error; }
  }

  private async guard(active?: ActiveStore) {
    await this.mainOwned();
    if (this.journalValue && this.registryValue) await this.owner.assertRecoveryConflicts({ journal: this.journalValue, registry: this.registryValue });
    this.assertCurrent();
    if (active !== 'journal') await this.assertSelected('journal');
    if (active !== 'registry') await this.assertSelected('registry');
    if (active !== 'binding' && this.binding !== undefined) {
      const actual = await this.inspectBinding(active);
      if (actual.mode !== this.binding.mode || !sameBindingSlots(actual.slots, this.binding.slots)) throw new WorkspaceBackupImportError('WORKSPACE_IMPORT_RECOVERY_REQUIRED', 'recovery');
    }
    await this.mainOwned();
  }

  private async assertSelected(kind: 'journal' | 'registry') {
    const expected = kind === 'journal' ? this.journalSelection : this.registrySelection;
    if (!expected) return;
    const actual = kind === 'journal' ? await this.options.importJournal.inspectRecoverySelection(this.assertCurrent)
      : await this.options.registry.inspectRecoverySelection(this.assertCurrent);
    this.assertCurrent();
    if (!sameObservation(expected, actual)) throw new WorkspaceBackupImportError('WORKSPACE_IMPORT_RECOVERY_REQUIRED', 'recovery');
  }

  private assertReceipt(actual: ObservedRecoverySelection, identity: NonNullable<ObservedRecoverySelection['identities']['current']>, bytes: Uint8Array) {
    if (actual.source !== 'current' || !actual.bytes || actual.identities.next || actual.identities.backup ||
      !actual.identities.current || !sameCrashSafeFileSlotIdentity(identity, actual.identities.current) ||
      !Buffer.from(actual.bytes).equals(Buffer.from(bytes))) throw new WorkspaceManagementRecoveryRequiredError();
  }
}

function normalized(receipt: Readonly<{ bytes: Uint8Array; identity: NonNullable<ObservedRecoverySelection['identities']['current']> }>): ObservedRecoverySelection {
  return { source: 'current', bytes: Uint8Array.from(receipt.bytes), identities: { current: receipt.identity, next: undefined, backup: undefined } };
}

function captureObservation(value: ObservedRecoverySelection): ObservedRecoverySelection {
  return Object.freeze({ source: value.source, bytes: value.bytes === undefined ? undefined : Uint8Array.from(value.bytes),
    identities: Object.freeze({ current: value.identities.current && Object.freeze({ ...value.identities.current }),
      next: value.identities.next && Object.freeze({ ...value.identities.next }),
      backup: value.identities.backup && Object.freeze({ ...value.identities.backup }) }) });
}

function sameObservation(left: ObservedRecoverySelection, right: ObservedRecoverySelection): boolean {
  if (left.source !== right.source || (left.bytes === undefined ? right.bytes !== undefined : right.bytes === undefined ||
    !Buffer.from(left.bytes).equals(Buffer.from(right.bytes)))) return false;
  return (['current', 'next', 'backup'] as const).every(slot => {
    const a = left.identities[slot], b = right.identities[slot];
    return a === undefined ? b === undefined : b !== undefined && sameCrashSafeFileSlotIdentity(a, b);
  });
}

function sameBindingSlots(left: ReadOnlyJournalSlots<WorkspaceRemnantBindingV1>, right: ReadOnlyJournalSlots<WorkspaceRemnantBindingV1>): boolean {
  return (['current', 'next', 'backup'] as const).every(slot => {
    const a = left[slot], b = right[slot];
    return a === undefined ? b === undefined : b !== undefined && a.identity !== undefined && b.identity !== undefined &&
      sameCrashSafeFileSlotIdentity(a.identity, b.identity) && Buffer.from(a.bytes).equals(Buffer.from(b.bytes));
  });
}

function captureBinding(observation: BindingObservation): BindingObservation {
  const slots = Object.fromEntries((['current', 'next', 'backup'] as const).map(slot => {
    const value = observation.slots[slot]; return [slot, value === undefined ? undefined :
      Object.freeze({ ...value, bytes: Uint8Array.from(value.bytes), identity: value.identity && Object.freeze({ ...value.identity }) })];
  })) as ReadOnlyJournalSlots<WorkspaceRemnantBindingV1>;
  return Object.freeze({ ...observation, slots: Object.freeze(slots) });
}

function assertSync(assertAuthority: () => void): void {
  const result: unknown = assertAuthority();
  if (result !== undefined) { void Promise.resolve(result).catch(() => undefined); throw new WorkspaceManagementRecoveryRequiredError(); }
}
