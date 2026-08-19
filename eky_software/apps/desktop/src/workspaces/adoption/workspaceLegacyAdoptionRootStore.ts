import { createHash } from 'node:crypto';
import {
  chmod,
  constants,
  copyFile,
  lstat,
  mkdir,
  readdir,
  realpath,
  rename,
  rm,
  stat,
} from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';

import type { WorkspaceLegacyAdoptionSourceKind } from './workspaceLegacyAdoptionJournal.js';
import { WorkspaceLegacyAdoptionError } from './workspaceLegacyAdoptionError.js';
import type { WorkspaceLegacyAdoptionPaths } from './workspaceLegacyAdoptionPaths.js';

const maximumAdoptionFiles = 100_010;
const maximumAdoptionBytes = 32n * 1024n * 1024n * 1024n;
const workspaceOwnedEntryNames = Object.freeze([
  'data',
  'storage',
  'profile-backup-state',
  'recovery-points',
  'recovery-point-state',
  'private-backup-staging',
  'profile-restore-rollback',
  'failed-profile-restores',
  'private-backup-quarantine',
  'profile-restore-state',
  'secrets',
  'settings',
  'archive',
]);

interface AdoptionInventoryEntry {
  readonly relativePath: string;
  readonly kind: 'directory' | 'file';
  readonly size: bigint;
  readonly sha256: string | null;
}

export interface WorkspaceLegacyAdoptionRootPresence {
  readonly candidateExists: boolean;
  readonly finalExists: boolean;
}

export interface WorkspaceLegacyAdoptionRootPort {
  assertNoUntrackedWorkspaceRoots(
    paths: Readonly<WorkspaceLegacyAdoptionPaths>,
  ): Promise<void>;
  detectSourceKind(
    paths: Readonly<WorkspaceLegacyAdoptionPaths>,
  ): Promise<WorkspaceLegacyAdoptionSourceKind>;
  prepareCandidate(
    paths: Readonly<WorkspaceLegacyAdoptionPaths>,
    sourceKind: WorkspaceLegacyAdoptionSourceKind,
  ): Promise<void>;
  inspectCandidate(
    paths: Readonly<WorkspaceLegacyAdoptionPaths>,
    sourceKind: WorkspaceLegacyAdoptionSourceKind,
  ): Promise<void>;
  publishCandidate(paths: Readonly<WorkspaceLegacyAdoptionPaths>): Promise<void>;
  inspectPublished(
    paths: Readonly<WorkspaceLegacyAdoptionPaths>,
    sourceKind: WorkspaceLegacyAdoptionSourceKind,
  ): Promise<void>;
  readPresence(
    paths: Readonly<WorkspaceLegacyAdoptionPaths>,
  ): Promise<Readonly<WorkspaceLegacyAdoptionRootPresence>>;
  discardCandidate(paths: Readonly<WorkspaceLegacyAdoptionPaths>): Promise<void>;
}

