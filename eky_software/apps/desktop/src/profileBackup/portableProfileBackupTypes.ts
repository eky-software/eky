import type { ProfileBackupInspectionSummary } from './inspectEncryptedProfileBackup.js';

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

export type CreateProfileBackupResult = 'cancelled' | 'created';

export type InspectProfileBackupResult =
  | { status: 'cancelled' }
  | {
      status: 'inspected';
      summary: ProfileBackupInspectionSummary;
    };

