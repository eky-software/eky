import { createHash } from 'node:crypto';
import { promises as fileSystem } from 'node:fs';
import type { BigIntStats } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';

import type {
  ParsedBackupContainerEntry,
  ParsedBackupPayload,
} from './backupContainerReader.js';
import { backupStreamChunkBytes } from './backupContainerLimits.js';

const databaseLogicalPath = 'profile.sqlite';
const artifactCatalogLogicalPath = 'snapshot-catalog-v1.json';
const businessArtifactPrefix =
  'artifacts/invoicing/invoice-documents/';

export async function extractBackupPayload(input: {
  operationRoot: string;
  parsedPayload: ParsedBackupPayload;
  payloadPath: string;
}): Promise<void> {
  validateRequiredEntries(input.parsedPayload.entries);
  const sourceMetadata = await fileSystem.lstat(input.payloadPath, {
    bigint: true,
  });
  if (!sourceMetadata.isFile() || sourceMetadata.isSymbolicLink()) {
    throw new Error('BACKUP_PAYLOAD_INVALID');
  }

  const source = await fileSystem.open(input.payloadPath, 'r');
  let operationRootCreated = false;

  try {
    assertSameFileIdentity(
      sourceMetadata,
      await source.stat({ bigint: true }),
    );
    await fileSystem.mkdir(input.operationRoot, { mode: 0o700 });
    operationRootCreated = true;
    await assertPrivateDirectory(input.operationRoot);

    for (const entry of input.parsedPayload.entries.slice(1)) {
      await extractEntry({
        entry,
        operationRoot: input.operationRoot,
        source,
      });
    }

    assertSameFileIdentity(
      sourceMetadata,
      await source.stat({ bigint: true }),
    );
  } catch (error) {
    if (operationRootCreated) {
      await fileSystem
        .rm(input.operationRoot, { force: true, recursive: true })
        .catch(() => undefined);
    }
    throw error;
  } finally {
    await source.close();
  }
}

function validateRequiredEntries(
  entries: readonly ParsedBackupContainerEntry[],
): void {
  const dataEntries = entries.slice(1);
  const databases = dataEntries.filter(
    (entry) =>
      entry.type === 'database' &&
      entry.logicalPath === databaseLogicalPath,
  );
  const catalogs = dataEntries.filter(
    (entry) =>
      entry.type === 'artifactCatalog' &&
      entry.logicalPath === artifactCatalogLogicalPath,
  );

  if (
    entries[0]?.type !== 'manifest' ||
    databases.length !== 1 ||
    catalogs.length !== 1 ||
    dataEntries.some(
      (entry) =>
        !(
          (entry.type === 'database' &&
            entry.logicalPath === databaseLogicalPath) ||
          (entry.type === 'artifactCatalog' &&
            entry.logicalPath === artifactCatalogLogicalPath) ||
          (entry.type === 'businessArtifact' &&
            entry.logicalPath.startsWith(businessArtifactPrefix) &&
            entry.logicalPath.endsWith('.pdf'))
        ),
    )
  ) {
    throw new Error('BACKUP_PAYLOAD_INVALID');
  }
}

async function extractEntry(input: {
  entry: ParsedBackupContainerEntry;
  operationRoot: string;
  source: FileHandle;
}): Promise<void> {
  const destinationPath = resolve(
    input.operationRoot,
    ...input.entry.logicalPath.split('/'),
  );
  assertContainedPath(input.operationRoot, destinationPath);
  await fileSystem.mkdir(dirname(destinationPath), {
    mode: 0o700,
    recursive: true,
  });
  await assertContainedDirectoryChain(
    input.operationRoot,
    dirname(destinationPath),
  );

  const destination = await fileSystem.open(destinationPath, 'wx', 0o600);
  try {
    const hash = createHash('sha256');
    const buffer = Buffer.allocUnsafe(backupStreamChunkBytes);
    let read = 0n;

    while (read < input.entry.contentLength) {
      const requested = Number(
        input.entry.contentLength - read > BigInt(buffer.byteLength)
          ? BigInt(buffer.byteLength)
          : input.entry.contentLength - read,
      );
      const sourceRead = await input.source.read(
        buffer,
        0,
        requested,
        Number(input.entry.contentOffset + read),
      );
      if (sourceRead.bytesRead !== requested) {
        throw new Error('BACKUP_PAYLOAD_INVALID');
      }

      const content = buffer.subarray(0, sourceRead.bytesRead);
      hash.update(content);
      await writeComplete(destination, content, Number(read));
      read += BigInt(sourceRead.bytesRead);
    }

    if (hash.digest('hex') !== input.entry.sha256) {
      throw new Error('BACKUP_ENTRY_CHECKSUM_INVALID');
    }

    await destination.sync();
  } finally {
    await destination.close();
  }

  await fileSystem.chmod(destinationPath, 0o400);
}

async function assertContainedDirectoryChain(
  operationRoot: string,
  leafDirectory: string,
): Promise<void> {
  const relativePath = relative(operationRoot, leafDirectory);
  const segments =
    relativePath === '' ? [] : relativePath.split(sep);
  let current = operationRoot;

  for (const segment of segments) {
    current = join(current, segment);
    await assertPrivateDirectory(current);
  }

  const realOperationRoot = await fileSystem.realpath(operationRoot);
  const realLeaf = await fileSystem.realpath(leafDirectory);
  if (!pathsAreEqual(realOperationRoot, realLeaf)) {
    assertContainedPath(realOperationRoot, realLeaf);
  }
}

async function assertPrivateDirectory(path: string): Promise<void> {
  const metadata = await fileSystem.lstat(path);
  if (
    !metadata.isDirectory() ||
    metadata.isSymbolicLink() ||
    (process.platform !== 'win32' && (metadata.mode & 0o077) !== 0)
  ) {
    throw new Error('BACKUP_STAGING_INVALID');
  }
}

function assertContainedPath(root: string, candidate: string): void {
  const relativePath = relative(root, candidate);
  if (
    relativePath === '' ||
    relativePath === '..' ||
    relativePath.startsWith(`..${sep}`) ||
    /^[a-zA-Z]:[\\/]/u.test(relativePath) ||
    relativePath.startsWith('/')
  ) {
    throw new Error('BACKUP_STAGING_INVALID');
  }
}

async function writeComplete(
  file: FileHandle,
  content: Buffer,
  position: number,
): Promise<void> {
  let written = 0;
  while (written < content.byteLength) {
    const result = await file.write(
      content,
      written,
      content.byteLength - written,
      position + written,
    );
    if (result.bytesWritten === 0) {
      throw new Error('BACKUP_WRITE_FAILED');
    }
    written += result.bytesWritten;
  }
}

function assertSameFileIdentity(
  expected: BigIntStats,
  actual: BigIntStats,
): void {
  if (
    !actual.isFile() ||
    actual.isSymbolicLink() ||
    expected.dev !== actual.dev ||
    expected.ino !== actual.ino ||
    expected.size !== actual.size ||
    expected.mtimeNs !== actual.mtimeNs ||
    expected.ctimeNs !== actual.ctimeNs
  ) {
    throw new Error('BACKUP_PAYLOAD_CHANGED');
  }
}

function pathsAreEqual(first: string, second: string): boolean {
  const firstResolved = resolve(first);
  const secondResolved = resolve(second);
  return process.platform === 'win32'
    ? firstResolved.toLowerCase() === secondResolved.toLowerCase()
    : firstResolved === secondResolved;
}
