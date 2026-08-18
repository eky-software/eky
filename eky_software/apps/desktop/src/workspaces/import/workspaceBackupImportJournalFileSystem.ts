import {
  createNodeCrashSafeFileSlotFileSystem,
  type CrashSafeFileSlot,
  type CrashSafeFileSlotFileSystem,
  type CrashSafeFileSlotNextWriter,
} from '../persistence/crashSafeFileSlot.js';
import { WORKSPACE_BACKUP_IMPORT_JOURNAL_MAX_BYTES } from './workspaceBackupImportJournalBytes.js';
import type { WorkspaceBackupImportJournalPaths } from './workspaceBackupImportJournalPaths.js';

export type WorkspaceBackupImportJournalSlot = CrashSafeFileSlot;
export type WorkspaceBackupImportJournalFileSystemFailure =
  | 'invalid'
  | 'unavailable';

export class WorkspaceBackupImportJournalFileSystemError extends Error {
  constructor(readonly failure: WorkspaceBackupImportJournalFileSystemFailure) {
    super(
      failure === 'invalid'
        ? 'WORKSPACE_BACKUP_IMPORT_JOURNAL_INVALID'
        : 'WORKSPACE_BACKUP_IMPORT_JOURNAL_UNAVAILABLE',
    );
    this.name = 'WorkspaceBackupImportJournalFileSystemError';
  }
}

export type WorkspaceBackupImportJournalNextWriter =
  CrashSafeFileSlotNextWriter;
export type WorkspaceBackupImportJournalFileSystem =
  CrashSafeFileSlotFileSystem;

export function createNodeWorkspaceBackupImportJournalFileSystem(
  paths: Readonly<WorkspaceBackupImportJournalPaths>,
): WorkspaceBackupImportJournalFileSystem {
  return createNodeCrashSafeFileSlotFileSystem(
    paths,
    WORKSPACE_BACKUP_IMPORT_JOURNAL_MAX_BYTES,
  );
}
