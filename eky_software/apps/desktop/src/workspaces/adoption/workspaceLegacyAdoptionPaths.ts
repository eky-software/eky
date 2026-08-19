import { isAbsolute, join, parse, relative, resolve } from 'node:path';

import { validateWorkspaceId } from '../registry/workspaceIdValidation.js';
import type { WorkspaceId } from '../registry/workspaceRegistryTypes.js';
import { WorkspaceLegacyAdoptionError } from './workspaceLegacyAdoptionError.js';

const operationIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export interface WorkspaceLegacyAdoptionPaths {
  readonly userDataRoot: string;
  readonly legacyRuntimeRoot: string;
  readonly operationsRoot: string;
  readonly operationRoot: string;
  readonly candidateRoot: string;
  readonly candidateRuntimeRoot: string;
  readonly workspacesRoot: string;
  readonly finalRoot: string;
}

export function deriveWorkspaceLegacyAdoptionPaths(
  userDataRoot: string,
  operationId: string,
  workspaceId: WorkspaceId,
): Readonly<WorkspaceLegacyAdoptionPaths> {
  try {
    if (
      typeof userDataRoot !== 'string' ||
      userDataRoot.includes('\0') ||
      !isAbsolute(userDataRoot) ||
      !operationIdPattern.test(operationId)
    ) {
      throw new Error('invalid');
    }
    const root = resolve(userDataRoot);
    const validatedWorkspaceId = validateWorkspaceId(workspaceId);
    const operationsRoot = join(root, 'workspace-operations');
    const operationRoot = join(operationsRoot, operationId);
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
    return Object.freeze({
      userDataRoot: root,
      legacyRuntimeRoot: join(root, 'runtime'),
      operationsRoot,
      operationRoot,
      candidateRoot,
      candidateRuntimeRoot: join(candidateRoot, 'runtime'),
      workspacesRoot,
      finalRoot,
    });
  } catch {
    throw new WorkspaceLegacyAdoptionError('WORKSPACE_ADOPTION_INVALID');
  }
}

function isContained(parentPath: string, childPath: string): boolean {
  const child = relative(parentPath, childPath);
  return child.length > 0 && !child.startsWith('..') && !isAbsolute(child);
}
