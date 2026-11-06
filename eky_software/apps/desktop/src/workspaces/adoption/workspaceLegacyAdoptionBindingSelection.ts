import { captureWorkspaceRemnantBinding, serializeWorkspaceRemnantBinding, workspaceRemnantBindingSha256,
  type WorkspaceRemnantBindingV1 } from '../deletion/workspaceRemnantBindingCodec.js';
import { WorkspaceRemnantBindingStore, type WorkspaceRemnantBindingAuthority } from '../deletion/workspaceRemnantBindingStore.js';
import { sameCrashSafeFileSlotIdentity, type CrashSafeFileSlotFileSystem } from '../persistence/crashSafeFileSlot.js';
import type { ReadOnlyJournalSlots } from '../persistence/readOnlyJournalSlots.js';
import { validateWorkspaceLineage } from '../registry/workspaceLineageValidation.js';
import { WorkspaceLegacyAdoptionError } from './workspaceLegacyAdoptionError.js';
import { validateWorkspaceLegacyAdoptionJournal, type WorkspaceLegacyAdoptionJournalV1 } from './workspaceLegacyAdoptionJournal.js';

export interface WorkspaceLegacyAdoptionBindingOptions extends WorkspaceRemnantBindingAuthority {
  readonly userDataRoot: string;
  readonly journal: Readonly<WorkspaceLegacyAdoptionJournalV1>;
  // Other owners only. Never re-enter this binding's writer or inspector here.
  onUncertain(error: unknown): void;
}

type Observation = Awaited<ReturnType<WorkspaceRemnantBindingStore['inspect']>>;
type BindingAuthority = Omit<WorkspaceLegacyAdoptionBindingOptions, 'userDataRoot' | 'journal'>;
interface BindingState {
  selected?: Observation;
  original?: WorkspaceRemnantBindingV1 | undefined;
  active?: WorkspaceLegacyAdoptionBindingSelection | undefined;
  failure?: { reason: unknown; completion?: AggregateError } | undefined;
}
export interface WorkspaceLegacyAdoptionBindingObservation {
  readonly initialBinding: Readonly<WorkspaceRemnantBindingV1> | undefined;
  assertObservedCurrent(): Promise<void>;
  forPhase(authority: Readonly<BindingAuthority>): WorkspaceLegacyAdoptionBindingSelection;
}

// One journal-selected adoption's binding observation and own publication receipt.
// Process authority and the other selected owners still belong to the caller.
export class WorkspaceLegacyAdoptionBindingSelection {
  private readonly checkOwner: () => void;
  private readonly checkExternal: () => Promise<void>;
  private readonly notifyUncertain: (error: unknown) => void;
  private get selected() { if (this.state.selected === undefined) throw required(); return this.state.selected; }
  private set selected(value: Observation) { this.state.selected = value; }
  private get original() { return this.state.original; }
  private set original(value: WorkspaceRemnantBindingV1 | undefined) { this.state.original = value; }
  private get active() { return this.state.active !== undefined; }
  private set active(value: boolean) { this.state.active = value ? this : undefined; }
  private get failure() { return this.state.failure; }
  private set failure(value: BindingState['failure']) { this.state.failure = value; }

  private constructor(options: Readonly<BindingAuthority>,
    private readonly journal: Readonly<WorkspaceLegacyAdoptionJournalV1>,
    private readonly store: WorkspaceRemnantBindingStore,
    private readonly state: BindingState = {}, private readonly scoped = false) {
    this.checkOwner = options.assertAuthority.bind(options);
    this.checkExternal = options.assertExternalSelection.bind(options);
    this.notifyUncertain = options.onUncertain.bind(options);
  }

  static async capture(options: Readonly<WorkspaceLegacyAdoptionBindingOptions>, fileSystem?: CrashSafeFileSlotFileSystem) {
    const journal = validateWorkspaceLegacyAdoptionJournal(options.journal);
    const selected = new WorkspaceLegacyAdoptionBindingSelection(options, journal,
      new WorkspaceRemnantBindingStore(options.userDataRoot,
        { owner: 'workspaceLegacyAdoption', workspaceId: journal.workspaceId }, fileSystem));
    await selected.run(async () => {
      await selected.assertOutside();
      const observed = await selected.readBindingOnly();
      selected.assertJournalTarget(observed);
      selected.selected = captureObservation(observed);
      selected.original = observed.mode === 'published' ? captureWorkspaceRemnantBinding(observed.value) : undefined;
      await selected.assertSelected();
    });
    return selected;
  }

