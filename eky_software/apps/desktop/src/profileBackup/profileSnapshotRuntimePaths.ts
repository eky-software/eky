import { join } from 'node:path';

export interface ProfileSnapshotRuntimePaths {
  quarantineRoot: string;
  stagingRoot: string;
}

export function createProfileSnapshotRuntimePaths(
  runtimeRoot: string,
): ProfileSnapshotRuntimePaths {
  return {
    quarantineRoot: join(runtimeRoot, 'private-backup-quarantine'),
    stagingRoot: join(runtimeRoot, 'private-backup-staging'),
  };
}
