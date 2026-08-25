import { chmod, mkdir, writeFile } from 'node:fs/promises';
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
  readonly archiveSentinelFilePath: string;
  readonly archiveJournalFilePath: string;
  readonly recoveryPointsRoot: string;
  readonly recoverySentinelFilePath: string;
  readonly secretNamespaceRoot: string;
  readonly secretSentinelFilePath: string;
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
  const archiveSentinelFilePath = join(
    archiveDirectoryPath,
    'w6b2-archive-sentinel.txt',
  );
  const recoverySentinelFilePath = join(
    recoveryPointsRoot,
    'w6b2-recovery-sentinel.txt',
  );
  const secretSentinelFilePath = join(
    secretNamespaceRoot,
    'w6b2-secret-sentinel.txt',
  );
  await Promise.all([
    writeSentinel(archiveSentinelFilePath, 'archive', input.fixtureKey),
    writeSentinel(recoverySentinelFilePath, 'recovery', input.fixtureKey),
    writeSentinel(secretSentinelFilePath, 'secret', input.fixtureKey),
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
    archiveSentinelFilePath,
    archiveJournalFilePath: archivePaths.journalFilePath,
    recoveryPointsRoot,
    recoverySentinelFilePath,
    secretNamespaceRoot,
    secretSentinelFilePath,
  });
}

async function createPrivateDirectory(path: string): Promise<void> {
  await mkdir(path, { mode: 0o700, recursive: true });
  if (process.platform !== 'win32') await chmod(path, 0o700);
}

async function writeSentinel(
  path: string,
  namespace: 'archive' | 'recovery' | 'secret',
  fixtureKey: W6b2PackagedWorkspaceFixtureKey,
): Promise<void> {
  await writeFile(path, `w6b2-${namespace}-${fixtureKey}\n`, {
    encoding: 'utf8',
    flag: 'wx',
    mode: 0o600,
  });
}
