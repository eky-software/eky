import { join } from 'node:path';

import { request as requestFactory } from '@playwright/test';

import { createE2eWorkerPaths } from '../environment/createE2eWorkerPaths.js';
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
  readonly sourceDatabaseFilePath: string;
  readonly sourceDatabaseSha256: string;
}

const sourceScenarioId = 'WORKSPACE-BACKUP-SOURCE';
const syntheticPassword = 'synthetic-electron-workspace-import-password';
const syntheticCustomerName = 'Synthetic Imported Workspace Customer Oy';

export async function createElectronWorkspaceBackupFixture(input: {
  readonly backupPath: string;
  readonly runRoot: string;
}): Promise<Readonly<ElectronWorkspaceBackupFixture>> {
  const sourcePaths = createE2eWorkerPaths(input.runRoot, sourceScenarioId);
  const backendPort = await reserveLoopbackPort();
  const backend = await startE2eBackendProcess({
    backendPort,
    paths: sourcePaths,
    runRoot: input.runRoot,
    scenarioId: sourceScenarioId,
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
      customerName: syntheticCustomerName,
      customerNumber: 'E2E-IMPORTED-1',
      subject: 'Synthetic imported workspace invoice',
    });
    invoiceId = invoice.invoiceId;
  } finally {
    await api.dispose();
    await backend.stop();
    await waitForLoopbackPortRelease(backendPort);
  }

  const document = readWorkspaceBackupInvoiceDocument(
    sourcePaths.databaseFilePath,
    invoiceId,
  );
  const pdfSha256 = await sha256File(
    resolveWorkspaceBackupStoragePath(
      sourcePaths.documentsRoot,
      document.storagePath,
    ),
  );
  await createRealPortableWorkspaceBackup({
    backupPath: input.backupPath,
    databaseFilePath: sourcePaths.databaseFilePath,
    invoiceDocumentStorageRoot: sourcePaths.documentsRoot,
    password: syntheticPassword,
    stagingRoot: join(sourcePaths.tempRoot, 'backup-staging'),
  });

  return Object.freeze({
    backupPath: input.backupPath,
    backupSha256: await sha256File(input.backupPath),
    customerName: syntheticCustomerName,
    invoiceId,
    password: syntheticPassword,
    pdfSha256,
    sourceDatabaseFilePath: sourcePaths.databaseFilePath,
    sourceDatabaseSha256: await sha256File(sourcePaths.databaseFilePath),
  });
}
