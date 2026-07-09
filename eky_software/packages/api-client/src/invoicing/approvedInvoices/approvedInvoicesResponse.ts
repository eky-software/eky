import { EkyApiError, isRecord } from '../../http.js';
import type {
  ApprovedInvoiceLine,
  ApprovedInvoiceLineDiscount,
  ApprovedInvoiceDocumentMetadata,
  ApprovedInvoiceEmailPreview,
  ApprovedInvoiceEmailDryRunProviderResult,
  ApprovedInvoiceEmailDryRunSend,
  ApprovedInvoiceEmailDryRunSendResult,
  ApprovedInvoiceNumberingMode,
  ApprovedInvoicePriceInputMode,
  ApprovedInvoiceReferenceNumberType,
  ReopenedApprovedInvoice,
  ApprovedInvoiceSummary,
  ApprovedInvoiceTotals,
  ApprovedInvoiceUnit,
  ApprovedInvoiceVatBreakdown,
  ApprovedInvoiceView,
  ApprovedInvoiceViewStatus,
} from './approvedInvoicesTypes.js';

export function readApprovedInvoiceListResponse(
  responseBody: unknown,
): ApprovedInvoiceSummary[] {
  if (!isRecord(responseBody) || !Array.isArray(responseBody.invoices)) {
    throw invalidApprovedInvoiceResponse(responseBody);
  }

  return responseBody.invoices.map(parseApprovedInvoiceSummary);
}

export function readApprovedInvoiceResponse(
  responseBody: unknown,
): ApprovedInvoiceView {
  if (!isRecord(responseBody)) {
    throw invalidApprovedInvoiceResponse(responseBody);
  }

  return parseApprovedInvoiceView(responseBody.invoice);
}

export function readReopenedApprovedInvoiceResponse(
  responseBody: unknown,
): ReopenedApprovedInvoice {
  if (
    !isRecord(responseBody) ||
    typeof responseBody.invoiceId !== 'string'
  ) {
    throw invalidApprovedInvoiceResponse(responseBody);
  }

  if (typeof responseBody.invoiceDraftId !== 'string') {
    throw invalidApprovedInvoiceResponse(responseBody);
  }

  return {
    invoiceDraftId: responseBody.invoiceDraftId,
    invoiceId: responseBody.invoiceId,
  };
}

export function readApprovedInvoiceDocumentMetadataResponse(
  responseBody: unknown,
): ApprovedInvoiceDocumentMetadata {
  if (!isRecord(responseBody)) {
    throw invalidApprovedInvoiceResponse(responseBody);
  }

  return parseApprovedInvoiceDocumentMetadata(responseBody.document);
}

export function readApprovedInvoiceEmailPreviewResponse(
  responseBody: unknown,
): ApprovedInvoiceEmailPreview {
  if (!isRecord(responseBody)) {
    throw invalidApprovedInvoiceResponse(responseBody);
  }

  return parseApprovedInvoiceEmailPreview(responseBody.email);
}

export function readApprovedInvoiceEmailDryRunSendResponse(
  responseBody: unknown,
): ApprovedInvoiceEmailDryRunSendResult {
  if (!isRecord(responseBody) || !isRecord(responseBody.delivery)) {
    throw invalidApprovedInvoiceResponse(responseBody);
  }

  return parseApprovedInvoiceEmailDryRunSendResult(responseBody.delivery);
}

