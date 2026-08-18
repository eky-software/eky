import { isAbsolute, join, relative, resolve } from 'node:path';

import { workspaceRootInvalid } from './workspaceRootError.js';
import type { WorkspaceId } from './workspaceRegistryTypes.js';
import { validateWorkspaceId } from './workspaceIdValidation.js';

export interface WorkspaceRootPathsV1 {
  readonly layoutVersion: 1;
  readonly workspacesRoot: string;
  readonly workspaceRoot: string;
}

export function deriveWorkspaceRoot(
  userDataPath: string,
  workspaceId: WorkspaceId,
  layoutVersion: 1,
): Readonly<WorkspaceRootPathsV1> {
  try {
    if (
      typeof userDataPath !== 'string' ||
      userDataPath.includes('\0') ||
      !isAbsolute(userDataPath) ||
      layoutVersion !== 1
    ) {
      return workspaceRootInvalid();
    }
    const validatedWorkspaceId = validateWorkspaceId(workspaceId);
    const canonicalUserDataPath = resolve(userDataPath);
    const workspacesRoot = join(canonicalUserDataPath, 'workspaces');
    const workspaceRoot = join(workspacesRoot, validatedWorkspaceId);
    if (!isContainedPath(workspacesRoot, workspaceRoot)) {
      return workspaceRootInvalid();
    }
    return Object.freeze({
      layoutVersion: 1,
      workspacesRoot,
      workspaceRoot,
    });
  } catch {
    return workspaceRootInvalid();
  }
}

function isContainedPath(parentPath: string, candidatePath: string): boolean {
  const child = relative(parentPath, candidatePath);
  return child.length > 0 && !child.startsWith('..') && !isAbsolute(child);
}