export class NodeWorkspaceLegacyAdoptionRootStore
  implements WorkspaceLegacyAdoptionRootPort
{
  async assertNoUntrackedWorkspaceRoots(
    paths: Readonly<WorkspaceLegacyAdoptionPaths>,
  ): Promise<void> {
    try {
      await assertMissingOrEmptyDirectory(paths.workspacesRoot);
      await assertMissingOrEmptyDirectory(paths.operationsRoot);
    } catch (error) {
      throw mapRootError(error, 'WORKSPACE_ADOPTION_RECOVERY_REQUIRED');
    }
  }

  async detectSourceKind(
    paths: Readonly<WorkspaceLegacyAdoptionPaths>,
  ): Promise<WorkspaceLegacyAdoptionSourceKind> {
    try {
      if (!(await pathExists(paths.legacyRuntimeRoot))) return 'fresh';
      await assertRealDirectory(paths.legacyRuntimeRoot, false);
      const databasePath = join(paths.legacyRuntimeRoot, 'data', 'eky.sqlite');
      if (await pathExists(databasePath)) {
        await assertSafeRegularFile(databasePath);
        return 'legacy';
      }
      for (const entryName of workspaceOwnedEntryNames) {
        if (await pathExists(join(paths.legacyRuntimeRoot, entryName))) {
          throw new WorkspaceLegacyAdoptionError(
            'WORKSPACE_ADOPTION_RECOVERY_REQUIRED',
          );
        }
      }
      return 'fresh';
    } catch (error) {
      throw mapRootError(error);
    }
  }

  async prepareCandidate(
    paths: Readonly<WorkspaceLegacyAdoptionPaths>,
    sourceKind: WorkspaceLegacyAdoptionSourceKind,
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
      if (sourceKind === 'legacy') {
        const before = await inventoryLegacyWorkspaceEntries(
          paths.legacyRuntimeRoot,
        );
        await copyInventory(
          paths.legacyRuntimeRoot,
          paths.candidateRuntimeRoot,
          before,
        );
        const [after, candidate] = await Promise.all([
          inventoryLegacyWorkspaceEntries(paths.legacyRuntimeRoot),
          inventoryTree(paths.candidateRuntimeRoot),
        ]);
        assertInventoriesEqual(before, after);
        assertInventoriesEqual(before, candidate);
      } else {
        const dataRoot = join(paths.candidateRuntimeRoot, 'data');
        const storageRoot = join(paths.candidateRuntimeRoot, 'storage');
        await createPrivateDirectory(paths.candidateRuntimeRoot, dataRoot);
        await createPrivateDirectory(paths.candidateRuntimeRoot, storageRoot);
        await createPrivateDirectory(
          storageRoot,
          join(storageRoot, 'invoices'),
        );
      }
      await this.inspectCandidate(paths, sourceKind);
    } catch (error) {
      throw mapRootError(error);
    }
  }

  async inspectCandidate(
    paths: Readonly<WorkspaceLegacyAdoptionPaths>,
    sourceKind: WorkspaceLegacyAdoptionSourceKind,
  ): Promise<void> {
    try {
      await inspectWorkspaceRoot(
        paths.candidateRoot,
        paths.candidateRuntimeRoot,
        sourceKind,
      );
    } catch (error) {
      throw mapRootError(error);
    }
  }

  async publishCandidate(
    paths: Readonly<WorkspaceLegacyAdoptionPaths>,
  ): Promise<void> {
    try {
      await ensurePrivateDirectory(paths.userDataRoot, paths.workspacesRoot);
      await assertPathMissing(paths.finalRoot);
      await rename(paths.candidateRoot, paths.finalRoot);
    } catch (error) {
      throw mapRootError(error);
    }
  }

  async inspectPublished(
    paths: Readonly<WorkspaceLegacyAdoptionPaths>,
    sourceKind: WorkspaceLegacyAdoptionSourceKind,
  ): Promise<void> {
    try {
      await assertRealDirectory(paths.workspacesRoot, true);
      await inspectWorkspaceRoot(
        paths.finalRoot,
        join(paths.finalRoot, 'runtime'),
        sourceKind,
      );
    } catch (error) {
      throw mapRootError(error, 'WORKSPACE_ADOPTION_RECOVERY_REQUIRED');
    }
  }

  async readPresence(
    paths: Readonly<WorkspaceLegacyAdoptionPaths>,
  ): Promise<Readonly<WorkspaceLegacyAdoptionRootPresence>> {
    try {
      return Object.freeze({
        candidateExists: await pathExists(paths.candidateRoot),
        finalExists: await pathExists(paths.finalRoot),
      });
    } catch (error) {
      throw mapRootError(error, 'WORKSPACE_ADOPTION_RECOVERY_REQUIRED');
    }
  }

  async discardCandidate(
    paths: Readonly<WorkspaceLegacyAdoptionPaths>,
  ): Promise<void> {
    try {
      if (!(await pathExists(paths.operationRoot))) return;
      await assertRealDirectory(paths.operationRoot, true);
      const entries = await readdir(paths.operationRoot);
      if (
        entries.length > 1 ||
        (entries.length === 1 && entries[0] !== basename(paths.candidateRoot))
      ) {
        throw new Error('invalid');
      }
      if (entries.length === 1) await assertSafeTree(paths.candidateRoot);
      await rm(paths.operationRoot, { recursive: true });
    } catch (error) {
      throw mapRootError(error);
    }
  }
}

