import { join, relative, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { createInvoicePdfArchiveRuntimePaths } from '../src/invoicePdfArchive/invoicePdfArchivePaths.js';
import { createProfileSnapshotRuntimePaths } from '../src/profileBackup/profileSnapshotRuntimePaths.js';
import { createDesktopProfilePaths } from '../src/runtime/desktopProfilePaths.js';
import { deriveWorkspaceRoot } from '../src/workspaces/registry/deriveWorkspaceRoot.js';
import type { W6b2PackagedWorkspaceFixture } from './w6b2PackagedWorkspaceFixtures.js';
import type { W6b2PersistedWorkspaceFixture } from './w6b2PackagedWorkspaceProfileState.js';

export function hydrateW6b2PackagedWorkspaceFixture(
  userDataRoot: string,
  persisted: Readonly<W6b2PersistedWorkspaceFixture>,
): Readonly<W6b2PackagedWorkspaceFixture> {
  const workspaceRoot = deriveWorkspaceRoot(
    userDataRoot,
    persisted.workspaceId,
    1,
  ).workspaceRoot;
  const profile = createDesktopProfilePaths(workspaceRoot);
  const storagePath = readDocumentStoragePath(
    profile.databaseFilePath,
    persisted.business.documentId,
  );
  const businessArtifactPath = join(
    profile.invoiceDocumentStorageRoot,
    ...storagePath.split('/'),
  );
  requireContainedPath(
    profile.invoiceDocumentStorageRoot,
    businessArtifactPath,
  );
  const archivePaths = createInvoicePdfArchiveRuntimePaths(
    profile.runtimeRoot,
  );
  const archiveDirectoryPath = join(
    workspaceRoot,
    `synthetic-pdf-archive-${persisted.fixtureKey.toLowerCase()}`,
  );
  const recoveryPointsRoot =
    createProfileSnapshotRuntimePaths(profile.runtimeRoot).recoveryPointsRoot;
  const secretNamespaceRoot = join(
    profile.runtimeRoot,
    `synthetic-secret-namespace-${persisted.fixtureKey.toLowerCase()}`,
  );
  return Object.freeze({
    archiveConfigFilePath: archivePaths.configFilePath,
    archiveDirectoryPath,
    archiveJournalFilePath: archivePaths.journalFilePath,
    archiveSentinelFilePath: join(
      archiveDirectoryPath,
      'w6b2-archive-sentinel.txt',
    ),
    artifactRoot: profile.invoiceDocumentStorageRoot,
    business: persisted.business,
    businessArtifactPath,
    databaseFilePath: profile.databaseFilePath,
    fixtureKey: persisted.fixtureKey,
    profileId: persisted.profileId,
    recoveryPointsRoot,
    recoverySentinelFilePath: join(
      recoveryPointsRoot,
      'w6b2-recovery-sentinel.txt',
    ),
    secretNamespaceRoot,
    secretSentinelFilePath: join(
      secretNamespaceRoot,
      'w6b2-secret-sentinel.txt',
    ),
    workspaceId: persisted.workspaceId,
    workspaceRoot,
  });
}

function readDocumentStoragePath(
  databaseFilePath: string,
  documentId: string,
): string {
  const database = new DatabaseSync(databaseFilePath, {
    open: true,
    readOnly: true,
  });
  try {
    const row = database
      .prepare('SELECT storage_path FROM invoice_documents WHERE id = ?')
      .get(documentId) as { storage_path?: unknown } | undefined;
    if (
      typeof row?.storage_path !== 'string' ||
      row.storage_path.length < 1 ||
      row.storage_path.includes('\\') ||
      row.storage_path
        .split('/')
        .some((part) => part.length < 1 || part === '..')
    ) {
      throw new Error('W6B2_PROFILE_DOCUMENT_INVALID');
    }
    return row.storage_path;
  } finally {
    database.close();
  }
}

function requireContainedPath(root: string, path: string): void {
  const relativePath = relative(resolve(root), resolve(path));
  if (
    relativePath.length < 1 ||
    relativePath.startsWith('..') ||
    resolve(root, relativePath) !== resolve(path)
  ) {
    throw new Error('W6B2_PROFILE_DOCUMENT_INVALID');
  }
}
