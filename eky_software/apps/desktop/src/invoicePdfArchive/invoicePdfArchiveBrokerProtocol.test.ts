import { describe, expect, it } from 'vitest';

import {
  createInvoicePdfArchiveBrokerRequest,
  parseInvoicePdfArchiveBrokerRequest,
  parseInvoicePdfArchiveBrokerResponse,
  type DeliveredInvoiceArchiveTaskRequest,
} from './invoicePdfArchiveBrokerProtocol.js';

describe('invoice PDF archive broker protocol', () => {
  it('accepts the exact bounded delivery task contract', () => {
    const request = createInvoicePdfArchiveBrokerRequest({
      requestId: 'ee827e66-aaab-4fcf-b94f-87944c8fb6c2',
      task: createTask(),
    });

    expect(parseInvoicePdfArchiveBrokerRequest(request)).toStrictEqual(request);
  });

  it('rejects extra fields, unsafe filenames and oversized PDFs', () => {
    const base = createInvoicePdfArchiveBrokerRequest({
      requestId: 'ee827e66-aaab-4fcf-b94f-87944c8fb6c2',
      task: createTask(),
    });

    expect(
      parseInvoicePdfArchiveBrokerRequest({ ...base, url: 'file:///secret' }),
    ).toBeUndefined();
    expect(
      parseInvoicePdfArchiveBrokerRequest({
        ...base,
        task: { ...base.task, invoiceNumber: '../escape' },
      }),
    ).toBeUndefined();
    expect(
      parseInvoicePdfArchiveBrokerRequest({
        ...base,
        task: { ...base.task, expectedPdfSize: 25 * 1024 * 1024 + 1 },
      }),
    ).toBeUndefined();
  });

  it('accepts only the exact bounded response contract', () => {
    expect(
      parseInvoicePdfArchiveBrokerResponse({
        ok: true,
        protocolVersion: 1,
        requestId: 'ee827e66-aaab-4fcf-b94f-87944c8fb6c2',
        result: { accepted: true },
      }),
    ).toBeDefined();
    expect(
      parseInvoicePdfArchiveBrokerResponse({
        ok: true,
        protocolVersion: 1,
        requestId: 'ee827e66-aaab-4fcf-b94f-87944c8fb6c2',
        result: { accepted: true, path: 'C:\\private' },
      }),
    ).toBeUndefined();
  });
});

function createTask(): DeliveredInvoiceArchiveTaskRequest {
  return {
    createdAt: '2026-08-03T20:00:00.000Z',
    deliveryEventId: 'delivery-event-1',
    documentId: 'document-1',
    expectedPdfSha256: 'a'.repeat(64),
    expectedPdfSize: 2048,
    invoiceId: 'invoice-1',
    invoiceKind: 'standard',
    invoiceNumber: '2026001',
    taskId: 'task-1',
  };
}
