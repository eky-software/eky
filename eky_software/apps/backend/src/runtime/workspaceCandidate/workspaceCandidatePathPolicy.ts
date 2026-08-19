import { promises as fileSystem } from 'node:fs';
import { isAbsolute, normalize, parse, relative, resolve, sep } from 'node:path';

const privateDirectoryPermissionMask = 0o077;
const untrustedWritePermissionMask = 0o022;

export async function validatePrivateWorkspaceDirectory(
  path: unknown,
): Promise<string> {
  const resolved = resolveAbsoluteWorkspaceCandidatePath(path);
  const metadata = await fileSystem.lstat(resolved);
  if (
    !metadata.isDirectory() ||
    metadata.isSymbolicLink() ||
    (process.platform !== 'win32' &&
      (metadata.mode & privateDirectoryPermissionMask) !== 0) ||
    !workspaceCandidatePathsAreEqual(
      await fileSystem.realpath(resolved),
      resolved,
    )
  ) {
    throw new Error('WORKSPACE_CANDIDATE_PATH_INVALID');
  }
  return resolved;
}

export async function validateTrustedReadOnlyCodeDirectory(
  path: unknown,
): Promise<string> {
  const resolved = resolveAbsoluteWorkspaceCandidatePath(path);
  const metadata = await fileSystem.lstat(resolved);
  if (
    !metadata.isDirectory() ||
    metadata.isSymbolicLink() ||
    (process.platform !== 'win32' &&
      (metadata.mode & untrustedWritePermissionMask) !== 0) ||
    !workspaceCandidatePathsAreEqual(
      await fileSystem.realpath(resolved),
      resolved,
    )
  ) {
    throw new Error('WORKSPACE_CANDIDATE_PATH_INVALID');
  }
  return resolved;
}

export function resolveAbsoluteWorkspaceCandidatePath(path: unknown): string {
  if (typeof path !== 'string' || path.includes('\0') || !isAbsolute(path)) {
    throw new Error('WORKSPACE_CANDIDATE_PATH_INVALID');
  }
  const pathWithoutOptionalDirectorySeparator = stripDirectorySeparator(path);
  if (
    stripDirectorySeparator(normalize(path)) !==
    pathWithoutOptionalDirectorySeparator
  ) {
    throw new Error('WORKSPACE_CANDIDATE_PATH_INVALID');
  }
  return resolve(pathWithoutOptionalDirectorySeparator);
}

export function assertWorkspaceCandidateContainedPath(
  root: string,
  candidate: string,
): void {
  const relativePath = relative(root, candidate);
  if (
    relativePath === '' ||
    relativePath === '..' ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath)
  ) {
    throw new Error('WORKSPACE_CANDIDATE_PATH_INVALID');
  }
}

export function workspaceCandidatePathsAreEqual(
  first: string,
  second: string,
): boolean {
  const firstResolved = resolve(first);
  const secondResolved = resolve(second);
  return process.platform === 'win32'
    ? firstResolved.toLowerCase() === secondResolved.toLowerCase()
    : firstResolved === secondResolved;
}

function stripDirectorySeparator(path: string): string {
  const root = parse(path).root;
  if (path.length <= root.length || !path.endsWith(sep)) return path;
  return path.slice(0, -1);
}
