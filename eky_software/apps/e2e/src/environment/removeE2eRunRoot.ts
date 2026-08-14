import { lstat, realpath, rm } from 'node:fs/promises';
import { basename, dirname, relative, resolve } from 'node:path';
import { tmpdir } from 'node:os';

interface RemoveE2eDirectoryOptions {
  force: true;
  maxRetries: number;
  recursive: true;
  retryDelay: number;
}

export type RemoveE2eDirectory = (
  path: string,
  options: RemoveE2eDirectoryOptions,
) => Promise<void>;

export const e2eRunRootRemovalOptions = Object.freeze({
  force: true,
  maxRetries: 20,
  recursive: true,
  retryDelay: 100,
} satisfies RemoveE2eDirectoryOptions);

export async function removeE2eRunRoot(
  runRoot: string,
  removeDirectory: RemoveE2eDirectory = rm,
): Promise<void> {
  await assertRemovableE2eRunRoot(runRoot);
  await removeDirectory(runRoot, e2eRunRootRemovalOptions);
}

async function assertRemovableE2eRunRoot(runRoot: string): Promise<void> {
  const baseRoot = await realpath(resolve(tmpdir(), 'eky-e2e'));
  const requestedRunRoot = resolve(runRoot);
  const metadata = await lstat(requestedRunRoot);
  const resolvedRunRoot = await realpath(requestedRunRoot);
  const relativePath = relative(baseRoot, resolvedRunRoot);

  if (
    metadata.isSymbolicLink() ||
    !metadata.isDirectory() ||
    dirname(relativePath) !== '.' ||
    !basename(relativePath).startsWith('run-')
  ) {
    throw new Error('E2E_RUN_ROOT_REMOVAL_REFUSED');
  }
}
