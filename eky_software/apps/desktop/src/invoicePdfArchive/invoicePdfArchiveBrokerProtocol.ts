import {
  maximumArchivedInvoicePdfBytes,
  type InvoicePdfArchiveInvoiceKind,
} from './invoicePdfArchiveTypes.js';

export const invoicePdfArchiveBrokerProtocolVersion = 1;

const identifierPattern = /^[A-Za-z0-9._:-]{1,200}$/;
const invoiceNumberPattern = /^\d{1,50}$/;
const requestIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const sha256Pattern = /^[a-f0-9]{64}$/;
const isoTimestampPattern =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const maximumRequestBytes = 4_096;

export interface DeliveredInvoiceArchiveTaskRequest {
  createdAt: string;
  deliveryEventId: string;
  documentId: string;
  expectedPdfSha256: string;
  expectedPdfSize: number;
  invoiceId: string;
  invoiceKind: InvoicePdfArchiveInvoiceKind;
  invoiceNumber: string;
  taskId: string;
}

export interface InvoicePdfArchiveBrokerRequest {
  operation: 'queueDeliveredInvoiceArchiveTask';
  protocolVersion: typeof invoicePdfArchiveBrokerProtocolVersion;
  requestId: string;
  task: DeliveredInvoiceArchiveTaskRequest;
}

export type InvoicePdfArchiveBrokerResponse =
  | {
      errorCode:
        | 'ARCHIVE_BROKER_REQUEST_INVALID'
        | 'ARCHIVE_BROKER_UNAVAILABLE';
      ok: false;
      protocolVersion: typeof invoicePdfArchiveBrokerProtocolVersion;
      requestId: string;
    }
  | {
      ok: true;
      protocolVersion: typeof invoicePdfArchiveBrokerProtocolVersion;
      requestId: string;
      result: { accepted: true };
    };

export function createInvoicePdfArchiveBrokerRequest(input: {
  requestId: string;
  task: DeliveredInvoiceArchiveTaskRequest;
}): InvoicePdfArchiveBrokerRequest {
  const request = parseInvoicePdfArchiveBrokerRequest({
    operation: 'queueDeliveredInvoiceArchiveTask',
    protocolVersion: invoicePdfArchiveBrokerProtocolVersion,
    requestId: input.requestId,
    task: input.task,
  });

  if (request === undefined) {
    throw new Error('ARCHIVE_BROKER_REQUEST_INVALID');
  }
  return request;
}

export function parseInvoicePdfArchiveBrokerRequest(
  value: unknown,
): InvoicePdfArchiveBrokerRequest | undefined {
  if (
    !isRecord(value) ||
    serializedByteLength(value) > maximumRequestBytes ||
    !hasExactKeys(value, [
      'operation',
      'protocolVersion',
      'requestId',
      'task',
    ]) ||
    value.operation !== 'queueDeliveredInvoiceArchiveTask' ||
    value.protocolVersion !== invoicePdfArchiveBrokerProtocolVersion ||
    !isRequestId(value.requestId)
  ) {
    return undefined;
  }

  const task = parseTask(value.task);
  return task === undefined
    ? undefined
    : {
        operation: 'queueDeliveredInvoiceArchiveTask',
        protocolVersion: invoicePdfArchiveBrokerProtocolVersion,
        requestId: value.requestId,
        task,
      };
}

export function parseInvoicePdfArchiveBrokerResponse(
  value: unknown,
): InvoicePdfArchiveBrokerResponse | undefined {
  if (
    !isRecord(value) ||
    value.protocolVersion !== invoicePdfArchiveBrokerProtocolVersion ||
    !isRequestId(value.requestId) ||
    typeof value.ok !== 'boolean'
  ) {
    return undefined;
  }

  if (value.ok === false) {
    if (
      !hasExactKeys(value, [
        'errorCode',
        'ok',
        'protocolVersion',
        'requestId',
      ]) ||
      (value.errorCode !== 'ARCHIVE_BROKER_REQUEST_INVALID' &&
        value.errorCode !== 'ARCHIVE_BROKER_UNAVAILABLE')
    ) {
      return undefined;
    }
    return {
      errorCode: value.errorCode,
      ok: false,
      protocolVersion: invoicePdfArchiveBrokerProtocolVersion,
      requestId: value.requestId,
    };
  }

  if (
    !hasExactKeys(value, [
      'ok',
      'protocolVersion',
      'requestId',
      'result',
    ]) ||
    !isRecord(value.result) ||
    !hasExactKeys(value.result, ['accepted']) ||
    value.result.accepted !== true
  ) {
    return undefined;
  }

  return {
    ok: true,
    protocolVersion: invoicePdfArchiveBrokerProtocolVersion,
    requestId: value.requestId,
    result: { accepted: true },
  };
}

export function readInvoicePdfArchiveBrokerRequestId(
  value: unknown,
): string | undefined {
  return isRecord(value) && isRequestId(value.requestId)
    ? value.requestId
    : undefined;
}

function parseTask(value: unknown): DeliveredInvoiceArchiveTaskRequest | undefined {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      'createdAt',
      'deliveryEventId',
      'documentId',
      'expectedPdfSha256',
      'expectedPdfSize',
      'invoiceId',
      'invoiceKind',
      'invoiceNumber',
      'taskId',
    ]) ||
    !isIdentifier(value.taskId) ||
    !isIdentifier(value.deliveryEventId) ||
    !isIdentifier(value.documentId) ||
    !isIdentifier(value.invoiceId) ||
    typeof value.invoiceNumber !== 'string' ||
    !invoiceNumberPattern.test(value.invoiceNumber) ||
    (value.invoiceKind !== 'standard' && value.invoiceKind !== 'credit') ||
    typeof value.expectedPdfSha256 !== 'string' ||
    !sha256Pattern.test(value.expectedPdfSha256) ||
    typeof value.expectedPdfSize !== 'number' ||
    !Number.isSafeInteger(value.expectedPdfSize) ||
    value.expectedPdfSize < 1 ||
    value.expectedPdfSize > maximumArchivedInvoicePdfBytes ||
    !isIsoTimestamp(value.createdAt)
  ) {
    return undefined;
  }

  return {
    createdAt: value.createdAt,
    deliveryEventId: value.deliveryEventId,
    documentId: value.documentId,
    expectedPdfSha256: value.expectedPdfSha256,
    expectedPdfSize: value.expectedPdfSize,
    invoiceId: value.invoiceId,
    invoiceKind: value.invoiceKind,
    invoiceNumber: value.invoiceNumber,
    taskId: value.taskId,
  };
}

function isIdentifier(value: unknown): value is string {
  return typeof value === 'string' && identifierPattern.test(value);
}

function isRequestId(value: unknown): value is string {
  return typeof value === 'string' && requestIdPattern.test(value);
}

function isIsoTimestamp(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    isoTimestampPattern.test(value) &&
    !Number.isNaN(Date.parse(value))
  );
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return (
    actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index])
  );
}

function serializedByteLength(value: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(value), 'utf8');
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
