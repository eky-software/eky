import { WorkspaceRemnantBindingStore } from '../deletion/workspaceRemnantBindingStore.js';
import { captureWorkspaceRemnantBinding, workspaceRemnantBindingKey } from '../deletion/workspaceRemnantBindingCodec.js';
import { sameCrashSafeFileSlotIdentity, type CrashSafeFileSlotFileSystem,
  type CrashSafeFileSlotIdentity } from '../persistence/crashSafeFileSlot.js';
import type { InMemoryWorkspaceMaintenanceLease, WorkspaceMaintenanceLeaseHandle } from '../maintenance/workspaceMaintenanceLease.js';
import { parseWorkspaceRegistryBytes } from '../registry/workspaceRegistryBytes.js';
import type { WorkspaceRegistryStore } from '../registry/workspaceRegistryStore.js';
import type { WorkspaceRuntimeAbsencePort } from '../runtime/workspaceRuntimeAbsencePort.js';
import { WorkspaceBackupReplacementError } from './workspaceBackupReplacementError.js';
import { assertWorkspaceReplacementRegistryUnchanged, validateWorkspaceReplacementTarget,
  type WorkspaceReplacementTarget } from './workspaceBackupReplacementRegistry.js';

export interface WorkspaceBackupReplacementBindingOptions {
  readonly userDataRoot: string;
  readonly operationId: unknown;
  readonly target: Readonly<WorkspaceReplacementTarget>;
  readonly lease: WorkspaceMaintenanceLeaseHandle;
  readonly maintenanceLease: Pick<InMemoryWorkspaceMaintenanceLease, 'captureCurrentOwner'>;
  readonly registry: Pick<WorkspaceRegistryStore, 'inspectSlots'>;
  readonly runtimeAbsence: WorkspaceRuntimeAbsencePort;
  readonly mainOwner: {
    assertCurrent(): void;
    assertOwned(): Promise<void>;
  };
  // The composition closes admission, invalidates main authority and blocks deferred return.
  readonly onUncertain: () => void;
}

type BindingReceipt = Awaited<ReturnType<WorkspaceRemnantBindingStore['publish']>>;

// Per-operation authority only. It neither owns recovery nor grants payload cleanup.
export class WorkspaceBackupReplacementBinding {
  private readonly assertLease: () => void;
  private readonly store: WorkspaceRemnantBindingStore;
  private readonly binding;
  private readonly registrySnapshot: Uint8Array;
  private readonly inspectRegistry: WorkspaceRegistryStore['inspectSlots'];
  private readonly assertRuntimeAbsent: () => Promise<void>;
  private readonly assertMainCurrent: () => void;
  private readonly assertMainOwned: () => Promise<void>;
  private readonly onUncertain: () => void;
  private registrySelection: { bytes: Uint8Array; identity: Readonly<CrashSafeFileSlotIdentity> } | undefined;
  private receipt: BindingReceipt | undefined;
  private attempted = false;
  private uncertain = false;
  private activeIo = false;

  constructor(options: Readonly<WorkspaceBackupReplacementBindingOptions>, fileSystem?: CrashSafeFileSlotFileSystem) {
    // Capture immediately after acquisition, before any registry or file await.
    this.assertLease = options.maintenanceLease.captureCurrentOwner(['replace'], options.lease);
    this.inspectRegistry = options.registry.inspectSlots.bind(options.registry);
    this.assertRuntimeAbsent = options.runtimeAbsence.assertNoActiveWorkspaceRuntime.bind(options.runtimeAbsence);
    this.assertMainCurrent = options.mainOwner.assertCurrent.bind(options.mainOwner);
    this.assertMainOwned = options.mainOwner.assertOwned.bind(options.mainOwner);
    this.onUncertain = options.onUncertain.bind(options);
    this.registrySnapshot = Uint8Array.from(options.target.registrySnapshot);
    const target = validateWorkspaceReplacementTarget(parseWorkspaceRegistryBytes(this.registrySnapshot), options.target.entry.workspaceId);
    if (target.entry.lineageIdentity.profileId !== options.target.entry.lineageIdentity.profileId) throw unavailable();
    this.binding = captureWorkspaceRemnantBinding({ formatVersion: 1, owner: 'workspaceReplacement',
      operationId: options.operationId, workspaceId: target.entry.workspaceId, lineageIdentity: target.entry.lineageIdentity });
    this.store = new WorkspaceRemnantBindingStore(options.userDataRoot, workspaceRemnantBindingKey(this.binding), fileSystem);
  }

