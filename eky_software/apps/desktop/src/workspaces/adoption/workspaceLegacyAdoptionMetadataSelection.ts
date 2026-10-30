import type { CrashSafeByteSlotSelection, ObservedRecoveryAuthority, ObservedRecoverySelection } from '../persistence/crashSafeByteSlotStore.js';
import { sameCrashSafeFileSlotIdentity, type CrashSafeFileSlotIdentity } from '../persistence/crashSafeFileSlot.js';
import { parseWorkspaceRegistryBytes } from '../registry/workspaceRegistryBytes.js';
import type { WorkspaceRegistryPort } from '../registry/workspaceRegistryPort.js';
import { serializeWorkspaceRegistry } from '../registry/workspaceRegistrySerializer.js';
import type { WorkspaceRegistryStore } from '../registry/workspaceRegistryStore.js';
import { WorkspaceLegacyAdoptionError } from './workspaceLegacyAdoptionError.js';
import { parseWorkspaceLegacyAdoptionJournalBytes, serializeWorkspaceLegacyAdoptionJournal,
  type WorkspaceLegacyAdoptionJournalPort, type WorkspaceLegacyAdoptionJournalStore } from './workspaceLegacyAdoptionJournal.js';

export interface WorkspaceLegacyAdoptionMetadataOptions extends ObservedRecoveryAuthority {
  readonly journal: Pick<WorkspaceLegacyAdoptionJournalStore,
    'inspectRecoverySelection' | 'recoverObservedSelection' | 'writeSelected' | 'clearSelected'>;
  readonly registry: Pick<WorkspaceRegistryStore,
    'inspectRecoverySelection' | 'recoverObservedSelection' | 'writeSelected'>;
}

type Owner = 'journal' | 'registry';
type MetadataStores = ReturnType<typeof captureStores>;
interface MetadataState {
  selected?: Record<Owner, ObservedRecoverySelection>;
  active?: WorkspaceLegacyAdoptionMetadataSelection | undefined;
  retired: boolean;
  failure?: { reason: unknown; completion?: AggregateError } | undefined;
}
export interface WorkspaceLegacyAdoptionMetadataObservation {
  readJournal(): ReturnType<WorkspaceLegacyAdoptionJournalPort['read']>;
  assertObservedCurrent(): Promise<void>;
  forPhase(authority: Readonly<ObservedRecoveryAuthority>): WorkspaceLegacyAdoptionMetadataSelection;
}

// One adoption attempt's observed metadata and own acknowledged writes, not a
// lifecycle owner. The main caller must supply its current phase authority.
export class WorkspaceLegacyAdoptionMetadataSelection {
  private readonly stores: MetadataStores;
  private readonly checkOwner: () => void;
  private readonly checkExternal: () => Promise<void>;
  private readonly notifyUncertain: (error: unknown) => void;
  private readonly state: MetadataState;
  private get selected() { if (this.state.selected === undefined) throw required(); return this.state.selected; }
  private set selected(value: Record<Owner, ObservedRecoverySelection>) { this.state.selected = value; }
  private get active() { return this.state.active !== undefined; }
  private set active(value: boolean) { this.state.active = value ? this : undefined; }
  private get retired() { return this.state.retired; }
  private set retired(value: boolean) { this.state.retired = value; }
  private get failure() { return this.state.failure; }
  private set failure(value: MetadataState['failure']) { this.state.failure = value; }

  readonly journal: WorkspaceLegacyAdoptionJournalPort = Object.freeze({
    read: () => this.run(async () => {
      await this.assertBoth();
      await this.recover('journal');
      const bytes = this.selected.journal.bytes;
      return bytes === undefined ? undefined : parseWorkspaceLegacyAdoptionJournalBytes(bytes);
    }),
    write: async (value: unknown) => {
      const bytes = serializeWorkspaceLegacyAdoptionJournal(value);
      return this.run(async () => {
        await this.assertBoth();
        const receipt = await this.stores.journal.writeSelected(parseWorkspaceLegacyAdoptionJournalBytes(bytes), this.guard('journal'));
        await this.acknowledge('journal', bytes, receipt);
      });
    },
    clear: (operationId: string) => this.run(async () => {
      await this.assertBoth();
      await this.stores.journal.clearSelected(operationId, this.guard('journal'));
      await this.acknowledge('journal', undefined, undefined);
      this.retired = true;
    }),
  });

  readonly registry: WorkspaceRegistryPort = Object.freeze({
    read: () => this.run(async () => {
      await this.assertBoth();
      await this.recover('registry');
      const bytes = this.selected.registry.bytes;
      return bytes === undefined ? undefined : parseWorkspaceRegistryBytes(bytes);
    }),
    write: async (value: unknown) => {
      const bytes = serializeWorkspaceRegistry(value);
      return this.run(async () => {
        await this.assertBoth();
        const receipt = await this.stores.registry.writeSelected(parseWorkspaceRegistryBytes(bytes), this.guard('registry'));
        await this.acknowledge('registry', bytes, receipt);
      });
    },
  });

