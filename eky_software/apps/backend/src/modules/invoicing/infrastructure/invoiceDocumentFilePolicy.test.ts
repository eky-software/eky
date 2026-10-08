import { describe, expect, it } from 'vitest';

import { InvoiceDocumentIntegrityError } from '../application/invoiceDocumentIntegrityError.js';
import { createInvoiceDocumentStoragePath, invoiceDocumentMaximumSizeBytes } from './invoiceDocumentFilePolicy.js';

describe('invoice document file policy', () => {
  it('gives each document an independent company/invoice/id path', () => {
    const scope = { companyId: 'company-1', invoiceId: 'invoice-1' };
    expect(createInvoiceDocumentStoragePath(scope, 'document-1')).toBe(
      'id-company-1/id-invoice-1/id-document-1/approved-invoice.pdf',
    );
    expect(createInvoiceDocumentStoragePath(scope, 'document-2')).not.toBe(
      createInvoiceDocumentStoragePath(scope, 'document-1'),
    );
    expect(invoiceDocumentMaximumSizeBytes).toBe(10_485_760);
  });

  it('encodes separators, dot segments, metacharacters and reserved names', () => {
    expect(createInvoiceDocumentStoragePath({ companyId: '..', invoiceId: 'CON' }, '../A\\B:*?.')).toBe(
      'id-%2E%2E/id-CON/id-%2E%2E%2FA%5CB%3A%2A%3F%2E/approved-invoice.pdf',
    );
    expect(createInvoiceDocumentStoragePath({ companyId: '%2F', invoiceId: 'a/b' }, 'x ')).toBe(
      'id-%252F/id-a%2Fb/id-x%20/approved-invoice.pdf',
    );
  });

  it.each(['', ' ', '\u0000', 'a\nb', '\u007f', '\ud800', 'a'.repeat(201)])(
    'rejects invalid keys with a content-free error (%#)', (value) => {
      const scope = { companyId: 'company', invoiceId: 'invoice' };
      for (const operation of [
        () => createInvoiceDocumentStoragePath({ ...scope, companyId: value }, 'document'),
        () => createInvoiceDocumentStoragePath({ ...scope, invoiceId: value }, 'document'),
        () => createInvoiceDocumentStoragePath(scope, value),
      ]) {
        expect(operation).toThrow(InvoiceDocumentIntegrityError);
        expect(operation).toThrow('Stored invoice document is inconsistent.');
      }
    },
  );
});
