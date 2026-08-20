import { createHash, randomUUID } from 'node:crypto';
import {
  constants as fileSystemConstants,
  promises as fileSystem,
} from 'node:fs';
import {
  dirname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from 'node:path';

import type { ValidatedProfileArtifact } from './validateProfileArtifactCatalog.js';

export async function materializeValidatedProfileArtifacts(input: {
  readonly artifacts: readonly ValidatedProfileArtifact[];
  readonly destinationRoot: string;
  readonly sourceRoot: string;
}): Promise<void> {
  if (!isAbsolute(input.destinationRoot) || !isAbsolute(input.sourceRoot)) {
    throw new Error('PROFILE_ARTIFACT_MATERIALIZATION_FAILED');
  }

  const destinationRoot = resolve(input.destinationRoot);
  const sourceRoot = resolve(input.sourceRoot);
  await assertEmptyPrivateDestinationRoot(destinationRoot);

  try {
    for (const artifact of input.artifacts) {
      const sourcePath = resolve(
        sourceRoot,
        ...artifact.logicalPath.split('/'),
      );
      const destinationPath = resolve(
        destinationRoot,
        ...artifact.storagePath.split('/'),
      );
      assertContainedPath(sourceRoot, sourcePath);
      assertContainedPath(destinationRoot, destinationPath);
      await materializeArtifact({
        destinationPath,
        expectedByteSize: artifact.byteSize,
        expectedSha256: artifact.sha256,
        sourcePath,
      });
    }
  } catch {
    await fileSystem
      .rm(destinationRoot, { force: true, recursive: true })
      .catch(() => undefined);
    throw new Error('PROFILE_ARTIFACT_MATERIALIZATION_FAILED');
  }
}

async function materializeArtifact(input: {
  destinationPath: string;
  expectedByteSize: number;
  expectedSha256: string;
  sourcePath: string;
}): Promise<void> {
  await createPrivateDirectoryTree(dirname(input.destinationPath));
  const temporaryPath = `${input.destinationPath}.next-${randomUUID()}`;
  let destinationCreated = false;
  let temporaryCreated = false;

  try {
    const source = await fileSystem.open(
      input.sourcePath,
      fileSystemConstants.O_RDONLY | fileSystemConstants.O_NOFOLLOW,
    );
    try {
      const destination = await fileSystem.open(
        temporaryPath,
        fileSystemConstants.O_CREAT |
          fileSystemConstants.O_EXCL |
          fileSystemConstants.O_WRONLY,
        0o600,
      );
      temporaryCreated = true;
      try {
        const hash = createHash('sha256');
        let byteSize = 0;
        for await (const chunk of source.createReadStream({
          autoClose: false,
        })) {
          const content = chunk as Buffer;
          byteSize += content.byteLength;
          if (byteSize > input.expectedByteSize) {
            throw new Error('PROFILE_ARTIFACT_MATERIALIZATION_FAILED');
          }
          hash.update(content);
          await writeCompleteBuffer(destination, content);
        }
        if (
          byteSize !== input.expectedByteSize ||
          hash.digest('hex') !== input.expectedSha256
        ) {
          throw new Error('PROFILE_ARTIFACT_MATERIALIZATION_FAILED');
        }
        await destination.sync();
      } finally {
        await destination.close();
      }
    } finally {
      await source.close();
    }

    await fileSystem.link(temporaryPath, input.destinationPath);
    destinationCreated = true;
    await fileSystem.unlink(temporaryPath);
    temporaryCreated = false;
    await fileSystem.chmod(input.destinationPath, 0o600);
    const metadata = await fileSystem.lstat(input.destinationPath);
    if (
      !metadata.isFile() ||
      metadata.isSymbolicLink() ||
      metadata.nlink !== 1
    ) {
      throw new Error('PROFILE_ARTIFACT_MATERIALIZATION_FAILED');
    }
    await syncDirectory(dirname(input.destinationPath));
    destinationCreated = false;
  } catch {
    throw new Error('PROFILE_ARTIFACT_MATERIALIZATION_FAILED');
  } finally {
    await Promise.allSettled([
      temporaryCreated
        ? fileSystem.rm(temporaryPath, { force: true })
        : Promise.resolve(),
      destinationCreated
        ? fileSystem.rm(input.destinationPath, { force: true })
        : Promise.resolve(),
    ]);
  }
}

async function writeCompleteBuffer(
  destination: Awaited<ReturnType<typeof fileSystem.open>>,
  content: Buffer,
): Promise<void> {
  let offset = 0;
  while (offset < content.byteLength) {
    const { bytesWritten } = await destination.write(
      content,
      offset,
      content.byteLength - offset,
    );
    if (bytesWritten < 1) {
      throw new Error('PROFILE_ARTIFACT_MATERIALIZATION_FAILED');
    }
    offset += bytesWritten;
  }
}

async function assertEmptyPrivateDestinationRoot(
  destinationRoot: string,
): Promise<void> {
  try {
    const metadata = await fileSystem.lstat(destinationRoot);
    if (
      !metadata.isDirectory() ||
      metadata.isSymbolicLink() ||
      (process.platform !== 'win32' && (metadata.mode & 0o077) !== 0) ||
      !pathsAreEqual(
        await fileSystem.realpath(destinationRoot),
        destinationRoot,
      ) ||
      (await fileSystem.readdir(destinationRoot)).length !== 0
    ) {
      throw new Error('PROFILE_ARTIFACT_MATERIALIZATION_FAILED');
    }
  } catch {
    throw new Error('PROFILE_ARTIFACT_MATERIALIZATION_FAILED');
  }
}

async function createPrivateDirectoryTree(path: string): Promise<void> {
  await fileSystem.mkdir(path, { mode: 0o700, recursive: true });
  await fileSystem.chmod(path, 0o700);
  const metadata = await fileSystem.lstat(path);
  if (
    !metadata.isDirectory() ||
    metadata.isSymbolicLink() ||
    (process.platform !== 'win32' && (metadata.mode & 0o077) !== 0)
  ) {
    throw new Error('PROFILE_ARTIFACT_MATERIALIZATION_FAILED');
  }
}

async function syncDirectory(path: string): Promise<void> {
  if (process.platform === 'win32') return;
  const directory = await fileSystem.open(path, 'r');
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}

function assertContainedPath(root: string, candidate: string): void {
  const relativePath = relative(root, candidate);
  if (
    relativePath === '' ||
    relativePath === '..' ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath)
  ) {
    throw new Error('PROFILE_ARTIFACT_MATERIALIZATION_FAILED');
  }
}

function pathsAreEqual(first: string, second: string): boolean {
  const firstResolved = resolve(first);
  const secondResolved = resolve(second);
  return process.platform === 'win32'
    ? firstResolved.toLowerCase() === secondResolved.toLowerCase()
    : firstResolved === secondResolved;
}
