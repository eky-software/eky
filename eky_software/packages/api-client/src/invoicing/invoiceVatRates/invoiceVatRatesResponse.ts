import { EkyApiError, isRecord } from '../../http.js';
import type {
  InvoiceVatRate,
  InvoiceVatRatesView,
} from './invoiceVatRatesTypes.js';

export function readInvoiceVatRatesResponse(
  responseBody: unknown,
): InvoiceVatRatesView {
  if (!isRecord(responseBody) || !isRecord(responseBody.invoiceVatRates)) {
    throw invalidInvoiceVatRatesResponse(responseBody);
  }

  const view = responseBody.invoiceVatRates;

  if (!Array.isArray(view.vatRates) || typeof view.isPersisted !== 'boolean') {
    throw invalidInvoiceVatRatesResponse(responseBody);
  }

  return {
    vatRates: view.vatRates.map((value) => parseInvoiceVatRate(value, responseBody)),
    isPersisted: view.isPersisted,
  };
}

function parseInvoiceVatRate(
  value: unknown,
  responseBody: unknown,
): InvoiceVatRate {
  if (!isRecord(value)) {
    throw invalidInvoiceVatRatesResponse(responseBody);
  }

  const { rateBasisPoints, label, isActive, isDefault, sortOrder } = value;

  if (
    typeof rateBasisPoints !== 'number' ||
    !Number.isSafeInteger(rateBasisPoints) ||
    rateBasisPoints < 0 ||
    rateBasisPoints > 10000 ||
    typeof label !== 'string' ||
    label.length < 1 ||
    label.length > 50 ||
    label !== label.trim() ||
    /[\r\n\0]/.test(label) ||
    typeof isActive !== 'boolean' ||
    typeof isDefault !== 'boolean' ||
    typeof sortOrder !== 'number' ||
    !Number.isSafeInteger(sortOrder) ||
    sortOrder < 0 ||
    sortOrder > 1000
  ) {
    throw invalidInvoiceVatRatesResponse(responseBody);
  }

  return { rateBasisPoints, label, isActive, isDefault, sortOrder };
}

function invalidInvoiceVatRatesResponse(responseBody: unknown): EkyApiError {
  return new EkyApiError('Invalid invoice VAT rates response.', {
    responseBody,
  });
}
