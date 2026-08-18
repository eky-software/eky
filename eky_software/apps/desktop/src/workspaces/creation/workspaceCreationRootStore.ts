import {
  chmod,
  lstat,
  mkdir,
  readdir,
  realpath,
  rename,
  rm,
  rmdir,
} from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';

import {
  EmptyWorkspaceCreationError,
  mapEmptyWorkspaceCreationError,
} from './emptyWorkspaceCreationError.js';
import type { WorkspaceCreationPaths } from './workspaceCreationPaths.js';

export interface WorkspaceCreationRootPresence {
  readonly candidateExists: boolean;
  readonly finalExists: boolean;
}

export interface WorkspaceCreationRootStore {
  createCandidate(paths: Readonly<WorkspaceCreationPaths>): Promise<void>;
  inspectCandidate(paths: Readonly<WorkspaceCreationPaths>): Promise<void>;
  publishCandidate(paths: Readonly<WorkspaceCreationPaths>): Promise<void>;
  inspectPublished(paths: Readonly<WorkspaceCreationPaths>): Promise<void>;
  cleanupPublishedOperation(
    paths: Readonly<WorkspaceCreationPaths>,
  ): Promise<void>;
  readPresence(
    paths: Readonly<WorkspaceCreationPaths>,
  ): Promise<Readonly<WorkspaceCreationRootPresence>>;
  discardCandidate(paths: Readonly<WorkspaceCreationPaths>): Promise<void>;
}

export class NodeWorkspaceCreationRootStore
  implements WorkspaceCreationRootStore {
  async createCandidate(
    paths: Readonly<WorkspaceCreationPaths>,
  ): Promise<void> {
    try {
      await assertRealDirectory(paths.userDataRoot, false);
      await ensurePrivateDirectory(paths.userDataRoot, paths.operationsRoot);
      await assertPathMissing(paths.finalRoot);
      await createPrivateDirectory(paths.operationsRoot, paths.operationRoot);
      await createPrivateDirectory(paths.operationRoot, paths.candidateRoot);
      await createPrivateDirectory(
        paths.candidateRoot,
        paths.candidateRuntimeRoot,
      );
      const dataRoot = dirname(paths.databaseFilePath);
      const storageRoot = dirname(paths.artifactRoot);
      await createPrivateDirectory(paths.candidateRuntimeRoot, dataRoot);
      await createPrivateDirectory(paths.candidateRuntimeRoot, storageRoot);
      await createPrivateDirectory(storageRoot, paths.artifactRoot);
    } catch (error) {
      throw mapEmptyWorkspaceCreationError(
        error,
        'WORKSPACE_CREATION_STORAGE_FAILED',
        'candidateRoot',
      );
    }
  }

  async inspectCandidate(
    paths: Readonly<WorkspaceCreationPaths>,
  ): Promise<void> {
    try {
      await inspectWorkspaceLayout(paths.candidateRoot, paths.databaseFilePath);
      if (!pathsEqual(await realpath(paths.artifactRoot), paths.artifactRoot)) {
        throw new Error('invalid');
      }
    } catch (error) {
      throw mapEmptyWorkspaceCreationError(
        error,
        'WORKSPACE_CREATION_STORAGE_FAILED',
        'candidateValidation',
      );
    }
  }

  async publishCandidate(
    paths: Readonly<WorkspaceCreationPaths>,
  ): Promise<void> {
    try {
      await this.inspectCandidate(paths);
      await ensurePrivateDirectory(paths.userDataRoot, paths.workspacesRoot);
      await assertPathMissing(paths.finalRoot);
      await rename(paths.candidateRoot, paths.finalRoot);
    } catch (error) {
      throw mapEmptyWorkspaceCreationError(
        error,
        'WORKSPACE_CREATION_STORAGE_FAILED',
        'rootPublish',
      );
    }
  }

  async cleanupPublishedOperation(
    paths: Readonly<WorkspaceCreationPaths>,
  ): Promise<void> {
    try {
      if (!(await safePathExists(paths.operationRoot))) return;
      await removeEmptyRealDirectory(paths.operationRoot);
    } catch (error) {
      throw mapEmptyWorkspaceCreationError(
        error,
        'WORKSPACE_CREATION_STORAGE_FAILED',
        'cleanup',
      );
    }
  }

  async inspectPublished(
    paths: Readonly<WorkspaceCreationPaths>,
  ): Promise<void> {
    try {
      await assertRealDirectory(paths.workspacesRoot, true);
      await inspectWorkspaceLayout(
        paths.finalRoot,
        join(paths.finalRoot, 'runtime', 'data', 'eky.sqlite'),
      );
    } catch (error) {
      throw mapEmptyWorkspaceCreationError(
        error,
        'WORKSPACE_CREATION_RECOVERY_REQUIRED',
        'recovery',
      );
    }
  }

  async readPresence(
    paths: Readonly<WorkspaceCreationPaths>,
  ): Promise<Readonly<WorkspaceCreationRootPresence>> {
    try {
      return Object.freeze({
        candidateExists: await safePathExists(paths.candidateRoot),
        finalExists: await safePathExists(paths.finalRoot),
      });
    } catch (error) {
      throw mapEmptyWorkspaceCreationError(
        error,
        'WORKSPACE_CREATION_RECOVERY_REQUIRED',
        'recovery',
      );
    }
  }

  async discardCandidate(
    paths: Readonly<WorkspaceCreationPaths>,
  ): Promise<void> {
    try {
      if (!(await safePathExists(paths.operationRoot))) return;
      await assertSafePartialOperationTree(paths);
      await rm(paths.operationRoot, { recursive: true });
    } catch (error) {
      throw mapEmptyWorkspaceCreationError(
        error,
        'WORKSPACE_CREATION_STORAGE_FAILED',
        'cleanup',
      );
    }
  }
}