  static async observe(options: Readonly<Omit<WorkspaceLegacyAdoptionBindingOptions, 'assertExternalSelection'>>,
    fileSystem?: CrashSafeFileSlotFileSystem): Promise<Readonly<WorkspaceLegacyAdoptionBindingObservation>> {
    const journal = validateWorkspaceLegacyAdoptionJournal(options.journal);
    const selected = new WorkspaceLegacyAdoptionBindingSelection({
      assertAuthority: options.assertAuthority.bind(options),
      onUncertain: options.onUncertain.bind(options),
      assertExternalSelection: async () => { throw required(); },
    }, journal, new WorkspaceRemnantBindingStore(options.userDataRoot,
      { owner: 'workspaceLegacyAdoption', workspaceId: journal.workspaceId }, fileSystem), undefined, true);
    await selected.run(async () => {
      const observed = await selected.readBindingOnly();
      selected.assertJournalTarget(observed);
      selected.selected = captureObservation(observed);
      selected.original = observed.mode === 'published' ? captureWorkspaceRemnantBinding(observed.value) : undefined;
      assertSameObservation(selected.selected, await selected.readBindingOnly());
    });
    return Object.freeze({
      get initialBinding() { return selected.initialBinding; },
      assertObservedCurrent: () => selected.assertObservedCurrent(),
      forPhase: (authority: Readonly<BindingAuthority>) => selected.forPhase(authority),
    });
  }

  forPhase(authority: Readonly<BindingAuthority>): WorkspaceLegacyAdoptionBindingSelection {
    return new WorkspaceLegacyAdoptionBindingSelection(authority, this.journal, this.store, this.state, true);
  }

  get initialBinding(): Readonly<WorkspaceRemnantBindingV1> | undefined {
    this.assertMutationCurrent();
    return this.original;
  }

  assertCurrent(): Promise<void> { return this.run(() => this.assertSelected()); }
  assertObservedCurrent(): Promise<void> {
    return this.run(async () => { assertSameObservation(this.selected, await this.readBindingOnly()); });
  }

  async publish(profileId: string): Promise<void> {
    const lineageIdentity = validateWorkspaceLineage({ formatVersion: 1, profileId });
    if (this.journal.sourceKind !== 'legacy') throw required();
    const binding = captureWorkspaceRemnantBinding({ formatVersion: 1, owner: 'workspaceLegacyAdoption',
      operationId: this.journal.operationId, workspaceId: this.journal.workspaceId, lineageIdentity });
    await this.run(async () => {
      await this.assertSelected();
      if (this.selected.mode === 'published') {
        assertSameValue(this.selected.value, binding);
        return;
      }
      const receipt = await this.store.publish(binding, {
        assertAuthority: this.assertMutationCurrent, assertExternalSelection: () => this.assertOutside(),
      });
      this.assertMutationCurrent();
      assertSameValue(receipt.value, binding);
      if (receipt.bindingSha256 !== workspaceRemnantBindingSha256(binding)) throw required();
      const published = await this.readBindingOnly();
      if (published.mode !== 'published' || published.slots.current?.identity === undefined ||
          published.slots.next !== undefined || published.slots.backup !== undefined ||
          !sameCrashSafeFileSlotIdentity(receipt.identity, published.slots.current.identity) ||
          !sameBytes(published.slots.current.bytes, serializeWorkspaceRemnantBinding(binding))) throw required();
      assertSameValue(published.value, binding);
      this.selected = captureObservation(published);
      await this.assertSelected();
    });
  }

  async assertPublished(profileId: string): Promise<void> {
    const lineage = validateWorkspaceLineage({ formatVersion: 1, profileId });
    return this.run(async () => {
      await this.assertSelected();
      if (this.journal.sourceKind !== 'legacy' || this.selected.mode !== 'published' ||
          this.selected.value.lineageIdentity.profileId !== lineage.profileId) throw required();
    });
  }

  assertMutationCurrent = (): void => {
    if (this.scoped && this.state.active !== this) this.assertAdmissionOwner();
    if (this.failure !== undefined) throw this.failure.reason;
    try {
      this.assertOwner();
    } catch (error) { this.onUncertain(error); throw this.failure!.reason; }
  };

  private assertOwner(): void {
    const result: unknown = this.checkOwner();
    if (result !== undefined) { void Promise.resolve(result).catch(() => undefined); throw required(); }
  }

