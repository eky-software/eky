import { randomUUID } from 'node:crypto';

import type { ApprovedInvoiceDocumentMetadata } from '../domain/approvedInvoiceDocument.js';
import type { ApprovedInvoiceView } from '../domain/approvedInvoiceView.js';
import type { DeliveredInvoiceArchiveTaskSink } from '../ports/deliveredInvoiceArchiveTaskSink.js';

export async function queueDeliveredInvoiceArchiveTaskSafely(
  input: {
    createdAt: string;
    deliveryEventId: string;
    document: ApprovedInvoiceDocumentMetadata;
    invoice: Pick<
      ApprovedInvoiceView,
      'id' | 'invoiceKind' | 'invoiceNumber'
    >;
  },
  taskSink: DeliveredInvoiceArchiveTaskSink,
): Promise<void> {
  try {
    await taskSink.queueDeliveredInvoiceArchiveTask({
      createdAt: input.createdAt,
      deliveryEventId: input.deliveryEventId,
      documentId: input.document.id,
      expectedPdfSha256: input.document.sha256,
      expectedPdfSize: input.document.sizeBytes,
      invoiceId: input.invoice.id,
      invoiceKind: input.invoice.invoiceKind,
      invoiceNumber: input.invoice.invoiceNumber,
      taskId: randomUUID(),
    });
  } catch {
    // Delivery is durable. Archival stays an independent retryable side effect.
  }
}
