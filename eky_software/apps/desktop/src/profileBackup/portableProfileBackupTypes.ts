import type { ProfileBackupInspectionSummary } from './inspectEncryptedProfileBackup.js';
import type { RecoveryPointStatus } from './recoveryPoint/recoveryPointService.js';

export const legacyProfileRestoreIpcChannels = Object.freeze([
  'eky:profile-backup:prepare-restore',
  'eky:profile-backup:activate-restore',
] as const);
export const createManualRecoveryPointIpcChannel =
  'eky:profile-backup:create-recovery-point';
export const createProfileBackupIpcChannel =
  'eky:profile-backup:create-portable';
export const inspectProfileBackupIpcChannel =
  'eky:profile-backup:inspect-portable';
export const getProfileBackupStatusIpcChannel =
  'eky:profile-backup:get-status';

export type ProfileBackupOperationState =
  | 'creating'
  | 'idle'
  | 'inspecting';

export interface ProfileBackupStatus {
  lastSafeErrorCode?: string;
  latestSuccessfulPortableBackupAt?: string;
  operationState: ProfileBackupOperationState;
}

export interface ProfileProtectionStatus {
  portableBackup: {
    latestSuccessfulPortableBackupAt: string | null;
    operationState: ProfileBackupOperationState;
  };
  recoveryPoints: {
    availability: RecoveryPointStatus['availability'];
    budgetState: RecoveryPointStatus['budgetState'];
    latestValidatedGoodAt: string | null;
    nextAutomaticCheckAt: string | null;
    operationState: RecoveryPointStatus['operationState'];
    pointCount: number;
  };
}

export type CreateProfileBackupResult = 'cancelled' | 'created';

export type InspectProfileBackupResult =
  | { status: 'cancelled' }
  | {
      status: 'inspected';
      summary: ProfileBackupInspectionSummary;
    };
