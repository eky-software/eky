import { isRecord } from '../../http.js';
import {
  invalidApprovedInvoiceResponse,
  readString,
} from './approvedInvoiceResponsePrimitives.js';
import type { ReopenedApprovedInvoice } from './approvedInvoicesTypes.js';

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
