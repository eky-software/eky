import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
} from 'node:fs/promises';
import {
  basename,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from 'node:path';

import { writeExclusiveSyncedFile } from './localUpdateFileOperations.js';

const rollbackRuntimeDirectoryPrefix = 'operation-';
const rollbackRuntimeDirectoryPattern = /^operation-[A-Za-z0-9]{6}$/u;
const rollbackRuntimeFileMaximumBytes = 256 * 1024;
const rollbackRuntimeFileNames = Object.freeze([
  'rollbackWindowsInstallerLauncher.cmd',
  'rollbackWindowsInstallerLauncher.ps1',
  'rollbackWindowsInstaller.ps1',
] as const);
const rollbackScriptFileName = 'rollbackWindowsInstaller.ps1';

export interface WindowsInstallerRollbackRuntimeInput {
  packagedRuntimeRoot: string;
  privateRuntimeRoot: string;
}

export interface PreparedWindowsInstallerRollbackRuntime {
  rollbackScriptPath: string;
}

export class WindowsInstallerRollbackRuntimeError extends Error {
  constructor() {
    super('The Windows installer rollback runtime could not be prepared safely.');
    this.name = 'WindowsInstallerRollbackRuntimeError';
  }
}

export async function prepareWindowsInstallerRollbackRuntime(
  input: Readonly<WindowsInstallerRollbackRuntimeInput>,
): Promise<Readonly<PreparedWindowsInstallerRollbackRuntime>> {
  let operationRoot: string | undefined;
  try {
    const packagedRuntimeRoot = requireAbsoluteCanonicalPath(
      input.packagedRuntimeRoot,
    );
    const privateRuntimeRoot = requireAbsoluteCanonicalPath(
      input.privateRuntimeRoot,
    );
    assertSeparateRoots(packagedRuntimeRoot, privateRuntimeRoot);
    await assertCanonicalDirectory(packagedRuntimeRoot);
    await ensurePrivateRuntimeRoot(privateRuntimeRoot);
    await removePreviousOwnedOperations(privateRuntimeRoot);

    operationRoot = await mkdtemp(
      join(privateRuntimeRoot, rollbackRuntimeDirectoryPrefix),
    );
    await assertCanonicalDirectory(operationRoot);

    for (const fileName of rollbackRuntimeFileNames) {
      const sourcePath = join(packagedRuntimeRoot, fileName);
      const destinationPath = join(operationRoot, fileName);
      const sourceBytes = await readValidatedRuntimeFile(sourcePath, fileName);
      await writeExclusiveSyncedFile(destinationPath, sourceBytes);
      const destinationBytes = await readValidatedRuntimeFile(
        destinationPath,
        fileName,
      );
      if (!sourceBytes.equals(destinationBytes)) {
        throw new WindowsInstallerRollbackRuntimeError();
      }
    }

    return Object.freeze({
      rollbackScriptPath: join(operationRoot, rollbackScriptFileName),
    });
  } catch (error) {
    if (operationRoot !== undefined) {
      await removeOwnedOperationIfPresent(operationRoot).catch(() => undefined);
    }
    if (error instanceof WindowsInstallerRollbackRuntimeError) {
      throw error;
    }
    throw new WindowsInstallerRollbackRuntimeError();
  }
}

async function ensurePrivateRuntimeRoot(path: string): Promise<void> {
  await mkdir(path, { mode: 0o700, recursive: true });
  await assertCanonicalDirectory(path);
}

async function removePreviousOwnedOperations(root: string): Promise<void> {
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (
      !rollbackRuntimeDirectoryPattern.test(entry.name) ||
      !entry.isDirectory() ||
      entry.isSymbolicLink()
    ) {
      throw new WindowsInstallerRollbackRuntimeError();
    }
    await removeOwnedOperationIfPresent(join(root, entry.name));
  }
}

async function removeOwnedOperationIfPresent(path: string): Promise<void> {
  let metadata;
  try {
    metadata = await lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return;
    }
    throw error;
  }
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new WindowsInstallerRollbackRuntimeError();
  }
  await assertCanonicalDirectory(path);
  await rm(path, { recursive: true });
}

async function readValidatedRuntimeFile(
  path: string,
  expectedFileName: string,
): Promise<Buffer> {
  if (basename(path) !== expectedFileName) {
    throw new WindowsInstallerRollbackRuntimeError();
  }
  const before = await lstat(path);
  if (
    !before.isFile() ||
    before.isSymbolicLink() ||
    before.size < 1 ||
    before.size > rollbackRuntimeFileMaximumBytes ||
    !pathsAreEqual(await realpath(path), path)
  ) {
    throw new WindowsInstallerRollbackRuntimeError();
  }
  const bytes = await readFile(path);
  const after = await lstat(path);
  if (
    !after.isFile() ||
    after.isSymbolicLink() ||
    after.size !== before.size ||
    after.mtimeMs !== before.mtimeMs ||
    bytes.byteLength !== before.size
  ) {
    throw new WindowsInstallerRollbackRuntimeError();
  }
  return bytes;
}

async function assertCanonicalDirectory(path: string): Promise<void> {
  const metadata = await lstat(path);
  if (
    !metadata.isDirectory() ||
    metadata.isSymbolicLink() ||
    !pathsAreEqual(await realpath(path), path)
  ) {
    throw new WindowsInstallerRollbackRuntimeError();
  }
}

function requireAbsoluteCanonicalPath(path: string): string {
  if (path.includes('\0') || !isAbsolute(path) || resolve(path) !== path) {
    throw new WindowsInstallerRollbackRuntimeError();
  }
  return path;
}

function assertSeparateRoots(sourceRoot: string, destinationRoot: string): void {
  if (
    pathsAreEqual(sourceRoot, destinationRoot) ||
    isDescendant(sourceRoot, destinationRoot) ||
    isDescendant(destinationRoot, sourceRoot)
  ) {
    throw new WindowsInstallerRollbackRuntimeError();
  }
}

function isDescendant(parent: string, candidate: string): boolean {
  const difference = relative(parent, candidate);
  return (
    difference !== '' &&
    difference !== '..' &&
    !difference.startsWith(`..${sep}`) &&
    !isAbsolute(difference)
  );
}

function pathsAreEqual(first: string, second: string): boolean {
  const normalizedFirst = resolve(first);
  const normalizedSecond = resolve(second);
  return process.platform === 'win32'
    ? normalizedFirst.toLowerCase() === normalizedSecond.toLowerCase()
    : normalizedFirst === normalizedSecond;
}