  private constructor(options: Readonly<ObservedRecoveryAuthority>, stores: MetadataStores,
    state: MetadataState = { retired: false }, private readonly scoped = false) {
    this.checkOwner = options.assertAuthority.bind(options);
    this.checkExternal = options.assertExternalSelection.bind(options);
    this.notifyUncertain = options.onUncertain.bind(options);
    this.stores = stores;
    this.state = state;
  }

  static async capture(options: Readonly<WorkspaceLegacyAdoptionMetadataOptions>) {
    const selected = new WorkspaceLegacyAdoptionMetadataSelection(options, captureStores(options));
    await selected.run(async () => {
      await selected.assertOutside();
      const observations = await selected.inspectBoth();
      selected.selected = { journal: captureObservation(observations[0]), registry: captureObservation(observations[1]) };
      await selected.assertBoth();
    });
    return selected;
  }

  static async observe(options: Readonly<Omit<WorkspaceLegacyAdoptionMetadataOptions, 'assertExternalSelection'>>)
    : Promise<Readonly<WorkspaceLegacyAdoptionMetadataObservation>> {
    const selected = new WorkspaceLegacyAdoptionMetadataSelection({
      assertAuthority: options.assertAuthority.bind(options),
      onUncertain: options.onUncertain.bind(options),
      assertExternalSelection: async () => { throw required(); },
    }, captureStores(options), undefined, true);
    await selected.run(async () => {
      const observations = await selected.inspectBoth();
      selected.selected = { journal: captureObservation(observations[0]), registry: captureObservation(observations[1]) };
      await selected.assertObservedBoth();
    });
    // No repairing or writing port escapes the readonly initialization phase.
    return Object.freeze({
      readJournal: () => selected.run(async () => {
        await selected.assertObservedBoth();
        const bytes = selected.selected.journal.bytes;
        return bytes === undefined ? undefined : parseWorkspaceLegacyAdoptionJournalBytes(bytes);
      }),
      assertObservedCurrent: () => selected.assertObservedCurrent(),
      forPhase: (authority: Readonly<ObservedRecoveryAuthority>) => selected.forPhase(authority),
    });
  }

  forPhase(authority: Readonly<ObservedRecoveryAuthority>): WorkspaceLegacyAdoptionMetadataSelection {
    return new WorkspaceLegacyAdoptionMetadataSelection(authority, this.stores, this.state, true);
  }

  assertCurrent(): Promise<void> { return this.run(() => this.assertBoth()); }
  assertObservedCurrent(): Promise<void> { return this.run(() => this.assertObservedBoth()); }

  assertMutationCurrent = (): void => {
    if (this.scoped && this.state.active !== this) this.assertAdmissionOwner();
    if (this.retired && this.failure === undefined) this.onUncertain(required());
    this.assertCompletionCurrent();
  };

