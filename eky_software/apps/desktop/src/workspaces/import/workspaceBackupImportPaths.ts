import { isAbsolute, join, parse, relative, resolve } from 'node:path';

import { validateWorkspaceId } from '../registry/workspaceIdValidation.js';
import type { WorkspaceId } from '../registry/workspaceRegistryTypes.js';
import { WorkspaceBackupImportError } from './workspaceBackupImportError.js';
import { validateWorkspaceBackupImportOperationId } from './workspaceBackupImportOperationId.js';
import type { WorkspaceBackupImportOperationId } from './workspaceBackupImportTypes.js';

export interface WorkspaceBackupImportPaths {
  readonly userDataRoot: string;
  readonly operationsRoot: string;
  readonly operationRoot: string;
  readonly candidateRoot: string;
  readonly importStagingRoot: string;
  readonly candidateRuntimeRoot: string;
  readonly databaseFilePath: string;
  readonly artifactRoot: string;
  readonly workspacesRoot: string;
  readonly finalRoot: string;
  readonly publishedDatabaseFilePath: string;
  readonly publishedArtifactRoot: string;
}

export function deriveWorkspaceBackupImportPaths(
  userDataRoot: string,
  operationId: WorkspaceBackupImportOperationId,
  workspaceId: WorkspaceId,
): Readonly<WorkspaceBackupImportPaths> {
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
      validateWorkspaceBackupImportOperationId(operationId);
    const validatedWorkspaceId = validateWorkspaceId(workspaceId);
    const operationsRoot = join(root, 'workspace-operations');
    const operationRoot = join(operationsRoot, validatedOperationId);
    const candidateRoot = join(operationRoot, validatedWorkspaceId);
    const workspacesRoot = join(root, 'workspaces');
    const finalRoot = join(workspacesRoot, validatedWorkspaceId);
    if (
      !isContained(operationsRoot, operationRoot) ||
      !isContained(operationRoot, candidateRoot) ||
      !isContained(workspacesRoot, finalRoot) ||
      parse(candidateRoot).root.toLowerCase() !==
        parse(finalRoot).root.toLowerCase()
    ) {
      throw new Error('invalid');
    }
    const candidateRuntimeRoot = join(candidateRoot, 'runtime');
    return Object.freeze({
      userDataRoot: root,
      operationsRoot,
      operationRoot,
      candidateRoot,
      importStagingRoot: join(candidateRoot, 'import-staging'),
      candidateRuntimeRoot,
      databaseFilePath: join(candidateRuntimeRoot, 'data', 'eky.sqlite'),
      artifactRoot: join(candidateRuntimeRoot, 'storage', 'invoices'),
      workspacesRoot,
      finalRoot,
      publishedDatabaseFilePath: join(
        finalRoot,
        'runtime',
        'data',
        'eky.sqlite',
      ),
      publishedArtifactRoot: join(
        finalRoot,
        'runtime',
        'storage',
        'invoices',
      ),
    });
  } catch {
    throw new WorkspaceBackupImportError(
      'WORKSPACE_IMPORT_INVALID',
      'identityGeneration',
    );
  }
}

function isContained(parentPath: string, childPath: string): boolean {
  const child = relative(parentPath, childPath);
  return child.length > 0 && !child.startsWith('..') && !isAbsolute(child);
}
