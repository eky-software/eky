import type { ProfileSnapshotBrokerClient } from './profileSnapshotBrokerClient.js';
import type { ProfileInspectionReceipt } from '../runtime/profileInspectionMessages.js';
import type { ProfileSnapshotInspectionValidation } from './runProfileSnapshotInspection.js';
import type { ProfileSnapshotInspectionEvidence } from './profileSnapshotInspectionClient.js';

/** Same-operation cleanup permission, independent of the snapshot's native reservation. */
export interface ProfileSnapshotCleanupAuthority {
  assertOwned(): Promise<void>;
  assertCurrent(): void;
}

export function captureProfileSnapshotCleanupAuthority(
  authority: ProfileSnapshotCleanupAuthority,
): Readonly<ProfileSnapshotCleanupAuthority>;
export function captureProfileSnapshotCleanupAuthority(
  authority?: ProfileSnapshotCleanupAuthority,
): Readonly<ProfileSnapshotCleanupAuthority> | undefined;
export function captureProfileSnapshotCleanupAuthority(
  authority?: ProfileSnapshotCleanupAuthority,
): Readonly<ProfileSnapshotCleanupAuthority> | undefined {
  if (authority === undefined) return undefined;
  if (authority === null || typeof authority !== 'object') throw new Error('PROFILE_INSPECTION_PROTOCOL_INVALID');
  const assertOwned = authority.assertOwned;
  const assertCurrent = authority.assertCurrent;
  if (typeof assertOwned !== 'function' || typeof assertCurrent !== 'function') {
    throw new Error('PROFILE_INSPECTION_PROTOCOL_INVALID');
  }
  return Object.freeze({
    assertOwned: assertOwned.bind(authority),
    assertCurrent: captureProfileSnapshotCleanupGuard(assertCurrent.bind(authority))!,
  });
}

/** Captures the synchronous-only guard used by partial staging cleanup. */
export function captureProfileSnapshotCleanupGuard(assertCurrent?: () => void): (() => void) | undefined {
  if (assertCurrent === undefined) return undefined;
  if (typeof assertCurrent !== 'function') throw new Error('PROFILE_INSPECTION_PROTOCOL_INVALID');
  return () => {
    const result: unknown = assertCurrent();
    if (result !== undefined) {
      void Promise.resolve(result).catch(() => undefined);
      throw new Error('PROFILE_INSPECTION_CLEANUP_UNVERIFIED');
    }
  };
}

/** Internal main-process content evidence, never a renderer capability. */
export interface ProfileSnapshotEvidencePort {
  withProfileSnapshotEvidence<T>(operationId: string, use: (
    evidence: ProfileSnapshotInspectionEvidence, assertCurrent: () => Promise<void>,
  ) => Promise<T>): Promise<T>;
}

export interface ProfileDeletionSnapshotEvidencePort extends ProfileSnapshotEvidencePort {
  validateDeletionProfileSnapshot(operationId: string, deleteMaintenanceOperationId: string): Promise<ProfileSnapshotInspectionValidation>;
}

/** Main-owned staging remains reserved through its consumer and cleanup. */
export interface ProfileSnapshotOwnershipPort {
  withInspectionOperation<T>(operation: () => Promise<T>): Promise<T>;
  withProfileSnapshot<T>(operationId: string, use: (receipt: ProfileInspectionReceipt) => Promise<T>): Promise<T>;
  removeProfileSnapshot(operationId: string): Promise<void>;
  releaseProfileSnapshot(operationId: string): Promise<void>;
}

export interface ProfileSnapshotInspectionPort extends ProfileSnapshotOwnershipPort, Pick<
  ProfileSnapshotBrokerClient,
  'assertUpdateMaintenance' | 'beginMaintenance' |
  'endMaintenance'
> {
  createProfileSnapshot(operationId: string, policy: Parameters<ProfileSnapshotBrokerClient['createProfileSnapshot']>[1],
    cleanupAuthority?: ProfileSnapshotCleanupAuthority): ReturnType<ProfileSnapshotBrokerClient['createProfileSnapshot']>;
  validateProfileSnapshot(operationId: string, updateMaintenanceOperationId?: string,
    cleanupAuthority?: ProfileSnapshotCleanupAuthority): Promise<ProfileSnapshotInspectionValidation>;
}

export type OwnedProfileSnapshotValidator = ProfileSnapshotOwnershipPort & Pick<
  ProfileSnapshotInspectionPort, 'validateProfileSnapshot'
>;

/** A durable restore takes over independently inspected bytes, never a live reader. */
export interface ProfileRestoreSnapshotInspectionPort extends Pick<ProfileSnapshotBrokerClient,
  'beginRestoreMaintenance' | 'assertRestoreMaintenance' | 'endRestoreMaintenance' |
  'invalidateRestoreMaintenance'> {
  prepareProfileRestoreSnapshot(operationId: string): Promise<ProfileSnapshotInspectionValidation>;
  retainProfileSnapshotForRecovery(operationId: string): void;
  /** Completes exact restore-fence release before removing the deletion barrier. */
  cancelProfileRestoreRetention(operationId: string): Promise<void>;
  releaseProfileSnapshot(operationId: string): Promise<void>;
}
