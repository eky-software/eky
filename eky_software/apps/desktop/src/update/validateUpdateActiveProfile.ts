import { randomUUID } from 'node:crypto';

import { waitForInspectionPhase } from '../profileBackup/inspectOwnedEncryptedProfileBackup.js';
import type { ProfileSnapshotInspectionClient } from '../profileBackup/profileSnapshotInspectionClient.js';
import { isOperationId } from '../profileBackup/profileSnapshotBrokerProtocol.js';
import { profileInspectionShutdownMilliseconds, profileInspectionWorkMilliseconds } from '../runtime/profileInspectionMessages.js';
import type { InMemoryWorkspaceMaintenanceLease } from '../workspaces/maintenance/workspaceMaintenanceLease.js';
import type { UpdateActiveProfileValidation, UpdateActiveProfileValidationContext } from './updateActiveProfileValidation.js';

/** Borrows the coordinator's live update owner. It never ends the update fence or lease. */
export async function validateUpdateActiveProfile(input: {
  readonly context: UpdateActiveProfileValidationContext;
  readonly snapshotClient: Pick<ProfileSnapshotInspectionClient,
    'withInspectionOperation' | 'beginMaintenance' | 'endMaintenance' | 'assertUpdateMaintenance' |
    'createProfileSnapshot' | 'validateProfileSnapshot' | 'withProfileSnapshot' | 'removeProfileSnapshot'>;
  readonly maintenanceLease: Pick<InMemoryWorkspaceMaintenanceLease, 'captureCurrentOwner'>;
  readonly assertAuthority: () => void;
  readonly assertLineage: (profileId: string) => void;
}): Promise<Readonly<UpdateActiveProfileValidation>> {
  const context = Object.freeze({ ...input.context });
  if (!isOperationId(context.operationId) || !['preparation', 'handoff'].includes(context.stage)) throw invalid();
  context.assertCurrent();
  const assertOwner = input.maintenanceLease.captureCurrentOwner(['update']);
  const assertAuthority = () => { input.assertAuthority(); context.assertCurrent(); assertOwner(); };
  assertAuthority();
  const client = input.snapshotClient;
  return client.withInspectionOperation(async () => {
    const operationId = context.stage === 'handoff' ? context.operationId : randomUUID();
    const cancellation = new AbortController();
    const deadline = performance.now() + profileInspectionWorkMilliseconds;
    const timer = setTimeout(() => cancellation.abort(), profileInspectionWorkMilliseconds);
    const pending = new Set<Promise<unknown>>();
    const failures: unknown[] = [];
    let maintenanceStarted = false;
    let snapshotAttempted = false;
    let validation: Readonly<UpdateActiveProfileValidation> | undefined;
    const assertWork = () => {
      assertAuthority();
      if (cancellation.signal.aborted || performance.now() >= deadline) throw new Error('PROFILE_INSPECTION_TIMEOUT');
    };
    const read = async <T>(operation: () => Promise<T>) => {
      assertWork();
      const task = Promise.resolve().then(() => { assertWork(); return operation(); })
        .then(result => { assertWork(); return result; });
      pending.add(task);
      void task.finally(() => pending.delete(task)).catch(() => {});
      return waitForInspectionPhase(task, cancellation.signal);
    };
    try {
      if (context.stage === 'preparation') {
        await read(async () => { await client.beginMaintenance(operationId); maintenanceStarted = true; });
      } else await read(() => client.assertUpdateMaintenance(context.operationId));
      snapshotAttempted = true;
      await read(() => client.createProfileSnapshot(operationId, 'exactCurrentManifest'));
      const inspected = await read(() => context.stage === 'handoff'
        ? client.validateProfileSnapshot(operationId, context.operationId)
        : client.validateProfileSnapshot(operationId));
      if (!inspected.profileMatchesActive || inspected.databaseHealth !== 'healthy') throw invalid();
      await read(() => client.withProfileSnapshot(operationId, async (receipt, assertSnapshotCurrent) => {
        if (receipt.migrationPolicy !== 'exactCurrentManifest' || receipt.profileId !== inspected.profileId ||
            receipt.migrationChainIdentity !== inspected.migrationChainIdentity ||
            receipt.artifactCount !== inspected.artifactCount || receipt.artifactTotalByteSize !== inspected.artifactTotalByteSize ||
            receipt.databaseHealth !== inspected.databaseHealth) throw invalid();
        input.assertLineage(receipt.profileId);
        await read(assertSnapshotCurrent);
        input.assertLineage(receipt.profileId);
        validation = Object.freeze({ artifactCount: receipt.artifactCount, artifactTotalByteSize: receipt.artifactTotalByteSize,
          databaseHealth: receipt.databaseHealth, migrationChainIdentity: receipt.migrationChainIdentity });
      }));
    } catch (error) { failures.push(error); }
    finally {
      clearTimeout(timer);
      cancellation.abort();
      const cleanup = new AbortController();
      const cleanupDeadline = performance.now() + 2 * profileInspectionShutdownMilliseconds;
      const cleanupTimer = setTimeout(() => cleanup.abort(), 2 * profileInspectionShutdownMilliseconds);
      const assertCleanup = () => {
        assertAuthority();
        if (cleanup.signal.aborted || performance.now() >= cleanupDeadline) throw new Error('PROFILE_INSPECTION_CLEANUP_UNVERIFIED');
      };
      const close = async (operation: () => Promise<unknown>) => {
        assertCleanup();
        try {
          await waitForInspectionPhase(Promise.resolve().then(() => { assertCleanup(); return operation(); }), cleanup.signal);
          assertCleanup();
        } catch (error) {
          if (cleanup.signal.aborted || performance.now() >= cleanupDeadline) {
            throw new Error('PROFILE_INSPECTION_CLEANUP_UNVERIFIED', { cause: error });
          }
          throw error;
        }
      };
      try {
        if (pending.size !== 0) await close(() => Promise.allSettled([...pending]));
        assertCleanup();
        if (context.stage === 'handoff') await close(() => client.assertUpdateMaintenance(context.operationId));
        // This native-owned removal also proves child exit; a lost creation reply cannot pass it.
        if (snapshotAttempted) await close(() => client.removeProfileSnapshot(operationId));
        if (context.stage === 'preparation') {
          if (!maintenanceStarted) throw new Error('PROFILE_INSPECTION_CLEANUP_UNVERIFIED');
          await close(() => client.endMaintenance(operationId));
        } else await close(() => client.assertUpdateMaintenance(context.operationId));
        assertCleanup();
        context.confirmCleanup();
      } catch (error) { failures.push(error); }
      finally { clearTimeout(cleanupTimer); cleanup.abort(); }
    }
    if (failures.length === 1) throw failures[0];
    if (failures.length !== 0) throw new AggregateError(failures, 'ACTIVE_PROFILE_VALIDATION_FAILED');
    if (validation === undefined) throw invalid();
    return validation;
  });
}

function invalid() { return new Error('ACTIVE_PROFILE_VALIDATION_FAILED'); }
