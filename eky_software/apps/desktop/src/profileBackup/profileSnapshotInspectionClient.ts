import { promises as fileSystem } from 'node:fs';
import { isAbsolute, join } from 'node:path';

import {
  isProfileInspectionOperationId, profileInspectionShutdownMilliseconds,
  profileInspectionWorkMilliseconds, type ProfileInspectionDeployment,
  type ProfileInspectionMigrationPolicy,
  type ProfileInspectionReceipt,
} from '../runtime/profileInspectionMessages.js';
import { ProfileInspectionProcessError } from '../runtime/profileInspectionProcess.js';
import {
  finishOwnedCleanup, waitForInspectionPhase, type OwnedProfileBackupInspectionReservation,
} from './inspectOwnedEncryptedProfileBackup.js';
import type { ProfileSnapshotBrokerClient } from './profileSnapshotBrokerClient.js';
import type { ProfileSnapshotMigrationPolicy } from './profileSnapshotBrokerProtocol.js';
import type { ProfileRestoreSnapshotInspectionPort, ProfileSnapshotInspectionPort } from './profileSnapshotInspectionPort.js';
import { runProfileSnapshotInspection } from './runProfileSnapshotInspection.js';

interface OwnedSnapshot {
  readonly migrationPolicy: ProfileInspectionMigrationPolicy;
  owner?: OwnedProfileBackupInspectionReservation;
  receipt?: ProfileInspectionReceipt;
  authority?: () => void;
  settled: boolean;
  inUse: boolean;
  removing: boolean;
  recoveryRetained: boolean;
}

interface ProfileSnapshotInspectionDependencies {
  readonly broker: Pick<ProfileSnapshotBrokerClient,
    'assertUpdateMaintenance' | 'beginMaintenance' | 'createProfileSnapshot' | 'endMaintenance' |
    'captureInspectionAuthority' | 'readProfileInspectionContext' | 'beginRestoreMaintenance' |
    'assertRestoreMaintenance' | 'endRestoreMaintenance' | 'invalidateRestoreMaintenance'>;
  readonly stagingRoot: string;
  readonly runnerPath: string;
  readonly deployment: ProfileInspectionDeployment;
  readonly assertMainInstance: () => void;
  readonly acquireReservation: (input: {
    readonly operationRoot: string;
    readonly signal: AbortSignal;
  }) => Promise<OwnedProfileBackupInspectionReservation>;
}

/** One fixed inspection slot in the current main runtime, never a business writer. */
export class ProfileSnapshotInspectionClient implements ProfileSnapshotInspectionPort, ProfileRestoreSnapshotInspectionPort {
  private readonly roots = new Map<string, OwnedSnapshot>();
  private readonly work = new Set<Promise<unknown>>();
  private readonly cancellation = new AbortController();
  private closed = false;
  private uncertain = false;
  private inspecting = false;
  private inspectionTask: Promise<unknown> | undefined;
  private shutdownTask: Promise<void> | undefined;

  constructor(private readonly dependencies: ProfileSnapshotInspectionDependencies) {
    if (!isAbsolute(dependencies.stagingRoot)) throw new Error('PROFILE_INSPECTION_PROTOCOL_INVALID');
  }

  beginMaintenance(operationId: string) { this.assertAdmission(); return this.dependencies.broker.beginMaintenance(operationId); }
  endMaintenance(operationId: string) { return this.dependencies.broker.endMaintenance(operationId); }
  assertUpdateMaintenance(operationId: string) { this.assertAdmission(); return this.dependencies.broker.assertUpdateMaintenance(operationId); }
  beginRestoreMaintenance(operationId: string) { this.assertAdmission(); return this.dependencies.broker.beginRestoreMaintenance(operationId); }
  assertRestoreMaintenance(operationId: string) { this.assertAdmission(); return this.dependencies.broker.assertRestoreMaintenance(operationId); }
  endRestoreMaintenance(operationId: string) { return this.dependencies.broker.endRestoreMaintenance(operationId); }
  invalidateRestoreMaintenance(operationId: string) { return this.dependencies.broker.invalidateRestoreMaintenance(operationId); }

  async createProfileSnapshot(operationId: string, policy: ProfileSnapshotMigrationPolicy) {
    this.assertAdmission();
    this.assertOperationId(operationId);
    if (policy !== 'exactCurrentManifest' && policy !== 'compatibleHistoricalPrefix') {
      throw new Error('PROFILE_INSPECTION_PROTOCOL_INVALID');
    }
    return this.createSnapshot(operationId, policy, policy);
  }

  /** Only an exact restore fence may select the approved metadata-less legacy policy. */
  async createRestoredProfileSnapshot(operationId: string) {
    this.assertAdmission();
    this.assertOperationId(operationId);
    const assertChannel = this.dependencies.broker.captureInspectionAuthority();
    assertChannel();
    await this.dependencies.broker.assertRestoreMaintenance(operationId);
    this.assertAdmission();
    assertChannel();
    return this.createSnapshot(operationId, 'compatibleHistoricalPrefix', 'restoreCompatible');
  }