async function inspectWorkspaceRoot(
  workspaceRoot: string,
  runtimeRoot: string,
  sourceKind: WorkspaceLegacyAdoptionSourceKind,
): Promise<void> {
  await assertRealDirectory(workspaceRoot, true);
  await assertExactEntries(workspaceRoot, ['runtime']);
  await assertRealDirectory(runtimeRoot, true);
  await assertSafeTree(runtimeRoot);
  await assertRealDirectory(join(runtimeRoot, 'data'), true);
  await assertRealDirectory(join(runtimeRoot, 'storage'), true);
  await assertRealDirectory(join(runtimeRoot, 'storage', 'invoices'), true);
  if (sourceKind === 'legacy') {
    await assertSafeRegularFile(join(runtimeRoot, 'data', 'eky.sqlite'));
  }
}

async function inventoryLegacyWorkspaceEntries(
  runtimeRoot: string,
): Promise<readonly AdoptionInventoryEntry[]> {
  await assertRealDirectory(runtimeRoot, false);
  const inventory: AdoptionInventoryEntry[] = [];
  for (const entryName of workspaceOwnedEntryNames) {
    const entryPath = join(runtimeRoot, entryName);
    if (!(await pathExists(entryPath))) continue;
    await appendInventory(runtimeRoot, entryPath, inventory);
  }
  requireInventoryBounds(inventory);
  if (!inventory.some((entry) => entry.relativePath === 'data/eky.sqlite')) {
    throw new WorkspaceLegacyAdoptionError(
      'WORKSPACE_ADOPTION_RECOVERY_REQUIRED',
    );
  }
  return Object.freeze(inventory);
}

async function inventoryTree(
  runtimeRoot: string,
): Promise<readonly AdoptionInventoryEntry[]> {
  await assertRealDirectory(runtimeRoot, true);
  const inventory: AdoptionInventoryEntry[] = [];
  const presentEntries = await readdir(runtimeRoot);
  for (const entryName of presentEntries) {
    if (!workspaceOwnedEntryNames.includes(entryName)) throw new Error('invalid');
  }
  for (const entryName of workspaceOwnedEntryNames) {
    if (!presentEntries.includes(entryName)) continue;
    await appendInventory(runtimeRoot, join(runtimeRoot, entryName), inventory);
  }
  requireInventoryBounds(inventory);
  return Object.freeze(inventory);
}

async function appendInventory(
  root: string,
  path: string,
  inventory: AdoptionInventoryEntry[],
): Promise<void> {
  const metadata = await lstat(path);
  if (metadata.isSymbolicLink() || !pathsEqual(await realpath(path), path)) {
    throw new Error('invalid');
  }
  const relativePath = relative(root, path).replaceAll('\\', '/');
  if (
    relativePath.length < 1 ||
    relativePath.startsWith('../') ||
    relativePath.includes('\0')
  ) {
    throw new Error('invalid');
  }
  if (metadata.isDirectory()) {
    if (process.platform !== 'win32' && (metadata.mode & 0o077) !== 0) {
      throw new Error('invalid');
    }
    inventory.push({
      relativePath,
      kind: 'directory',
      size: 0n,
      sha256: null,
    });
    requireInventoryBounds(inventory);
    const entries = (await readdir(path)).sort();
    for (const entry of entries) {
      await appendInventory(root, join(path, entry), inventory);
    }
    return;
  }
  if (!metadata.isFile() || metadata.nlink !== 1) throw new Error('invalid');
  inventory.push({
    relativePath,
    kind: 'file',
    size: BigInt(metadata.size),
    sha256: await hashFile(path),
  });
  requireInventoryBounds(inventory);
}

