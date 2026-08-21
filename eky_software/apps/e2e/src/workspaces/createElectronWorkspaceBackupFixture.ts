import { join } from 'node:path';

import { request as requestFactory } from '@playwright/test';

import { createE2eWorkerPaths } from '../environment/createE2eWorkerPaths.js';
import type { E2eWorkerPaths } from '../environment/e2eEnvironmentTypes.js';
import { reserveLoopbackPort } from '../environment/reserveLoopbackPort.js';
import { startE2eBackendProcess } from '../environment/startE2eBackendProcess.js';
import { waitForLoopbackPortRelease } from '../environment/waitForLoopbackPortRelease.js';
import {
  createApprovedInvoiceWithPdfForWorkspaceBackup,
  createRealPortableWorkspaceBackup,
  readWorkspaceBackupInvoiceDocument,
  resolveWorkspaceBackupStoragePath,
  sha256File,
} from './workspaceBackupSystemTestSupport.js';

export interface ElectronWorkspaceBackupFixture {
  readonly backupPath: string;
  readonly backupSha256: string;
  readonly customerName: string;
  readonly invoiceId: string;
  readonly password: string;
  readonly pdfSha256: string;
  readonly profileId: string;
  readonly sourceDatabaseFilePath: string;
  readonly sourceDatabaseSha256: string;
}

const sourceScenarioId = 'WORKSPACE-BACKUP-SOURCE';
const syntheticPassword = 'synthetic-electron-workspace-import-password';
const syntheticCustomerName = 'Synthetic Imported Workspace Customer Oy';
const activeReplacementPassword =
  'synthetic-electron-workspace-replacement-password';
const activeReplacementCustomerName =
  'Synthetic Active Workspace Backup Customer Oy';

export async function createElectronWorkspaceBackupFixture(input: {
  readonly backupPath: string;
  readonly runRoot: string;
}): Promise<Readonly<ElectronWorkspaceBackupFixture>> {
  const sourcePaths = createE2eWorkerPaths(input.runRoot, sourceScenarioId);
  return createWorkspaceBackupFixture({
    backupPath: input.backupPath,
    customerName: syntheticCustomerName,
    customerNumber: 'E2E-IMPORTED-1',
    password: syntheticPassword,
    paths: sourcePaths,
    runRoot: input.runRoot,
    scenarioId: sourceScenarioId,
    stagingDirectoryName: 'backup-staging',
    subject: 'Synthetic imported workspace invoice',
  });
}

export async function createElectronActiveWorkspaceReplacementFixture(input: {
  readonly backupPath: string;
  readonly paths: E2eWorkerPaths;
  readonly runRoot: string;
  readonly scenarioId: string;
}): Promise<Readonly<ElectronWorkspaceBackupFixture>> {
  return createWorkspaceBackupFixture({
    backupPath: input.backupPath,
    customerName: activeReplacementCustomerName,
    customerNumber: 'E2E-REPLACE-SOURCE',
    password: activeReplacementPassword,
    paths: input.paths,
    runRoot: input.runRoot,
    scenarioId: input.scenarioId,
    stagingDirectoryName: 'replacement-backup-staging',
    subject: 'Synthetic active workspace replacement invoice',
  });
}

async function createWorkspaceBackupFixture(input: {
  readonly backupPath: string;
  readonly customerName: string;
  readonly customerNumber: string;
  readonly password: string;
  readonly paths: E2eWorkerPaths;
  readonly runRoot: string;
  readonly scenarioId: string;
  readonly stagingDirectoryName: string;
  readonly subject: string;
}): Promise<Readonly<ElectronWorkspaceBackupFixture>> {
  const backendPort = await reserveLoopbackPort();
  const backend = await startE2eBackendProcess({
    backendPort,
    paths: input.paths,
    runRoot: input.runRoot,
    scenarioId: input.scenarioId,
  });
  const api = await requestFactory.newContext({
    baseURL: backend.backendOrigin,
    extraHTTPHeaders: {
      Accept: 'application/json',
      'x-eky-local-session': backend.sessionSecret,
    },
  });

  let invoiceId: string;
  try {
    const invoice = await createApprovedInvoiceWithPdfForWorkspaceBackup(api, {
      customerName: input.customerName,
      customerNumber: input.customerNumber,
      subject: input.subject,
    });
    invoiceId = invoice.invoiceId;
  } finally {
    await api.dispose();
    await backend.stop();
    await waitForLoopbackPortRelease(backendPort);
  }

  const document = readWorkspaceBackupInvoiceDocument(
    input.paths.databaseFilePath,
    invoiceId,
  );
  const pdfSha256 = await sha256File(
    resolveWorkspaceBackupStoragePath(
      input.paths.documentsRoot,
      document.storagePath,
    ),
  );
  const backupIdentity = await createRealPortableWorkspaceBackup({
    backupPath: input.backupPath,
    databaseFilePath: input.paths.databaseFilePath,
    invoiceDocumentStorageRoot: input.paths.documentsRoot,
    password: input.password,
    stagingRoot: join(input.paths.tempRoot, input.stagingDirectoryName),
  });

  return Object.freeze({
    backupPath: input.backupPath,
    backupSha256: await sha256File(input.backupPath),
    customerName: input.customerName,
    invoiceId,
    password: input.password,
    pdfSha256,
    profileId: backupIdentity.profileId,
    sourceDatabaseFilePath: input.paths.databaseFilePath,
    sourceDatabaseSha256: await sha256File(input.paths.databaseFilePath),
  });
}
