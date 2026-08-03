import { createHash } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { createInvoicePdfArchiveBackendLoader } from './invoicePdfArchiveBackendLoader.js';
import type { InvoicePdfArchiveTask } from './invoicePdfArchiveTypes.js';

describe('createInvoicePdfArchiveBackendLoader', () => {
  it('loads metadata and PDF through authenticated loopback requests', async () => {
    const content = Uint8Array.from(Buffer.from('%PDF-1.7\nsynthetic'));
    const task = createTask(content);
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json(
          {
            document: {
              id: task.documentId,
              invoiceId: task.invoiceId,
              mimeType: 'application/pdf',
              sha256: task.expectedPdfSha256,
              sizeBytes: task.expectedPdfSize,
            },
          },
          { headers: { 'content-length': '220' } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(content, {
          headers: {
            'content-length': String(content.byteLength),
            'content-type': 'application/pdf; charset=binary',
          },
        }),
      );
    const load = createInvoicePdfArchiveBackendLoader({
      backendOrigin: 'http://127.0.0.1:3000',
      fetchImplementation,
      runtimeSessionSecret: 'session-secret',
    });

    await expect(load(task)).resolves.toMatchObject({
      documentId: task.documentId,
      invoiceId: task.invoiceId,
      mimeType: 'application/pdf',
    });
    expect(fetchImplementation).toHaveBeenCalledTimes(2);
    for (const [, init] of fetchImplementation.mock.calls) {
      expect(new Headers(init?.headers).get('x-eky-local-session')).toBe(
        'session-secret',
      );
    }
  });

  it('stops before loading bytes when metadata is not bound to the task', async () => {
    const content = Uint8Array.from(Buffer.from('%PDF-1.7\nsynthetic'));
    const task = createTask(content);
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        document: {
          id: 'another-document',
          invoiceId: task.invoiceId,
          mimeType: 'application/pdf',
          sha256: task.expectedPdfSha256,
          sizeBytes: task.expectedPdfSize,
        },
      }),
    );

    await expect(
      createInvoicePdfArchiveBackendLoader({
        backendOrigin: 'http://127.0.0.1:3000',
        fetchImplementation,
        runtimeSessionSecret: 'session-secret',
      })(task),
    ).rejects.toMatchObject({ code: 'ARCHIVE_DOCUMENT_INVALID' });
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
  });

  it('rejects missing content length and non-PDF media types', async () => {
    const content = Uint8Array.from(Buffer.from('%PDF-1.7\nsynthetic'));
    const task = createTask(content);
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          document: {
            id: task.documentId,
            invoiceId: task.invoiceId,
            mimeType: 'application/pdf',
            sha256: task.expectedPdfSha256,
            sizeBytes: task.expectedPdfSize,
          },
        }),
      )
      .mockResolvedValueOnce(
        new Response(content, {
          headers: { 'content-type': 'text/plain' },
        }),
      );

    await expect(
      createInvoicePdfArchiveBackendLoader({
        backendOrigin: 'http://127.0.0.1:3000',
        fetchImplementation,
        runtimeSessionSecret: 'session-secret',
      })(task),
    ).rejects.toMatchObject({ code: 'ARCHIVE_DOCUMENT_INVALID' });
  });
});

function createTask(content: Uint8Array): InvoicePdfArchiveTask {
  return {
    attemptCount: 0,
    createdAt: '2026-08-03T20:00:00.000Z',
    deliveryEventId: 'delivery-event-1',
    documentId: 'document-1',
    expectedPdfSha256: createHash('sha256').update(content).digest('hex'),
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
