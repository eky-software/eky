import {
  chmod,
  lstat,
  mkdir,
  readdir,
  realpath,
  rm,
} from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

import type { WorkspaceBackupReplacementRootStore } from './workspaceBackupReplacementPorts.js';
import type { WorkspaceBackupReplacementPaths } from './workspaceBackupReplacementPaths.js';
import {
  mapWorkspaceBackupReplacementError,
  WorkspaceBackupReplacementError,
} from './workspaceBackupReplacementError.js';

export class NodeWorkspaceBackupReplacementRootStore
  implements WorkspaceBackupReplacementRootStore
{
  async prepareCandidate(
    paths: Readonly<WorkspaceBackupReplacementPaths>,
  ): Promise<void> {
    try {
      await assertRealDirectory(paths.userDataRoot, false);
      await assertWorkspaceLayout(paths);
      await ensurePrivateDirectory(paths.userDataRoot, paths.operationsRoot);
      await ensurePrivateDirectory(paths.operationsRoot, paths.importRoot);
      await ensurePrivateDirectory(paths.operationsRoot, paths.activationRoot);
      await ensurePrivateDirectory(
        paths.activationRoot,
        paths.activationStagingRoot,
      );
      await ensurePrivateDirectory(
        paths.activationRoot,
        paths.activationRollbackRoot,
      );
      await ensurePrivateDirectory(
        paths.activationRoot,
        paths.activationFailedRoot,
      );
      await assertPathMissing(paths.importStagingRoot);
      await assertPathMissing(paths.activationStagingOperationRoot);
      await assertPathMissing(
        join(
          paths.activationRollbackRoot,
          operationIdFromPath(paths.activationStagingOperationRoot),
        ),
      );
      await assertPathMissing(
        join(
          paths.activationFailedRoot,
          operationIdFromPath(paths.activationStagingOperationRoot),
        ),
      );
      await createPrivateDirectory(
        paths.activationStagingRoot,
        paths.activationStagingOperationRoot,
      );
      const activationDocumentsRoot = dirname(
        dirname(paths.candidateArtifactRoot),
      );
      const activationStorageRoot = dirname(paths.candidateArtifactRoot);
      await createPrivateDirectory(
        paths.activationStagingOperationRoot,
        activationDocumentsRoot,
      );
      await createPrivateDirectory(
        activationDocumentsRoot,
        activationStorageRoot,
      );
      await createPrivateDirectory(
        activationStorageRoot,
        paths.candidateArtifactRoot,
      );
    } catch (error) {
      throw mapWorkspaceBackupReplacementError(
        error,
        'WORKSPACE_REPLACEMENT_STORAGE_FAILED',
        'candidateRoot',
      );
    }
  }

  async removeImportStaging(
    paths: Readonly<WorkspaceBackupReplacementPaths>,
  ): Promise<void> {
    try {
      await assertSafeTree(paths.importStagingRoot);
      await rm(paths.importStagingRoot, { recursive: true });
    } catch (error) {
      throw mapWorkspaceBackupReplacementError(
        error,
        'WORKSPACE_REPLACEMENT_STORAGE_FAILED',
        'cleanup',
      );
    }
  }

  async inspectCandidate(
    paths: Readonly<WorkspaceBackupReplacementPaths>,
  ): Promise<void> {
    try {
      await assertRealDirectory(
        paths.activationStagingOperationRoot,
        true,
      );
      await assertExactEntries(paths.activationStagingOperationRoot, [
        'activation',
        'profile.sqlite',
      ]);
      await assertRegularFile(paths.candidateDatabasePath);
      const activationDocumentsRoot = dirname(
        dirname(paths.candidateArtifactRoot),
      );
      const activationStorageRoot = dirname(paths.candidateArtifactRoot);
      await assertRealDirectory(activationDocumentsRoot, true);
      await assertRealDirectory(activationStorageRoot, true);
      await assertRealDirectory(paths.candidateArtifactRoot, true);
      await assertExactEntries(activationDocumentsRoot, ['storage']);
      await assertExactEntries(activationStorageRoot, ['invoices']);
      await assertSafeTree(paths.candidateArtifactRoot);
    } catch (error) {
      throw mapWorkspaceBackupReplacementError(
        error,
        'WORKSPACE_REPLACEMENT_STORAGE_FAILED',
        'candidateValidation',
      );
    }
  }

  async discardBeforeActivation(
    paths: Readonly<WorkspaceBackupReplacementPaths>,
  ): Promise<void> {
    try {
      if (await safePathExists(paths.importStagingRoot)) {
        await assertSafeTree(paths.importStagingRoot);
        await rm(paths.importStagingRoot, { recursive: true });
      }
      if (await safePathExists(paths.activationStagingOperationRoot)) {
        await assertPartialCandidate(paths);
        await rm(paths.activationStagingOperationRoot, {
          recursive: true,
        });
      }
    } catch (error) {
      throw mapWorkspaceBackupReplacementError(
        error,
        'WORKSPACE_REPLACEMENT_STORAGE_FAILED',
        'cleanup',
      );
    }
  }
}

