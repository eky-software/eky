import { rename } from 'node:fs/promises';

const windowsRetryDelaysMilliseconds = [25, 50, 100, 200, 400, 800] as const;
const retryableWindowsErrorCodes = new Set(['EACCES', 'EBUSY', 'EPERM']);

interface RenameProfilePathOptions {
  destinationPath: string;
  platform?: NodeJS.Platform;
  renamePath?(sourcePath: string, destinationPath: string): Promise<void>;
  sourcePath: string;
  wait?(milliseconds: number): Promise<void>;
}

export async function renameProfilePathWithRetry(
  options: RenameProfilePathOptions,
): Promise<void> {
  const platform = options.platform ?? process.platform;
  const renamePath = options.renamePath ?? rename;
  const wait = options.wait ?? waitForDelay;

  for (
    let attempt = 0;
    attempt <= windowsRetryDelaysMilliseconds.length;
    attempt += 1
  ) {
    try {
      await renamePath(options.sourcePath, options.destinationPath);
      return;
    } catch (error) {
      if (
        platform !== 'win32' ||
        !isRetryableWindowsRenameError(error) ||
        attempt === windowsRetryDelaysMilliseconds.length
      ) {
        throw error;
      }
      await wait(windowsRetryDelaysMilliseconds[attempt]!);
    }
  }
}

function isRetryableWindowsRenameError(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    typeof (error as NodeJS.ErrnoException).code === 'string' &&
    retryableWindowsErrorCodes.has(
      (error as NodeJS.ErrnoException).code!,
    )
  );
}

async function waitForDelay(milliseconds: number): Promise<void> {
  await new Promise<void>((resolveWait) => {
    setTimeout(resolveWait, milliseconds);
  });
}
