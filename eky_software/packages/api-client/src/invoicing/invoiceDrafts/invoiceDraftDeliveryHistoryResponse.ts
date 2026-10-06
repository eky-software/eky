import { EkyApiError, isRecord } from '../../http.js';
import { readInvoiceDeliveryEventListResponse } from '../approvedInvoices/approvedInvoiceDeliveryResponse.js';
import type { InvoiceDraftDeliveryHistory } from './invoiceDraftsTypes.js';

export function readInvoiceDraftDeliveryHistoryResponse(
  responseBody: unknown,
): InvoiceDraftDeliveryHistory {
  if (!isRecord(responseBody) || !isRecord(responseBody.invoiceDeliveryHistory)) {
    throw invalidResponse();
  }
  const history = responseBody.invoiceDeliveryHistory;
  const invoiceId = history.invoiceId;
  if (invoiceId !== null && (
    typeof invoiceId !== 'string' || invoiceId.length < 1 || invoiceId.length > 100
    || /[^A-Za-z0-9_-]/.test(invoiceId)
  )) {
    throw invalidResponse();
  }
  const events = readInvoiceDeliveryEventListResponse(history);
  if (invoiceId === null && events.length !== 0) throw invalidResponse();
  return { invoiceId, events };
}

function invalidResponse(): EkyApiError {
  return new EkyApiError('Invalid invoice draft delivery history response.');
}
