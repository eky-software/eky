import { isRecord } from '../../http.js';
import {
  invalidApprovedInvoiceResponse,
  readBoolean,
  readNullableString,
  readOptionalString,
  readSafeInteger,
  readString,
} from './approvedInvoiceResponsePrimitives.js';
import { parseApprovedInvoiceView } from './approvedInvoiceViewResponse.js';
import type {
  ApprovedInvoiceEmailDryRunProviderResult,
  ApprovedInvoiceEmailDryRunSend,
  ApprovedInvoiceEmailDryRunSendResult,
  ApprovedInvoiceEmailPreview,
  ApprovedInvoiceEmailSmtpPreparation,
  ApprovedInvoiceEmailSmtpSendResult,
  ApprovedInvoiceEmailSmtpTestPreparation,
  ApprovedInvoiceEmailSmtpTestSendResult,
  InvoiceDeliveryEventSummary,
  InvoiceDeliveryMethod,
  InvoiceDeliveryProvider,
  InvoiceDeliveryStatus,
} from './approvedInvoicesTypes.js';

export function readInvoiceDeliveryEventListResponse(
  responseBody: unknown,
): InvoiceDeliveryEventSummary[] {
  if (!isRecord(responseBody) || !Array.isArray(responseBody.events)) {
    throw invalidApprovedInvoiceResponse(responseBody);
  }

  return responseBody.events.map(parseInvoiceDeliveryEventSummary);
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

export function readApprovedInvoiceEmailSmtpTestSendResponse(
  responseBody: unknown,
): ApprovedInvoiceEmailSmtpTestSendResult {
  if (!isRecord(responseBody) || !isRecord(responseBody.delivery)) {
    throw invalidApprovedInvoiceResponse(responseBody);
  }

  const delivery = responseBody.delivery;

  if (delivery.provider !== 'smtp' || delivery.testMode !== true) {
    throw invalidApprovedInvoiceResponse(responseBody);
  }

  return {
    deliveredTo: readString(delivery, 'deliveredTo'),
    deliveryEventId: readString(delivery, 'deliveryEventId'),
    provider: 'smtp',
    providerMessageId: readNullableString(delivery, 'providerMessageId'),
    testMode: true,
  };
}

export function readApprovedInvoiceEmailSmtpTestPreparationResponse(
  responseBody: unknown,
): ApprovedInvoiceEmailSmtpTestPreparation {
  if (!isRecord(responseBody) || !isRecord(responseBody.preparation)) {
    throw invalidApprovedInvoiceResponse(responseBody);
  }

  const preparation = responseBody.preparation;

  if (!isRecord(preparation.attachment)) {
    throw invalidApprovedInvoiceResponse(responseBody);
  }

  return {
    attachment: {
      fileName: readString(preparation.attachment, 'fileName'),
      sizeBytes: readSafeInteger(preparation.attachment, 'sizeBytes'),
    },
    attemptId: readString(preparation, 'attemptId'),
    authorizationToken: readString(preparation, 'authorizationToken'),
    expiresAt: readString(preparation, 'expiresAt'),
    invoiceId: readString(preparation, 'invoiceId'),
    subject: readString(preparation, 'subject'),
    testRecipient: readString(preparation, 'testRecipient'),
  };
}

export function readApprovedInvoiceEmailSmtpPreparationResponse(
  responseBody: unknown,
): ApprovedInvoiceEmailSmtpPreparation {
  if (!isRecord(responseBody) || !isRecord(responseBody.preparation)) {
    throw invalidApprovedInvoiceResponse(responseBody);
  }

  const preparation = responseBody.preparation;

  if (!isRecord(preparation.attachment)) {
    throw invalidApprovedInvoiceResponse(responseBody);
  }

  return {
    attachment: {
      fileName: readString(preparation.attachment, 'fileName'),
      sizeBytes: readSafeInteger(preparation.attachment, 'sizeBytes'),
    },
    attemptId: readString(preparation, 'attemptId'),
    authorizationToken: readString(preparation, 'authorizationToken'),
    body: readString(preparation, 'body'),
    cc: readString(preparation, 'cc'),
    expiresAt: readString(preparation, 'expiresAt'),
    invoiceId: readString(preparation, 'invoiceId'),
    invoiceNumber: readString(preparation, 'invoiceNumber'),
    recipient: readString(preparation, 'recipient'),
    resend: readBoolean(preparation, 'resend'),
    sender: readString(preparation, 'sender'),
    subject: readString(preparation, 'subject'),
  };
}

export function readApprovedInvoiceEmailSmtpSendResponse(
  responseBody: unknown,
): ApprovedInvoiceEmailSmtpSendResult {
  if (!isRecord(responseBody) || !isRecord(responseBody.delivery)) {
    throw invalidApprovedInvoiceResponse(responseBody);
  }

  const delivery = responseBody.delivery;

  if (delivery.provider !== 'smtp' || delivery.testMode !== false) {
    throw invalidApprovedInvoiceResponse(responseBody);
  }

  return {
    deliveredCc: readString(delivery, 'deliveredCc'),
    deliveredTo: readString(delivery, 'deliveredTo'),
    deliveryEventId: readString(delivery, 'deliveryEventId'),
    invoice: parseApprovedInvoiceView(delivery.invoice),
    provider: 'smtp',
    providerMessageId: readNullableString(delivery, 'providerMessageId'),
    resend: readBoolean(delivery, 'resend'),
    testMode: false,
  };
}

function parseInvoiceDeliveryEventSummary(
  value: unknown,
): InvoiceDeliveryEventSummary {
  if (!isRecord(value)) {
    throw invalidApprovedInvoiceResponse(value);
  }

  return {
    ccEmail: readString(value, 'ccEmail'),
    createdAt: readString(value, 'createdAt'),
    deliveryMethod: parseDeliveryMethod(value.deliveryMethod),
    id: readString(value, 'id'),
    provider: parseDeliveryProvider(value.provider),
    recipientEmail: readString(value, 'recipientEmail'),
    safeErrorMessage: readNullableString(value, 'safeErrorMessage'),
    status: parseDeliveryStatus(value.status),
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

function parseDeliveryMethod(value: unknown): InvoiceDeliveryMethod {
  if (
    value === 'email' ||
    value === 'manual' ||
    value === 'print' ||
    value === 'other'
  ) {
    return value;
  }

  throw invalidApprovedInvoiceResponse(value);
}

function parseDeliveryProvider(value: unknown): InvoiceDeliveryProvider {
  if (
    value === 'dryRun' ||
    value === 'smtp' ||
    value === 'gmail' ||
    value === 'microsoft' ||
    value === 'manual' ||
    value === 'other'
  ) {
    return value;
  }

  throw invalidApprovedInvoiceResponse(value);
}

function parseDeliveryStatus(value: unknown): InvoiceDeliveryStatus {
  if (
    value === 'prepared' ||
    value === 'attempted' ||
    value === 'succeeded' ||
    value === 'failed' ||
    value === 'outcomeUnknown'
  ) {
    return value;
  }

  throw invalidApprovedInvoiceResponse(value);
}