async function copyInventory(
  sourceRoot: string,
  destinationRoot: string,
  inventory: readonly AdoptionInventoryEntry[],
): Promise<void> {
  for (const entry of inventory) {
    const sourcePath = join(sourceRoot, ...entry.relativePath.split('/'));
    const destinationPath = join(
      destinationRoot,
      ...entry.relativePath.split('/'),
    );
    if (entry.kind === 'directory') {
      await mkdir(destinationPath, { mode: 0o700 });
      if (process.platform !== 'win32') await chmod(destinationPath, 0o700);
      continue;
    }
    await assertRealDirectory(dirname(destinationPath), true);
    await copyFile(sourcePath, destinationPath, constants.COPYFILE_EXCL);
    if (process.platform !== 'win32') await chmod(destinationPath, 0o600);
  }
}

function assertInventoriesEqual(
  expected: readonly AdoptionInventoryEntry[],
  actual: readonly AdoptionInventoryEntry[],
): void {
  if (expected.length !== actual.length) throw new Error('invalid');
  for (let index = 0; index < expected.length; index += 1) {
    const left = expected[index];
    const right = actual[index];
    if (
      left === undefined ||
      right === undefined ||
      left.relativePath !== right.relativePath ||
      left.kind !== right.kind ||
      left.size !== right.size ||
      left.sha256 !== right.sha256
    ) {
      throw new Error('invalid');
    }
  }
}

function requireInventoryBounds(
  inventory: readonly AdoptionInventoryEntry[],
): void {
  const totalBytes = inventory.reduce((sum, entry) => sum + entry.size, 0n);
  if (
    inventory.length > maximumAdoptionFiles ||
    totalBytes > maximumAdoptionBytes
  ) {
    throw new Error('invalid');
  }
}

async function hashFile(path: string): Promise<string> {
  const before = await stat(path);
  if (!before.isFile() || before.nlink !== 1) throw new Error('invalid');
  const hash = createHash('sha256');
  await new Promise<void>((resolvePromise, reject) => {
    const stream = createReadStream(path);
    stream.on('data', (chunk: Buffer | string) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', resolvePromise);
  });
  const after = await stat(path);
  if (
    before.size !== after.size ||
    before.mtimeMs !== after.mtimeMs ||
    after.nlink !== 1
  ) {
    throw new Error('invalid');
  }
  return hash.digest('hex');
}

async function assertSafeTree(path: string): Promise<void> {
  const metadata = await lstat(path);
  if (metadata.isSymbolicLink() || !pathsEqual(await realpath(path), path)) {
    throw new Error('invalid');
  }
  if (metadata.isDirectory()) {
    if (process.platform !== 'win32' && (metadata.mode & 0o077) !== 0) {
      throw new Error('invalid');
    }
    for (const entry of await readdir(path)) {
      await assertSafeTree(join(path, entry));
    }
    return;
  }
  if (!metadata.isFile() || metadata.nlink !== 1) throw new Error('invalid');
}

async function assertSafeRegularFile(path: string): Promise<void> {
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
  if (await pathExists(path)) {
    throw new WorkspaceLegacyAdoptionError(
      'WORKSPACE_ADOPTION_RECOVERY_REQUIRED',
    );
  }
}

async function assertMissingOrEmptyDirectory(path: string): Promise<void> {
  if (!(await pathExists(path))) return;
  await assertRealDirectory(path, true);
  if ((await readdir(path)).length !== 0) {
    throw new WorkspaceLegacyAdoptionError(
      'WORKSPACE_ADOPTION_RECOVERY_REQUIRED',
    );
  }
}

async function pathExists(path: string): Promise<boolean> {
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
  return process.platform === 'win32'
    ? left.toLowerCase() === right.toLowerCase()
    : left === right;
}

function mapRootError(
  error: unknown,
  fallback: 'WORKSPACE_ADOPTION_STORAGE_FAILED' | 'WORKSPACE_ADOPTION_RECOVERY_REQUIRED' =
    'WORKSPACE_ADOPTION_STORAGE_FAILED',
): WorkspaceLegacyAdoptionError {
  return error instanceof WorkspaceLegacyAdoptionError
    ? error
    : new WorkspaceLegacyAdoptionError(fallback);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
