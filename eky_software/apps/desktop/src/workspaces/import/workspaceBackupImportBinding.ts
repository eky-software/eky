import { WorkspaceRemnantBindingStore } from '../deletion/workspaceRemnantBindingStore.js';
import { captureWorkspaceRemnantBinding, workspaceRemnantBindingKey } from '../deletion/workspaceRemnantBindingCodec.js';
import type { InMemoryWorkspaceMaintenanceLease, WorkspaceMaintenanceLeaseHandle } from '../maintenance/workspaceMaintenanceLease.js';
import { sameCrashSafeFileSlotIdentity, type CrashSafeFileSlotFileSystem,
  type CrashSafeFileSlotIdentity } from '../persistence/crashSafeFileSlot.js';
import type { ReadOnlyJournalSlots } from '../persistence/readOnlyJournalSlots.js';
import { parseWorkspaceRegistryBytes } from '../registry/workspaceRegistryBytes.js';
import { serializeWorkspaceRegistry } from '../registry/workspaceRegistrySerializer.js';
import type { WorkspaceRegistryStore } from '../registry/workspaceRegistryStore.js';
import type { LocalWorkspaceRegistry, LocalWorkspaceRegistryEntryV1, WorkspaceLineageIdentityV1 } from '../registry/workspaceRegistryTypes.js';
import type { WorkspaceRuntimeAbsencePort } from '../runtime/workspaceRuntimeAbsencePort.js';
import { WorkspaceBackupImportError } from './workspaceBackupImportError.js';
import { assertImportLineageAvailable, assertImportWorkspaceIdAvailable, publishImportedWorkspaceEntry } from './workspaceBackupImportRegistry.js';

export interface WorkspaceBackupImportBindingOptions {
  readonly userDataRoot: string;
  readonly operationId: unknown;
  readonly workspaceId: unknown;
  readonly lineageIdentity: Readonly<WorkspaceLineageIdentityV1>;
  readonly registrySelection: ReadOnlyJournalSlots<LocalWorkspaceRegistry>;
  readonly registry: Pick<WorkspaceRegistryStore, 'inspectSlots' | 'writeSelected'>;
  readonly lease: WorkspaceMaintenanceLeaseHandle;
  readonly maintenanceLease: Pick<InMemoryWorkspaceMaintenanceLease, 'captureCurrentOwner'>;
  readonly runtimeAbsence: WorkspaceRuntimeAbsencePort;
  readonly mainOwner: { assertCurrent(): void; assertOwned(): Promise<void> };
  readonly onUncertain: () => void;
}

type Receipt = Awaited<ReturnType<WorkspaceRemnantBindingStore['publish']>>;
type RegistrySelection = Readonly<{ bytes: Uint8Array; identity: Readonly<CrashSafeFileSlotIdentity> }>;

// Import authority only; payloads, recovery and deferred completion keep their owners.
export class WorkspaceBackupImportBinding {
  private readonly assertLease: () => void;
  private readonly assertMain: () => void;
  private readonly assertOwned: () => Promise<void>;
  private readonly assertAbsent: () => Promise<void>;
  private readonly onUncertain: () => void;
  private readonly readRegistry: WorkspaceRegistryStore['inspectSlots'];
  private readonly writeRegistry: WorkspaceRegistryStore['writeSelected'];
  private readonly original: RegistrySelection;
  private selected: RegistrySelection;
  private readonly binding;
  private readonly store: WorkspaceRemnantBindingStore;
  private receipt: Receipt | undefined;
  private phase: 'before' | 'writing' | 'after' = 'before';
  private attempted = false;
  private active = false;
  private failure: { error: unknown } | undefined;