  private assertCompletionCurrent(): void {
    if (this.failure !== undefined) throw this.failure.reason;
    try {
      this.assertOwner();
    } catch (error) { this.onUncertain(error); throw this.failure!.reason; }
  }

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
    } catch { /* Notification cannot replace the first failure. */ }
  };

  private async assertOutside() {
    this.assertMutationCurrent();
    await this.checkExternal();
    this.assertMutationCurrent();
  }

  private async inspectBoth() {
    let first: { reason: unknown } | undefined;
    const observe = (reason: unknown): never => { first ??= { reason }; throw reason; };
    const results = await Promise.allSettled([
      this.stores.journal.inspect(this.assertMutationCurrent).catch(observe),
      this.stores.registry.inspect(this.assertMutationCurrent).catch(observe),
    ]);
    if (first !== undefined) throw first.reason;
    const [journal, registry] = results;
    if (journal.status !== 'fulfilled' || registry.status !== 'fulfilled') throw required();
    this.assertMutationCurrent();
    return [journal.value, registry.value] as const;
  }

  private async assertBoth() {
    await this.assertOutside();
    await this.assertObservedBoth();
    await this.assertOutside();
    await this.assertObservedBoth();
  }

  private async assertObservedBoth() {
    const observations = await this.inspectBoth();
    assertSameObservation(this.selected.journal, observations[0]);
    assertSameObservation(this.selected.registry, observations[1]);
  }

  private guard(owner: Owner): CrashSafeByteSlotSelection & ObservedRecoveryAuthority {
    const selected = this.selected[owner];
    if (selected.source !== undefined && selected.source !== 'current' ||
        selected.identities.next !== undefined || selected.identities.backup !== undefined) throw required();
    return { expectedSlots: { current: selected.bytes, next: undefined, backup: undefined },
      expectedIdentities: selected.identities, assertAuthority: this.assertMutationCurrent,
      assertExternalSelection: () => this.assertOther(owner), onUncertain: this.onUncertain };
  }

  private async assertOther(writing: Owner) {
    await this.assertOutside();
    const other = writing === 'journal' ? 'registry' : 'journal';
    const observed = await this.stores[other].inspect(this.assertMutationCurrent);
    assertSameObservation(this.selected[other], observed);
    await this.assertOutside();
    const fresh = await this.stores[other].inspect(this.assertMutationCurrent);
    assertSameObservation(this.selected[other], fresh);
  }

  private async recover(owner: Owner) {
    const selected = this.selected[owner];
    if (selected.bytes === undefined) return;
    if (selected.source === 'current' && selected.identities.next === undefined && selected.identities.backup === undefined) return;
    const authority: ObservedRecoveryAuthority = { assertAuthority: this.assertMutationCurrent,
      assertExternalSelection: () => this.assertOther(owner), onUncertain: this.onUncertain };
    const receipt = await this.stores[owner].recover(selected, authority);
    await this.acknowledge(owner, receipt.bytes, receipt.identity);
  }

  private async acknowledge(owner: Owner, bytes: Uint8Array | undefined, identity: Readonly<CrashSafeFileSlotIdentity> | undefined) {
    this.assertMutationCurrent();
    const expected = captureObservation({ source: bytes === undefined ? undefined : 'current', bytes,
      identities: { current: identity, next: undefined, backup: undefined } });
    const actual = await this.stores[owner].inspect(this.assertMutationCurrent);
    assertSameObservation(expected, actual);
    await this.assertOther(owner);
    // Only this acknowledged effect advances the selected bytes and identity.
    this.selected[owner] = expected;
    await this.assertBoth();
  }

  private async run<T>(work: () => Promise<T>): Promise<T> {
    this.assertAdmissionOwner();
    if (this.active || this.retired || this.failure !== undefined) {
      this.onUncertain(required());
      throw required(this.failure?.completion ?? this.failure?.reason);
    }
    this.active = true;
    try {
      this.assertMutationCurrent();
      const result = await work();
      this.assertCompletionCurrent();
      return result;
    } catch (error) { this.onUncertain(error); throw required(this.failure!.completion ?? this.failure!.reason); }
    finally { this.active = false; }
  }
}

function captureStores(options: Pick<WorkspaceLegacyAdoptionMetadataOptions, 'journal' | 'registry'>) {
  return Object.freeze({
    journal: Object.freeze({
      inspect: options.journal.inspectRecoverySelection.bind(options.journal),
      recover: options.journal.recoverObservedSelection.bind(options.journal),
      writeSelected: options.journal.writeSelected.bind(options.journal),
      clearSelected: options.journal.clearSelected.bind(options.journal),
    }),
    registry: Object.freeze({
      inspect: options.registry.inspectRecoverySelection.bind(options.registry),
      recover: options.registry.recoverObservedSelection.bind(options.registry),
      writeSelected: options.registry.writeSelected.bind(options.registry),
    }),
  });
}

function captureObservation(value: ObservedRecoverySelection): ObservedRecoverySelection {
  return Object.freeze({ source: value.source, bytes: value.bytes === undefined ? undefined : Uint8Array.from(value.bytes),
    identities: Object.freeze({ current: captureIdentity(value.identities.current),
      next: captureIdentity(value.identities.next), backup: captureIdentity(value.identities.backup) }) });
}

function captureIdentity(value: Readonly<CrashSafeFileSlotIdentity> | undefined) {
  return value === undefined ? undefined : Object.freeze({ ...value });
}

function assertSameObservation(expected: ObservedRecoverySelection, actual: ObservedRecoverySelection) {
  if (expected.source !== actual.source || (expected.bytes === undefined ? actual.bytes !== undefined
    : actual.bytes === undefined || !Buffer.from(expected.bytes).equals(Buffer.from(actual.bytes)))) throw required();
  for (const slot of ['current', 'next', 'backup'] as const) {
    const before = expected.identities[slot], after = actual.identities[slot];
    if (before === undefined ? after !== undefined : after === undefined || !sameCrashSafeFileSlotIdentity(before, after)) throw required();
  }
}

function required(cause?: unknown) {
  const error = new WorkspaceLegacyAdoptionError('WORKSPACE_ADOPTION_RECOVERY_REQUIRED');
  if (cause !== undefined) error.cause = cause;
  return error;
}
