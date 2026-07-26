import { EkyApiError, isRecord } from '../../http.js';
import type {
  InvoiceLineDiscount,
  InvoicePerformancePeriod,
  InvoiceTaxTreatment,
  InvoiceTotals,
  InvoiceUnit,
  InvoiceVatBreakdown,
} from '../invoiceDrafts/index.js';
import type {
  ApprovedCreditInvoiceResult,
  CreditInvoiceDraft,
  CreditInvoiceDraftLine,
  CreditInvoiceParty,
} from './invoiceCreditsTypes.js';

export function readApproveCreditInvoiceDraftResponse(
  responseBody: unknown,
): ApprovedCreditInvoiceResult {
  if (!isRecord(responseBody) || !isRecord(responseBody.approvedInvoice)) {
    throw invalidCreditInvoiceResponse(responseBody);
  }

  const value = responseBody.approvedInvoice;

  return {
    invoiceId: readString(value, 'invoiceId'),
    draftId: readString(value, 'draftId'),
    invoiceNumber: readString(value, 'invoiceNumber'),
    sequenceNumber: readSafeInteger(value, 'sequenceNumber'),
    sequenceScope: readString(value, 'sequenceScope'),
    numberingMode: parseNumberingMode(value.numberingMode),
    status: parseApprovedStatus(value.status),
  };
}

export function readCreditInvoiceDraftResponse(
  responseBody: unknown,
): CreditInvoiceDraft {
  if (!isRecord(responseBody)) {
    throw invalidCreditInvoiceResponse(responseBody);
  }

  return parseCreditInvoiceDraft(responseBody.creditInvoiceDraft);
}

function parseApprovedStatus(value: unknown): 'approved' {
  if (value === 'approved') {
    return value;
  }

  throw invalidCreditInvoiceResponse(value);
}

function parseNumberingMode(
  value: unknown,
): ApprovedCreditInvoiceResult['numberingMode'] {
  if (
    value === 'calendarYearSequence' ||
    value === 'fiscalYearSequence' ||
    value === 'plainSequence'
  ) {
    return value;
  }

  throw invalidCreditInvoiceResponse(value);
}

function parseCreditInvoiceDraft(value: unknown): CreditInvoiceDraft {
  if (
    !isRecord(value) ||
    value.invoiceKind !== 'credit' ||
    !isRecord(value.customer) ||
    !isRecord(value.billingRecipient) ||
    !Array.isArray(value.lines) ||
    !isRecord(value.totals)
  ) {
    throw invalidCreditInvoiceResponse(value);
  }

  return {
    id: readString(value, 'id'),
    invoiceKind: 'credit',
    creditedInvoiceId: readString(value, 'creditedInvoiceId'),
    creditedInvoiceNumber: readString(value, 'creditedInvoiceNumber'),
    creditedInvoiceDate: readString(value, 'creditedInvoiceDate'),
    customer: parseParty(value.customer),
    billingRecipient: parseParty(value.billingRecipient),
    invoiceDate: readString(value, 'invoiceDate'),
    dueDate: readString(value, 'dueDate'),
    paymentTermDays: readZero(value, 'paymentTermDays'),
    reminderPeriodDays: readZero(value, 'reminderPeriodDays'),
    latePaymentInterestBasisPoints: readZero(
      value,
      'latePaymentInterestBasisPoints',
    ),
    priceInputMode: parsePriceInputMode(value.priceInputMode),
    taxTreatment: parseTaxTreatment(value.taxTreatment),
    performancePeriod: parsePerformancePeriod(value.performancePeriod),
    subject: readString(value, 'subject'),
    orderNumber: readString(value, 'orderNumber'),
    note: readString(value, 'note'),
    deliveryAddressText: readString(value, 'deliveryAddressText'),
    refundIban: readString(value, 'refundIban'),
    lines: value.lines.map(parseCreditLine),
    totals: parseTotals(value.totals),
    createdAt: readString(value, 'createdAt'),
    updatedAt: readString(value, 'updatedAt'),
  };
}

function parseParty(value: Record<string, unknown>): CreditInvoiceParty {
  return {
    customerId: readNullableString(value, 'customerId'),
    customerNumber: readString(value, 'customerNumber'),
    name: readString(value, 'name'),
    businessId: readString(value, 'businessId'),
    email: readString(value, 'email'),
    phone: readString(value, 'phone'),
    streetAddress: readString(value, 'streetAddress'),
    postalCode: readString(value, 'postalCode'),
    city: readString(value, 'city'),
  };
}

function parseCreditLine(value: unknown): CreditInvoiceDraftLine {
  if (!isRecord(value)) {
    throw invalidCreditInvoiceResponse(value);
  }

  const lineType = parseCreditLineType(value.lineType);
  const sourceInvoiceLineId = readNullableString(
    value,
    'sourceInvoiceLineId',
  );
  const maximumQuantityHundredths = readNullableSafeInteger(
    value,
    'maximumQuantityHundredths',
  );

  const common = {
    id: readNullableString(value, 'id'),
    isIncluded: readBoolean(value, 'isIncluded'),
    position: readSafeInteger(value, 'position'),
    code: readString(value, 'code'),
    description: readString(value, 'description'),
    quantityHundredths: readSafeInteger(value, 'quantityHundredths'),
    unit: parseInvoiceUnit(value.unit),
    unitPriceCents: readSafeInteger(value, 'unitPriceCents'),
    vatRateBasisPoints: readNullableSafeInteger(
      value,
      'vatRateBasisPoints',
    ),
    discount: parseDiscount(value.discount),
    baseCents: readSafeInteger(value, 'baseCents'),
    discountCents: readSafeInteger(value, 'discountCents'),
    netCents: readSafeInteger(value, 'netCents'),
    vatCents: readSafeInteger(value, 'vatCents'),
    grossCents: readSafeInteger(value, 'grossCents'),
  };

  if (lineType === 'source') {
    if (
      sourceInvoiceLineId === null ||
      maximumQuantityHundredths === null
    ) {
      throw invalidCreditInvoiceResponse(value);
    }

    return {
      ...common,
      lineType,
      sourceInvoiceLineId,
      maximumQuantityHundredths,
    };
  }

  if (
    sourceInvoiceLineId !== null ||
    maximumQuantityHundredths !== null
  ) {
    throw invalidCreditInvoiceResponse(value);
  }

  return {
    ...common,
    lineType,
    sourceInvoiceLineId: null,
    maximumQuantityHundredths: null,
  };
}

