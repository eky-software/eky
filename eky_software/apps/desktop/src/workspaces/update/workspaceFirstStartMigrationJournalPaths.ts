import { isAbsolute, join, resolve } from 'node:path';

import type { CrashSafeFileSlotPaths } from '../persistence/crashSafeFileSlot.js';
import { workspaceFirstStartMigrationJournalInvalid } from './workspaceFirstStartMigrationJournalError.js';

const journalFileName = 'workspace-first-start-migration-v1.json';

export function createWorkspaceFirstStartMigrationJournalPaths(
  userDataPath: string,
): Readonly<CrashSafeFileSlotPaths> {
  if (
    typeof userDataPath !== 'string' ||
    userDataPath.includes('\0') ||
    !isAbsolute(userDataPath) ||
    !pathsAreEqual(userDataPath, resolve(userDataPath))
  ) {
    return workspaceFirstStartMigrationJournalInvalid();
  }
  const directoryPath = join(userDataPath, 'update-state');
  const currentPath = join(directoryPath, journalFileName);
  return Object.freeze({
    directoryPath,
    currentPath,
    nextPath: `${currentPath}.next`,
    backupPath: `${currentPath}.backup`,
  });
}

function pathsAreEqual(firstPath: string, secondPath: string): boolean {
  return process.platform === 'win32'
    ? firstPath.toLowerCase() === secondPath.toLowerCase()
    : firstPath === secondPath;
}
