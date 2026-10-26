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
  readonly mode?: 'active';
  readonly adoptionJournal: Readonly<ReadOnlyJournalSlotPaths>;
  readonly creationJournal: Readonly<ReadOnlyJournalSlotPaths>;
  readonly directSetupRecovery: Readonly<ReadOnlyJournalSlotPaths>;
  readonly importJournal: Readonly<ReadOnlyJournalSlotPaths>;
  readonly profileRestoreJournal: Readonly<ReadOnlyJournalSlotPaths>;
  readonly replacementJournal: Readonly<ReadOnlyJournalSlotPaths>;
  readonly switchJournal: Readonly<ReadOnlyJournalSlotPaths>;
  readonly updateJournal: Readonly<ReadOnlyJournalSlotPaths>;
}

export interface SelectorWorkspaceManagementOperationGuardOptions {
  readonly mode: 'selector';
  assertNoUnresolvedSelectorOperations(): Promise<void>;
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
    private readonly options: Readonly<MainOwnedWorkspaceManagementOperationGuardOptions | SelectorWorkspaceManagementOperationGuardOptions>,
  ) {}

  async assertNoUnresolvedOperations(): Promise<void> {
    if ((await this.readRecoveryState()) !== 'clear') {
      throw new WorkspaceManagementRecoveryRequiredError();
    }
  }

  async readRecoveryState(): Promise<WorkspaceManagementRecoveryState> {
    if (this.disposed) return 'recoveryRequired';
    try {
      if (this.options.mode === 'selector') {
        await this.options.assertNoUnresolvedSelectorOperations();
        return this.disposed ? 'recoveryRequired' : 'clear';
      }
      const unresolved = await Promise.allSettled([
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
      return this.disposed || unresolved.some(result => result.status === 'rejected' || result.value)
        ? 'recoveryRequired' : 'clear';
    } catch {
      return 'recoveryRequired';
    }
  }

  dispose(): void {
    this.disposed = true;
  }
}
