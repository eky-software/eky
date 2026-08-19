import { ProfileRestoreActivationJournalStore } from '../../profileBackup/restore/profileRestoreActivationJournalStore.js';
import { ProfileRestoreActivationTransaction } from '../../profileBackup/restore/profileRestoreActivationTransaction.js';
import type {
  WorkspaceReplacementActivationAuthority,
  WorkspaceReplacementActivationAuthorityFactory,
} from './workspaceBackupReplacementPorts.js';
import type { WorkspaceBackupReplacementPaths } from './workspaceBackupReplacementPaths.js';

export class ProfileRestoreWorkspaceReplacementActivationFactory
  implements WorkspaceReplacementActivationAuthorityFactory
{
  create(
    paths: Readonly<WorkspaceBackupReplacementPaths>,
  ): Readonly<WorkspaceReplacementActivationAuthority> {
    const journalStore = new ProfileRestoreActivationJournalStore(
      paths.activationJournalPath,
    );
    const transaction = new ProfileRestoreActivationTransaction({
      journalStore,
      paths: {
        activeDatabasePath: paths.activeDatabasePath,
        activeDocumentsRoot: paths.activeArtifactRoot,
        failedRoot: paths.activationFailedRoot,
        rollbackRoot: paths.activationRollbackRoot,
        stagingRoot: paths.activationStagingRoot,
      },
    });
    return Object.freeze({ journalStore, transaction });
  }
}