function parseApprovedInvoiceSummary(
  value: unknown,
): ApprovedInvoiceSummary {
  if (!isRecord(value)) {
    throw invalidApprovedInvoiceResponse(value);
  }

  return {
    id: readString(value, 'id'),
    invoiceNumber: readString(value, 'invoiceNumber'),
    referenceNumber: readString(value, 'referenceNumber'),
    status: parseStatus(value.status),
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

function parseApprovedInvoiceDocumentMetadata(
  value: unknown,
): ApprovedInvoiceDocumentMetadata {
  if (!isRecord(value)) {
    throw invalidApprovedInvoiceResponse(value);
  }

  const documentType = readString(value, 'documentType');
  const mimeType = readString(value, 'mimeType');

  if (documentType !== 'approved_invoice_pdf' || mimeType !== 'application/pdf') {
    throw invalidApprovedInvoiceResponse(value);
  }

  return {
    id: readString(value, 'id'),
    companyId: readString(value, 'companyId'),
    invoiceId: readString(value, 'invoiceId'),
    documentType,
    fileName: readString(value, 'fileName'),
    storagePath: readString(value, 'storagePath'),
    mimeType,
    sha256: readString(value, 'sha256'),
    sizeBytes: readSafeInteger(value, 'sizeBytes'),
    createdAt: readString(value, 'createdAt'),
  };
}

function parseApprovedInvoiceEmailPreview(
  value: unknown,
): ApprovedInvoiceEmailPreview {
  if (!isRecord(value) || !isRecord(value.attachment)) {
    throw invalidApprovedInvoiceResponse(value);
  }

  const provider = readString(value, 'provider');
  const mimeType = readString(value.attachment, 'mimeType');

  if (provider !== 'dryRun' || mimeType !== 'application/pdf') {
    throw invalidApprovedInvoiceResponse(value);
  }

  return {
    attachment: {
      documentId: readString(value.attachment, 'documentId'),
      fileName: readString(value.attachment, 'fileName'),
      mimeType,
      sizeBytes: readSafeInteger(value.attachment, 'sizeBytes'),
    },
    body: readString(value, 'body'),
    invoiceId: readString(value, 'invoiceId'),
    invoiceNumber: readString(value, 'invoiceNumber'),
    provider,
    subject: readString(value, 'subject'),
    to: readString(value, 'to'),
  };
}

function parseApprovedInvoiceEmailDryRunSendResult(
  value: Record<string, unknown>,
): ApprovedInvoiceEmailDryRunSendResult {
  if (!isRecord(value.email) || !isRecord(value.providerResult)) {
    throw invalidApprovedInvoiceResponse(value);
  }

  return {
    deliveryEventId: readString(value, 'deliveryEventId'),
    email: parseApprovedInvoiceEmailDryRunSend(value.email),
    providerResult: parseApprovedInvoiceEmailDryRunProviderResult(
      value.providerResult,
    ),
  };
}

function parseApprovedInvoiceEmailDryRunSend(
  value: Record<string, unknown>,
): ApprovedInvoiceEmailDryRunSend {
  if (!isRecord(value.attachment)) {
    throw invalidApprovedInvoiceResponse(value);
  }

  const provider = readString(value, 'provider');
  const mimeType = readString(value.attachment, 'mimeType');

  if (provider !== 'dryRun' || mimeType !== 'application/pdf') {
    throw invalidApprovedInvoiceResponse(value);
  }

  const email: ApprovedInvoiceEmailDryRunSend = {
    attachment: {
      documentId: readString(value.attachment, 'documentId'),
      fileName: readString(value.attachment, 'fileName'),
      mimeType,
      sizeBytes: readSafeInteger(value.attachment, 'sizeBytes'),
    },
    body: readString(value, 'body'),
    invoiceId: readString(value, 'invoiceId'),
    invoiceNumber: readString(value, 'invoiceNumber'),
    provider,
    subject: readString(value, 'subject'),
    to: readString(value, 'to'),
  };
  const cc = readOptionalString(value, 'cc');

  if (cc !== undefined) {
    email.cc = cc;
  }

  return email;
}

function parseApprovedInvoiceEmailDryRunProviderResult(
  value: Record<string, unknown>,
): ApprovedInvoiceEmailDryRunProviderResult {
  const provider = readString(value, 'provider');

  if (provider !== 'dryRun') {
    throw invalidApprovedInvoiceResponse(value);
  }

  return {
    provider,
    providerMessageId: readNullableString(value, 'providerMessageId'),
  };
}

function parseApprovedInvoiceView(value: unknown): ApprovedInvoiceView {
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
    status: parseStatus(value.status),
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
    unit: parseUnit(value.unit),
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

function parseStatus(value: unknown): ApprovedInvoiceViewStatus {
  if (value === 'approved' || value === 'sent') {
    return value;
  }

  throw invalidApprovedInvoiceResponse(value);
}

function parseNumberingMode(value: unknown): ApprovedInvoiceNumberingMode {
  if (
    value === 'calendarYearSequence' ||
    value === 'fiscalYearSequence' ||
    value === 'plainSequence'
  ) {
    return value;
  }

  throw invalidApprovedInvoiceResponse(value);
}

function parseReferenceNumberType(
  value: unknown,
): ApprovedInvoiceReferenceNumberType {
  if (value === 'finnishDomestic') {
    return value;
  }

  throw invalidApprovedInvoiceResponse(value);
}

function parsePriceInputMode(value: unknown): ApprovedInvoicePriceInputMode {
  if (value === 'net' || value === 'gross') {
    return value;
  }

  throw invalidApprovedInvoiceResponse(value);
}

function parseUnit(value: unknown): ApprovedInvoiceUnit {
  if (typeof value === 'string' && isValidApprovedInvoiceUnit(value)) {
    return value;
  }

  throw invalidApprovedInvoiceResponse(value);
}

function isValidApprovedInvoiceUnit(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= 8 &&
    /^[\p{L}\p{N}.-]+$/u.test(value)
  );
}

function readString(value: Record<string, unknown>, fieldName: string): string {
  const fieldValue = value[fieldName];

  if (typeof fieldValue === 'string') {
    return fieldValue;
  }

  throw invalidApprovedInvoiceResponse(value);
}

function readNullableString(
  value: Record<string, unknown>,
  fieldName: string,
): string | null {
  const fieldValue = value[fieldName];

  if (fieldValue === null || typeof fieldValue === 'string') {
    return fieldValue;
  }

  throw invalidApprovedInvoiceResponse(value);
}

function readOptionalString(
  value: Record<string, unknown>,
  fieldName: string,
): string | undefined {
  if (!(fieldName in value)) {
    return undefined;
  }

  return readString(value, fieldName);
}

function readSafeInteger(
  value: Record<string, unknown>,
  fieldName: string,
): number {
  const fieldValue = value[fieldName];

  if (typeof fieldValue === 'number' && Number.isSafeInteger(fieldValue)) {
    return fieldValue;
  }

  throw invalidApprovedInvoiceResponse(value);
}

function invalidApprovedInvoiceResponse(responseBody: unknown): EkyApiError {
  return new EkyApiError('Invalid approved invoice response.', { responseBody });
}
