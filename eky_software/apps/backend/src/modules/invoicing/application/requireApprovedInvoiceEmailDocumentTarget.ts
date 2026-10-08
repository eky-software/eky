import { InvoiceDraftValidationError } from '../domain/invoiceDraftValidationError.js';
import type { ApprovedInvoiceEmailDocumentTarget } from './approvedInvoiceEmailPreview.js';

const documentIdPattern = /^[A-Za-z0-9_-]{1,100}$/;

export function requireApprovedInvoiceEmailDocumentTarget(value: unknown): ApprovedInvoiceEmailDocumentTarget {
  if (typeof value !== 'object' || value === null || Array.isArray(value)
    || Object.keys(value).length !== 2
    || Object.keys(value).some(key => key !== 'kind' && key !== 'documentId')
    || !('kind' in value) || !('documentId' in value)
    || (value.kind !== 'revision' && value.kind !== 'preservedLegacy')
    || typeof value.documentId !== 'string'
    || documentIdPattern.exec(value.documentId)?.[0] !== value.documentId) {
    throw new InvoiceDraftValidationError('Invalid invoice email document target.');
  }
  return { kind: value.kind, documentId: value.documentId };
}
