import { basename, isAbsolute, join, resolve } from 'node:path';

import {
  WORKSPACE_CREATION_JOURNAL_UNAVAILABLE,
  WorkspaceCreationJournalStoreError,
} from './workspaceCreationJournalError.js';

export const WORKSPACE_CREATION_JOURNAL_FILE_NAME =
  'workspace-creation-journal-v1.json';
export const WORKSPACE_CREATION_JOURNAL_NEXT_FILE_NAME =
  'workspace-creation-journal-v1.json.next';
export const WORKSPACE_CREATION_JOURNAL_BACKUP_FILE_NAME =
  'workspace-creation-journal-v1.json.backup';

export interface WorkspaceCreationJournalPaths {
  readonly directoryPath: string;
  readonly currentPath: string;
  readonly nextPath: string;
  readonly backupPath: string;
}

export function createWorkspaceCreationJournalPaths(
  installationRoot: string,
  filePath: string,
): Readonly<WorkspaceCreationJournalPaths> {
  if (
    typeof installationRoot !== 'string' ||
    typeof filePath !== 'string' ||
    installationRoot.includes('\0') ||
    filePath.includes('\0') ||
    !isAbsolute(installationRoot) ||
    !isAbsolute(filePath) ||
    basename(filePath) !== WORKSPACE_CREATION_JOURNAL_FILE_NAME
  ) {
    throw new WorkspaceCreationJournalStoreError(
      WORKSPACE_CREATION_JOURNAL_UNAVAILABLE,
    );
  }
  const directoryPath = resolve(installationRoot);
  const currentPath = join(
    directoryPath,
    WORKSPACE_CREATION_JOURNAL_FILE_NAME,
  );
  if (!pathsAreEqual(filePath, currentPath)) {
    throw new WorkspaceCreationJournalStoreError(
      WORKSPACE_CREATION_JOURNAL_UNAVAILABLE,
    );
  }
  return Object.freeze({
    directoryPath,
    currentPath,
    nextPath: join(
      directoryPath,
      WORKSPACE_CREATION_JOURNAL_NEXT_FILE_NAME,
    ),
    backupPath: join(
      directoryPath,
      WORKSPACE_CREATION_JOURNAL_BACKUP_FILE_NAME,
    ),
  });
}

function pathsAreEqual(firstPath: string, secondPath: string): boolean {
  const first = resolve(firstPath);
  const second = resolve(secondPath);
  return process.platform === 'win32'
    ? first.toLowerCase() === second.toLowerCase()
    : first === second;
}
