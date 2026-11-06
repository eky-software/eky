import { WorkspaceRemnantBindingStore } from '../deletion/workspaceRemnantBindingStore.js';
import { captureWorkspaceRemnantBinding, workspaceRemnantBindingKey } from '../deletion/workspaceRemnantBindingCodec.js';
import { sameCrashSafeFileSlotIdentity, type CrashSafeFileSlotFileSystem } from '../persistence/crashSafeFileSlot.js';
import type { InMemoryWorkspaceMaintenanceLease, WorkspaceMaintenanceLeaseHandle } from '../maintenance/workspaceMaintenanceLease.js';
import { parseWorkspaceRegistryBytes } from '../registry/workspaceRegistryBytes.js';
import { serializeWorkspaceRegistry } from '../registry/workspaceRegistrySerializer.js';
import type { WorkspaceRegistryStore } from '../registry/workspaceRegistryStore.js';
import { parseVersionedWorkspaceSwitchJournalBytes, serializeVersionedWorkspaceSwitchJournal,
  type WorkspaceSwitchJournalStore } from '../switch/workspaceSwitchJournal.js';
import { captureWorkspaceSelectorSwitchSelection } from '../switch/workspaceSelectorSwitchSelection.js';
import type { WorkspaceRuntimeAbsencePort } from '../runtime/workspaceRuntimeAbsencePort.js';
import { WorkspaceActivationMigrationError } from './workspaceActivationMigrationError.js';
import type { WorkspaceActivationMigrationProof } from './workspaceActivationMigrationGuard.js';

export interface WorkspaceActivationMigrationBindingOptions {
  readonly userDataRoot: string;
  readonly proof: Readonly<WorkspaceActivationMigrationProof>;
  readonly lease: WorkspaceMaintenanceLeaseHandle;
  readonly maintenanceLease: Pick<InMemoryWorkspaceMaintenanceLease, 'captureCurrentOwner'>;
  readonly registry: Pick<WorkspaceRegistryStore, 'inspectSlots'>;
  readonly switchJournal: Pick<WorkspaceSwitchJournalStore, 'inspectSlots'>;
  readonly startupOwner: { assertCurrent(): void };
  readonly stoppedOwner: { assertCurrent(): void; assertOwned(): Promise<void> };
  readonly runtimeAbsence: WorkspaceRuntimeAbsencePort;
  // Closes logical continuation only; the existing process owner still reclaims its child.
  readonly onUncertain: () => void;
}

type Receipt = Awaited<ReturnType<WorkspaceRemnantBindingStore['publish']>>;

/** Pins migration metadata; snapshot ownership and process shutdown remain with their owners. */
export class WorkspaceActivationMigrationBinding {
  private readonly assertLease: () => void;
  private readonly assertStartup: () => void;
  private readonly assertStopped: () => void;
  private readonly assertMainOwned: () => Promise<void>;
  private readonly assertAbsent: () => Promise<void>;
  private readonly onUncertain: () => void;
  private readonly readRegistry: WorkspaceRegistryStore['inspectSlots'];
  private readonly readJournal: WorkspaceSwitchJournalStore['inspectSlots'];
  private readonly registrySnapshot: Uint8Array;
  private readonly journalSnapshot: Uint8Array;
  private readonly binding;
  private readonly store: WorkspaceRemnantBindingStore;
  private selection: ReturnType<typeof captureWorkspaceSelectorSwitchSelection> | undefined;
  private receipt: Receipt | undefined;
  private phase: 'snapshot' | 'stopped' = 'snapshot';
  private attempted = false;
  private uncertain = false;
  private firstFailure: { error: unknown } | undefined;
  private active = false;

