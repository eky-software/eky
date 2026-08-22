import type { ProfileRecoveryOperationalObserver } from '../../profileBackup/profileRecoveryOperationalObserver.js';
import { ProfileRestoreStartupRecovery } from '../../profileBackup/restore/profileRestoreStartupRecovery.js';
import { createProfileRestoreWorkspaceReplacementActivationAuthority } from './workspaceBackupReplacementActivationFactory.js';
import type { WorkspaceBackupReplacementRuntimePaths } from './workspaceBackupReplacementPaths.js';

export function createWorkspaceBackupReplacementStartupRecovery(input: {
  readonly observer?: ProfileRecoveryOperationalObserver;
  readonly paths: Readonly<WorkspaceBackupReplacementRuntimePaths>;
}) {
  const activation =
    createProfileRestoreWorkspaceReplacementActivationAuthority(input.paths);
  return Object.freeze({
    activation,
    journalStore: activation.journalStore,
    recovery: new ProfileRestoreStartupRecovery({
      journalStore: activation.journalStore,
      ...(input.observer === undefined
        ? {}
        : { observer: input.observer }),
      transaction: activation.transaction,
    }),
  });
}
