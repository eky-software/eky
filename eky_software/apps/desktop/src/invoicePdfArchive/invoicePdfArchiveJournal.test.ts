import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, describe, expect, it } from 'vitest';

import { createInvoicePdfArchiveRuntimePaths } from './invoicePdfArchivePaths.js';
import {
  createEmptyJournal,
  InvoicePdfArchiveJournalStore,
  parseInvoicePdfArchiveJournal,
  parseInvoicePdfArchiveTask,
} from './invoicePdfArchiveJournal.js';
import {
  InvoicePdfArchiveError,
  type InvoicePdfArchiveTask,
} from './invoicePdfArchiveTypes.js';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) =>
      rm(root, { force: true, recursive: true }),
    ),
  );
});

describe('InvoicePdfArchiveJournalStore', () => {
  it('queues a task idempotently without storing business data', async () => {
    const store = await createStore();
    const task = createTask();

    await expect(store.queue(task)).resolves.toBe(true);
    await expect(store.queue(task)).resolves.toBe(false);

    const journal = await store.get();
    expect(journal.tasks).toEqual([task]);
    expect(JSON.stringify(journal)).not.toMatch(
      /customer|email|iban|directoryPath|pdfContent/i,
    );
  });

  it('records bounded retry state and removes a completed task', async () => {
    const store = await createStore();
    const task = createTask();
    await store.queue(task);

    await store.recordFailure(task.taskId, {
      errorCode: 'ARCHIVE_DIRECTORY_UNAVAILABLE',
      nextAttemptAt: '2026-08-03T20:05:00.000Z',
    });
    await expect(store.get()).resolves.toMatchObject({
      lastSafeErrorCode: 'ARCHIVE_DIRECTORY_UNAVAILABLE',
      tasks: [
        {
          attemptCount: 1,
          lastSafeErrorCode: 'ARCHIVE_DIRECTORY_UNAVAILABLE',
          nextAttemptAt: '2026-08-03T20:05:00.000Z',
        },
      ],
    });

    await store.recordSuccess(task.taskId, '2026-08-03T20:10:00.000Z');
    await expect(store.get()).resolves.toEqual({
      ...createEmptyJournal(),
      lastArchivedAt: '2026-08-03T20:10:00.000Z',
    });
  });

  it('rejects duplicate delivery event identities', () => {
    const task = createTask();

    expect(() =>
      parseInvoicePdfArchiveJournal({
        ...createEmptyJournal(),
        tasks: [task, { ...task, taskId: 'task-2' }],
      }),
    ).toThrowError(InvoicePdfArchiveError);
  });

  it('rejects unknown fields, unsafe invoice numbers and oversized PDFs', () => {
    expect(() =>
      parseInvoicePdfArchiveTask({
        ...createTask(),
        invoiceNumber: '../invoice',
      }),
    ).toThrowError(InvoicePdfArchiveError);
    expect(() =>
      parseInvoicePdfArchiveTask({
        ...createTask(),
        expectedPdfSize: 25 * 1024 * 1024 + 1,
      }),
    ).toThrowError(InvoicePdfArchiveError);
    expect(() =>
      parseInvoicePdfArchiveTask({
        ...createTask(),
        recipientEmail: 'synthetic@example.invalid',
      }),
    ).toThrowError(InvoicePdfArchiveError);
  });
});

function createTask(): InvoicePdfArchiveTask {
  return {
    attemptCount: 0,
    createdAt: '2026-08-03T20:00:00.000Z',
    deliveryEventId: 'delivery-event-1',
    documentId: 'document-1',
    expectedPdfSha256:
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    expectedPdfSize: 2_048,
    invoiceId: 'invoice-1',
    invoiceKind: 'standard',
    invoiceNumber: '2026001',
    lastSafeErrorCode: null,
    nextAttemptAt: '2026-08-03T20:00:00.000Z',
    schemaVersion: 1,
    taskId: 'task-1',
  };
}

async function createStore(): Promise<InvoicePdfArchiveJournalStore> {
  const root = await mkdtemp(join(tmpdir(), 'eky-archive-journal-'));
  temporaryRoots.push(root);
  return new InvoicePdfArchiveJournalStore(
    createInvoicePdfArchiveRuntimePaths(root).journalFilePath,
  );
}
