import type {
  ProfileBackupStatus,
  ProfileProtectionStatus,
} from './portableProfileBackupTypes.js';
import type { RecoveryPointStatus } from './recoveryPoint/recoveryPointService.js';

export function createProfileProtectionStatus(
  portableBackup: ProfileBackupStatus,
  recoveryPoints: RecoveryPointStatus,
  restoreOperationState: ProfileProtectionStatus['restoreOperationState'],
): ProfileProtectionStatus {
  return {
    portableBackup: {
      latestSuccessfulPortableBackupAt:
        portableBackup.latestSuccessfulPortableBackupAt ?? null,
      operationState: portableBackup.operationState,
    },
    recoveryPoints: {
      availability: recoveryPoints.availability,
      budgetState: recoveryPoints.budgetState,
      latestValidatedGoodAt:
        recoveryPoints.latestValidatedGoodAt ?? null,
      nextAutomaticCheckAt:
        recoveryPoints.nextAutomaticCheckAt ?? null,
      operationState: recoveryPoints.operationState,
      pointCount: recoveryPoints.pointCount,
    },
    restoreOperationState,
  };
}