async function assertWorkspaceLayout(
  paths: Readonly<WorkspaceBackupReplacementPaths>,
): Promise<void> {
  const runtimeRoot = join(paths.targetWorkspaceRoot, 'runtime');
  const dataRoot = dirname(paths.activeDatabasePath);
  const storageRoot = dirname(paths.activeArtifactRoot);
  await assertRealDirectory(paths.targetWorkspaceRoot, true);
  await assertRealDirectory(runtimeRoot, true);
  await assertRealDirectory(dataRoot, true);
  await assertRealDirectory(storageRoot, true);
  await assertRegularFile(paths.activeDatabasePath);
  await assertSafeTree(paths.activeArtifactRoot);
}

async function assertPartialCandidate(
  paths: Readonly<WorkspaceBackupReplacementPaths>,
): Promise<void> {
  await assertRealDirectory(paths.activationStagingOperationRoot, true);
  const entries = await readdir(paths.activationStagingOperationRoot);
  if (entries.some((entry) => !['activation', 'profile.sqlite'].includes(entry))) {
    throw new Error('invalid');
  }
  if (await safePathExists(paths.candidateDatabasePath)) {
    await assertRegularFile(paths.candidateDatabasePath);
  }
  const activationRoot = join(
    paths.activationStagingOperationRoot,
    'activation',
  );
  if (await safePathExists(activationRoot)) {
    await assertSafeTree(activationRoot);
  }
}

async function assertSafeTree(path: string): Promise<void> {
  const metadata = await lstat(path);
  if (metadata.isSymbolicLink()) throw new Error('invalid');
  if (metadata.isDirectory()) {
    if (
      (process.platform !== 'win32' && (metadata.mode & 0o077) !== 0) ||
      !pathsEqual(await realpath(path), path)
    ) {
      throw new Error('invalid');
    }
    for (const entry of await readdir(path)) {
      await assertSafeTree(join(path, entry));
    }
    return;
  }
  if (
    !metadata.isFile() ||
    metadata.nlink !== 1 ||
    !pathsEqual(await realpath(path), path)
  ) {
    throw new Error('invalid');
  }
}

async function assertRegularFile(path: string): Promise<void> {
  const metadata = await lstat(path);
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    metadata.nlink !== 1 ||
    metadata.size < 1 ||
    !pathsEqual(await realpath(path), path)
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

async function assertPathMissing(path: string): Promise<void> {
  if (await safePathExists(path)) {
    throw new WorkspaceBackupReplacementError(
      'WORKSPACE_REPLACEMENT_OPERATION_UNRESOLVED',
      'candidateRoot',
    );
  }
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

function operationIdFromPath(path: string): string {
  const segments = resolve(path).split(/[\\/]/u);
  const operationId = segments.at(-1);
  if (operationId === undefined || operationId.length === 0) {
    throw new Error('invalid');
  }
  return operationId;
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