  constructor(options: Readonly<WorkspaceActivationMigrationBindingOptions>, fileSystem?: CrashSafeFileSlotFileSystem) {
    if (options.lease === null || typeof options.lease !== 'object' || typeof options.lease.release !== 'function') throw required();
    this.assertLease = options.maintenanceLease.captureCurrentOwner(['switch'], options.lease);
    this.assertStartup = options.startupOwner.assertCurrent.bind(options.startupOwner);
    this.assertStopped = options.stoppedOwner.assertCurrent.bind(options.stoppedOwner);
    this.assertMainOwned = options.stoppedOwner.assertOwned.bind(options.stoppedOwner);
    this.assertAbsent = options.runtimeAbsence.assertNoActiveWorkspaceRuntime.bind(options.runtimeAbsence);
    this.onUncertain = options.onUncertain.bind(options);
    this.readRegistry = options.registry.inspectSlots.bind(options.registry);
    this.readJournal = options.switchJournal.inspectSlots.bind(options.switchJournal);
    this.registrySnapshot = Uint8Array.from(options.proof.registrySnapshot);
    this.journalSnapshot = Uint8Array.from(options.proof.switchJournalSnapshot);
    const registry = parseWorkspaceRegistryBytes(this.registrySnapshot);
    const journal = parseVersionedWorkspaceSwitchJournalBytes(this.journalSnapshot);
    const proof = options.proof;
    const target = registry.workspaces.find(entry => entry.workspaceId === proof.targetWorkspaceId);
    const source = registry.workspaces.find(entry => entry.workspaceId === proof.sourceWorkspaceId);
    if (registry.activeWorkspaceId !== proof.targetWorkspaceId || target?.lifecycleState !== 'ready' ||
        target.lineageIdentity.profileId !== proof.profileId ||
        (proof.sourceWorkspaceId !== null && source?.lifecycleState !== 'ready') ||
        proof.sourceWorkspaceId === proof.targetWorkspaceId || journal.state !== 'targetSelected' ||
        journal.operationId !== proof.operationId || journal.sourceWorkspaceId !== proof.sourceWorkspaceId ||
        journal.targetWorkspaceId !== proof.targetWorkspaceId) throw required();
    this.binding = captureWorkspaceRemnantBinding({ formatVersion: 1, owner: 'workspaceActivationMigration',
      operationId: proof.operationId, workspaceId: target.workspaceId, lineageIdentity: target.lineageIdentity });
    this.store = new WorkspaceRemnantBindingStore(options.userDataRoot, workspaceRemnantBindingKey(this.binding), fileSystem);
  }

  publishBeforeSnapshot(): Promise<void> {
    return this.run(async () => {
      if (this.attempted || this.phase !== 'snapshot') throw required();
      this.attempted = true;
      const receipt = await this.store.publish(this.binding, this.authority());
      await this.verifyReceipt(receipt);
      this.receipt = receipt;
    });
  }

  assertPublished(): Promise<void> {
    return this.run(async () => {
      if (this.receipt === undefined) throw required();
      await this.verifyReceipt(this.receipt);
    });
  }

  assertReadOwnership(): Promise<void> {
    return this.run(async () => {
      if (this.receipt === undefined || this.phase !== 'stopped') throw required();
      await this.assertStoppedOwnership();
    });
  }

  // Only the caller's successfully settled strict stop may request this transition.
  enterStopped(): Promise<void> {
    return this.run(async () => {
      if (this.receipt === undefined || this.phase !== 'snapshot') throw required();
      this.phase = 'stopped';
      await this.verifyReceipt(this.receipt);
    });
  }

  assertMutationCurrent(): void {
    this.assertPublishedCurrent(true);
  }

  /** Snapshot cleanup may precede shutdown, but still needs the exact live owner. */
  assertSnapshotCleanupCurrent(): void {
    this.assertPublishedCurrent(false);
  }

  private assertPublishedCurrent(requireStopped: boolean): void {
    if (this.uncertain) throw required(this.firstFailure?.error);
    try {
      if ((requireStopped && this.phase !== 'stopped') || this.receipt === undefined || this.active) throw required();
      this.assertAuthority();
    } catch (primary) { this.rejectUncertain(primary); }
  }

