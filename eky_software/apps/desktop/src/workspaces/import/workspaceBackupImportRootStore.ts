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
  WorkspaceBackupImportError,
  mapWorkspaceBackupImportError,
} from './workspaceBackupImportError.js';
import type { WorkspaceBackupImportPaths } from './workspaceBackupImportPaths.js';

export interface WorkspaceBackupImportRootPresence {
  readonly candidateExists: boolean;
  readonly finalExists: boolean;
}

export interface WorkspaceBackupImportRootStore {
  createCandidate(paths: Readonly<WorkspaceBackupImportPaths>): Promise<void>;
  removeImportStaging(
    paths: Readonly<WorkspaceBackupImportPaths>,
  ): Promise<void>;
  inspectCandidate(paths: Readonly<WorkspaceBackupImportPaths>): Promise<void>;
  publishCandidate(paths: Readonly<WorkspaceBackupImportPaths>): Promise<void>;
  inspectPublished(paths: Readonly<WorkspaceBackupImportPaths>): Promise<void>;
  cleanupPublishedOperation(
    paths: Readonly<WorkspaceBackupImportPaths>,
  ): Promise<void>;
  readPresence(
    paths: Readonly<WorkspaceBackupImportPaths>,
  ): Promise<Readonly<WorkspaceBackupImportRootPresence>>;
  discardCandidate(paths: Readonly<WorkspaceBackupImportPaths>): Promise<void>;
}

export class NodeWorkspaceBackupImportRootStore
  implements WorkspaceBackupImportRootStore
{
  async createCandidate(
    paths: Readonly<WorkspaceBackupImportPaths>,
  ): Promise<void> {
    try {
      await assertRealDirectory(paths.userDataRoot, false);
      await ensurePrivateDirectory(paths.userDataRoot, paths.operationsRoot);
      await assertPathMissing(paths.finalRoot);
      await createPrivateDirectory(paths.operationsRoot, paths.operationRoot);
      await createPrivateDirectory(paths.operationRoot, paths.candidateRoot);
      await createPrivateDirectory(paths.candidateRoot, paths.candidateRuntimeRoot);
      const dataRoot = dirname(paths.databaseFilePath);
      const storageRoot = dirname(paths.artifactRoot);
      await createPrivateDirectory(paths.candidateRuntimeRoot, dataRoot);
      await createPrivateDirectory(paths.candidateRuntimeRoot, storageRoot);
      await createPrivateDirectory(storageRoot, paths.artifactRoot);
    } catch (error) {
      throw mapWorkspaceBackupImportError(
        error,
        'WORKSPACE_IMPORT_STORAGE_FAILED',
        'candidateRoot',
      );
    }
  }

  async removeImportStaging(
    paths: Readonly<WorkspaceBackupImportPaths>,
  ): Promise<void> {
    try {
      await assertSafeTree(paths.importStagingRoot);
      await rm(paths.importStagingRoot, { recursive: true });
    } catch (error) {
      throw mapWorkspaceBackupImportError(error, 'WORKSPACE_IMPORT_STORAGE_FAILED', 'cleanup');
    }
  }

  async inspectCandidate(
    paths: Readonly<WorkspaceBackupImportPaths>,
  ): Promise<void> {
    try {
      await inspectWorkspaceLayout(paths.candidateRoot, paths.databaseFilePath, paths.artifactRoot);
    } catch (error) {
      throw mapWorkspaceBackupImportError(
        error,
        'WORKSPACE_IMPORT_STORAGE_FAILED',
        'candidateValidation',
      );
    }
  }

  async publishCandidate(
    paths: Readonly<WorkspaceBackupImportPaths>,
  ): Promise<void> {
    try {
      await this.inspectCandidate(paths);
      await ensurePrivateDirectory(paths.userDataRoot, paths.workspacesRoot);
      await assertPathMissing(paths.finalRoot);
      await rename(paths.candidateRoot, paths.finalRoot);
    } catch (error) {
      throw mapWorkspaceBackupImportError(error, 'WORKSPACE_IMPORT_STORAGE_FAILED', 'rootPublish');
    }
  }

  async inspectPublished(
    paths: Readonly<WorkspaceBackupImportPaths>,
  ): Promise<void> {
    try {
      await assertRealDirectory(paths.workspacesRoot, true);
      await inspectWorkspaceLayout(
        paths.finalRoot,
        paths.publishedDatabaseFilePath,
        paths.publishedArtifactRoot,
      );
    } catch (error) {
      throw mapWorkspaceBackupImportError(error, 'WORKSPACE_IMPORT_RECOVERY_REQUIRED', 'recovery');
    }
  }

  async cleanupPublishedOperation(
    paths: Readonly<WorkspaceBackupImportPaths>,
  ): Promise<void> {
    try {
      if (!(await safePathExists(paths.operationRoot))) return;
      await removeEmptyRealDirectory(paths.operationRoot);
    } catch (error) {
      throw mapWorkspaceBackupImportError(error, 'WORKSPACE_IMPORT_STORAGE_FAILED', 'cleanup');
    }
  }

  async readPresence(
    paths: Readonly<WorkspaceBackupImportPaths>,
  ): Promise<Readonly<WorkspaceBackupImportRootPresence>> {
    try {
      return Object.freeze({
        candidateExists: await safePathExists(paths.candidateRoot),
        finalExists: await safePathExists(paths.finalRoot),
      });
    } catch (error) {
      throw mapWorkspaceBackupImportError(error, 'WORKSPACE_IMPORT_RECOVERY_REQUIRED', 'recovery');
    }
  }

  async discardCandidate(paths: Readonly<WorkspaceBackupImportPaths>): Promise<void> {
    try {
      if (!(await safePathExists(paths.operationRoot))) return;
      await assertPartialOperationTree(paths);
      await rm(paths.operationRoot, { recursive: true });
    } catch (error) {
      throw mapWorkspaceBackupImportError(error, 'WORKSPACE_IMPORT_STORAGE_FAILED', 'cleanup');
    }
  }
}

