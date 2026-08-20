import { lstat, readFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';

import { parseDirectSetupMigrationRecovery } from '../../update/directSetupMigrationRecovery.js';
import { maximumDirectSetupMigrationRecoveryBytes } from '../../update/directSetupMigrationRecoveryStore.js';
import { isTerminalUpdateJournalState } from '../../update/startupRecoveryAuthority.js';
import { parseUpdateJournal } from '../../update/updateJournal.js';
import { maximumUpdateJournalBytes } from '../../update/updateJournalStore.js';
import {
  WorkspaceManagementRecoveryRequiredError,
  type WorkspaceManagementOperationGuard,
  type WorkspaceManagementRecoveryState,
} from './workspaceManagementOperationGuard.js';

interface ReadOnlyJournalSlotPaths {
  readonly backupPath: string;
  readonly currentPath: string;
  readonly nextPath: string;
}

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
        hasAnySlot(this.options.adoptionJournal),
        hasAnySlot(this.options.creationJournal),
        hasTerminalRecordConflict(
          this.options.directSetupRecovery,
          maximumDirectSetupMigrationRecoveryBytes,
          parseDirectSetupMigrationRecovery,
          (record) => record.state === 'accepted',
        ),
        hasAnySlot(this.options.importJournal),
        hasAnySlot(this.options.profileRestoreJournal),
        hasAnySlot(this.options.replacementJournal),
        hasAnySlot(this.options.switchJournal),
        hasTerminalRecordConflict(
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

async function hasAnySlot(
  paths: Readonly<ReadOnlyJournalSlotPaths>,
): Promise<boolean> {
  const presence = await Promise.all([
    inspectSlotPresence(paths.currentPath),
    inspectSlotPresence(paths.nextPath),
    inspectSlotPresence(paths.backupPath),
  ]);
  return presence.some(Boolean);
}

async function hasTerminalRecordConflict<T>(
  paths: Readonly<ReadOnlyJournalSlotPaths>,
  maximumBytes: number,
  parse: (value: unknown) => Readonly<T>,
  isTerminal: (value: Readonly<T>) => boolean,
): Promise<boolean> {
  const [currentExists, nextExists, backupExists] = await Promise.all([
    inspectSlotPresence(paths.currentPath),
    inspectSlotPresence(paths.nextPath),
    inspectSlotPresence(paths.backupPath),
  ]);
  if (nextExists || backupExists) return true;
  if (!currentExists) return false;
  const current = await readCurrentRecord(
    paths.currentPath,
    maximumBytes,
    parse,
  );
  return !isTerminal(current);
}

async function inspectSlotPresence(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return false;
    throw error;
  }
}

async function readCurrentRecord<T>(
  path: string,
  maximumBytes: number,
  parse: (value: unknown) => Readonly<T>,
): Promise<Readonly<T>> {
  const metadata = await lstat(path);
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    metadata.nlink !== 1 ||
    metadata.size < 1 ||
    metadata.size > maximumBytes
  ) {
    throw new Error('WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED');
  }
  return parse(JSON.parse(await readFile(path, 'utf8')));
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
