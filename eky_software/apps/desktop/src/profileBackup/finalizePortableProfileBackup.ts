import { constants } from 'node:fs';
import { chmod, copyFile, link, open, rm } from 'node:fs/promises';

interface PortableBackupFinalizationFileOperations {
  copyWithoutOverwrite(sourcePath: string, destinationPath: string): Promise<void>;
  linkWithoutOverwrite(sourcePath: string, destinationPath: string): Promise<void>;
  protectReadOnly(path: string): Promise<void>;
  remove(path: string): Promise<void>;
  setWritable(path: string): Promise<void>;
  sync(path: string): Promise<void>;
}

const defaultFileOperations: PortableBackupFinalizationFileOperations = {
  copyWithoutOverwrite(sourcePath, destinationPath) {
    return copyFile(sourcePath, destinationPath, constants.COPYFILE_EXCL);
  },
  linkWithoutOverwrite(sourcePath, destinationPath) {
    return link(sourcePath, destinationPath);
  },
  protectReadOnly(path) {
    return chmod(path, 0o400);
  },
  async remove(path) {
    await rm(path, { force: true });
  },
  setWritable(path) {
    return chmod(path, 0o600);
  },
  async sync(path) {
    const file = await open(path, 'r+');
    try {
      await file.sync();
    } finally {
      await file.close();
    }
  },
};

export class PortableBackupFinalizationError extends Error {
  constructor(readonly code: 'destinationExists' | 'writeFailed') {
    super(code);
    this.name = 'PortableBackupFinalizationError';
  }
}

export async function finalizePortableProfileBackup(
  temporaryPath: string,
  destinationPath: string,
  fileOperations: PortableBackupFinalizationFileOperations =
    defaultFileOperations,
): Promise<void> {
  let destinationCreated = false;

  try {
    try {
      await fileOperations.linkWithoutOverwrite(
        temporaryPath,
        destinationPath,
      );
      destinationCreated = true;
      await fileOperations.protectReadOnly(destinationPath);
      return;
    } catch (error) {
      if (!isHardLinkUnsupported(error)) {
        throw error;
      }
    }

    await fileOperations.copyWithoutOverwrite(
      temporaryPath,
      destinationPath,
    );
    destinationCreated = true;
    await fileOperations.setWritable(destinationPath);
    await fileOperations.sync(destinationPath);
    await fileOperations.protectReadOnly(destinationPath);
  } catch (error) {
    if (destinationCreated) {
      await fileOperations.remove(destinationPath).catch(() => undefined);
    }
    throw new PortableBackupFinalizationError(
      isNodeError(error) && error.code === 'EEXIST'
        ? 'destinationExists'
        : 'writeFailed',
    );
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

function isHardLinkUnsupported(error: unknown): boolean {
  return (
    isNodeError(error) &&
    ['ENOSYS', 'ENOTSUP', 'EOPNOTSUPP', 'EPERM', 'EXDEV'].includes(
      error.code ?? '',
    )
  );
}
