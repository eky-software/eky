import type { ProfileSnapshotBrokerClient } from './profileSnapshotBrokerClient.js';
import type { ProfileInspectionReceipt } from '../runtime/profileInspectionMessages.js';
import type { ProfileSnapshotInspectionValidation } from './runProfileSnapshotInspection.js';

/** Main-owned staging remains reserved through its consumer and cleanup. */
export interface ProfileSnapshotOwnershipPort {
  withInspectionOperation<T>(operation: () => Promise<T>): Promise<T>;
  withProfileSnapshot<T>(operationId: string, use: (receipt: ProfileInspectionReceipt) => Promise<T>): Promise<T>;
  removeProfileSnapshot(operationId: string): Promise<void>;
  releaseProfileSnapshot(operationId: string): Promise<void>;
}

export interface ProfileSnapshotInspectionPort extends ProfileSnapshotOwnershipPort, Pick<
  ProfileSnapshotBrokerClient,
  'assertUpdateMaintenance' | 'beginMaintenance' | 'createProfileSnapshot' |
  'endMaintenance'
> {
  validateProfileSnapshot(operationId: string, updateMaintenanceOperationId?: string): Promise<ProfileSnapshotInspectionValidation>;
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
