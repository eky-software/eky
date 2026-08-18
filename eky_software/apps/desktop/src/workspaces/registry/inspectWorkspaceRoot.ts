import { lstat, realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';

import type { WorkspaceRootPathsV1 } from './deriveWorkspaceRoot.js';
import { WorkspaceRootValidationError, workspaceRootInvalid } from './workspaceRootError.js';

export async function inspectWorkspaceRoot(
  paths: Readonly<WorkspaceRootPathsV1>,
): Promise<Readonly<WorkspaceRootPathsV1>> {
  try {
    if (
      paths.layoutVersion !== 1 ||
      !isAbsolute(paths.workspacesRoot) ||
      !isAbsolute(paths.workspaceRoot) ||
      !isContainedPath(paths.workspacesRoot, paths.workspaceRoot)
    ) {
      return workspaceRootInvalid();
    }
    await assertPrivateRealDirectory(paths.workspacesRoot);
    await assertPrivateRealDirectory(paths.workspaceRoot);
    const realParent = await realpath(paths.workspacesRoot);
    const realWorkspace = await realpath(paths.workspaceRoot);
    if (
      !pathsAreEqual(realParent, paths.workspacesRoot) ||
      !pathsAreEqual(realWorkspace, paths.workspaceRoot) ||
      !isContainedPath(realParent, realWorkspace)
    ) {
      return workspaceRootInvalid();
    }
    return paths;
  } catch (error) {
    if (error instanceof WorkspaceRootValidationError) {
      throw error;
    }
    return workspaceRootInvalid();
  }
}

async function assertPrivateRealDirectory(path: string): Promise<void> {
  const metadata = await lstat(path);
  if (
    !metadata.isDirectory() ||
    metadata.isSymbolicLink() ||
    (process.platform !== 'win32' && (metadata.mode & 0o077) !== 0)
  ) {
    return workspaceRootInvalid();
  }
}

function isContainedPath(parentPath: string, candidatePath: string): boolean {
  const child = relative(parentPath, candidatePath);
  return child.length > 0 && !child.startsWith('..') && !isAbsolute(child);
}

function pathsAreEqual(firstPath: string, secondPath: string): boolean {
  const first = resolve(firstPath);
  const second = resolve(secondPath);
  return process.platform === 'win32'
    ? first.toLowerCase() === second.toLowerCase()
    : first === second;
}
