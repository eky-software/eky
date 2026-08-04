import { join } from 'node:path';

export interface ProfileSnapshotRuntimePaths {
  stagingRoot: string;
}

export function createProfileSnapshotRuntimePaths(
  runtimeRoot: string,
): ProfileSnapshotRuntimePaths {
  return {
    stagingRoot: join(runtimeRoot, 'private-backup-staging'),
  };
}
