import { join } from 'node:path';

export interface ProfileSnapshotRuntimePaths {
  portableBackupStatusPath: string;
  quarantineRoot: string;
  recoveryPointCleanShutdownMarkerPath: string;
  recoveryPointsRoot: string;
  restoreActivationJournalPath: string;
  restoreFailedRoot: string;
  restoreRollbackRoot: string;
  stagingRoot: string;
}

export function createProfileSnapshotRuntimePaths(
  runtimeRoot: string,
): ProfileSnapshotRuntimePaths {
  return {
    portableBackupStatusPath: join(
      runtimeRoot,
      'profile-backup-state',
      'portable-backup-status-v1.json',
    ),
    quarantineRoot: join(runtimeRoot, 'private-backup-quarantine'),
    recoveryPointCleanShutdownMarkerPath: join(
      runtimeRoot,
      'recovery-point-state',
      'clean-shutdown-v1.json',
    ),
    recoveryPointsRoot: join(runtimeRoot, 'recovery-points'),
    restoreActivationJournalPath: join(
      runtimeRoot,
      'profile-restore-state',
      'profile-restore-activation-journal-v1.json',
    ),
    restoreFailedRoot: join(runtimeRoot, 'failed-profile-restores'),
    restoreRollbackRoot: join(runtimeRoot, 'profile-restore-rollback'),
    stagingRoot: join(runtimeRoot, 'private-backup-staging'),
  };
}