async function inspectWorkspaceLayout(
  workspaceRoot: string,
  databaseFilePath: string,
): Promise<void> {
  const runtimeRoot = join(workspaceRoot, 'runtime');
  const dataRoot = join(runtimeRoot, 'data');
  const storageRoot = join(runtimeRoot, 'storage');
  const artifactRoot = join(storageRoot, 'invoices');
  await Promise.all([
    assertRealDirectory(workspaceRoot, true),
    assertRealDirectory(runtimeRoot, true),
    assertRealDirectory(dataRoot, true),
    assertRealDirectory(storageRoot, true),
    assertRealDirectory(artifactRoot, true),
  ]);
  await assertExactEntries(workspaceRoot, ['runtime']);
  await assertExactEntries(runtimeRoot, ['data', 'storage']);
  await assertExactEntries(dataRoot, ['eky.sqlite']);
  await assertExactEntries(storageRoot, ['invoices']);
  await assertExactEntries(artifactRoot, []);
  const metadata = await lstat(databaseFilePath);
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    metadata.nlink !== 1 ||
    metadata.size < 1 ||
    !pathsEqual(await realpath(databaseFilePath), databaseFilePath)
  ) {
    throw new Error('invalid');
  }
}

async function assertSafePartialOperationTree(
  paths: Readonly<WorkspaceCreationPaths>,
): Promise<void> {
  await assertRealDirectory(paths.operationRoot, true);
  const operationEntries = await readdir(paths.operationRoot);
  if (
    operationEntries.length > 1 ||
    (operationEntries.length === 1 &&
      operationEntries[0] !== basename(paths.candidateRoot))
  ) {
    throw new Error('invalid');
  }
  if (operationEntries.length === 0) return;
  await assertPartialDirectory(paths.candidateRoot, ['runtime']);
  const runtimeRoot = paths.candidateRuntimeRoot;
  if (!(await safePathExists(runtimeRoot))) return;
  await assertPartialDirectory(runtimeRoot, ['data', 'storage']);
  const dataRoot = dirname(paths.databaseFilePath);
  if (await safePathExists(dataRoot)) {
    await assertPartialDirectory(dataRoot, ['eky.sqlite']);
    if (await safePathExists(paths.databaseFilePath)) {
      const database = await lstat(paths.databaseFilePath);
      if (
        !database.isFile() ||
        database.isSymbolicLink() ||
        database.nlink !== 1
      ) {
        throw new Error('invalid');
      }
    }
  }
  const storageRoot = dirname(paths.artifactRoot);
  if (await safePathExists(storageRoot)) {
    await assertPartialDirectory(storageRoot, ['invoices']);
    if (await safePathExists(paths.artifactRoot)) {
      await assertPartialDirectory(paths.artifactRoot, []);
    }
  }
}

async function assertPartialDirectory(
  path: string,
  allowedEntries: readonly string[],
): Promise<void> {
  await assertRealDirectory(path, true);
  const entries = await readdir(path);
  if (entries.some((entry) => !allowedEntries.includes(entry))) {
    throw new Error('invalid');
  }
}

async function assertExactEntries(
  path: string,
  expectedEntries: readonly string[],
): Promise<void> {
  const entries = (await readdir(path)).sort();
  const expected = [...expectedEntries].sort();
  if (
    entries.length !== expected.length ||
    entries.some((entry, index) => entry !== expected[index])
  ) {
    throw new Error('invalid');
  }
}

async function ensurePrivateDirectory(
  parentPath: string,
  directoryPath: string,
): Promise<void> {
  await assertRealDirectory(parentPath, false);
  try {
    await mkdir(directoryPath, { mode: 0o700 });
  } catch (error) {
    if (!isNodeError(error) || error.code !== 'EEXIST') throw error;
  }
  if (process.platform !== 'win32') await chmod(directoryPath, 0o700);
  await assertRealDirectory(directoryPath, true);
}

async function createPrivateDirectory(
  parentPath: string,
  directoryPath: string,
): Promise<void> {
  await assertRealDirectory(parentPath, true);
  await mkdir(directoryPath, { mode: 0o700 });
  if (process.platform !== 'win32') await chmod(directoryPath, 0o700);
  await assertRealDirectory(directoryPath, true);
}

async function removeEmptyRealDirectory(path: string): Promise<void> {
  await assertRealDirectory(path, true);
  if ((await readdir(path)).length !== 0) throw new Error('invalid');
  await rmdir(path);
}

async function assertRealDirectory(
  path: string,
  requirePrivateMode: boolean,
): Promise<void> {
  const metadata = await lstat(path);
  if (
    !metadata.isDirectory() ||
    metadata.isSymbolicLink() ||
    (requirePrivateMode &&
      process.platform !== 'win32' &&
      (metadata.mode & 0o077) !== 0) ||
    !pathsEqual(await realpath(path), path)
  ) {
    throw new Error('invalid');
  }
}

async function assertPathMissing(path: string): Promise<void> {
  try {
    await lstat(path);
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return;
    throw error;
  }
  throw new EmptyWorkspaceCreationError(
    'WORKSPACE_CREATION_CONFLICT',
    'candidateRoot',
  );
}

async function safePathExists(path: string): Promise<boolean> {
  try {
    const metadata = await lstat(path);
    if (metadata.isSymbolicLink()) throw new Error('invalid');
    return true;
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return false;
    throw error;
  }
}

function pathsEqual(firstPath: string, secondPath: string): boolean {
  const first = resolve(firstPath);
  const second = resolve(secondPath);
  return process.platform === 'win32'
    ? first.toLowerCase() === second.toLowerCase()
    : first === second;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
