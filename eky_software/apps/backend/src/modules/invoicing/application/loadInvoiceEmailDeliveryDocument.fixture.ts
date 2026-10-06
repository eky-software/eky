import { createHash } from 'node:crypto';
import type { InvoiceEmailDeliveryDocument } from './loadInvoiceEmailDeliveryDocument.js';
import { createDocumentMetadata } from './generateApprovedInvoicePdfDocument.fixture.js';

export function createEmailDocument(): InvoiceEmailDeliveryDocument {
  const content = new TextEncoder().encode('%PDF-synthetic-email');
  const metadata = {
    ...createDocumentMetadata({ companyId: 'company-1', invoiceId: 'invoice-1', revisionId: 'revision-1' }),
    id: 'document-1', fileName: 'lasku-20260001.pdf',
    sha256: createHash('sha256').update(content).digest('hex'), sizeBytes: content.byteLength,
  };
  return { content, metadata, target: {
    companyId: metadata.companyId, invoiceId: metadata.invoiceId,
    ...metadata.binding, documentId: metadata.id, sha256: metadata.sha256, sizeBytes: metadata.sizeBytes,
  } };
}
