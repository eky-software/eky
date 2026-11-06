import { isAbsolute, join, resolve } from 'node:path';

const operationIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface ProfileRestoreActivationPaths {
  activeDatabasePath: string;
  activeDocumentsRoot: string;
  failedRoot: string;
  rollbackRoot: string;
  stagingRoot: string;
}

export function assertProfileRestoreActivationPaths(paths: ProfileRestoreActivationPaths): void {
  const values = Object.values(paths);
  if (
    values.some(path => !isAbsolute(path) || path.includes('\0') || path.length > 4_096) ||
    new Set(values.map(path => {
      const resolved = resolve(path);
      return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
    })).size !== values.length
  ) {
    throw new Error('PROFILE_RESTORE_ACTIVATION_PATHS_INVALID');
  }
}

export function assertProfileRestoreOperationId(operationId: string): void {
  if (!operationIdPattern.test(operationId)) throw new Error('PROFILE_RESTORE_OPERATION_INVALID');
}

// Restore and its remnant readers share the existing operation layout, not filesystem authority.
export function deriveProfileRestoreActivationOperationPaths(
  paths: ProfileRestoreActivationPaths, operationId: string,
) {
  assertProfileRestoreActivationPaths(paths);
  assertProfileRestoreOperationId(operationId);
  const stagingOperationRoot = join(resolve(paths.stagingRoot), operationId);
  const rollbackOperationRoot = join(resolve(paths.rollbackRoot), operationId);
  const failedOperationRoot = join(resolve(paths.failedRoot), operationId);
  return Object.freeze({
    failedActiveDatabasePath: join(failedOperationRoot, 'active', 'data', 'eky.sqlite'),
    failedActiveDocumentsRoot: join(failedOperationRoot, 'active', 'storage', 'invoices'),
    failedOperationRoot,
    failedStagingRoot: join(failedOperationRoot, 'staging'),
    failedStagedDatabasePath: join(failedOperationRoot, 'staging', 'profile.sqlite'),
    failedStagedDocumentsRoot: join(failedOperationRoot, 'staging', 'activation', 'storage', 'invoices'),
    rollbackDatabasePath: join(rollbackOperationRoot, 'data', 'eky.sqlite'),
    rollbackDocumentsRoot: join(rollbackOperationRoot, 'storage', 'invoices'),
    rollbackOperationRoot,
    stagedDatabasePath: join(stagingOperationRoot, 'profile.sqlite'),
    stagedDocumentsRoot: join(stagingOperationRoot, 'activation', 'storage', 'invoices'),
    stagingOperationRoot,
  });
}
