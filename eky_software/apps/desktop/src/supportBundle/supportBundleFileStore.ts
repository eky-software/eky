import {
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

const supportBundleExtension = '.ekysupport';

interface WriteSupportBundleOptions {
  archive: Buffer;
  runtimeRoot: string;
  targetPath: string;
}

export function writeSupportBundleAtomically(
  options: WriteSupportBundleOptions,
): void {
  const runtimeRoot = requireAbsolutePath(options.runtimeRoot);
  ensureExistingSafeDirectory(runtimeRoot);
  const targetPath = requireAbsolutePath(
    ensureSupportBundleExtension(options.targetPath),
  );
  const targetDirectory = dirname(targetPath);
  ensureExistingSafeDirectory(targetDirectory);
  ensureSafeReplaceTarget(targetPath);

  const supportBundleRuntimeDirectory = join(runtimeRoot, 'support-bundles');
  ensureSafeDirectory(supportBundleRuntimeDirectory);
  const runtimeTemporaryDirectory = join(
    supportBundleRuntimeDirectory,
    'temporary',
  );
  ensureSafeDirectory(runtimeTemporaryDirectory);

  const identifier = randomUUID();
  const runtimeTemporaryPath = join(
    runtimeTemporaryDirectory,
    `${identifier}.next`,
  );
  const adjacentTemporaryPath = join(
    targetDirectory,
    `.${identifier}.ekysupport.next`,
  );

  try {
    writePrivateFile(runtimeTemporaryPath, options.archive);
    writePrivateFile(
      adjacentTemporaryPath,
      readFileSync(runtimeTemporaryPath),
    );
    renameSync(adjacentTemporaryPath, targetPath);
  } finally {
    removeTemporaryFile(runtimeTemporaryPath);
    removeTemporaryFile(adjacentTemporaryPath);
  }
}

export function removeExpiredSupportBundleTemporaryFiles(
  runtimeRoot: string,
  now: Date = new Date(),
): void {
  const absoluteRuntimeRoot = requireAbsolutePath(runtimeRoot);
  ensureExistingSafeDirectory(absoluteRuntimeRoot);
  const supportBundleRuntimeDirectory = join(
    absoluteRuntimeRoot,
    'support-bundles',
  );
  if (!existsSync(supportBundleRuntimeDirectory)) {
    return;
  }
  ensureExistingSafeDirectory(supportBundleRuntimeDirectory);
  const temporaryDirectory = join(
    supportBundleRuntimeDirectory,
    'temporary',
  );

  if (!existsSync(temporaryDirectory)) {
    return;
  }

  ensureExistingSafeDirectory(temporaryDirectory);
  const expirationTime = now.getTime() - 30 * 24 * 60 * 60 * 1_000;

  for (const entryName of readdirSync(temporaryDirectory)) {
    if (!/^[0-9a-f-]{36}\.next$/.test(entryName)) {
      continue;
    }
    const candidatePath = join(temporaryDirectory, entryName);
    const metadata = lstatSync(candidatePath);
    if (
      metadata.isFile() &&
      !metadata.isSymbolicLink() &&
      metadata.mtimeMs < expirationTime
    ) {
      rmSync(candidatePath, { force: true });
    }
  }
}

function writePrivateFile(filePath: string, value: Buffer): void {
  const descriptor = openSync(
    filePath,
    'wx',
    0o600,
  );
  try {
    writeFileSync(descriptor, value);
  } finally {
    closeSync(descriptor);
  }
}

function ensureSupportBundleExtension(filePath: string): string {
  return filePath.toLowerCase().endsWith(supportBundleExtension)
    ? filePath
    : `${filePath}${supportBundleExtension}`;
}

function ensureSafeDirectory(directoryPath: string): void {
  try {
    ensureExistingSafeDirectory(directoryPath);
  } catch (error) {
    if (!isMissingPathError(error)) {
      throw error;
    }
    mkdirSync(directoryPath, { mode: 0o700 });
    ensureExistingSafeDirectory(directoryPath);
  }
}

function ensureExistingSafeDirectory(directoryPath: string): void {
  const metadata = lstatSync(directoryPath);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error('SUPPORT_BUNDLE_DIRECTORY_UNSAFE');
  }
}

function ensureSafeReplaceTarget(targetPath: string): void {
  if (!existsSync(targetPath)) {
    return;
  }
  const metadata = lstatSync(targetPath);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error('SUPPORT_BUNDLE_TARGET_UNSAFE');
  }
}

function removeTemporaryFile(filePath: string): void {
  try {
    const metadata = lstatSync(filePath);
    if (metadata.isFile() && !metadata.isSymbolicLink()) {
      rmSync(filePath, { force: true });
    }
  } catch {
    // A missing or inaccessible temporary file must not mask the result.
  }
}

function requireAbsolutePath(value: string): string {
  const absolute = resolve(value);
  if (absolute !== value) {
    throw new Error('SUPPORT_BUNDLE_PATH_INVALID');
  }
  return absolute;
}

function isMissingPathError(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === 'ENOENT'
  );
}
