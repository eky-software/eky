import { isAbsolute, join, relative, resolve } from 'node:path';

import { profileRestoreActivationJournalFileName } from '../../profileBackup/restore/profileRestoreActivationJournalStore.js';
import { deriveWorkspaceRoot } from '../registry/deriveWorkspaceRoot.js';
import type { WorkspaceId } from '../registry/workspaceRegistryTypes.js';
import { WorkspaceBackupReplacementError } from './workspaceBackupReplacementError.js';
import {
  validateWorkspaceBackupReplacementOperationId,
  type WorkspaceBackupReplacementOperationId,
} from './workspaceBackupReplacementOperationId.js';

export interface WorkspaceBackupReplacementPaths {
  readonly userDataRoot: string;
  readonly targetWorkspaceRoot: string;
  readonly activeDatabasePath: string;
  readonly activeArtifactRoot: string;
  readonly operationsRoot: string;
  readonly importRoot: string;
  readonly importStagingRoot: string;
  readonly activationRoot: string;
  readonly activationJournalPath: string;
  readonly activationStagingRoot: string;
  readonly activationStagingOperationRoot: string;
  readonly candidateDatabasePath: string;
  readonly candidateArtifactRoot: string;
  readonly activationRollbackRoot: string;
  readonly activationFailedRoot: string;
}

export function deriveWorkspaceBackupReplacementPaths(
  userDataRoot: string,
  operationId: WorkspaceBackupReplacementOperationId,
  workspaceId: WorkspaceId,
): Readonly<WorkspaceBackupReplacementPaths> {
  try {
    if (
      typeof userDataRoot !== 'string' ||
      userDataRoot.includes('\0') ||
      !isAbsolute(userDataRoot)
    ) {
      throw new Error('invalid');
    }
    const root = resolve(userDataRoot);
    const validatedOperationId =
      validateWorkspaceBackupReplacementOperationId(operationId);
    const workspace = deriveWorkspaceRoot(root, workspaceId, 1);
    const operationsRoot = join(root, 'workspace-replacement-operations');
    const importRoot = join(operationsRoot, 'import');
    const importStagingRoot = join(importRoot, validatedOperationId);
    const activationRoot = join(operationsRoot, 'activation');
    const activationStagingRoot = join(activationRoot, 'staging');
    const activationStagingOperationRoot = join(
      activationStagingRoot,
      validatedOperationId,
    );
    const activationRollbackRoot = join(activationRoot, 'rollback');
    const activationFailedRoot = join(activationRoot, 'failed');
    const paths = {
      userDataRoot: root,
      targetWorkspaceRoot: workspace.workspaceRoot,
      activeDatabasePath: join(
        workspace.workspaceRoot,
        'runtime',
        'data',
        'eky.sqlite',
      ),
      activeArtifactRoot: join(
        workspace.workspaceRoot,
        'runtime',
        'storage',
        'invoices',
      ),
      operationsRoot,
      importRoot,
      importStagingRoot,
      activationRoot,
      activationJournalPath: join(
        activationRoot,
        profileRestoreActivationJournalFileName,
      ),
      activationStagingRoot,
      activationStagingOperationRoot,
      candidateDatabasePath: join(
        activationStagingOperationRoot,
        'profile.sqlite',
      ),
      candidateArtifactRoot: join(
        activationStagingOperationRoot,
        'activation',
        'storage',
        'invoices',
      ),
      activationRollbackRoot,
      activationFailedRoot,
    } as const;

    const operationPaths = [
      importRoot,
      importStagingRoot,
      activationRoot,
      activationStagingRoot,
      activationStagingOperationRoot,
      activationRollbackRoot,
      activationFailedRoot,
    ];
    if (
      !isContained(root, workspace.workspaceRoot) ||
      !isContained(root, operationsRoot) ||
      operationPaths.some((path) => !isContained(operationsRoot, path)) ||
      !isContained(
        activationStagingOperationRoot,
        paths.candidateArtifactRoot,
      ) ||
      !isContained(
        activationStagingOperationRoot,
        paths.candidateDatabasePath,
      ) ||
      !isContained(workspace.workspaceRoot, paths.activeDatabasePath) ||
      !isContained(workspace.workspaceRoot, paths.activeArtifactRoot)
    ) {
      throw new Error('invalid');
    }
    return Object.freeze(paths);
  } catch (error) {
    if (error instanceof WorkspaceBackupReplacementError) throw error;
    throw new WorkspaceBackupReplacementError(
      'WORKSPACE_REPLACEMENT_INVALID',
      'inputValidation',
    );
  }
}

function isContained(parentPath: string, childPath: string): boolean {
  const child = relative(parentPath, childPath);
  return child.length > 0 && !child.startsWith('..') && !isAbsolute(child);
}
