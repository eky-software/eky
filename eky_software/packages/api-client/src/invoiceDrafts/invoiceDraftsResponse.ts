import { EkyApiError, isRecord } from '../http.js';
import type {
  ApprovedInvoiceResult,
  InvoiceDraft,
  InvoiceDraftLine,
  InvoiceDraftStatus,
  InvoiceNumberingMode,
  InvoiceDraftSummary,
  InvoiceLineDiscount,
  InvoicePriceInputMode,
  InvoiceTotals,
  InvoiceUnit,
  InvoiceVatBreakdown,
} from './invoiceDraftsTypes.js';

export function readApproveInvoiceDraftResponse(
  responseBody: unknown,
): ApprovedInvoiceResult {
  if (!isRecord(responseBody)) {
    throw invalidInvoiceDraftResponse(responseBody);
  }

  return parseApprovedInvoiceResult(responseBody.approvedInvoice);
}

export function readInvoiceDraftResponse(responseBody: unknown): InvoiceDraft {
  if (!isRecord(responseBody)) {
    throw invalidInvoiceDraftResponse(responseBody);
  }

  return parseInvoiceDraft(responseBody.invoiceDraft);
}

export function readDeleteInvoiceDraftResponse(responseBody: unknown): void {
  if (!isRecord(responseBody) || responseBody.deleted !== true) {
    throw invalidInvoiceDraftResponse(responseBody);
  }
}

export function readInvoiceDraftListResponse(
  responseBody: unknown,
): InvoiceDraftSummary[] {
  if (!isRecord(responseBody) || !Array.isArray(responseBody.invoiceDrafts)) {
    throw invalidInvoiceDraftResponse(responseBody);
  }

  return responseBody.invoiceDrafts.map(parseInvoiceDraftSummary);
}

function parseApprovedInvoiceResult(value: unknown): ApprovedInvoiceResult {
  if (!isRecord(value)) {
    throw invalidInvoiceDraftResponse(value);
  }

  return {
    invoiceId: readString(value, 'invoiceId'),
    draftId: readString(value, 'draftId'),
    invoiceNumber: readString(value, 'invoiceNumber'),
    sequenceNumber: readSafeInteger(value, 'sequenceNumber'),
    sequenceScope: readString(value, 'sequenceScope'),
    numberingMode: parseInvoiceNumberingMode(value.numberingMode),
    status: parseApprovedInvoiceStatus(value.status),
  };
}

function parseInvoiceDraft(value: unknown): InvoiceDraft {
  if (
    !isRecord(value) ||
    !Array.isArray(value.lines) ||
    !isRecord(value.totals)
  ) {
    throw invalidInvoiceDraftResponse(value);
  }

  return {
    id: readString(value, 'id'),
    companyId: readString(value, 'companyId'),
    customerId: readString(value, 'customerId'),
    status: parseInvoiceDraftStatus(value.status),
    invoiceDate: readString(value, 'invoiceDate'),
    dueDate: readString(value, 'dueDate'),
    paymentTermDays: readSafeInteger(value, 'paymentTermDays'),
    priceInputMode: parsePriceInputMode(value.priceInputMode),
    subject: readString(value, 'subject'),
    orderNumber: readString(value, 'orderNumber'),
    note: readString(value, 'note'),
    lines: value.lines.map(parseInvoiceDraftLine),
    totals: parseInvoiceTotals(value.totals),
    createdAt: readString(value, 'createdAt'),
    updatedAt: readString(value, 'updatedAt'),
  };
}

function parseInvoiceDraftLine(value: unknown): InvoiceDraftLine {
  if (!isRecord(value)) {
    throw invalidInvoiceDraftResponse(value);
  }

  return {
    id: readString(value, 'id'),
    position: readSafeInteger(value, 'position'),
    code: readString(value, 'code'),
    description: readString(value, 'description'),
    quantityHundredths: readSafeInteger(value, 'quantityHundredths'),
    unit: parseInvoiceUnit(value.unit),
    unitPriceCents: readSafeInteger(value, 'unitPriceCents'),
    vatRateBasisPoints: readSafeInteger(value, 'vatRateBasisPoints'),
    priceInputMode: parsePriceInputMode(value.priceInputMode),
    discount: parseDiscount(value.discount),
    baseCents: readSafeInteger(value, 'baseCents'),
    discountCents: readSafeInteger(value, 'discountCents'),
    netCents: readSafeInteger(value, 'netCents'),
    vatCents: readSafeInteger(value, 'vatCents'),
    grossCents: readSafeInteger(value, 'grossCents'),
  };
}

