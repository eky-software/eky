import { chmod, lstat, mkdir, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';

import { validateWorkspaceId } from '../workspaces/registry/workspaceIdValidation.js';
import type { WorkspaceId } from '../workspaces/registry/workspaceRegistryTypes.js';
import { requireInvoicePdfArchiveDirectoryPath } from './invoicePdfArchivePaths.js';
import { InvoicePdfArchiveError } from './invoicePdfArchiveTypes.js';

export type ResolveInvoicePdfArchiveDirectory = (
  configuredArchiveRoot: string,
) => Promise<string>;

export function createWorkspaceInvoicePdfArchiveDirectoryResolver(
  workspaceId: WorkspaceId,
): ResolveInvoicePdfArchiveDirectory {
  const validatedWorkspaceId = validateWorkspaceId(workspaceId);

  return async (configuredArchiveRoot) => {
    try {
      const validatedRoot = requireInvoicePdfArchiveDirectoryPath(
        configuredArchiveRoot,
      );
      const canonicalRoot = await realpath(validatedRoot);
      const rootMetadata = await lstat(canonicalRoot);
      if (!rootMetadata.isDirectory() || rootMetadata.isSymbolicLink()) {
        throw new Error('invalid archive root');
      }

      const workspaceDirectory = join(canonicalRoot, validatedWorkspaceId);
      if (!isDirectChild(canonicalRoot, workspaceDirectory)) {
        throw new Error('invalid workspace archive directory');
      }
      await mkdir(workspaceDirectory, { mode: 0o700 }).catch((error) => {
        if (!isNodeError(error) || error.code !== 'EEXIST') throw error;
      });
      if (process.platform !== 'win32') {
        await chmod(workspaceDirectory, 0o700);
      }

      const metadata = await lstat(workspaceDirectory);
      const canonicalWorkspaceDirectory = await realpath(workspaceDirectory);
      if (
        !metadata.isDirectory() ||
        metadata.isSymbolicLink() ||
        !pathsEqual(canonicalWorkspaceDirectory, workspaceDirectory) ||
        !isDirectChild(canonicalRoot, canonicalWorkspaceDirectory)
      ) {
        throw new Error('unsafe workspace archive directory');
      }
      return canonicalWorkspaceDirectory;
    } catch (error) {
      if (error instanceof InvoicePdfArchiveError) throw error;
      throw new InvoicePdfArchiveError('ARCHIVE_DIRECTORY_UNAVAILABLE', true);
    }
  };
}

function isDirectChild(parentPath: string, childPath: string): boolean {
  const child = relative(parentPath, childPath);
  return (
    child.length > 0 &&
    !child.startsWith('..') &&
    !isAbsolute(child) &&
    !child.includes('/') &&
    !child.includes('\\')
  );
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
