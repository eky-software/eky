import {
  invoicePdfArchiveBrokerProtocolVersion,
  parseInvoicePdfArchiveBrokerRequest,
  readInvoicePdfArchiveBrokerRequestId,
  type InvoicePdfArchiveBrokerResponse,
} from './invoicePdfArchiveBrokerProtocol.js';
import type { InvoicePdfArchiveBrokerTransport } from './invoicePdfArchiveBrokerTransport.js';
import type { InvoicePdfArchiveService } from './invoicePdfArchiveService.js';
import { invoicePdfArchiveSchemaVersion } from './invoicePdfArchiveTypes.js';

export function startInvoicePdfArchiveBrokerMain(input: {
  service: Pick<InvoicePdfArchiveService, 'queueTask'>;
  transport: InvoicePdfArchiveBrokerTransport;
}): { close(): void } {
  let closed = false;
  let operationQueue = Promise.resolve();
  const unsubscribe = input.transport.subscribe((value) => {
    operationQueue = operationQueue
      .then(async () => {
        if (closed) {
          return;
        }
        const response = await handleInvoicePdfArchiveBrokerMessage(
          value,
          input.service,
        );

        if (!closed && response !== undefined) {
          input.transport.send(response);
        }
      })
      .catch(() => undefined);
  });

  return {
    close() {
      if (closed) {
        return;
      }
      closed = true;
      unsubscribe();
      input.transport.close();
    },
  };
}

export async function handleInvoicePdfArchiveBrokerMessage(
  value: unknown,
  service: Pick<InvoicePdfArchiveService, 'queueTask'>,
): Promise<InvoicePdfArchiveBrokerResponse | undefined> {
  const requestId = readInvoicePdfArchiveBrokerRequestId(value);
  const request = parseInvoicePdfArchiveBrokerRequest(value);

  if (request === undefined) {
    return requestId === undefined
      ? undefined
      : createErrorResponse(requestId, 'ARCHIVE_BROKER_REQUEST_INVALID');
  }

  try {
    await service.queueTask({
      ...request.task,
      attemptCount: 0,
      lastSafeErrorCode: null,
      nextAttemptAt: request.task.createdAt,
      schemaVersion: invoicePdfArchiveSchemaVersion,
    });
    return {
      ok: true,
      protocolVersion: invoicePdfArchiveBrokerProtocolVersion,
      requestId: request.requestId,
      result: { accepted: true },
    };
  } catch {
    return createErrorResponse(
      request.requestId,
      'ARCHIVE_BROKER_UNAVAILABLE',
    );
  }
}

function createErrorResponse(
  requestId: string,
  errorCode:
    | 'ARCHIVE_BROKER_REQUEST_INVALID'
    | 'ARCHIVE_BROKER_UNAVAILABLE',
): InvoicePdfArchiveBrokerResponse {
  return {
    errorCode,
    ok: false,
    protocolVersion: invoicePdfArchiveBrokerProtocolVersion,
    requestId,
  };
}