  private assertAuthority = (): void => {
    if (this.firstFailure !== undefined) throw this.firstFailure.error;
    try {
      assertSynchronous(this.assertLease);
      assertSynchronous(this.assertStartup);
      if (this.phase === 'stopped') assertSynchronous(this.assertStopped);
    } catch (error) { this.rejectUncertain(error); }
  };

  private authority() {
    return { assertAuthority: this.assertAuthority, assertExternalSelection: this.assertSelection };
  }

  private assertSelection = async (): Promise<void> => {
    this.assertAuthority();
    if (this.phase === 'stopped') {
      await this.assertStoppedOwnership();
    }
    const registry = await this.readRegistry(this.assertAuthority);
    this.assertAuthority();
    const journal = await this.readJournal(this.assertAuthority);
    this.assertAuthority();
    if (this.selection === undefined) {
      if (registry.current === undefined || journal.current === undefined ||
          registry.next !== undefined || registry.backup !== undefined ||
          journal.next !== undefined || journal.backup !== undefined ||
          !sameBytes(this.registrySnapshot, serializeWorkspaceRegistry(registry.current.value)) ||
          !sameBytes(this.journalSnapshot, serializeVersionedWorkspaceSwitchJournal(journal.current.value))) throw required();
      this.selection = captureWorkspaceSelectorSwitchSelection({ registrySlots: registry, journalSlots: journal,
        readRegistrySlots: this.readRegistry, assertAuthority: this.assertAuthority });
    } else {
      this.selection.assertRegistrySelection(registry);
      this.selection.assertJournalSelection(journal);
    }
  };

  private async assertStoppedOwnership(): Promise<void> {
    this.assertAuthority();
    await this.assertAbsent(); this.assertAuthority();
    await this.assertMainOwned(); this.assertAuthority();
  }

  private async verifyReceipt(receipt: Receipt): Promise<void> {
    const observed = await this.store.inspect(this.authority());
    this.assertAuthority();
    if (observed.mode !== 'published' || observed.bindingSha256 !== receipt.bindingSha256 ||
        observed.slots.current?.identity === undefined || observed.slots.next !== undefined || observed.slots.backup !== undefined ||
        !sameCrashSafeFileSlotIdentity(receipt.identity, observed.slots.current.identity)) throw required();
  }

  private async run(work: () => Promise<void>): Promise<void> {
    if (this.uncertain) throw required(this.firstFailure?.error);
    if (this.active) this.rejectUncertain(required());
    this.active = true;
    try {
      await work();
      if (this.firstFailure !== undefined) throw this.firstFailure.error;
    } catch (primary) {
      // A reader may fail again while joining its original file close.
      if (this.firstFailure !== undefined && primary !== this.firstFailure.error) {
        throw new AggregateError([this.firstFailure.error, primary], 'WORKSPACE_ACTIVATION_MIGRATION_RECOVERY_REQUIRED');
      }
      this.rejectUncertain(primary);
    }
    finally { this.active = false; }
  }

  private rejectUncertain(primary: unknown): never {
    if (this.attempted && !this.uncertain) {
      this.uncertain = true;
      this.firstFailure = { error: primary };
      try { assertSynchronous(this.onUncertain); }
      catch (secondary) {
        this.firstFailure = { error: new AggregateError([primary, secondary], 'WORKSPACE_ACTIVATION_MIGRATION_RECOVERY_REQUIRED') };
      }
    }
    throw this.firstFailure === undefined ? primary : this.firstFailure.error;
  }
}

function assertSynchronous(assertCurrent: () => void): void {
  const result: unknown = assertCurrent();
  if (result !== undefined) {
    void Promise.resolve(result).catch(() => undefined);
    throw required();
  }
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength && left.every((value, index) => value === right[index]);
}

function required(cause?: unknown) {
  return new WorkspaceActivationMigrationError('WORKSPACE_ACTIVATION_MIGRATION_RECOVERY_REQUIRED', { cause });
}
