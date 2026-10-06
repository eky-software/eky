import { InvoiceDocumentIntegrityError } from '../application/invoiceDocumentIntegrityError.js';
import type { InvoiceScope } from '../domain/invoiceContentRevision.js';
import { requireIdentifier } from '../domain/invoiceDraftRules.js';

export const invoiceDocumentMaximumSizeBytes = 10 * 1024 * 1024;
export const invoiceDocumentPdfSignature = '%PDF-';

export function createInvoiceDocumentStoragePath(scope: InvoiceScope, documentId: string): string {
  return [scope.companyId, scope.invoiceId, documentId]
    .map(encodePathSegment).concat('approved-invoice.pdf').join('/');
}

function encodePathSegment(value: string): string {
  if (typeof value !== 'string' || value.trim().length === 0 || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new InvoiceDocumentIntegrityError();
  }
  // Encode Windows metacharacters and dot segments as well as path separators.
  try {
    requireIdentifier(value, 'Document file key');
    const encoded = encodeURIComponent(value).replace(/[.!'()*]/gu,
      (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
    // The prefix also prevents reserved Windows device names such as CON.
    return `id-${encoded}`;
  } catch {
    throw new InvoiceDocumentIntegrityError();
  }
}
