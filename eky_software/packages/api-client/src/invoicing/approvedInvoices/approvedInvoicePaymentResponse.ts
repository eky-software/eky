import { isRecord } from '../../http.js';
import {
  invalidApprovedInvoiceResponse,
  parseInvoicePaymentReadModel,
  readString,
} from './approvedInvoiceResponsePrimitives.js';
import type { InvoicePaymentSummary } from './approvedInvoicesTypes.js';

export function readInvoicePaymentResponse(
  responseBody: unknown,
): InvoicePaymentSummary {
  if (!isRecord(responseBody) || !isRecord(responseBody.payment)) {
    throw invalidApprovedInvoiceResponse(responseBody);
  }

  const payment = responseBody.payment;
  const projection = parseInvoicePaymentReadModel(payment, 'standard');

  if (projection.paymentState === 'notApplicable') {
    throw invalidApprovedInvoiceResponse(responseBody);
  }

  return {
    invoiceId: readString(payment, 'invoiceId'),
    invoiceNumber: readString(payment, 'invoiceNumber'),
    paymentState: projection.paymentState,
    paidOn: projection.paidOn,
    paidAmountCents: projection.paidAmountCents,
    paymentSource: projection.paymentSource,
  };
}
