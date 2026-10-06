import type { InvoiceDocumentRow, NewInvoiceDocumentRow } from '../../../database/schema.js';
import { InvoiceDocumentIntegrityError } from '../application/invoiceDocumentIntegrityError.js';
import {
  approvedInvoicePdfDocumentType, approvedInvoicePdfMimeType,
  type ApprovedInvoiceDocumentMetadata,
  type StoredInvoiceDocumentMetadata,
} from '../domain/approvedInvoiceDocument.js';
import type { InvoiceScope } from '../domain/invoiceContentRevision.js';
import type { InvoiceDocumentCandidate } from '../ports/invoiceDocumentRepository.js';
import { createInvoiceDocumentStoragePath, invoiceDocumentMaximumSizeBytes } from './invoiceDocumentFilePolicy.js';

function nonempty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function validateDocumentCandidate(scope: InvoiceScope, candidate: InvoiceDocumentCandidate): void {
  if (!nonempty(candidate.fileName) || /[\u0000-\u001f\u007f]/u.test(candidate.fileName)
    || !nonempty(candidate.createdAt) || !isDocumentEvidence(candidate.sha256, candidate.sizeBytes)
    || candidate.storagePath !== createInvoiceDocumentStoragePath(scope, candidate.id)) {
    throw new InvoiceDocumentIntegrityError();
  }
}

export function isDocumentEvidence(sha256: unknown, sizeBytes: unknown): boolean {
  return typeof sha256 === 'string' && /^[0-9a-f]{64}$/u.test(sha256)
    && typeof sizeBytes === 'number' && Number.isSafeInteger(sizeBytes)
    && sizeBytes > 0 && sizeBytes <= invoiceDocumentMaximumSizeBytes;
}

export function toStoredInvoiceDocument(row: InvoiceDocumentRow): StoredInvoiceDocumentMetadata {
  if (![row.id, row.company_id, row.invoice_id, row.file_name, row.storage_path, row.created_at].every(nonempty)
    || row.document_type !== approvedInvoicePdfDocumentType || row.mime_type !== approvedInvoicePdfMimeType
    || typeof row.sha256 !== 'string' || row.sha256.length !== 64
    || !Number.isSafeInteger(row.size_bytes) || row.size_bytes <= 0) {
    throw new InvoiceDocumentIntegrityError();
  }
  const metadata: ApprovedInvoiceDocumentMetadata = {
    id: row.id, companyId: row.company_id, invoiceId: row.invoice_id,
    documentType: approvedInvoicePdfDocumentType, fileName: row.file_name,
    storagePath: row.storage_path, mimeType: approvedInvoicePdfMimeType,
    sha256: row.sha256, sizeBytes: row.size_bytes, createdAt: row.created_at,
  };
  if (row.binding_kind === 'legacyOriginal' && row.revision_id === null && row.source_document_id === null) {
    // Preserve migrated metadata as evidence; a later verified file read decides usability.
    return { ...metadata, binding: { kind: 'legacyOriginal' } };
  }
  validateDocumentCandidate(metadata, metadata);
  if (row.binding_kind === 'revision' && nonempty(row.revision_id) && row.source_document_id === null) {
    return { ...metadata, binding: { kind: 'revision', revisionId: row.revision_id } };
  }
  if (row.binding_kind === 'preservedLegacy' && row.revision_id === null
    && nonempty(row.source_document_id) && row.source_document_id !== row.id) {
    return { ...metadata, binding: { kind: 'preservedLegacy', sourceDocumentId: row.source_document_id } };
  }
  throw new InvoiceDocumentIntegrityError();
}

export function toInvoiceDocumentRow(metadata: StoredInvoiceDocumentMetadata): NewInvoiceDocumentRow {
  return {
    id: metadata.id, company_id: metadata.companyId, invoice_id: metadata.invoiceId,
    document_type: metadata.documentType, file_name: metadata.fileName,
    storage_path: metadata.storagePath, mime_type: metadata.mimeType,
    sha256: metadata.sha256, size_bytes: metadata.sizeBytes, created_at: metadata.createdAt,
    binding_kind: metadata.binding.kind,
    revision_id: metadata.binding.kind === 'revision' ? metadata.binding.revisionId : null,
    source_document_id: metadata.binding.kind === 'preservedLegacy' ? metadata.binding.sourceDocumentId : null,
  };
}