  private assertAdmissionOwner(): void {
    if (!this.scoped) return;
    try { this.assertOwner(); }
    catch (error) { throw required(error); }
  }

  onUncertain = (reason: unknown): void => {
    if (this.failure !== undefined) {
      if (reason instanceof AggregateError && reason.errors.includes(this.failure.reason)) this.failure.completion = reason;
      return;
    }
    this.failure = { reason };
    try {
      const result: unknown = this.notifyUncertain(reason);
      if (result !== undefined) void Promise.resolve(result).catch(() => undefined);
    } catch { /* Preserve the first reason. */ }
  };

  private async assertOutside() {
    this.assertMutationCurrent();
    await this.checkExternal();
    this.assertMutationCurrent();
  }

  private async readBindingOnly() {
    const observed = await this.store.inspect({ assertAuthority: this.assertMutationCurrent,
      assertExternalSelection: async () => { this.assertMutationCurrent(); } });
    this.assertMutationCurrent();
    return observed;
  }

  private async assertSelected() {
    await this.assertOutside();
    assertSameObservation(this.selected, await this.readBindingOnly());
    await this.assertOutside();
    // No external owner wait may follow the final binding readback.
    assertSameObservation(this.selected, await this.readBindingOnly());
  }

  private assertJournalTarget(observation: Observation) {
    if (observation.mode === 'absent') return;
    if (this.journal.sourceKind !== 'legacy' || observation.value.owner !== 'workspaceLegacyAdoption' ||
        observation.value.operationId !== this.journal.operationId || observation.value.workspaceId !== this.journal.workspaceId) throw required();
  }

  private async run<T>(work: () => Promise<T>): Promise<T> {
    this.assertAdmissionOwner();
    if (this.active || this.failure !== undefined) {
      this.onUncertain(required());
      throw required(this.failure?.completion ?? this.failure?.reason);
    }
    this.active = true;
    try {
      this.assertMutationCurrent();
      const result = await work();
      this.assertMutationCurrent();
      return result;
    } catch (error) { this.onUncertain(error); throw required(this.failure!.completion ?? this.failure!.reason); }
    finally { this.active = false; }
  }
}

function captureObservation(observation: Observation): Observation {
  const slots: Record<'current' | 'next' | 'backup', ReadOnlyJournalSlots<WorkspaceRemnantBindingV1>['current']> = {
    current: undefined, next: undefined, backup: undefined,
  };
  for (const slot of ['current', 'next', 'backup'] as const) {
    const record = observation.slots[slot];
    if (record !== undefined) {
      if (record.identity === undefined) throw required();
      slots[slot] = Object.freeze({ bytes: Uint8Array.from(record.bytes), value: captureWorkspaceRemnantBinding(record.value),
        identity: Object.freeze({ ...record.identity }) });
    }
  }
  return observation.mode === 'absent' ? Object.freeze({ mode: 'absent', slots: Object.freeze(slots) })
    : Object.freeze({ mode: 'published', value: captureWorkspaceRemnantBinding(observation.value),
      bindingSha256: observation.bindingSha256, slots: Object.freeze(slots) });
}

function assertSameObservation(expected: Observation, actual: Observation) {
  if (expected.mode !== actual.mode) throw required();
  for (const slot of ['current', 'next', 'backup'] as const) {
    const before = expected.slots[slot], after = actual.slots[slot];
    if (before === undefined ? after !== undefined : after === undefined || before.identity === undefined || after.identity === undefined ||
        !sameCrashSafeFileSlotIdentity(before.identity, after.identity) || !sameBytes(before.bytes, after.bytes)) throw required();
  }
  if (expected.mode === 'published') {
    if (actual.mode !== 'published' || expected.bindingSha256 !== actual.bindingSha256) throw required();
    assertSameValue(expected.value, actual.value);
  }
}

function assertSameValue(left: WorkspaceRemnantBindingV1, right: WorkspaceRemnantBindingV1) {
  if (!serializeWorkspaceRemnantBinding(left).equals(serializeWorkspaceRemnantBinding(right))) throw required();
}

function sameBytes(left: Uint8Array, right: Uint8Array) { return Buffer.from(left).equals(Buffer.from(right)); }

function required(cause?: unknown) {
  const error = new WorkspaceLegacyAdoptionError('WORKSPACE_ADOPTION_RECOVERY_REQUIRED');
  if (cause !== undefined) error.cause = cause;
  return error;
}
