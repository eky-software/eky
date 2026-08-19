import {
  existsSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

import type { Page } from '@playwright/test';

import { readElectronE2eActiveWorkspace } from '../../src/environment/readElectronE2eActiveWorkspace.js';
import { test, expect } from '../../src/fixtures/isolatedElectronTest.js';
import { createApprovedInvoiceWithPdf } from '../../src/journeys/invoicingApiJourney.js';

interface InvoicePdfArchiveStatus {
  enabled: boolean;
  lastSafeErrorCode: string | null;
  pendingCount: number;
}

interface InvoicePdfArchiveJournal {
  tasks: Array<{
    attemptCount: number;
    invoiceNumber: string;
    lastSafeErrorCode: string | null;
  }>;
}

test('ARCHIVE-PDF-FAILURE-001 @critical @fault preserves delivery and queues a safe retry when the target disappears', async ({
  e2eElectron,
}) => {
  const activeWorkspace = readElectronE2eActiveWorkspace(
    e2eElectron.runtime.userDataPath,
  );
  const invoice = await createApprovedInvoiceWithPdf(e2eElectron.api);
  await enableInvoicePdfArchive(e2eElectron.page);
  rmSync(e2eElectron.runtime.invoicePdfArchiveDirectoryPath, {
    force: true,
    recursive: true,
  });

  const response = await e2eElectron.api.post(
    `/invoices/${invoice.invoiceId}/mark-sent`,
    { data: { deliveryMethod: 'manual' } },
  );

  expect(response.status()).toBe(200);
  expect(await response.text()).toContain('"status":"sent"');
  await expect
    .poll(() => readInvoicePdfArchiveStatus(e2eElectron.page))
    .toEqual({
      enabled: false,
      lastSafeErrorCode: 'ARCHIVE_DIRECTORY_UNAVAILABLE',
      pendingCount: 1,
    });
  expect(readArchiveJournal(activeWorkspace.archiveJournalPath).tasks).toEqual([
    expect.objectContaining({
      attemptCount: 1,
      invoiceNumber: invoice.invoiceNumber,
      lastSafeErrorCode: 'ARCHIVE_DIRECTORY_UNAVAILABLE',
    }),
  ]);
  expect(
    existsSync(
      expectedArchivePath(
        e2eElectron.runtime.invoicePdfArchiveDirectoryPath,
        activeWorkspace.workspaceId,
        invoice.invoiceNumber,
      ),
    ),
  ).toBe(false);
});

test('ARCHIVE-PDF-RECOVERY-001 @critical @recovery archives a pending PDF after restart and manual retry', async ({
  e2eElectron,
}) => {
  const activeWorkspace = readElectronE2eActiveWorkspace(
    e2eElectron.runtime.userDataPath,
  );
  const invoice = await createApprovedInvoiceWithPdf(e2eElectron.api);
  await enableInvoicePdfArchive(e2eElectron.page);
  rmSync(e2eElectron.runtime.invoicePdfArchiveDirectoryPath, {
    force: true,
    recursive: true,
  });
  expect(
    (
      await e2eElectron.api.post(
        `/invoices/${invoice.invoiceId}/mark-sent`,
        { data: { deliveryMethod: 'manual' } },
      )
    ).status(),
  ).toBe(200);
  expect(
    readArchiveJournal(activeWorkspace.archiveJournalPath).tasks,
  ).toHaveLength(1);

  await e2eElectron.restart();
  const status = await retryInvoicePdfArchive(e2eElectron.page);
  const archivePath = expectedArchivePath(
    e2eElectron.runtime.invoicePdfArchiveDirectoryPath,
    activeWorkspace.workspaceId,
    invoice.invoiceNumber,
  );

  expect(status).toEqual({
    enabled: true,
    lastSafeErrorCode: null,
    pendingCount: 0,
  });
  expect(readFileSync(archivePath).subarray(0, 5).toString('ascii')).toBe(
    '%PDF-',
  );
  expect(readArchiveJournal(activeWorkspace.archiveJournalPath).tasks).toEqual(
    [],
  );
});

test('ARCHIVE-PDF-CONFLICT-001 @critical @recovery preserves an existing conflicting PDF without automatic retry churn', async ({
  e2eElectron,
}) => {
  const activeWorkspace = readElectronE2eActiveWorkspace(
    e2eElectron.runtime.userDataPath,
  );
  const invoice = await createApprovedInvoiceWithPdf(e2eElectron.api);
  await enableInvoicePdfArchive(e2eElectron.page);
  const archivePath = expectedArchivePath(
    e2eElectron.runtime.invoicePdfArchiveDirectoryPath,
    activeWorkspace.workspaceId,
    invoice.invoiceNumber,
  );
  const conflictingContent = Buffer.from('%PDF-conflicting-e2e-document');
  writeFileSync(archivePath, conflictingContent, { flag: 'wx', mode: 0o600 });

  expect(
    (
      await e2eElectron.api.post(
        `/invoices/${invoice.invoiceId}/mark-sent`,
        { data: { deliveryMethod: 'manual' } },
      )
    ).status(),
  ).toBe(200);
  await expect
    .poll(() => readInvoicePdfArchiveStatus(e2eElectron.page))
    .toEqual({
      enabled: true,
      lastSafeErrorCode: 'ARCHIVE_FILE_CONFLICT',
      pendingCount: 1,
    });
  const beforeRestart = readArchiveJournal(activeWorkspace.archiveJournalPath);
  expect(beforeRestart.tasks).toEqual([
    expect.objectContaining({
      attemptCount: 1,
      invoiceNumber: invoice.invoiceNumber,
      lastSafeErrorCode: 'ARCHIVE_FILE_CONFLICT',
    }),
  ]);

  await e2eElectron.restart();
  const afterRestart = readArchiveJournal(activeWorkspace.archiveJournalPath);

  expect(afterRestart.tasks).toEqual(beforeRestart.tasks);
  expect(readFileSync(archivePath)).toEqual(conflictingContent);
  expect(await readInvoicePdfArchiveStatus(e2eElectron.page)).toEqual({
    enabled: true,
    lastSafeErrorCode: 'ARCHIVE_FILE_CONFLICT',
    pendingCount: 1,
  });
});

async function enableInvoicePdfArchive(page: Page): Promise<void> {
  const status = await page.evaluate(async () => {
    const bridge = (
      window as typeof window & {
        ekyDesktop?: {
          chooseInvoicePdfArchiveDirectory(): Promise<unknown>;
        };
      }
    ).ekyDesktop;
    if (bridge === undefined) {
      throw new Error('Desktop bridge is unavailable.');
    }
    return bridge.chooseInvoicePdfArchiveDirectory();
  });
  expect(status).toEqual(
    expect.objectContaining({
      enabled: true,
      lastSafeErrorCode: null,
      pendingCount: 0,
    }),
  );
}

async function readInvoicePdfArchiveStatus(
  page: Page,
): Promise<InvoicePdfArchiveStatus> {
  return page.evaluate(async () => {
    const bridge = (
      window as typeof window & {
        ekyDesktop?: {
          getInvoicePdfArchiveStatus(): Promise<unknown>;
        };
      }
    ).ekyDesktop;
    if (bridge === undefined) {
      throw new Error('Desktop bridge is unavailable.');
    }
    const status = (await bridge.getInvoicePdfArchiveStatus()) as {
      enabled: boolean;
      lastSafeErrorCode: string | null;
      pendingCount: number;
    };
    return {
      enabled: status.enabled,
      lastSafeErrorCode: status.lastSafeErrorCode,
      pendingCount: status.pendingCount,
    };
  });
}

async function retryInvoicePdfArchive(
  page: Page,
): Promise<InvoicePdfArchiveStatus> {
  return page.evaluate(async () => {
    const bridge = (
      window as typeof window & {
        ekyDesktop?: {
          retryPendingInvoicePdfArchiveTasks(): Promise<unknown>;
        };
      }
    ).ekyDesktop;
    if (bridge === undefined) {
      throw new Error('Desktop bridge is unavailable.');
    }
    const status = (await bridge.retryPendingInvoicePdfArchiveTasks()) as {
      enabled: boolean;
      lastSafeErrorCode: string | null;
      pendingCount: number;
    };
    return {
      enabled: status.enabled,
      lastSafeErrorCode: status.lastSafeErrorCode,
      pendingCount: status.pendingCount,
    };
  });
}

function readArchiveJournal(journalPath: string): InvoicePdfArchiveJournal {
  return JSON.parse(
    readFileSync(journalPath, 'utf8'),
  ) as InvoicePdfArchiveJournal;
}

function expectedArchivePath(
  directoryPath: string,
  workspaceId: string,
  invoiceNumber: string,
): string {
  return join(directoryPath, workspaceId, `Lasku-${invoiceNumber}.pdf`);
}
