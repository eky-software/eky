import { isRecord } from '../../http.js';
import {
  invalidApprovedInvoiceResponse,
  parseInvoiceStatus,
  parseInvoiceUnit,
  parseNumberingMode,
  parsePriceInputMode,
  parseReferenceNumberType,
  readNullableString,
  readSafeInteger,
  readString,
} from './approvedInvoiceResponsePrimitives.js';
import type {
  ApprovedInvoiceListPage,
  ApprovedInvoiceLine,
  ApprovedInvoiceLineDiscount,
  ApprovedInvoiceSummary,
  ApprovedInvoiceTotals,
  ApprovedInvoiceVatBreakdown,
  ApprovedInvoiceView,
} from './approvedInvoicesTypes.js';

export function readApprovedInvoiceListResponse(
  responseBody: unknown,
): ApprovedInvoiceListPage {
  if (!isRecord(responseBody) || !isRecord(responseBody.invoicePage)) {
    throw invalidApprovedInvoiceResponse(responseBody);
  }

  const invoicePage = responseBody.invoicePage;

  if (!Array.isArray(invoicePage.invoices)) {
    throw invalidApprovedInvoiceResponse(responseBody);
  }

  const page = readSafeInteger(invoicePage, 'page');
  const pageSize = readSafeInteger(invoicePage, 'pageSize');
  const totalCount = readSafeInteger(invoicePage, 'totalCount');
  const totalPages = readSafeInteger(invoicePage, 'totalPages');

  if (
    page < 1 ||
    !isApprovedInvoicePageSize(pageSize) ||
    totalCount < 0 ||
    totalPages !== Math.ceil(totalCount / pageSize) ||
    invoicePage.invoices.length > pageSize ||
    invoicePage.invoices.length > totalCount
  ) {
    throw invalidApprovedInvoiceResponse(responseBody);
  }

  return {
    invoices: invoicePage.invoices.map(parseApprovedInvoiceSummary),
    page,
    pageSize,
    totalCount,
    totalPages,
  };
}

function isApprovedInvoicePageSize(value: number): value is 20 | 50 | 100 {
  return value === 20 || value === 50 || value === 100;
}

export function readApprovedInvoiceResponse(
  responseBody: unknown,
): ApprovedInvoiceView {
  if (!isRecord(responseBody)) {
    throw invalidApprovedInvoiceResponse(responseBody);
  }

  return parseApprovedInvoiceView(responseBody.invoice);
}

export function parseApprovedInvoiceView(value: unknown): ApprovedInvoiceView {
  if (
    !isRecord(value) ||
    !Array.isArray(value.lines) ||
    !isRecord(value.totals) ||
    !Array.isArray(value.vatBreakdown)
  ) {
    throw invalidApprovedInvoiceResponse(value);
  }

  return {
    id: readString(value, 'id'),
    companyId: readString(value, 'companyId'),
    sourceDraftId: readString(value, 'sourceDraftId'),
    invoiceNumber: readString(value, 'invoiceNumber'),
    referenceNumber: readString(value, 'referenceNumber'),
    referenceNumberType: parseReferenceNumberType(value.referenceNumberType),
    seriesKey: readString(value, 'seriesKey'),
    sequenceScope: readString(value, 'sequenceScope'),
    sequenceNumber: readSafeInteger(value, 'sequenceNumber'),
    numberingMode: parseNumberingMode(value.numberingMode),
    status: parseInvoiceStatus(value.status),
    customerId: readString(value, 'customerId'),
    customerNumberSnapshot: readString(value, 'customerNumberSnapshot'),
    customerNameSnapshot: readString(value, 'customerNameSnapshot'),
    customerBusinessIdSnapshot: readString(value, 'customerBusinessIdSnapshot'),
    customerTypeSnapshot: readString(value, 'customerTypeSnapshot'),
    customerEmailSnapshot: readString(value, 'customerEmailSnapshot'),
    customerPhoneSnapshot: readString(value, 'customerPhoneSnapshot'),
    customerStreetAddressSnapshot: readString(
      value,
      'customerStreetAddressSnapshot',
    ),
    customerPostalCodeSnapshot: readString(value, 'customerPostalCodeSnapshot'),
    customerCitySnapshot: readString(value, 'customerCitySnapshot'),
    companyNameSnapshot: readString(value, 'companyNameSnapshot'),
    companyBusinessIdSnapshot: readString(value, 'companyBusinessIdSnapshot'),
    companyVatNumberSnapshot: readString(value, 'companyVatNumberSnapshot'),
    companyStreetAddressSnapshot: readString(
      value,
      'companyStreetAddressSnapshot',
    ),
    companyPostalCodeSnapshot: readString(value, 'companyPostalCodeSnapshot'),
    companyCitySnapshot: readString(value, 'companyCitySnapshot'),
    companyEmailSnapshot: readString(value, 'companyEmailSnapshot'),
    companyPhoneSnapshot: readString(value, 'companyPhoneSnapshot'),
    companyWebsiteSnapshot: readString(value, 'companyWebsiteSnapshot'),
    companyIbanSnapshot: readString(value, 'companyIbanSnapshot'),
    companyBicSnapshot: readString(value, 'companyBicSnapshot'),
    companyBankNameSnapshot: readString(value, 'companyBankNameSnapshot'),
    billingRecipientCustomerId: readNullableString(
      value,
      'billingRecipientCustomerId',
    ),
    billingRecipientCustomerNumberSnapshot: readString(
      value,
      'billingRecipientCustomerNumberSnapshot',
    ),
    billingRecipientNameSnapshot: readString(
      value,
      'billingRecipientNameSnapshot',
    ),
    billingRecipientBusinessIdSnapshot: readString(
      value,
      'billingRecipientBusinessIdSnapshot',
    ),
    billingRecipientCustomerTypeSnapshot: readString(
      value,
      'billingRecipientCustomerTypeSnapshot',
    ),
    billingRecipientEmailSnapshot: readString(
      value,
      'billingRecipientEmailSnapshot',
    ),
    billingRecipientPhoneSnapshot: readString(
      value,
      'billingRecipientPhoneSnapshot',
    ),
    billingRecipientStreetAddressSnapshot: readString(
      value,
      'billingRecipientStreetAddressSnapshot',
    ),
    billingRecipientPostalCodeSnapshot: readString(
      value,
      'billingRecipientPostalCodeSnapshot',
    ),
    billingRecipientCitySnapshot: readString(
      value,
      'billingRecipientCitySnapshot',
    ),
    invoiceDate: readString(value, 'invoiceDate'),
    dueDate: readString(value, 'dueDate'),
    paymentTermDays: readSafeInteger(value, 'paymentTermDays'),
    reminderPeriodDays: readSafeInteger(value, 'reminderPeriodDays'),
    latePaymentInterestBasisPoints: readSafeInteger(
      value,
      'latePaymentInterestBasisPoints',
    ),
    priceInputMode: parsePriceInputMode(value.priceInputMode),
    subject: readString(value, 'subject'),
    orderNumber: readString(value, 'orderNumber'),
    note: readString(value, 'note'),
    deliveryAddressText: readString(value, 'deliveryAddressText'),
    lines: value.lines.map(parseApprovedInvoiceLine),
    totals: parseTotals(value.totals),
    vatBreakdown: value.vatBreakdown.map(parseVatBreakdown),
    createdAt: readString(value, 'createdAt'),
    approvedAt: readString(value, 'approvedAt'),
    updatedAt: readString(value, 'updatedAt'),
  };
}

