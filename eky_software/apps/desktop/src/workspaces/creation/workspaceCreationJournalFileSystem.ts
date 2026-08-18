import {
  createNodeCrashSafeFileSlotFileSystem,
  type CrashSafeFileSlot,
  type CrashSafeFileSlotFileSystem,
  type CrashSafeFileSlotNextWriter,
} from '../persistence/crashSafeFileSlot.js';
import { WORKSPACE_CREATION_JOURNAL_MAX_BYTES } from './workspaceCreationJournalBytes.js';
import type { WorkspaceCreationJournalPaths } from './workspaceCreationJournalPaths.js';

export type WorkspaceCreationJournalSlot = CrashSafeFileSlot;
export type WorkspaceCreationJournalFileSystemFailure =
  | 'invalid'
  | 'unavailable';

export class WorkspaceCreationJournalFileSystemError extends Error {
  constructor(readonly failure: WorkspaceCreationJournalFileSystemFailure) {
    super(
      failure === 'invalid'
        ? 'WORKSPACE_CREATION_JOURNAL_INVALID'
        : 'WORKSPACE_CREATION_JOURNAL_UNAVAILABLE',
    );
    this.name = 'WorkspaceCreationJournalFileSystemError';
  }
}

export type WorkspaceCreationJournalNextWriter =
  CrashSafeFileSlotNextWriter;
export type WorkspaceCreationJournalFileSystem =
  CrashSafeFileSlotFileSystem;

export function createNodeWorkspaceCreationJournalFileSystem(
  paths: Readonly<WorkspaceCreationJournalPaths>,
): WorkspaceCreationJournalFileSystem {
  return createNodeCrashSafeFileSlotFileSystem(
    paths,
    WORKSPACE_CREATION_JOURNAL_MAX_BYTES,
  );
}
