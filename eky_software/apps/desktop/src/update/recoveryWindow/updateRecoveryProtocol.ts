export const createUpdateRecoverySupportBundleIpcChannel =
  'eky:update-recovery:create-support-bundle';
export const openUpdateRecoveryLogsIpcChannel =
  'eky:update-recovery:open-logs';
export const selectUpdateRecoveryPackageIpcChannel =
  'eky:update-recovery:select-rollback-package';
export const closeUpdateRecoveryIpcChannel = 'eky:update-recovery:close';

export type UpdateRecoveryActionResult =
  | Readonly<{ status: 'completed' }>
  | Readonly<{
      errorCode: 'UPDATE_RECOVERY_ACTION_FAILED';
      status: 'failed';
    }>;

export const updateRecoveryActionCompleted: UpdateRecoveryActionResult =
  Object.freeze({ status: 'completed' });
export const updateRecoveryActionFailed: UpdateRecoveryActionResult =
  Object.freeze({
    errorCode: 'UPDATE_RECOVERY_ACTION_FAILED',
    status: 'failed',
  });