function parseCreditLineType(value: unknown): 'source' | 'manual' {
  if (value === 'source' || value === 'manual') {
    return value;
  }

  throw invalidCreditInvoiceResponse(value);
}

function parseTotals(value: Record<string, unknown>): InvoiceTotals {
  if (!Array.isArray(value.vatBreakdown)) {
    throw invalidCreditInvoiceResponse(value);
  }

  return {
    netTotalCents: readSafeInteger(value, 'netTotalCents'),
    vatTotalCents: readSafeInteger(value, 'vatTotalCents'),
    grossTotalCents: readSafeInteger(value, 'grossTotalCents'),
    vatBreakdown: value.vatBreakdown.map(parseVatBreakdown),
  };
}

function parseVatBreakdown(value: unknown): InvoiceVatBreakdown {
  if (!isRecord(value)) {
    throw invalidCreditInvoiceResponse(value);
  }

  return {
    vatRateBasisPoints: readSafeInteger(value, 'vatRateBasisPoints'),
    netCents: readSafeInteger(value, 'netCents'),
    vatCents: readSafeInteger(value, 'vatCents'),
    grossCents: readSafeInteger(value, 'grossCents'),
  };
}

function parseDiscount(value: unknown): InvoiceLineDiscount {
  if (!isRecord(value)) {
    throw invalidCreditInvoiceResponse(value);
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

  throw invalidCreditInvoiceResponse(value);
}

function parsePriceInputMode(value: unknown): 'net' | 'gross' {
  if (value === 'net' || value === 'gross') {
    return value;
  }

  throw invalidCreditInvoiceResponse(value);
}

function parseTaxTreatment(value: unknown): InvoiceTaxTreatment {
  if (value === 'normalVat' || value === 'reverseChargeConstruction') {
    return value;
  }

  throw invalidCreditInvoiceResponse(value);
}

function parsePerformancePeriod(value: unknown): InvoicePerformancePeriod {
  if (!isRecord(value)) {
    throw invalidCreditInvoiceResponse(value);
  }

  if (value.type === 'invoiceDate' && Object.keys(value).length === 1) {
    return { type: 'invoiceDate' };
  }

  if (
    value.type === 'singleDate' &&
    Object.keys(value).length === 2 &&
    typeof value.date === 'string'
  ) {
    return { type: 'singleDate', date: value.date };
  }

  if (
    value.type === 'dateRange' &&
    Object.keys(value).length === 3 &&
    typeof value.startDate === 'string' &&
    typeof value.endDate === 'string'
  ) {
    return {
      type: 'dateRange',
      startDate: value.startDate,
      endDate: value.endDate,
    };
  }

  throw invalidCreditInvoiceResponse(value);
}

function parseInvoiceUnit(value: unknown): InvoiceUnit {
  if (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 8 &&
    /^[\p{L}\p{N}.-]+$/u.test(value)
  ) {
    return value;
  }

  throw invalidCreditInvoiceResponse(value);
}

function readString(value: Record<string, unknown>, fieldName: string): string {
  const fieldValue = value[fieldName];

  if (typeof fieldValue === 'string') {
    return fieldValue;
  }

  throw invalidCreditInvoiceResponse(value);
}

function readNullableString(
  value: Record<string, unknown>,
  fieldName: string,
): string | null {
  const fieldValue = value[fieldName];

  if (fieldValue === null || typeof fieldValue === 'string') {
    return fieldValue;
  }

  throw invalidCreditInvoiceResponse(value);
}

function readBoolean(
  value: Record<string, unknown>,
  fieldName: string,
): boolean {
  const fieldValue = value[fieldName];

  if (typeof fieldValue === 'boolean') {
    return fieldValue;
  }

  throw invalidCreditInvoiceResponse(value);
}

function readSafeInteger(
  value: Record<string, unknown>,
  fieldName: string,
): number {
  const fieldValue = value[fieldName];

  if (typeof fieldValue === 'number' && Number.isSafeInteger(fieldValue)) {
    return fieldValue;
  }

  throw invalidCreditInvoiceResponse(value);
}

function readNullableSafeInteger(
  value: Record<string, unknown>,
  fieldName: string,
): number | null {
  const fieldValue = value[fieldName];

  if (fieldValue === null) {
    return null;
  }

  return readSafeInteger(value, fieldName);
}

function readZero(
  value: Record<string, unknown>,
  fieldName: string,
): 0 {
  if (readSafeInteger(value, fieldName) === 0) {
    return 0;
  }

  throw invalidCreditInvoiceResponse(value);
}

function invalidCreditInvoiceResponse(responseBody: unknown): EkyApiError {
  return new EkyApiError('Invalid credit invoice response.', { responseBody });
}
