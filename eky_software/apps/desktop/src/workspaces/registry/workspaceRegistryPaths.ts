import { basename, isAbsolute, join, resolve } from 'node:path';

import {
  WORKSPACE_REGISTRY_UNAVAILABLE,
  WorkspaceRegistryStoreError,
} from './workspaceRegistryStoreError.js';

export const WORKSPACE_REGISTRY_FILE_NAME = 'workspace-registry-v1.json';
export const WORKSPACE_REGISTRY_NEXT_FILE_NAME =
  'workspace-registry-v1.json.next';
export const WORKSPACE_REGISTRY_BACKUP_FILE_NAME =
  'workspace-registry-v1.json.backup';

export interface WorkspaceRegistryPaths {
  readonly directoryPath: string;
  readonly currentPath: string;
  readonly nextPath: string;
  readonly backupPath: string;
}

export function createWorkspaceRegistryPaths(
  installationRoot: string,
  filePath: string,
): Readonly<WorkspaceRegistryPaths> {
  if (
    typeof installationRoot !== 'string' ||
    typeof filePath !== 'string' ||
    installationRoot.includes('\0') ||
    filePath.includes('\0') ||
    !isAbsolute(installationRoot) ||
    !isAbsolute(filePath) ||
    basename(filePath) !== WORKSPACE_REGISTRY_FILE_NAME
  ) {
    throw new WorkspaceRegistryStoreError(WORKSPACE_REGISTRY_UNAVAILABLE);
  }
  const directoryPath = resolve(installationRoot);
  const currentPath = join(directoryPath, WORKSPACE_REGISTRY_FILE_NAME);
  if (!pathsAreEqual(filePath, currentPath)) {
    throw new WorkspaceRegistryStoreError(WORKSPACE_REGISTRY_UNAVAILABLE);
  }
  return Object.freeze({
    directoryPath,
    currentPath,
    nextPath: join(directoryPath, WORKSPACE_REGISTRY_NEXT_FILE_NAME),
    backupPath: join(directoryPath, WORKSPACE_REGISTRY_BACKUP_FILE_NAME),
  });
}

function pathsAreEqual(firstPath: string, secondPath: string): boolean {
  const first = resolve(firstPath);
  const second = resolve(secondPath);
  return process.platform === 'win32'
    ? first.toLowerCase() === second.toLowerCase()
    : first === second;
}
