import { isAbsolute } from 'node:path';

import { parseDirectSetupMigrationRecovery } from '../../update/directSetupMigrationRecovery.js';
import { maximumDirectSetupMigrationRecoveryBytes } from '../../update/directSetupMigrationRecoveryStore.js';
import { isTerminalUpdateJournalState } from '../../update/startupRecoveryAuthority.js';
import { parseUpdateJournal } from '../../update/updateJournal.js';
import { maximumUpdateJournalBytes } from '../../update/updateJournalStore.js';
import {
  hasAnyJournalSlot,
  hasTerminalJournalConflict,
  type ReadOnlyJournalSlotPaths,
} from '../persistence/readOnlyJournalSlots.js';
import {
  WorkspaceManagementRecoveryRequiredError,
  type WorkspaceManagementOperationGuard,
  type WorkspaceManagementRecoveryState,
} from './workspaceManagementOperationGuard.js';

export interface MainOwnedWorkspaceManagementOperationGuardOptions {
  readonly adoptionJournal: Readonly<ReadOnlyJournalSlotPaths>;
  readonly creationJournal: Readonly<ReadOnlyJournalSlotPaths>;
  readonly directSetupRecovery: Readonly<ReadOnlyJournalSlotPaths>;
  readonly importJournal: Readonly<ReadOnlyJournalSlotPaths>;
  readonly profileRestoreJournal: Readonly<ReadOnlyJournalSlotPaths>;
  readonly replacementJournal: Readonly<ReadOnlyJournalSlotPaths>;
  readonly switchJournal: Readonly<ReadOnlyJournalSlotPaths>;
  readonly updateJournal: Readonly<ReadOnlyJournalSlotPaths>;
}

export function createReadOnlyJournalSlotPaths(
  currentPath: string,
): Readonly<ReadOnlyJournalSlotPaths> {
  if (
    typeof currentPath !== 'string' ||
    currentPath.includes('\0') ||
    !isAbsolute(currentPath)
  ) {
    throw new WorkspaceManagementRecoveryRequiredError();
  }
  return Object.freeze({
    backupPath: `${currentPath}.backup`,
    currentPath,
    nextPath: `${currentPath}.next`,
  });
}

export class MainOwnedWorkspaceManagementOperationGuard
  implements WorkspaceManagementOperationGuard
{
  private disposed = false;

  constructor(
    private readonly options: Readonly<MainOwnedWorkspaceManagementOperationGuardOptions>,
  ) {}

  async assertNoUnresolvedOperations(): Promise<void> {
    if ((await this.readRecoveryState()) !== 'clear') {
      throw new WorkspaceManagementRecoveryRequiredError();
    }
  }

  async readRecoveryState(): Promise<WorkspaceManagementRecoveryState> {
    if (this.disposed) return 'recoveryRequired';
    try {
      const unresolved = await Promise.all([
        hasAnyJournalSlot(this.options.adoptionJournal),
        hasAnyJournalSlot(this.options.creationJournal),
        hasTerminalJournalConflict(
          this.options.directSetupRecovery,
          maximumDirectSetupMigrationRecoveryBytes,
          parseDirectSetupMigrationRecovery,
          (record) => record.state === 'accepted',
        ),
        hasAnyJournalSlot(this.options.importJournal),
        hasAnyJournalSlot(this.options.profileRestoreJournal),
        hasAnyJournalSlot(this.options.replacementJournal),
        hasAnyJournalSlot(this.options.switchJournal),
        hasTerminalJournalConflict(
          this.options.updateJournal,
          maximumUpdateJournalBytes,
          parseUpdateJournal,
          (journal) => isTerminalUpdateJournalState(journal.state),
        ),
      ]);
      return unresolved.some(Boolean) ? 'recoveryRequired' : 'clear';
    } catch {
      return 'recoveryRequired';
    }
  }

  dispose(): void {
    this.disposed = true;
  }
}
