import { describe, expect, it, vi } from 'vitest';

import { handleInvoicePdfArchiveBrokerMessage } from './invoicePdfArchiveBrokerMain.js';
import { createInvoicePdfArchiveBrokerRequest } from './invoicePdfArchiveBrokerProtocol.js';

describe('handleInvoicePdfArchiveBrokerMessage', () => {
  it('persists a validated task before acknowledging it', async () => {
    const queueTask = vi.fn(async () => ({
      archived: false,
      queued: true,
    }));
    const response = await handleInvoicePdfArchiveBrokerMessage(
      createRequest(),
      { queueTask },
    );

    expect(queueTask).toHaveBeenCalledWith(
      expect.objectContaining({
        attemptCount: 0,
        lastSafeErrorCode: null,
        nextAttemptAt: '2026-08-03T20:00:00.000Z',
        schemaVersion: 1,
      }),
    );
    expect(response).toMatchObject({
      ok: true,
      result: { accepted: true },
    });
  });

  it('returns only a safe broker error when persistence fails', async () => {
    const response = await handleInvoicePdfArchiveBrokerMessage(
      createRequest(),
      {
        queueTask: vi.fn(async () => {
          throw new Error('C:\\private\\archive');
        }),
      },
    );

    expect(response).toStrictEqual({
      errorCode: 'ARCHIVE_BROKER_UNAVAILABLE',
      ok: false,
      protocolVersion: 1,
      requestId: 'ee827e66-aaab-4fcf-b94f-87944c8fb6c2',
    });
  });
});

function createRequest() {
  return createInvoicePdfArchiveBrokerRequest({
    requestId: 'ee827e66-aaab-4fcf-b94f-87944c8fb6c2',
    task: {
      createdAt: '2026-08-03T20:00:00.000Z',
      deliveryEventId: 'delivery-event-1',
      documentId: 'document-1',
      expectedPdfSha256: 'a'.repeat(64),
      expectedPdfSize: 2048,
      invoiceId: 'invoice-1',
      invoiceKind: 'standard',
      invoiceNumber: '2026001',
      taskId: 'task-1',
    },
  });
}