  private async createSnapshot(operationId: string, policy: ProfileSnapshotMigrationPolicy,
    inspectionPolicy: ProfileInspectionMigrationPolicy) {
    if (this.roots.has(operationId)) throw new Error('PROFILE_PROTECTION_OPERATION_BUSY');
    const record: OwnedSnapshot = { migrationPolicy: inspectionPolicy, settled: false, inUse: false, removing: false, recoveryRetained: false };
    this.roots.set(operationId, record);
    // An absent/late response is not evidence that the backend writer stopped.
    try {
      const result = await this.dependencies.broker.createProfileSnapshot(operationId, policy);
      this.assertAdmission();
      record.settled = true;
      return result;
    } catch (error) {
      this.invalidate(record);
      throw error;
    }
  }

  validateProfileSnapshot(operationId: string, updateMaintenanceOperationId?: string) {
    return this.inspect(operationId, 'inspect', updateMaintenanceOperationId).then(result => result.validation);
  }

  async prepareProfileRestoreActivation(operationId: string) {
    const validation = await this.prepareProfileRestoreSnapshot(operationId);
    return { type: 'profileRestoreActivationPrepared' as const,
      artifactCount: validation.artifactCount,
      artifactTotalByteSize: validation.artifactTotalByteSize };
  }

  prepareProfileRestoreSnapshot(operationId: string) {
    return this.inspect(operationId, 'prepareRestoreActivation').then(result => result.validation);
  }

  /** A deletion barrier before the journal write, not permission to activate. */
  retainProfileSnapshotForRecovery(operationId: string): void {
    this.assertAdmission();
    const record = this.requireRoot(operationId);
    if (!record.settled || record.owner === undefined || record.receipt === undefined || record.authority === undefined ||
        record.inUse || record.removing || this.inspecting || record.recoveryRetained) {
      throw new Error('PROFILE_INSPECTION_CLEANUP_UNVERIFIED');
    }
    record.authority();
    record.recoveryRetained = true;
  }

  /** Only the caller's exact notPrepared readback may request this cancellation. */
  async cancelProfileRestoreRetention(operationId: string): Promise<void> {
    this.assertAdmission();
    const record = this.requireRoot(operationId);
    if (!record.recoveryRetained || record.inUse || record.removing || this.inspecting) {
      throw new Error('PROFILE_INSPECTION_CLEANUP_UNVERIFIED');
    }
    record.removing = true;
    const task = (async () => {
      const deadline = performance.now() + profileInspectionShutdownMilliseconds;
      try {
        await boundedShutdown(this.dependencies.broker.assertRestoreMaintenance(operationId), deadline);
        await this.assertOwned(record, deadline);
        this.assertAdmission();
        record.authority!();
        await boundedShutdown(this.dependencies.broker.assertRestoreMaintenance(operationId), deadline);
        await this.assertOwned(record, deadline);
        this.assertAdmission();
        record.authority!();
        await boundedShutdown(this.dependencies.broker.endRestoreMaintenance(operationId), deadline);
        await this.assertOwned(record, deadline);
        this.assertAdmission();
        record.authority!();
        record.recoveryRetained = false;
      } catch (error) { this.invalidate(record); throw error; }
      finally { record.removing = false; }
    })();
    this.work.add(task);
    try { await task; }
    finally { this.work.delete(task); }
  }

  async withInspectionOperation<T>(operation: () => Promise<T>): Promise<T> {
    this.assertAdmission();
    const task = Promise.resolve().then(() => { this.assertAdmission(); return operation(); });
    this.work.add(task);
    try { return await task; }
    finally { this.work.delete(task); }
  }

  async withProfileSnapshot<T>(operationId: string, use: (
    receipt: ProfileInspectionReceipt, assertCurrent: () => Promise<void>,
  ) => Promise<T>): Promise<T> {
    this.assertAdmission();
    const record = this.requireRoot(operationId);
    if (record.inUse || record.removing || record.recoveryRetained || this.inspecting || record.receipt === undefined || record.authority === undefined) {
      throw new Error('PROFILE_PROTECTION_OPERATION_BUSY');
    }
    const receipt = record.receipt;
    const authority = record.authority;
    let consumerActive = true;
    const assertCurrent = async (requireAdmission = true) => {
      await this.assertOwned(record);
      if (requireAdmission) this.assertAdmission();
      if (!consumerActive || !record.inUse || record.receipt !== receipt || record.authority !== authority) {
        throw new Error('PROFILE_INSPECTION_CLEANUP_UNVERIFIED');
      }
      authority();
    };
    record.inUse = true;
    const task = Promise.resolve().then(async () => {
      await assertCurrent();
      const value = await use(receipt, () => assertCurrent());
      // Closing admission drains an existing consumer, but grants it no new mutations.
      await assertCurrent(false);
      return value;
    });
    this.work.add(task);
    try { return await task; }
    finally { consumerActive = false; record.inUse = false; this.work.delete(task); }
  }

