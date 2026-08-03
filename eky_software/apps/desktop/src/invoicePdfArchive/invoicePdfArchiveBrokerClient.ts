import { randomUUID } from 'node:crypto';

import {
  createInvoicePdfArchiveBrokerRequest,
  parseInvoicePdfArchiveBrokerResponse,
  readInvoicePdfArchiveBrokerRequestId,
  type DeliveredInvoiceArchiveTaskRequest,
} from './invoicePdfArchiveBrokerProtocol.js';
import type { InvoicePdfArchiveBrokerTransport } from './invoicePdfArchiveBrokerTransport.js';

const requestTimeoutMilliseconds = 10_000;

export class InvoicePdfArchiveBrokerClient {
  private closed = false;
  private readonly pending = new Map<
    string,
    {
      reject(error: Error): void;
      resolve(): void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private readonly unsubscribe: () => void;

  constructor(private readonly transport: InvoicePdfArchiveBrokerTransport) {
    this.unsubscribe = transport.subscribe((value) => this.receive(value));
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.unsubscribe();
    this.transport.close();

    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error('ARCHIVE_BROKER_UNAVAILABLE'));
    }
    this.pending.clear();
  }

  queueDeliveredInvoiceArchiveTask(
    task: DeliveredInvoiceArchiveTaskRequest,
  ): Promise<void> {
    if (this.closed) {
      return Promise.reject(new Error('ARCHIVE_BROKER_UNAVAILABLE'));
    }

    const requestId = randomUUID();
    const request = createInvoicePdfArchiveBrokerRequest({ requestId, task });

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error('ARCHIVE_BROKER_UNAVAILABLE'));
      }, requestTimeoutMilliseconds);
      this.pending.set(requestId, { reject, resolve, timer });

      try {
        this.transport.send(request);
      } catch {
        clearTimeout(timer);
        this.pending.delete(requestId);
        reject(new Error('ARCHIVE_BROKER_UNAVAILABLE'));
      }
    });
  }

  private receive(value: unknown): void {
    const requestId = readInvoicePdfArchiveBrokerRequestId(value);

    if (requestId === undefined) {
      return;
    }
    const pending = this.pending.get(requestId);

    if (pending === undefined) {
      return;
    }
    const response = parseInvoicePdfArchiveBrokerResponse(value);
    clearTimeout(pending.timer);
    this.pending.delete(requestId);

    if (response === undefined || !response.ok) {
      pending.reject(new Error('ARCHIVE_BROKER_UNAVAILABLE'));
      return;
    }
    pending.resolve();
  }
}
