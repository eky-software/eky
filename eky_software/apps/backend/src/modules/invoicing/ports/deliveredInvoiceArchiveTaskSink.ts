import type { InvoiceKind } from '../domain/invoiceKind.js';

export interface DeliveredInvoiceArchiveTask {
  createdAt: string;
  deliveryEventId: string;
  documentId: string;
  expectedPdfSha256: string;
  expectedPdfSize: number;
  invoiceId: string;
  invoiceKind: InvoiceKind;
  invoiceNumber: string;
  taskId: string;
}

export interface DeliveredInvoiceArchiveTaskSink {
  queueDeliveredInvoiceArchiveTask(
    task: DeliveredInvoiceArchiveTask,
  ): Promise<void>;
}

export const noOpDeliveredInvoiceArchiveTaskSink: DeliveredInvoiceArchiveTaskSink =
  Object.freeze({
    async queueDeliveredInvoiceArchiveTask() {},
  });