  async removeProfileSnapshot(operationId: string): Promise<void> {
    await this.removeOwnedRoot(operationId, performance.now() + profileInspectionShutdownMilliseconds);
  }

  /** Durable activation takes over the files, not a currently running inspector. */
  async releaseProfileSnapshot(operationId: string): Promise<void> {
    const task = this.releaseOwnedRoot(operationId, performance.now() + profileInspectionShutdownMilliseconds);
    this.work.add(task);
    try { await task; }
    finally { this.work.delete(task); }
  }

  private async releaseOwnedRoot(operationId: string, deadline: number): Promise<void> {
    const record = this.requireRoot(operationId);
    if (record.inUse || record.removing || this.inspecting) throw new Error('PROFILE_PROTECTION_OPERATION_BUSY');
    record.removing = true;
    try {
      await this.assertOwned(record, deadline);
      await boundedShutdown(record.owner!.close(), deadline);
      this.roots.delete(operationId);
    } catch (error) {
      this.invalidate(record);
      throw error;
    }
  }

  /** Handoff closes the generation but leaves retained sources for the existing C consumer. */
  async stopInspectionWork(): Promise<void> {
    this.closeAdmission();
    await boundedShutdown(Promise.allSettled([this.inspectionTask]));
    if (this.uncertain) throw new Error('PROFILE_INSPECTION_CLEANUP_UNVERIFIED');
  }

  shutdown(): Promise<void> {
    this.closeAdmission();
    this.shutdownTask ??= this.drainAndClose();
    return this.shutdownTask;
  }

  closeAdmission(): void {
    this.closed = true;
    this.cancellation.abort();
  }

  private async drainAndClose(): Promise<void> {
    const deadline = performance.now() + 2 * profileInspectionShutdownMilliseconds;
    try {
      await boundedShutdown(Promise.allSettled([...this.work, this.inspectionTask]), deadline);
      for (const [operationId, record] of this.roots) {
        if (record.recoveryRetained) await this.releaseOwnedRoot(operationId, deadline);
        else await this.removeOwnedRoot(operationId, deadline);
      }
      if (this.uncertain) throw new Error('PROFILE_INSPECTION_CLEANUP_UNVERIFIED');
    } catch (error) {
      for (const record of this.roots.values()) this.invalidate(record);
      throw error;
    }
  }

  private inspect(operationId: string, kind: 'inspect' | 'prepareRestoreActivation', updateMaintenanceOperationId?: string) {
    this.assertAdmission();
    this.assertOperationId(operationId);
    if (this.inspecting) throw new Error('PROFILE_PROTECTION_OPERATION_BUSY');
    const record: OwnedSnapshot = this.roots.get(operationId) ?? {
      migrationPolicy: 'restoreCompatible', settled: true, inUse: false, removing: false, recoveryRetained: false,
    };
    if (!record.settled || record.inUse || record.removing || record.recoveryRetained) throw new Error('PROFILE_INSPECTION_CLEANUP_UNVERIFIED');
    this.roots.set(operationId, record);
    this.inspecting = true;
    const task = this.runInspection(record, operationId, kind, updateMaintenanceOperationId);
    this.inspectionTask = task;
    void task.finally(() => { this.inspecting = false; this.inspectionTask = undefined; }).catch(() => {});
    return task;
  }

