import { describe, expect, it, vi } from 'vitest';

import { queueDeliveredInvoiceArchiveTaskSafely } from './queueDeliveredInvoiceArchiveTaskSafely.js';

describe('queueDeliveredInvoiceArchiveTaskSafely', () => {
  it('reports a bounded failure and leaves the next delivery queueable', async () => {
    const queueDeliveredInvoiceArchiveTask = vi
      .fn()
      .mockRejectedValueOnce(new Error('private path and identifiers'))
      .mockResolvedValueOnce(undefined);
    const reportQueueFailure = vi.fn();
    const input = createInput();

    await expect(
      queueDeliveredInvoiceArchiveTaskSafely(
        input,
        { queueDeliveredInvoiceArchiveTask },
        { reportQueueFailure },
      ),
    ).resolves.toBeUndefined();
    await expect(
      queueDeliveredInvoiceArchiveTaskSafely(
        { ...input, deliveryEventId: 'delivery-2' },
        { queueDeliveredInvoiceArchiveTask },
        { reportQueueFailure },
      ),
    ).resolves.toBeUndefined();

    expect(reportQueueFailure).toHaveBeenCalledOnce();
    expect(reportQueueFailure).toHaveBeenCalledWith();
    expect(queueDeliveredInvoiceArchiveTask).toHaveBeenCalledTimes(2);
    expect(queueDeliveredInvoiceArchiveTask).toHaveBeenLastCalledWith(
      expect.objectContaining({ deliveryEventId: 'delivery-2' }),
    );
  });

  it('does not replace a durable delivery result when reporting also fails', async () => {
    await expect(
      queueDeliveredInvoiceArchiveTaskSafely(
        createInput(),
        {
          queueDeliveredInvoiceArchiveTask: vi.fn(async () => {
            throw new Error('queue failed');
          }),
        },
        {
          reportQueueFailure: vi.fn(() => {
            throw new Error('logger failed');
          }),
        },
      ),
    ).resolves.toBeUndefined();
  });
});

function createInput() {
  return {
    createdAt: '2026-08-03T20:00:00.000Z',
    deliveryEventId: 'delivery-1',
    document: {
      companyId: 'company-1',
      createdAt: '2026-08-03T20:00:00.000Z',
      documentType: 'approved_invoice_pdf' as const,
      fileName: 'lasku-2026001.pdf',
      id: 'document-1',
      invoiceId: 'invoice-1',
      mimeType: 'application/pdf' as const,
      sha256: 'a'.repeat(64),
      sizeBytes: 512,
      storagePath: 'private/path.pdf',
    },
    invoice: {
      id: 'invoice-1',
      invoiceKind: 'standard' as const,
      invoiceNumber: '2026001',
    },
  };
}
