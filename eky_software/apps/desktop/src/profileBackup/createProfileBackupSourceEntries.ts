import { createHash } from 'node:crypto';
import {
  createReadStream,
  promises as fileSystem,
} from 'node:fs';
import { relative, resolve, sep } from 'node:path';

import type { BackupContainerSourceEntry } from './container/backupContainerWriter.js';

const databaseLogicalPath = 'profile.sqlite';
const artifactCatalogLogicalPath = 'snapshot-catalog-v1.json';
const businessArtifactPrefix =
  'artifacts/invoicing/invoice-documents/';

export async function createProfileBackupSourceEntries(
  operationRoot: string,
): Promise<readonly BackupContainerSourceEntry[]> {
  const rootMetadata = await fileSystem.lstat(operationRoot);
  if (!rootMetadata.isDirectory() || rootMetadata.isSymbolicLink()) {
    throw new Error('PROFILE_BACKUP_SOURCE_INVALID');
  }
  const realRoot = await fileSystem.realpath(operationRoot);
  if (!pathsAreEqual(realRoot, operationRoot)) {
    throw new Error('PROFILE_BACKUP_SOURCE_INVALID');
  }

  const entries: BackupContainerSourceEntry[] = [];
  await visitDirectory(operationRoot, operationRoot, entries);

  if (
    entries.filter(
      ({ logicalPath, type }) =>
        logicalPath === databaseLogicalPath && type === 'database',
    ).length !== 1 ||
    entries.filter(
      ({ logicalPath, type }) =>
        logicalPath === artifactCatalogLogicalPath &&
        type === 'artifactCatalog',
    ).length !== 1
  ) {
    throw new Error('PROFILE_BACKUP_SOURCE_INVALID');
  }

  return entries.sort((first, second) =>
    first.logicalPath.localeCompare(second.logicalPath, 'en'),
  );
}

async function visitDirectory(
  operationRoot: string,
  directoryPath: string,
  entries: BackupContainerSourceEntry[],
): Promise<void> {
  const directoryEntries = await fileSystem.readdir(directoryPath, {
    withFileTypes: true,
  });

  for (const directoryEntry of directoryEntries) {
    const sourcePath = resolve(directoryPath, directoryEntry.name);
    assertContainedPath(operationRoot, sourcePath);
    const metadata = await fileSystem.lstat(sourcePath);

    if (metadata.isSymbolicLink()) {
      throw new Error('PROFILE_BACKUP_SOURCE_INVALID');
    }
    if (metadata.isDirectory()) {
      const realDirectory = await fileSystem.realpath(sourcePath);
      if (!pathsAreEqual(realDirectory, sourcePath)) {
        throw new Error('PROFILE_BACKUP_SOURCE_INVALID');
      }
      await visitDirectory(operationRoot, sourcePath, entries);
      continue;
    }
    if (!metadata.isFile() || metadata.nlink !== 1) {
      throw new Error('PROFILE_BACKUP_SOURCE_INVALID');
    }

    const logicalPath = relative(operationRoot, sourcePath)
      .split(sep)
      .join('/');
    const type = readEntryType(logicalPath);
    const realFile = await fileSystem.realpath(sourcePath);
    if (!pathsAreEqual(realFile, sourcePath)) {
      throw new Error('PROFILE_BACKUP_SOURCE_INVALID');
    }

    const hash = createHash('sha256');
    for await (const chunk of createReadStream(sourcePath)) {
      hash.update(chunk as Buffer);
    }
    entries.push({
      contentLength: BigInt(metadata.size),
      logicalPath,
      sha256: hash.digest('hex'),
      sourcePath,
      type,
    });
  }
}

function readEntryType(
  logicalPath: string,
): BackupContainerSourceEntry['type'] {
  if (logicalPath === databaseLogicalPath) {
    return 'database';
  }
  if (logicalPath === artifactCatalogLogicalPath) {
    return 'artifactCatalog';
  }
  if (
    logicalPath.startsWith(businessArtifactPrefix) &&
    logicalPath.endsWith('.pdf') &&
    /^[a-f0-9]{64}\.pdf$/u.test(
      logicalPath.slice(businessArtifactPrefix.length),
    )
  ) {
    return 'businessArtifact';
  }
  throw new Error('PROFILE_BACKUP_SOURCE_INVALID');
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
    throw new Error('PROFILE_BACKUP_SOURCE_INVALID');
  }
}

function pathsAreEqual(first: string, second: string): boolean {
  const firstResolved = resolve(first);
  const secondResolved = resolve(second);
  return process.platform === 'win32'
    ? firstResolved.toLowerCase() === secondResolved.toLowerCase()
    : firstResolved === secondResolved;
}