  private async runInspection(record: OwnedSnapshot, operationId: string,
    kind: 'inspect' | 'prepareRestoreActivation', updateMaintenanceOperationId?: string) {
    const deadline = performance.now() + profileInspectionWorkMilliseconds;
    const cancellation = new AbortController();
    const aborted = () => cancellation.abort();
    this.cancellation.signal.addEventListener('abort', aborted, { once: true });
    const timer = setTimeout(aborted, profileInspectionWorkMilliseconds);
    try {
      const channelAuthority = this.dependencies.broker.captureInspectionAuthority();
      const assertCurrent = () => {
        this.assertAdmission();
        channelAuthority();
        if (cancellation.signal.aborted || performance.now() >= deadline) throw new Error('PROFILE_INSPECTION_TIMEOUT');
      };
      assertCurrent();
      if (record.owner === undefined) {
        record.settled = false;
        const acquisition = Promise.resolve().then(() => this.dependencies.acquireReservation({
          operationRoot: join(this.dependencies.stagingRoot, operationId), signal: cancellation.signal,
        }));
        void acquisition.then(owner => {
          if (cancellation.signal.aborted || this.closed || performance.now() >= deadline) {
            try { owner.invalidate(); } catch { /* Preserve first cause. */ }
          }
        }, () => {});
        record.owner = await waitForInspectionPhase(acquisition, cancellation.signal);
        assertCurrent();
        record.settled = true;
      }
      const previousReceipt = record.receipt;
      delete record.receipt;
      delete record.authority;
      record.settled = false;
      const result = await runProfileSnapshotInspection({
        operationId, kind, deadline, reservation: record.owner, signal: cancellation.signal,
        migrationPolicy: record.migrationPolicy,
        runnerPath: this.dependencies.runnerPath, deployment: this.dependencies.deployment,
        readActiveContext: request => this.dependencies.broker.readProfileInspectionContext(request),
        assertAuthority: assertCurrent,
        ...(updateMaintenanceOperationId === undefined ? {} : { updateMaintenanceOperationId }),
      });
      record.settled = true;
      assertCurrent();
      if (result.receipt.migrationPolicy !== record.migrationPolicy) throw new Error('PROFILE_INSPECTION_PROTOCOL_INVALID');
      if (previousReceipt !== undefined && JSON.stringify(previousReceipt) !== JSON.stringify(result.receipt)) {
        throw new Error('PROFILE_INSPECTION_PROTOCOL_INVALID');
      }
      record.receipt = result.receipt;
      record.authority = channelAuthority;
      return result;
    } catch (error) {
      if (error instanceof ProfileInspectionProcessError) {
        record.settled = error.cleanup.processAbsent && error.cleanup.reservationReclaimed;
      }
      if (!record.settled || record.owner === undefined) this.invalidate(record);
      throw error;
    } finally {
      clearTimeout(timer);
      this.cancellation.signal.removeEventListener('abort', aborted);
      cancellation.abort();
    }
  }

  private async removeOwnedRoot(operationId: string, deadline: number): Promise<void> {
    this.assertOperationId(operationId);
    const record = this.roots.get(operationId);
    if (record === undefined) {
      // No handle may certify removal of an existing root.
      try { await boundedShutdown(fileSystem.lstat(join(this.dependencies.stagingRoot, operationId)), deadline); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
      this.uncertain = true;
      throw new Error('PROFILE_INSPECTION_CLEANUP_UNVERIFIED');
    }
    if (record.inUse || record.removing || record.recoveryRetained || this.inspecting) throw new Error('PROFILE_INSPECTION_CLEANUP_UNVERIFIED');
    record.removing = true;
    try {
      await this.assertOwned(record, deadline);
      await finishOwnedCleanup(record.owner!, join(this.dependencies.stagingRoot, operationId), deadline);
      this.roots.delete(operationId);
    } catch (error) { this.invalidate(record); throw error; }
  }

  private requireRoot(operationId: string): OwnedSnapshot {
    this.assertOperationId(operationId);
    const record = this.roots.get(operationId);
    if (record === undefined) throw new Error('PROFILE_INSPECTION_CLEANUP_UNVERIFIED');
    return record;
  }

  private async assertOwned(record: OwnedSnapshot,
    deadline = performance.now() + profileInspectionShutdownMilliseconds): Promise<void> {
    if (!record.settled || record.owner === undefined || this.uncertain) throw new Error('PROFILE_INSPECTION_CLEANUP_UNVERIFIED');
    try {
      this.dependencies.assertMainInstance();
      await boundedShutdown(record.owner.assertMainOwned(), deadline);
      this.dependencies.assertMainInstance();
      if (!record.settled || this.uncertain) throw new Error('PROFILE_INSPECTION_CLEANUP_UNVERIFIED');
    } catch (error) { this.invalidate(record); throw error; }
  }

  private invalidate(record: OwnedSnapshot) {
    record.settled = false;
    this.uncertain = true;
    try { record.owner?.invalidate(); } catch { /* Preserve first cause. */ }
  }

  private assertAdmission() {
    if (this.closed || this.uncertain) throw new Error('PROFILE_INSPECTION_CLEANUP_UNVERIFIED');
    this.dependencies.assertMainInstance();
  }

  private assertOperationId(operationId: string) {
    if (!isProfileInspectionOperationId(operationId)) throw new Error('PROFILE_INSPECTION_PROTOCOL_INVALID');
  }
}

async function boundedShutdown(task: Promise<unknown>, deadline = performance.now() + 2 * profileInspectionShutdownMilliseconds) {
  const cancellation = new AbortController();
  const timer = setTimeout(() => cancellation.abort(), Math.max(0, deadline - performance.now()));
  try {
    await waitForInspectionPhase(task, cancellation.signal);
    if (cancellation.signal.aborted || performance.now() >= deadline) throw new Error('PROFILE_INSPECTION_CLEANUP_UNVERIFIED');
  } finally { clearTimeout(timer); cancellation.abort(); }
}
