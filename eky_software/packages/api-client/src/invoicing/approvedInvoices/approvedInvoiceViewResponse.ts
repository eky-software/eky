import { isRecord } from '../../http.js';
import {
  invalidApprovedInvoiceResponse,
  parseInvoiceKind,
  parseInvoicePaymentReadModel,
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
  ApprovedInvoiceListPageSize,
  ApprovedInvoiceLine,
  ApprovedInvoiceLineDiscount,
  ApprovedInvoiceSummary,
  ApprovedInvoiceTotals,
  ApprovedInvoiceVatBreakdown,
  ApprovedInvoiceView,
  InvoiceCreditContext,
  SentInvoiceCreditStatus,
  SentInvoiceGroup,
  SentInvoiceGroupListPage,
} from './approvedInvoicesTypes.js';
import type {
  InvoicePerformancePeriod,
  InvoiceTaxTreatment,
} from '../invoiceDrafts/index.js';

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

export function readSentInvoiceGroupListResponse(
  responseBody: unknown,
): SentInvoiceGroupListPage {
  if (!isRecord(responseBody) || !isRecord(responseBody.invoiceGroupPage)) {
    throw invalidApprovedInvoiceResponse(responseBody);
  }

  const invoiceGroupPage = responseBody.invoiceGroupPage;

  if (!Array.isArray(invoiceGroupPage.groups)) {
    throw invalidApprovedInvoiceResponse(responseBody);
  }

  const page = readSafeInteger(invoiceGroupPage, 'page');
  const pageSize = readSafeInteger(invoiceGroupPage, 'pageSize');
  const totalCount = readSafeInteger(invoiceGroupPage, 'totalCount');
  const totalPages = readSafeInteger(invoiceGroupPage, 'totalPages');

  if (
    page < 1 ||
    !isApprovedInvoicePageSize(pageSize) ||
    totalCount < 0 ||
    totalPages !== Math.ceil(totalCount / pageSize) ||
    invoiceGroupPage.groups.length > pageSize ||
    invoiceGroupPage.groups.length > totalCount
  ) {
    throw invalidApprovedInvoiceResponse(responseBody);
  }

  return {
    groups: invoiceGroupPage.groups.map(parseSentInvoiceGroup),
    page,
    pageSize,
    totalCount,
    totalPages,
  };
}

export function readInvoiceCreditContextResponse(
  responseBody: unknown,
): InvoiceCreditContext {
  if (!isRecord(responseBody) || !isRecord(responseBody.creditContext)) {
    throw invalidApprovedInvoiceResponse(responseBody);
  }

  const value = responseBody.creditContext;

  if (!Array.isArray(value.creditInvoices)) {
    throw invalidApprovedInvoiceResponse(responseBody);
  }

  const sourceInvoiceId = readString(value, 'sourceInvoiceId');
  const creditInvoices = value.creditInvoices.map(parseApprovedInvoiceSummary);
  const creditStatus = parseSentInvoiceCreditStatus(value.creditStatus);
  const remainingCreditableGrossCents = readSafeInteger(
    value,
    'remainingCreditableGrossCents',
  );
  const activeCreditDraftId = readNullableString(
    value,
    'activeCreditDraftId',
  );

  if (
    remainingCreditableGrossCents < 0 ||
    creditInvoices.some(
      (invoice) =>
        invoice.invoiceKind !== 'credit' ||
        (invoice.status !== 'approved' && invoice.status !== 'sent') ||
        invoice.creditedInvoiceId !== sourceInvoiceId ||
        invoice.grossTotalCents < 0,
    ) ||
    (creditStatus === 'none' && creditInvoices.length !== 0) ||
    (creditStatus === 'full' && remainingCreditableGrossCents !== 0) ||
    (creditStatus === 'partial' &&
      (creditInvoices.length === 0 || remainingCreditableGrossCents === 0))
  ) {
    throw invalidApprovedInvoiceResponse(responseBody);
  }

  return {
    sourceInvoiceId,
    creditInvoices,
    creditStatus,
    remainingCreditableGrossCents,
    activeCreditDraftId,
  };
}