function parseApprovedInvoiceSummary(value: unknown): ApprovedInvoiceSummary {
  if (!isRecord(value)) {
    throw invalidApprovedInvoiceResponse(value);
  }

  return {
    id: readString(value, 'id'),
    invoiceNumber: readString(value, 'invoiceNumber'),
    referenceNumber: readString(value, 'referenceNumber'),
    status: parseInvoiceStatus(value.status),
    customerId: readString(value, 'customerId'),
    customerNumberSnapshot: readString(value, 'customerNumberSnapshot'),
    customerNameSnapshot: readString(value, 'customerNameSnapshot'),
    billingRecipientNameSnapshot: readString(
      value,
      'billingRecipientNameSnapshot',
    ),
    invoiceDate: readString(value, 'invoiceDate'),
    dueDate: readString(value, 'dueDate'),
    grossTotalCents: readSafeInteger(value, 'grossTotalCents'),
    approvedAt: readString(value, 'approvedAt'),
    updatedAt: readString(value, 'updatedAt'),
  };
}

function parseApprovedInvoiceLine(value: unknown): ApprovedInvoiceLine {
  if (!isRecord(value)) {
    throw invalidApprovedInvoiceResponse(value);
  }

  return {
    id: readString(value, 'id'),
    lineOrder: readSafeInteger(value, 'lineOrder'),
    code: readString(value, 'code'),
    description: readString(value, 'description'),
    quantityHundredths: readSafeInteger(value, 'quantityHundredths'),
    unit: parseInvoiceUnit(value.unit),
    unitPriceCents: readSafeInteger(value, 'unitPriceCents'),
    vatRateBasisPoints: readSafeInteger(value, 'vatRateBasisPoints'),
    discount: parseDiscount(value.discount),
    baseCents: readSafeInteger(value, 'baseCents'),
    discountCents: readSafeInteger(value, 'discountCents'),
    netCents: readSafeInteger(value, 'netCents'),
    vatCents: readSafeInteger(value, 'vatCents'),
    grossCents: readSafeInteger(value, 'grossCents'),
  };
}

function parseTotals(value: Record<string, unknown>): ApprovedInvoiceTotals {
  if (!Array.isArray(value.vatBreakdown)) {
    throw invalidApprovedInvoiceResponse(value);
  }

  return {
    netTotalCents: readSafeInteger(value, 'netTotalCents'),
    vatTotalCents: readSafeInteger(value, 'vatTotalCents'),
    grossTotalCents: readSafeInteger(value, 'grossTotalCents'),
    vatBreakdown: value.vatBreakdown.map(parseVatBreakdown),
  };
}

function parseVatBreakdown(value: unknown): ApprovedInvoiceVatBreakdown {
  if (!isRecord(value)) {
    throw invalidApprovedInvoiceResponse(value);
  }

  return {
    vatRateBasisPoints: readSafeInteger(value, 'vatRateBasisPoints'),
    netCents: readSafeInteger(value, 'netCents'),
    vatCents: readSafeInteger(value, 'vatCents'),
    grossCents: readSafeInteger(value, 'grossCents'),
  };
}

function parseDiscount(value: unknown): ApprovedInvoiceLineDiscount {
  if (!isRecord(value)) {
    throw invalidApprovedInvoiceResponse(value);
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

  throw invalidApprovedInvoiceResponse(value);
}
