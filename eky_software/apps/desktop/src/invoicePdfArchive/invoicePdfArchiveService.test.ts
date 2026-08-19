import { createHash } from 'node:crypto';
import { access, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { InvoicePdfArchiveConfigStore } from './invoicePdfArchiveConfig.js';
import type { LoadInvoicePdfArchiveDocument } from './invoicePdfArchiveFileCopy.js';
import { InvoicePdfArchiveJournalStore } from './invoicePdfArchiveJournal.js';
import { createInvoicePdfArchiveRuntimePaths } from './invoicePdfArchivePaths.js';
import { InvoicePdfArchiveService } from './invoicePdfArchiveService.js';
import type { InvoicePdfArchiveTask } from './invoicePdfArchiveTypes.js';
import { InvoicePdfArchiveError } from './invoicePdfArchiveTypes.js';
import { createWorkspaceInvoicePdfArchiveDirectoryResolver } from './workspaceInvoicePdfArchiveDirectory.js';
import { validateWorkspaceId } from '../workspaces/registry/workspaceIdValidation.js';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) =>
      rm(root, { force: true, recursive: true }),
    ),
  );
});

describe('InvoicePdfArchiveService', () => {
  it('does not queue historical deliveries while the feature is disabled', async () => {
    const { archiveRoot, loadDocument, service } = await createService();
    const content = createPdf();
    const task = createTask(content);

    await expect(service.queueTask(task)).resolves.toEqual({
      archived: false,
      queued: false,
    });
    await expect(service.getStatus()).resolves.toMatchObject({
      enabled: false,
      pendingCount: 0,
    });

    await expect(service.chooseDirectory(archiveRoot)).resolves.toMatchObject({
      displayName: 'archive',
      enabled: true,
      pendingCount: 0,
    });
    expect(loadDocument).not.toHaveBeenCalled();
  });

  it('records a safe error and leaves delivery work pending on copy failure', async () => {
    const { archiveRoot, service } = await createService({
      loadDocument: vi.fn().mockRejectedValue(new Error('raw path secret')),
    });
    await service.chooseDirectory(archiveRoot);

    await expect(service.queueTask(createTask(createPdf()))).resolves.toEqual({
      archived: false,
      queued: true,
    });
    await expect(service.getStatus()).resolves.toMatchObject({
      lastSafeErrorCode: 'ARCHIVE_STORAGE_FAILED',
      pendingCount: 1,
    });
  });

  it('does not persist a selected directory when the finalization probe fails', async () => {
    const root = await mkdtemp(join(tmpdir(), 'eky-archive-service-probe-'));
    temporaryRoots.push(root);
    const archiveRoot = join(root, 'archive');
    await mkdir(archiveRoot);
    const paths = createInvoicePdfArchiveRuntimePaths(root);
    const configStore = new InvoicePdfArchiveConfigStore(paths.configFilePath);
    const service = new InvoicePdfArchiveService({
      configStore,
      journalStore: new InvoicePdfArchiveJournalStore(paths.journalFilePath),
      loadDocument: vi.fn(),
      probeDirectory: vi.fn(async () => {
        throw new InvoicePdfArchiveError(
          'ARCHIVE_DIRECTORY_UNSUPPORTED',
          false,
        );
      }),
    });

    await expect(service.chooseDirectory(archiveRoot)).rejects.toMatchObject({
      code: 'ARCHIVE_DIRECTORY_UNSUPPORTED',
    });
    await expect(configStore.read()).resolves.toBeNull();
  });

  it('does not automatically retry conflicts', async () => {
    const content = createPdf();
    const loadDocument = vi.fn().mockResolvedValue({
      content: Uint8Array.from(content),
      documentId: 'document-1',
      invoiceId: 'invoice-1',
      mimeType: 'application/pdf',
      sha256: hash(content),
      sizeBytes: content.byteLength,
    });
    const { archiveRoot, service } = await createService({ loadDocument });
    await service.chooseDirectory(archiveRoot);
    await mkdir(archiveRoot, { recursive: true });
    const task = createTask(content);
    const { writeFile } = await import('node:fs/promises');
    await writeFile(join(archiveRoot, 'Lasku-2026001.pdf'), 'conflict');
    await service.queueTask(task);
    expect(loadDocument).toHaveBeenCalledTimes(1);

    await service.retryPending(true);
    expect(loadDocument).toHaveBeenCalledTimes(1);
  });

  it('allows a manual retry after the user removes a conflicting file', async () => {
    const content = createPdf();
    const loadDocument = vi.fn().mockImplementation(async () => ({
      content: Uint8Array.from(content),
      documentId: 'document-1',
      invoiceId: 'invoice-1',
      mimeType: 'application/pdf',
      sha256: hash(content),
      sizeBytes: content.byteLength,
    }));
    const { archiveRoot, service } = await createService({ loadDocument });
    await service.chooseDirectory(archiveRoot);
    const archiveFilePath = join(archiveRoot, 'Lasku-2026001.pdf');
    const { unlink, writeFile } = await import('node:fs/promises');
    await writeFile(archiveFilePath, 'conflict');
    await service.queueTask(createTask(content));
    await unlink(archiveFilePath);

    await expect(service.retryPending(false)).resolves.toMatchObject({
      lastSafeErrorCode: null,
      pendingCount: 0,
    });
    expect(loadDocument).toHaveBeenCalledTimes(2);
  });

  it('stores a configured root but writes and opens only the workspace child', async () => {
    const workspaceId = validateWorkspaceId(
      '33333333-3333-4333-8333-333333333333',
    );
    const { archiveRoot, service } = await createService({
      resolveArchiveDirectory:
        createWorkspaceInvoicePdfArchiveDirectoryResolver(workspaceId),
    });
    const task = createTask(createPdf());

    await service.chooseDirectory(archiveRoot);
    await expect(service.getDirectoryPath()).resolves.toBe(archiveRoot);
    await expect(service.getOpenDirectoryPath()).resolves.toBe(
      join(archiveRoot, workspaceId),
    );
    await expect(service.queueTask(task)).resolves.toEqual({
      archived: true,
      queued: true,
    });
    await expect(
      access(join(archiveRoot, 'Lasku-2026001.pdf')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(
      access(join(archiveRoot, workspaceId, 'Lasku-2026001.pdf')),
    ).resolves.toBeUndefined();
  });
});

async function createService(input: {
  loadDocument?: LoadInvoicePdfArchiveDocument;
  resolveArchiveDirectory?: (
    configuredArchiveRoot: string,
  ) => Promise<string>;
} = {}) {
  const root = await mkdtemp(join(tmpdir(), 'eky-archive-service-'));
  temporaryRoots.push(root);
  const archiveRoot = join(root, 'archive');
  await mkdir(archiveRoot);
  const paths = createInvoicePdfArchiveRuntimePaths(root);
  const content = createPdf();
  const loadDocument =
    input.loadDocument ??
    vi.fn().mockResolvedValue({
      content: Uint8Array.from(content),
      documentId: 'document-1',
      invoiceId: 'invoice-1',
      mimeType: 'application/pdf',
      sha256: hash(content),
      sizeBytes: content.byteLength,
    });

  return {
    archiveRoot,
    loadDocument,
    service: new InvoicePdfArchiveService({
      configStore: new InvoicePdfArchiveConfigStore(paths.configFilePath),
      journalStore: new InvoicePdfArchiveJournalStore(paths.journalFilePath),
      loadDocument,
      now: () => new Date('2026-08-03T20:00:00.000Z'),
      ...(input.resolveArchiveDirectory === undefined
        ? {}
        : { resolveArchiveDirectory: input.resolveArchiveDirectory }),
    }),
  };
}

function createTask(content: Uint8Array): InvoicePdfArchiveTask {
  return {
    attemptCount: 0,
    createdAt: '2026-08-03T20:00:00.000Z',
    deliveryEventId: 'delivery-event-1',
    documentId: 'document-1',
    expectedPdfSha256: hash(content),
    expectedPdfSize: content.byteLength,
    invoiceId: 'invoice-1',
    invoiceKind: 'standard',
    invoiceNumber: '2026001',
    lastSafeErrorCode: null,
    nextAttemptAt: '2026-08-03T20:00:00.000Z',
    schemaVersion: 1,
    taskId: 'task-1',
  };
}

function createPdf(): Uint8Array {
  return Uint8Array.from(Buffer.from('%PDF-1.7\nsynthetic'));
}

function hash(content: Uint8Array): string {
  return createHash('sha256').update(content).digest('hex');
}