  publish(): Promise<void> {
    return this.run(async () => {
      if (this.attempted) throw unavailable();
      this.attempted = true;
      const receipt = await this.store.publish(this.binding, this.authority());
      await this.verifyReceipt(receipt);
      this.receipt = receipt;
    });
  }

  // Use before a repairing recovery read and at its existing mutation boundaries.
  assertPublished(): Promise<void> {
    return this.run(async () => {
      if (this.receipt === undefined) throw unavailable();
      await this.verifyReceipt(this.receipt);
    });
  }

  private assertAuthority = (): void => {
    if (this.uncertain) throw unavailable();
    assertSynchronous(this.assertLease);
    assertSynchronous(this.assertMainCurrent);
  };

  private authority() {
    return { assertAuthority: this.assertAuthority, assertExternalSelection: this.assertSelection };
  }

  private assertSelection = async (): Promise<void> => {
    this.assertAuthority();
    await this.assertRuntimeAbsent();
    this.assertAuthority();
    await this.assertMainOwned();
    this.assertAuthority();
    const slots = await this.inspectRegistry();
    this.assertAuthority();
    const selected = slots.current;
    if (selected === undefined || selected.identity === undefined || slots.next !== undefined || slots.backup !== undefined) {
      throw unavailable();
    }
    assertWorkspaceReplacementRegistryUnchanged(this.registrySnapshot, parseWorkspaceRegistryBytes(selected.bytes));
    const expected = this.registrySelection;
    if (expected === undefined) {
      this.registrySelection = { bytes: Uint8Array.from(selected.bytes), identity: Object.freeze({ ...selected.identity }) };
    } else if (!sameBytes(expected.bytes, selected.bytes) || !sameCrashSafeFileSlotIdentity(expected.identity, selected.identity)) {
      throw unavailable();
    }
  };

  private async verifyReceipt(receipt: BindingReceipt): Promise<void> {
    const selected = await this.store.inspect(this.authority());
    this.assertAuthority();
    if (selected.mode !== 'published' || selected.bindingSha256 !== receipt.bindingSha256 ||
        selected.slots.current?.identity === undefined || selected.slots.next !== undefined || selected.slots.backup !== undefined ||
        !sameCrashSafeFileSlotIdentity(receipt.identity, selected.slots.current.identity)) throw unavailable();
  }

  private async run(work: () => Promise<void>): Promise<void> {
    if (this.activeIo || this.uncertain) throw unavailable();
    this.activeIo = true;
    try { await work(); }
    catch (primary) {
      if (this.attempted) {
        this.uncertain = true;
        try { assertSynchronous(this.onUncertain); }
        catch (secondary) { throw new AggregateError([primary, secondary], 'WORKSPACE_REPLACEMENT_RECOVERY_REQUIRED'); }
      }
      throw primary;
    } finally { this.activeIo = false; }
  }
}

function unavailable() {
  return new WorkspaceBackupReplacementError('WORKSPACE_REPLACEMENT_RECOVERY_REQUIRED', 'rollback');
}

function assertSynchronous(assertCurrent: () => void): void {
  const result: unknown = assertCurrent();
  if (result !== undefined) {
    void Promise.resolve(result).catch(() => undefined);
    throw unavailable();
  }
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength && left.every((value, index) => value === right[index]);
}