async function inspectWorkspaceLayout(
  workspaceRoot: string,
  databasePath: string,
  artifactRoot: string,
): Promise<void> {
  const runtimeRoot = join(workspaceRoot, 'runtime');
  const dataRoot = join(runtimeRoot, 'data');
  const storageRoot = join(runtimeRoot, 'storage');
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
  const database = await lstat(databasePath);
  if (
    !database.isFile() ||
    database.isSymbolicLink() ||
    database.nlink !== 1 ||
    database.size < 1 ||
    !pathsEqual(await realpath(databasePath), databasePath)
  ) {
    throw new Error('invalid');
  }
  await assertSafeTree(artifactRoot);
}

async function assertPartialOperationTree(
  paths: Readonly<WorkspaceBackupImportPaths>,
): Promise<void> {
  await assertRealDirectory(paths.operationRoot, true);
  const entries = await readdir(paths.operationRoot);
  if (
    entries.length > 1 ||
    (entries.length === 1 && entries[0] !== basename(paths.candidateRoot))
  ) {
    throw new Error('invalid');
  }
  if (entries.length === 0) return;

  await assertPartialDirectory(paths.candidateRoot, [
    'import-staging',
    'runtime',
  ]);
  if (await safePathExists(paths.importStagingRoot)) {
    await assertSafeTree(paths.importStagingRoot);
  }

  if (!(await safePathExists(paths.candidateRuntimeRoot))) return;
  await assertPartialDirectory(paths.candidateRuntimeRoot, ['data', 'storage']);

  const dataRoot = dirname(paths.databaseFilePath);
  if (await safePathExists(dataRoot)) {
    await assertPartialDirectory(dataRoot, ['eky.sqlite']);
    if (await safePathExists(paths.databaseFilePath)) {
      const database = await lstat(paths.databaseFilePath);
      if (
        !database.isFile() ||
        database.isSymbolicLink() ||
        database.nlink !== 1 ||
        !pathsEqual(await realpath(paths.databaseFilePath), paths.databaseFilePath)
      ) {
        throw new Error('invalid');
      }
    }
  }

  const storageRoot = dirname(paths.artifactRoot);
  if (await safePathExists(storageRoot)) {
    await assertPartialDirectory(storageRoot, ['invoices']);
    if (await safePathExists(paths.artifactRoot)) {
      await assertSafeTree(paths.artifactRoot);
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

async function assertSafeTree(path: string): Promise<void> {
  const metadata = await lstat(path);
  if (metadata.isSymbolicLink()) throw new Error('invalid');
  if (metadata.isDirectory()) {
    if (process.platform !== 'win32' && (metadata.mode & 0o077) !== 0) throw new Error('invalid');
    if (!pathsEqual(await realpath(path), path)) throw new Error('invalid');
    const entries = await readdir(path);
    for (const entry of entries) await assertSafeTree(join(path, entry));
    return;
  }
  if (!metadata.isFile() || metadata.nlink !== 1 || !pathsEqual(await realpath(path), path)) {
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

async function assertExactEntries(
  path: string,
  expectedEntries: readonly string[],
): Promise<void> {
  const actual = (await readdir(path)).sort();
  const expected = [...expectedEntries].sort();
  if (
    actual.length !== expected.length ||
    actual.some((entry, index) => entry !== expected[index])
  ) {
    throw new Error('invalid');
  }
}

async function removeEmptyRealDirectory(path: string): Promise<void> {
  await assertRealDirectory(path, true);
  if ((await readdir(path)).length !== 0) throw new Error('invalid');
  await rmdir(path);
}

async function assertPathMissing(path: string): Promise<void> {
  try {
    await lstat(path);
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return;
    throw error;
  }
  throw new WorkspaceBackupImportError('WORKSPACE_IMPORT_CONFLICT', 'candidateRoot');
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

function pathsEqual(first: string, second: string): boolean {
  const left = resolve(first);
  const right = resolve(second);
  return process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
