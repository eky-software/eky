import { isAbsolute, join, relative, resolve } from 'node:path';

import { profileRestoreActivationJournalFileName } from '../../profileBackup/restore/profileRestoreActivationJournalStore.js';
import { deriveWorkspaceRoot } from '../registry/deriveWorkspaceRoot.js';
import type { WorkspaceId } from '../registry/workspaceRegistryTypes.js';
import { WorkspaceBackupReplacementError } from './workspaceBackupReplacementError.js';
import {
  validateWorkspaceBackupReplacementOperationId,
  type WorkspaceBackupReplacementOperationId,
} from './workspaceBackupReplacementOperationId.js';

export interface WorkspaceBackupReplacementRuntimePaths {
  readonly userDataRoot: string;
  readonly targetWorkspaceRoot: string;
  readonly activeDatabasePath: string;
  readonly activeArtifactRoot: string;
  readonly operationsRoot: string;
  readonly importRoot: string;
  readonly activationRoot: string;
  readonly activationJournalPath: string;
  readonly activationStagingRoot: string;
  readonly activationRollbackRoot: string;
  readonly activationFailedRoot: string;
}

export interface WorkspaceBackupReplacementPaths
  extends WorkspaceBackupReplacementRuntimePaths {
  readonly importStagingRoot: string;
  readonly activationStagingOperationRoot: string;
  readonly candidateDatabasePath: string;
  readonly candidateArtifactRoot: string;
}

export function deriveWorkspaceBackupReplacementRuntimePaths(
  userDataRoot: string,
  workspaceId: WorkspaceId,
): Readonly<WorkspaceBackupReplacementRuntimePaths> {
  try {
    if (
      typeof userDataRoot !== 'string' ||
      userDataRoot.includes('\0') ||
      !isAbsolute(userDataRoot)
    ) {
      throw new Error('invalid');
    }
    const root = resolve(userDataRoot);
    const workspace = deriveWorkspaceRoot(root, workspaceId, 1);
    const operationsRoot = join(root, 'workspace-replacement-operations');
    const importRoot = join(operationsRoot, 'import');
    const activationRoot = join(operationsRoot, 'activation');
    const activationStagingRoot = join(activationRoot, 'staging');
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
      activationRoot,
      activationJournalPath: join(
        activationRoot,
        profileRestoreActivationJournalFileName,
      ),
      activationStagingRoot,
      activationRollbackRoot,
      activationFailedRoot,
    } as const;

    const operationPaths = [
      importRoot,
      activationRoot,
      activationStagingRoot,
      activationRollbackRoot,
      activationFailedRoot,
    ];
    if (
      !isContained(root, workspace.workspaceRoot) ||
      !isContained(root, operationsRoot) ||
      operationPaths.some((path) => !isContained(operationsRoot, path)) ||
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

export function deriveWorkspaceBackupReplacementPaths(
  userDataRoot: string,
  operationId: WorkspaceBackupReplacementOperationId,
  workspaceId: WorkspaceId,
): Readonly<WorkspaceBackupReplacementPaths> {
  try {
    const runtimePaths = deriveWorkspaceBackupReplacementRuntimePaths(
      userDataRoot,
      workspaceId,
    );
    const validatedOperationId =
      validateWorkspaceBackupReplacementOperationId(operationId);
    const importStagingRoot = join(
      runtimePaths.importRoot,
      validatedOperationId,
    );
    const activationStagingOperationRoot = join(
      runtimePaths.activationStagingRoot,
      validatedOperationId,
    );
    const paths = {
      ...runtimePaths,
      importStagingRoot,
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
    } as const;

    if (
      !isContained(runtimePaths.importRoot, importStagingRoot) ||
      !isContained(
        runtimePaths.activationStagingRoot,
        activationStagingOperationRoot,
      ) ||
      !isContained(
        activationStagingOperationRoot,
        paths.candidateArtifactRoot,
      ) ||
      !isContained(
        activationStagingOperationRoot,
        paths.candidateDatabasePath,
      )
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