  constructor(options: Readonly<WorkspaceBackupImportBindingOptions>, fileSystem?: CrashSafeFileSlotFileSystem) {
    if (options.lease === null || typeof options.lease !== 'object' || typeof options.lease.release !== 'function') throw required();
    this.assertLease = options.maintenanceLease.captureCurrentOwner(['import'], options.lease);
    this.assertMain = options.mainOwner.assertCurrent.bind(options.mainOwner);
    this.assertOwned = options.mainOwner.assertOwned.bind(options.mainOwner);
    this.assertAbsent = options.runtimeAbsence.assertNoActiveWorkspaceRuntime.bind(options.runtimeAbsence);
    this.onUncertain = options.onUncertain.bind(options);
    this.readRegistry = options.registry.inspectSlots.bind(options.registry);
    this.writeRegistry = options.registry.writeSelected.bind(options.registry);
    const slots = options.registrySelection;
    if (slots.current?.identity === undefined || slots.next !== undefined || slots.backup !== undefined) throw required();
    this.original = captureSelection(slots.current.bytes, slots.current.identity);
    this.selected = this.original;
    this.binding = captureWorkspaceRemnantBinding({ formatVersion: 1, owner: 'workspaceImport',
      operationId: options.operationId, workspaceId: options.workspaceId, lineageIdentity: options.lineageIdentity });
    const registry = parseWorkspaceRegistryBytes(this.original.bytes);
    assertImportWorkspaceIdAvailable(registry, this.binding.workspaceId);
    assertImportLineageAvailable(registry, this.binding.lineageIdentity);
    this.store = new WorkspaceRemnantBindingStore(options.userDataRoot, workspaceRemnantBindingKey(this.binding), fileSystem);
  }

  publish(): Promise<void> {
    return this.run(async () => {
      if (this.attempted || this.phase !== 'before') throw required();
      this.attempted = true;
      const receipt = await this.store.publish(this.binding, {
        assertAuthority: this.assertAuthority, assertExternalSelection: this.assertRegistrySelection,
      });
      await this.verifyReceipt(receipt);
      this.receipt = receipt;
    });
  }

  assertPublished(): Promise<void> {
    return this.run(() => this.assertPublishedSelection());
  }

  publishRegistry(entry: Readonly<LocalWorkspaceRegistryEntryV1>, assertJournalSelection: () => Promise<void>): Promise<void> {
    // Business validation precedes the authority operation and is not uncertainty.
    if (entry.workspaceId !== this.binding.workspaceId || entry.lineageIdentity.profileId !== this.binding.lineageIdentity.profileId) {
      throw required();
    }
    const expected = serializeWorkspaceRegistry(publishImportedWorkspaceEntry(parseWorkspaceRegistryBytes(this.original.bytes), entry));
    const checkJournal = assertJournalSelection.bind(undefined);
    return this.run(async () => {
      if (this.phase !== 'before') throw required();
      await this.assertPublishedSelection();
      this.phase = 'writing';
      // The existing writer owns its changing registry slots. Never re-enter it.
      const identity = await this.writeRegistry(parseWorkspaceRegistryBytes(expected), {
        expectedSlots: { current: this.original.bytes, next: undefined, backup: undefined },
        expectedIdentities: { current: this.original.identity, next: undefined, backup: undefined },
        assertAuthority: this.assertAuthority,
        assertExternalSelection: async () => {
          try {
            await this.assertBindingOnly();
            await checkJournal(); this.assertAuthority();
            await this.assertBindingOnly();
          } catch (error) { this.rejectUncertain(error); }
        },
      });
      const slots = await this.readRegistry(this.assertAuthority);
      this.assertAuthority();
      if (slots.current?.identity === undefined || slots.next !== undefined || slots.backup !== undefined ||
          !sameBytes(expected, slots.current.bytes) || !sameCrashSafeFileSlotIdentity(identity, slots.current.identity)) throw required();
      this.selected = captureSelection(slots.current.bytes, slots.current.identity);
      await this.assertBindingOnly();
      await checkJournal(); this.assertAuthority();
      await this.assertRegistrySelection();
      this.phase = 'after';
    });
  }

  assertMutationCurrent(): void {
    if (this.failure !== undefined) throw required(this.failure.error);
    try {
      if (this.active || this.receipt === undefined || this.phase === 'writing') throw required();
      this.assertAuthority();
    } catch (error) { this.rejectUncertain(error); }
  }

