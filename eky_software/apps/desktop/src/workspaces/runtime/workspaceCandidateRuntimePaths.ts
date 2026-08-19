import { lstat, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';

const invalidRuntimePathsCode = 'WORKSPACE_CANDIDATE_RUNTIME_PATHS_INVALID';

export interface WorkspaceCandidateRuntimePaths {
  readonly backendRoot: string;
  readonly migrationsDirectory: string;
  readonly runnerPath: string;
}

export async function resolveWorkspaceCandidateRuntimePaths(
  resourcesPath: string,
): Promise<Readonly<WorkspaceCandidateRuntimePaths>> {
  try {
    if (
      typeof resourcesPath !== 'string' ||
      resourcesPath.includes('\0') ||
      !isAbsolute(resourcesPath)
    ) {
      throw new Error(invalidRuntimePathsCode);
    }

    const canonicalResourcesRoot = await requireRealDirectory(resourcesPath);
    const backendRoot = await requireRealDirectory(
      join(canonicalResourcesRoot, 'backend'),
    );
    const desktopRuntimeRoot = await requireRealDirectory(
      join(canonicalResourcesRoot, 'desktop-runtime'),
    );
    const migrationsDirectory = await requireRealDirectory(
      join(backendRoot, 'dist', 'database', 'migrations'),
    );
    const runnerPath = await requireRegularFile(
      join(
        desktopRuntimeRoot,
        'runtime',
        'workspaceCandidateRunner.js',
      ),
    );

    if (
      !isStrictChild(backendRoot, migrationsDirectory) ||
      !isStrictChild(desktopRuntimeRoot, runnerPath)
    ) {
      throw new Error(invalidRuntimePathsCode);
    }

    return Object.freeze({ backendRoot, migrationsDirectory, runnerPath });
  } catch {
    throw new Error(invalidRuntimePathsCode);
  }
}

async function requireRealDirectory(path: string): Promise<string> {
  const resolvedPath = resolve(path);
  const metadata = await lstat(resolvedPath);
  const canonicalPath = resolve(await realpath(resolvedPath));
  if (
    !metadata.isDirectory() ||
    metadata.isSymbolicLink() ||
    !pathsEqual(resolvedPath, canonicalPath)
  ) {
    throw new Error(invalidRuntimePathsCode);
  }
  return canonicalPath;
}

async function requireRegularFile(path: string): Promise<string> {
  const resolvedPath = resolve(path);
  const metadata = await lstat(resolvedPath);
  const canonicalPath = resolve(await realpath(resolvedPath));
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    metadata.nlink !== 1 ||
    !pathsEqual(resolvedPath, canonicalPath)
  ) {
    throw new Error(invalidRuntimePathsCode);
  }
  return canonicalPath;
}

function isStrictChild(parentPath: string, childPath: string): boolean {
  const child = relative(parentPath, childPath);
  return child.length > 0 && !child.startsWith('..') && !isAbsolute(child);
}

function pathsEqual(firstPath: string, secondPath: string): boolean {
  const first = resolve(firstPath);
  const second = resolve(secondPath);
  return process.platform === 'win32'
    ? first.toLowerCase() === second.toLowerCase()
    : first === second;
}