function parseInvoiceTotals(value: Record<string, unknown>): InvoiceTotals {
  if (!Array.isArray(value.vatBreakdown)) {
    throw invalidInvoiceDraftResponse(value);
  }

  return {
    netTotalCents: readSafeInteger(value, 'netTotalCents'),
    vatTotalCents: readSafeInteger(value, 'vatTotalCents'),
    grossTotalCents: readSafeInteger(value, 'grossTotalCents'),
    vatBreakdown: value.vatBreakdown.map(parseInvoiceVatBreakdown),
  };
}

function parseInvoiceVatBreakdown(value: unknown): InvoiceVatBreakdown {
  if (!isRecord(value)) {
    throw invalidInvoiceDraftResponse(value);
  }

  return {
    vatRateBasisPoints: readSafeInteger(value, 'vatRateBasisPoints'),
    netCents: readSafeInteger(value, 'netCents'),
    vatCents: readSafeInteger(value, 'vatCents'),
    grossCents: readSafeInteger(value, 'grossCents'),
  };
}

function parseInvoiceDraftSummary(value: unknown): InvoiceDraftSummary {
  if (!isRecord(value)) {
    throw invalidInvoiceDraftResponse(value);
  }

  return {
    id: readString(value, 'id'),
    customerId: readString(value, 'customerId'),
    status: parseInvoiceDraftStatus(value.status),
    invoiceDate: readString(value, 'invoiceDate'),
    dueDate: readString(value, 'dueDate'),
    paymentTermDays: readSafeInteger(value, 'paymentTermDays'),
    priceInputMode: parsePriceInputMode(value.priceInputMode),
    subject: readString(value, 'subject'),
    netTotalCents: readSafeInteger(value, 'netTotalCents'),
    vatTotalCents: readSafeInteger(value, 'vatTotalCents'),
    grossTotalCents: readSafeInteger(value, 'grossTotalCents'),
    updatedAt: readString(value, 'updatedAt'),
  };
}

function parseDiscount(value: unknown): InvoiceLineDiscount {
  if (!isRecord(value)) {
    throw invalidInvoiceDraftResponse(value);
  }

  if (value.type === 'none') {
    return { type: 'none' };
  }

  if (value.type === 'percentage') {
    return {
      type: 'percentage',
      basisPoints: readSafeInteger(value, 'basisPoints'),
    };
  }

  if (value.type === 'fixed') {
    return {
      type: 'fixed',
      amountCents: readSafeInteger(value, 'amountCents'),
    };
  }

  throw invalidInvoiceDraftResponse(value);
}

function parseApprovedInvoiceStatus(value: unknown): 'approved' {
  if (value === 'approved') {
    return value;
  }

  throw invalidInvoiceDraftResponse(value);
}

function parseInvoiceDraftStatus(value: unknown): InvoiceDraftStatus {
  if (value === 'draft') {
    return value;
  }

  throw invalidInvoiceDraftResponse(value);
}

function parseInvoiceNumberingMode(value: unknown): InvoiceNumberingMode {
  if (
    value === 'calendarYearSequence' ||
    value === 'fiscalYearSequence' ||
    value === 'plainSequence'
  ) {
    return value;
  }

  throw invalidInvoiceDraftResponse(value);
}

function parsePriceInputMode(value: unknown): InvoicePriceInputMode {
  if (value === 'net' || value === 'gross') {
    return value;
  }

  throw invalidInvoiceDraftResponse(value);
}

function parseInvoiceUnit(value: unknown): InvoiceUnit {
  if (
    value === 'h' ||
    value === 'kpl' ||
    value === 'pv' ||
    value === 'km' ||
    value === 'erä'
  ) {
    return value;
  }

  throw invalidInvoiceDraftResponse(value);
}

function readString(value: Record<string, unknown>, fieldName: string): string {
  const fieldValue = value[fieldName];

  if (typeof fieldValue === 'string') {
    return fieldValue;
  }

  throw invalidInvoiceDraftResponse(value);
}

function readSafeInteger(
  value: Record<string, unknown>,
  fieldName: string,
): number {
  const fieldValue = value[fieldName];

  if (typeof fieldValue === 'number' && Number.isSafeInteger(fieldValue)) {
    return fieldValue;
  }

  throw invalidInvoiceDraftResponse(value);
}

function invalidInvoiceDraftResponse(responseBody: unknown): EkyApiError {
  return new EkyApiError('Invalid invoice draft response.', { responseBody });
}