  private assertAuthority = (): void => {
    if (this.failure !== undefined) throw this.failure.error;
    try {
      assertSynchronous(this.assertLease);
      assertSynchronous(this.assertMain);
    } catch (error) { this.rejectUncertain(error); }
  };

  private assertOwner = async (): Promise<void> => {
    this.assertAuthority();
    await this.assertAbsent(); this.assertAuthority();
    await this.assertOwned(); this.assertAuthority();
  };

  private assertRegistrySelection = async (): Promise<void> => {
    await this.assertOwner();
    const slots = await this.readRegistry(this.assertAuthority);
    this.assertAuthority();
    if (slots.current?.identity === undefined || slots.next !== undefined || slots.backup !== undefined ||
        !sameBytes(this.selected.bytes, slots.current.bytes) ||
        !sameCrashSafeFileSlotIdentity(this.selected.identity, slots.current.identity)) throw required();
  };

  private async verifyReceipt(receipt: Receipt): Promise<void> {
    const observed = await this.store.inspect({ assertAuthority: this.assertAuthority, assertExternalSelection: this.assertOwner });
    this.assertAuthority();
    if (observed.mode !== 'published' || observed.bindingSha256 !== receipt.bindingSha256 ||
        observed.slots.current?.identity === undefined || observed.slots.next !== undefined || observed.slots.backup !== undefined ||
        !sameCrashSafeFileSlotIdentity(receipt.identity, observed.slots.current.identity)) throw required();
    await this.assertRegistrySelection();
  }

  private async assertBindingOnly(): Promise<void> {
    if (this.receipt === undefined) throw required();
    const observed = await this.store.inspect({ assertAuthority: this.assertAuthority, assertExternalSelection: this.assertOwner });
    this.assertAuthority();
    if (observed.mode !== 'published' || observed.bindingSha256 !== this.receipt.bindingSha256 ||
        observed.slots.current?.identity === undefined || observed.slots.next !== undefined || observed.slots.backup !== undefined ||
        !sameCrashSafeFileSlotIdentity(this.receipt.identity, observed.slots.current.identity)) throw required();
  }

  private async assertPublishedSelection(): Promise<void> {
    if (this.receipt === undefined || this.phase === 'writing') throw required();
    await this.assertRegistrySelection();
    await this.verifyReceipt(this.receipt);
  }

  private async run(work: () => Promise<void>): Promise<void> {
    const previous = this.readFailure();
    if (previous !== undefined) throw required(previous.error);
    if (this.active) this.rejectUncertain(required());
    this.active = true;
    try {
      await work();
      const failure = this.readFailure();
      if (failure !== undefined) throw failure.error;
    } catch (error) {
      const failure = this.readFailure();
      if (failure !== undefined && error !== failure.error) {
        throw new AggregateError([failure.error, error], 'WORKSPACE_IMPORT_RECOVERY_REQUIRED');
      }
      this.rejectUncertain(error);
    } finally { this.active = false; }
  }

  private readFailure() { return this.failure; }

  private rejectUncertain(error: unknown): never {
    if (this.attempted && this.failure === undefined) {
      this.failure = { error };
      try { assertSynchronous(this.onUncertain); }
      catch (secondary) { this.failure = { error: new AggregateError([error, secondary], 'WORKSPACE_IMPORT_RECOVERY_REQUIRED') }; }
    }
    throw this.failure === undefined ? error : this.failure.error;
  }
}

function captureSelection(bytes: Uint8Array, identity: Readonly<CrashSafeFileSlotIdentity>): RegistrySelection {
  return Object.freeze({ bytes: Uint8Array.from(bytes), identity: Object.freeze({ ...identity }) });
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength && left.every((value, index) => value === right[index]);
}

function assertSynchronous(assertCurrent: () => void): void {
  const result: unknown = assertCurrent();
  if (result !== undefined) {
    void Promise.resolve(result).catch(() => undefined);
    throw required();
  }
}

function required(cause?: unknown) {
  return new WorkspaceBackupImportError('WORKSPACE_IMPORT_RECOVERY_REQUIRED', 'recovery', { cause });
}
