import { chmod, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import { InvoicePdfArchiveConfigStore } from '../src/invoicePdfArchive/invoicePdfArchiveConfig.js';
import { InvoicePdfArchiveJournalStore } from '../src/invoicePdfArchive/invoicePdfArchiveJournal.js';
import { createInvoicePdfArchiveRuntimePaths } from '../src/invoicePdfArchive/invoicePdfArchivePaths.js';
import { createProfileSnapshotRuntimePaths } from '../src/profileBackup/profileSnapshotRuntimePaths.js';
import { createDesktopProfilePaths } from '../src/runtime/desktopProfilePaths.js';
import type {
  W6b2PackagedWorkspaceBusinessFixture,
  W6b2PackagedWorkspaceFixtureKey,
} from './w6b2PackagedWorkspaceBusinessFixture.js';
import type { WorkspaceFirstStartProofFixture } from './workspaceFirstStartMigrationProofFixtures.js';

export interface W6b2PackagedWorkspaceRuntimeNamespaces {
  readonly archiveConfigFilePath: string;
  readonly archiveDirectoryPath: string;
  readonly archiveJournalFilePath: string;
  readonly recoveryPointsRoot: string;
  readonly secretNamespaceRoot: string;
}

export async function createW6b2PackagedWorkspaceRuntimeNamespaces(input: {
  readonly business: Readonly<W6b2PackagedWorkspaceBusinessFixture>;
  readonly fixture: Readonly<WorkspaceFirstStartProofFixture>;
  readonly fixtureKey: W6b2PackagedWorkspaceFixtureKey;
}): Promise<Readonly<W6b2PackagedWorkspaceRuntimeNamespaces>> {
  const profile = createDesktopProfilePaths(input.fixture.workspaceRoot);
  const archivePaths = createInvoicePdfArchiveRuntimePaths(profile.runtimeRoot);
  const archiveDirectoryPath = join(
    input.fixture.workspaceRoot,
    `synthetic-pdf-archive-${input.fixtureKey.toLowerCase()}`,
  );
  const recoveryPointsRoot =
    createProfileSnapshotRuntimePaths(profile.runtimeRoot).recoveryPointsRoot;
  const secretNamespaceRoot = join(
    profile.runtimeRoot,
    `synthetic-secret-namespace-${input.fixtureKey.toLowerCase()}`,
  );
  await Promise.all([
    createPrivateDirectory(archiveDirectoryPath),
    createPrivateDirectory(recoveryPointsRoot),
    createPrivateDirectory(secretNamespaceRoot),
  ]);
  await new InvoicePdfArchiveConfigStore(
    archivePaths.configFilePath,
  ).enable(archiveDirectoryPath);
  await new InvoicePdfArchiveJournalStore(archivePaths.journalFilePath).queue({
    attemptCount: 0,
    createdAt: '2026-08-22T00:00:00.000Z',
    deliveryEventId: `w6b2-${input.fixtureKey.toLowerCase()}-delivery`,
    documentId: input.business.documentId,
    expectedPdfSha256: input.business.pdfSha256,
    expectedPdfSize: input.business.pdfSize,
    invoiceId: input.business.invoiceId,
    invoiceKind: 'standard',
    invoiceNumber: input.business.invoiceNumber,
    lastSafeErrorCode: null,
    nextAttemptAt: '2099-01-01T00:00:00.000Z',
    schemaVersion: 1,
    taskId: `w6b2-${input.fixtureKey.toLowerCase()}-archive`,
  });

  return Object.freeze({
    archiveConfigFilePath: archivePaths.configFilePath,
    archiveDirectoryPath,
    archiveJournalFilePath: archivePaths.journalFilePath,
    recoveryPointsRoot,
    secretNamespaceRoot,
  });
}

async function createPrivateDirectory(path: string): Promise<void> {
  await mkdir(path, { mode: 0o700, recursive: true });
  if (process.platform !== 'win32') await chmod(path, 0o700);
}
