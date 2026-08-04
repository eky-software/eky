import { join } from 'node:path';

export interface ProfileSnapshotRuntimePaths {
  quarantineRoot: string;
  recoveryPointCleanShutdownMarkerPath: string;
  recoveryPointsRoot: string;
  stagingRoot: string;
}

export function createProfileSnapshotRuntimePaths(
  runtimeRoot: string,
): ProfileSnapshotRuntimePaths {
  return {
    quarantineRoot: join(runtimeRoot, 'private-backup-quarantine'),
    recoveryPointCleanShutdownMarkerPath: join(
      runtimeRoot,
      'recovery-point-state',
      'clean-shutdown-v1.json',
    ),
    recoveryPointsRoot: join(runtimeRoot, 'recovery-points'),
    stagingRoot: join(runtimeRoot, 'private-backup-staging'),
  };
}
