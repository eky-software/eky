import { parseDirectSetupMigrationRecovery } from '../../update/directSetupMigrationRecovery.js';
import { maximumDirectSetupMigrationRecoveryBytes } from '../../update/directSetupMigrationRecoveryStore.js';
import { isTerminalUpdateJournalState } from '../../update/startupRecoveryAuthority.js';
import { parseUpdateJournal } from '../../update/updateJournal.js';
import { maximumUpdateJournalBytes } from '../../update/updateJournalStore.js';
import { WorkspaceManagementRecoveryRequiredError } from '../management/workspaceManagementOperationGuard.js';
import {
  hasAnyJournalSlot,
  hasTerminalJournalConflict,
  type ReadOnlyJournalSlotPaths,
} from '../persistence/readOnlyJournalSlots.js';

export interface WorkspaceColdRecoveryAdmissionOptions {
  readonly adoptionJournal: Readonly<ReadOnlyJournalSlotPaths>;
  readonly creationJournal: Readonly<ReadOnlyJournalSlotPaths>;
  readonly directSetupRecovery: Readonly<ReadOnlyJournalSlotPaths>;
  readonly firstStartMigrationJournal: Readonly<ReadOnlyJournalSlotPaths>;
  readonly importJournal: Readonly<ReadOnlyJournalSlotPaths>;
  readonly legacyUpdateJournal: Readonly<ReadOnlyJournalSlotPaths>;
  readonly profileRestoreJournals: readonly Readonly<ReadOnlyJournalSlotPaths>[];
  readonly replacementJournal: Readonly<ReadOnlyJournalSlotPaths>;
  readonly switchJournal: Readonly<ReadOnlyJournalSlotPaths>;
  readonly updateJournal: Readonly<ReadOnlyJournalSlotPaths>;
}

export type WorkspaceColdRecoveryAdmission = 'none' | 'creation' | 'import';

// This selects an owner, not permission to mutate. The owner still proves its
// lease, runtime absence, journal contents and exact continuation before recovery.
export async function readWorkspaceColdRecoveryAdmission(
  options: Readonly<WorkspaceColdRecoveryAdmissionOptions>,
): Promise<WorkspaceColdRecoveryAdmission> {
  try {
    const [creation, importBackup] = await Promise.all([
      hasAnyJournalSlot(options.creationJournal),
      hasAnyJournalSlot(options.importJournal),
    ]);
    if (!creation && !importBackup) return 'none';
    if (creation && importBackup) {
      throw new WorkspaceManagementRecoveryRequiredError();
    }
    const conflicts = await Promise.all([
      hasAnyJournalSlot(options.adoptionJournal),
      hasAnyJournalSlot(options.firstStartMigrationJournal),
      hasAnyJournalSlot(options.replacementJournal),
      hasAnyJournalSlot(options.switchJournal),
      ...options.profileRestoreJournals.map(hasAnyJournalSlot),
      hasTerminalJournalConflict(
        options.directSetupRecovery,
        maximumDirectSetupMigrationRecoveryBytes,
        parseDirectSetupMigrationRecovery,
        (record) => record.state === 'accepted',
      ),
      ...[options.updateJournal, options.legacyUpdateJournal].map((paths) =>
        hasTerminalJournalConflict(
          paths,
          maximumUpdateJournalBytes,
          parseUpdateJournal,
          (journal) => isTerminalUpdateJournalState(journal.state),
        ),
      ),
    ]);
    if (conflicts.some(Boolean)) {
      throw new WorkspaceManagementRecoveryRequiredError();
    }
    return creation ? 'creation' : 'import';
  } catch {
    throw new WorkspaceManagementRecoveryRequiredError();
  }
}