function isApprovedInvoicePageSize(
  value: number,
): value is ApprovedInvoiceListPageSize {
  return value === 5 || value === 20 || value === 50 || value === 100;
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

  const invoiceKind = parseInvoiceKind(value.invoiceKind);

  return {
    id: readString(value, 'id'),
    invoiceKind,
    creditedInvoiceId: readNullableString(value, 'creditedInvoiceId'),
    creditedInvoiceNumber: readNullableString(value, 'creditedInvoiceNumber'),
    creditedInvoiceDate: readNullableString(value, 'creditedInvoiceDate'),
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
    taxTreatment: parseTaxTreatment(value.taxTreatment),
    taxTreatmentLabelSnapshot: readString(
      value,
      'taxTreatmentLabelSnapshot',
    ),
    taxLegalBasisSnapshot: readString(value, 'taxLegalBasisSnapshot'),
    performancePeriod: parsePerformancePeriod(value.performancePeriod),
    subject: readString(value, 'subject'),
    orderNumber: readString(value, 'orderNumber'),
    note: readString(value, 'note'),
    deliveryAddressText: readString(value, 'deliveryAddressText'),
    refundIbanSnapshot: readString(value, 'refundIbanSnapshot'),
    lines: value.lines.map(parseApprovedInvoiceLine),
    totals: parseTotals(value.totals),
    vatBreakdown: value.vatBreakdown.map(parseVatBreakdown),
    createdAt: readString(value, 'createdAt'),
    approvedAt: readString(value, 'approvedAt'),
    updatedAt: readString(value, 'updatedAt'),
    cancelledAt: readNullableString(value, 'cancelledAt'),
    cancelledBy: readNullableString(value, 'cancelledBy'),
    cancellationReason: readNullableString(value, 'cancellationReason'),
    ...parseInvoicePaymentReadModel(value, invoiceKind),
  };
}

export function parseApprovedInvoiceSummary(
  value: unknown,
): ApprovedInvoiceSummary {
  if (!isRecord(value)) {
    throw invalidApprovedInvoiceResponse(value);
  }

  const invoiceKind = parseInvoiceKind(value.invoiceKind);

  return {
    id: readString(value, 'id'),
    invoiceKind,
    creditedInvoiceId: readNullableString(value, 'creditedInvoiceId'),
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
    cancelledAt: readNullableString(value, 'cancelledAt'),
    ...parseInvoicePaymentReadModel(value, invoiceKind),
  };
}

function parseSentInvoiceGroup(value: unknown): SentInvoiceGroup {
  if (
    !isRecord(value) ||
    !Array.isArray(value.creditInvoices)
  ) {
    throw invalidApprovedInvoiceResponse(value);
  }

  const rootInvoice = parseApprovedInvoiceSummary(value.rootInvoice);
  const creditInvoices = value.creditInvoices.map(parseApprovedInvoiceSummary);
  const creditStatus = parseSentInvoiceCreditStatus(value.creditStatus);
  const remainingCreditableGrossCents = readSafeInteger(
    value,
    'remainingCreditableGrossCents',
  );

  if (
    rootInvoice.invoiceKind !== 'standard' ||
    rootInvoice.status !== 'sent' ||
    rootInvoice.creditedInvoiceId !== null ||
    rootInvoice.grossTotalCents < 0 ||
    remainingCreditableGrossCents < 0 ||
    remainingCreditableGrossCents > rootInvoice.grossTotalCents ||
    creditInvoices.some(
      (invoice) =>
        invoice.invoiceKind !== 'credit' ||
        invoice.status !== 'sent' ||
        invoice.creditedInvoiceId !== rootInvoice.id ||
        invoice.grossTotalCents < 0,
    ) ||
    (creditStatus === 'none' &&
      remainingCreditableGrossCents !== rootInvoice.grossTotalCents) ||
    (creditStatus === 'full' && remainingCreditableGrossCents !== 0) ||
    (creditStatus === 'partial' &&
      (remainingCreditableGrossCents === 0 ||
        remainingCreditableGrossCents === rootInvoice.grossTotalCents))
  ) {
    throw invalidApprovedInvoiceResponse(value);
  }

  return {
    rootInvoice,
    creditInvoices,
    creditStatus,
    remainingCreditableGrossCents,
  };
}

function parseSentInvoiceCreditStatus(
  value: unknown,
): SentInvoiceCreditStatus {
  if (value === 'none' || value === 'partial' || value === 'full') {
    return value;
  }

  throw invalidApprovedInvoiceResponse(value);
}

function parseApprovedInvoiceLine(value: unknown): ApprovedInvoiceLine {
  if (!isRecord(value)) {
    throw invalidApprovedInvoiceResponse(value);
  }

  return {
    id: readString(value, 'id'),
    sourceInvoiceLineId: readNullableString(value, 'sourceInvoiceLineId'),
    lineOrder: readSafeInteger(value, 'lineOrder'),
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

function parseTaxTreatment(value: unknown): InvoiceTaxTreatment {
  if (value === 'normalVat' || value === 'reverseChargeConstruction') {
    return value;
  }

  throw invalidApprovedInvoiceResponse(value);
}

function parsePerformancePeriod(value: unknown): InvoicePerformancePeriod {
  if (!isRecord(value)) {
    throw invalidApprovedInvoiceResponse(value);
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

  throw invalidApprovedInvoiceResponse(value);
}

function readNullableSafeInteger(
  value: Record<string, unknown>,
  fieldName: string,
): number | null {
  if (value[fieldName] === null) {
    return null;
  }

  return readSafeInteger(value, fieldName);
}
