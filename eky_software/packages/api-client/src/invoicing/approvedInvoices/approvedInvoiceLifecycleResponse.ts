import { isRecord } from '../../http.js';
import {
  invalidApprovedInvoiceResponse,
  readString,
} from './approvedInvoiceResponsePrimitives.js';
import type {
  CancelledApprovedInvoice,
  ReopenedApprovedInvoice,
} from './approvedInvoicesTypes.js';

export function readCancelledApprovedInvoiceResponse(
  responseBody: unknown,
): CancelledApprovedInvoice {
  if (!isRecord(responseBody) || !isRecord(responseBody.cancellation)) {
    throw invalidApprovedInvoiceResponse(responseBody);
  }

  const cancellation = responseBody.cancellation;

  if (
    cancellation.invoiceKind !== 'standard' &&
    cancellation.invoiceKind !== 'credit'
  ) {
    throw invalidApprovedInvoiceResponse(responseBody);
  }

  if (cancellation.status !== 'cancelled') {
    throw invalidApprovedInvoiceResponse(responseBody);
  }

  return {
    cancellationReason: readString(cancellation, 'cancellationReason'),
    cancelledAt: readString(cancellation, 'cancelledAt'),
    cancelledBy: readString(cancellation, 'cancelledBy'),
    invoiceId: readString(cancellation, 'invoiceId'),
    invoiceKind: cancellation.invoiceKind,
    invoiceNumber: readString(cancellation, 'invoiceNumber'),
    status: cancellation.status,
  };
}

export function readReopenedApprovedInvoiceResponse(
  responseBody: unknown,
): ReopenedApprovedInvoice {
  if (!isRecord(responseBody)) {
    throw invalidApprovedInvoiceResponse(responseBody);
  }

  return {
    invoiceDraftId: readString(responseBody, 'invoiceDraftId'),
    invoiceId: readString(responseBody, 'invoiceId'),
  };
}
