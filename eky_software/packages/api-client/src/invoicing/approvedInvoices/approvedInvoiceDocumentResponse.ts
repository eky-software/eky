import { isRecord } from '../../http.js';
import {
  invalidApprovedInvoiceResponse,
  readSafeInteger,
  readString,
} from './approvedInvoiceResponsePrimitives.js';
import type { ApprovedInvoiceDocumentMetadata } from './approvedInvoicesTypes.js';

export function readApprovedInvoiceDocumentMetadataResponse(
  responseBody: unknown,
): ApprovedInvoiceDocumentMetadata {
  if (!isRecord(responseBody)) {
    throw invalidApprovedInvoiceResponse(responseBody);
  }

  return parseApprovedInvoiceDocumentMetadata(responseBody.document);
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
