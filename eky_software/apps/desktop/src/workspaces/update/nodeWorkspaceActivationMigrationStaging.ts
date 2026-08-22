import { lstat, readdir, realpath, rm } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';

import { validateWorkspaceBackupImportOperationId } from '../import/workspaceBackupImportOperationId.js';
import type { WorkspaceBackupImportOperationId } from '../import/workspaceBackupImportTypes.js';
import type { WorkspaceActivationMigrationStagingPort } from './workspaceActivationMigrationRecoveryPoint.js';
import { WorkspaceActivationMigrationError } from './workspaceActivationMigrationError.js';

export class NodeWorkspaceActivationMigrationStaging
  implements WorkspaceActivationMigrationStagingPort
{
  private readonly stagingRoot: string;

  constructor(stagingRoot: string) {
    if (!isAbsolute(stagingRoot) || stagingRoot.includes('\0')) {
      throw new WorkspaceActivationMigrationError(
        'WORKSPACE_ACTIVATION_MIGRATION_FAILED',
      );
    }
    this.stagingRoot = resolve(stagingRoot);
  }

  async assertOperationRoot(input: {
    readonly operationId: WorkspaceBackupImportOperationId;
    readonly operationRoot: string;
  }): Promise<void> {
    try {
      const expected = this.operationRoot(input.operationId);
      if (!pathsEqual(expected, input.operationRoot)) {
        throw new Error('invalid');
      }
      await assertSafeTree(expected);
    } catch {
      throw new WorkspaceActivationMigrationError(
        'WORKSPACE_ACTIVATION_MIGRATION_FAILED',
      );
    }
  }

  async removeOperationRoot(
    operationId: WorkspaceBackupImportOperationId,
  ): Promise<void> {
    const operationRoot = this.operationRoot(operationId);
    try {
      const metadata = await lstat(operationRoot).catch((error: unknown) => {
        if (isNodeError(error) && error.code === 'ENOENT') return undefined;
        throw error;
      });
      if (metadata === undefined) return;
      await assertSafeTree(operationRoot);
      await rm(operationRoot, { recursive: true });
    } catch {
      throw new WorkspaceActivationMigrationError(
        'WORKSPACE_ACTIVATION_MIGRATION_FAILED',
      );
    }
  }

  private operationRoot(operationId: WorkspaceBackupImportOperationId) {
    const validatedOperationId =
      validateWorkspaceBackupImportOperationId(operationId);
    const operationRoot = join(this.stagingRoot, validatedOperationId);
    return operationRoot;
  }
}

async function assertSafeTree(path: string): Promise<void> {
  const metadata = await lstat(path);
  if (metadata.isSymbolicLink() || !pathsEqual(await realpath(path), path)) {
    throw new Error('invalid');
  }
  if (metadata.isDirectory()) {
    for (const entry of await readdir(path)) {
      await assertSafeTree(join(path, entry));
    }
    return;
  }
  if (!metadata.isFile() || metadata.nlink !== 1) {
    throw new Error('invalid');
  }
}

function pathsEqual(first: string, second: string): boolean {
  const left = resolve(first);
  const right = resolve(second);
  return process.platform === 'win32'
    ? left.toLowerCase() === right.toLowerCase()
    : left === right;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
