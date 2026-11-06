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
  readonly deletionJournal: Readonly<ReadOnlyJournalSlotPaths>;
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

export async function readWorkspaceColdRecoveryOwnerPresence(
  creation: Readonly<ReadOnlyJournalSlotPaths>, importBackup: Readonly<ReadOnlyJournalSlotPaths>,
  deletion: Readonly<ReadOnlyJournalSlotPaths>,
): Promise<readonly [boolean, boolean, boolean]> {
  let firstFailure: { error: unknown } | undefined;
  const observations = await Promise.allSettled([hasAnyJournalSlot(creation), hasAnyJournalSlot(importBackup), hasAnyJournalSlot(deletion)]
    .map(read => read.catch((error: unknown) => { firstFailure ??= { error }; throw error; })));
  if (firstFailure !== undefined) throw firstFailure.error;
  const values = observations.map(observation => {
    if (observation.status === 'rejected') throw observation.reason;
    return observation.value;
  });
  return [values[0]!, values[1]!, values[2]!];
}

// This selects an owner, not permission to mutate. The owner still proves its
// lease, runtime absence, journal contents and exact continuation before recovery.
export async function readWorkspaceColdRecoveryAdmission(
  options: Readonly<WorkspaceColdRecoveryAdmissionOptions>,
): Promise<WorkspaceColdRecoveryAdmission> {
  try {
    const [creation, importBackup, deletion] = await readWorkspaceColdRecoveryOwnerPresence(
      options.creationJournal, options.importJournal, options.deletionJournal);
    if (deletion) throw new WorkspaceManagementRecoveryRequiredError();
    if (!creation && !importBackup) return 'none';
    if (creation && importBackup) {
      throw new WorkspaceManagementRecoveryRequiredError();
    }
    await assertWorkspaceColdRecoveryConflictsAbsent(options);
    return creation ? 'creation' : 'import';
  } catch (cause) {
    if (cause instanceof WorkspaceManagementRecoveryRequiredError) throw cause;
    throw new WorkspaceManagementRecoveryRequiredError({ cause });
  }
}

// Shared by initial admission and an already selected owner's mutation guards.
// The caller separately owns its changing creation/import journal selection.
export async function assertWorkspaceColdRecoveryConflictsAbsent(
  options: Readonly<Omit<WorkspaceColdRecoveryAdmissionOptions, 'creationJournal' | 'importJournal'>>,
): Promise<void> {
  try {
    let firstFailure: { error: unknown } | undefined;
    const observations = await Promise.allSettled([
      hasAnyJournalSlot(options.adoptionJournal),
      hasAnyJournalSlot(options.deletionJournal),
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
    ].map(read => read.catch((error: unknown) => { firstFailure ??= { error }; throw error; })));
    if (firstFailure !== undefined) throw firstFailure.error;
    if (observations.some(value => value.status === 'fulfilled' && value.value)) {
      throw new WorkspaceManagementRecoveryRequiredError();
    }
  } catch (cause) {
    if (cause instanceof WorkspaceManagementRecoveryRequiredError) throw cause;
    throw new WorkspaceManagementRecoveryRequiredError({ cause });
  }
}
