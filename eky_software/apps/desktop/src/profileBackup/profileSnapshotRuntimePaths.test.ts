import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { createProfileSnapshotRuntimePaths } from './profileSnapshotRuntimePaths.js';

describe('profile snapshot runtime paths', () => {
  it('keeps private staging below the trusted desktop runtime root', () => {
    const runtimeRoot = resolve('desktop-runtime');

    expect(createProfileSnapshotRuntimePaths(runtimeRoot)).toEqual({
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
      restoreFailedRoot: join(
        runtimeRoot,
        'failed-profile-restores',
      ),
      restoreRollbackRoot: join(
        runtimeRoot,
        'profile-restore-rollback',
      ),
      stagingRoot: join(runtimeRoot, 'private-backup-staging'),
    });
  });
});
