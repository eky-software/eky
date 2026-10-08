import { describe, expect, it, vi } from 'vitest';

import { createApprovedInvoicesApi } from './approvedInvoicesClient.js';

describe('preserved legacy PDF URL', () => {
  it.each(['https://example.invalid', 'eky://app'])('uses the fixed exact-document route at %s', baseUrl => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const api = createApprovedInvoicesApi(fetch, baseUrl);
    expect(api.getPreservedLegacyInvoicePdfUrl('invoice-1', 'preserved-1')).toBe(
      `${baseUrl}/invoices/invoice-1/preserved-documents/preserved-1/pdf`,
    );
    expect(api.getApprovedInvoicePdfUrl('invoice-1')).toBe(`${baseUrl}/invoices/invoice-1/pdf`);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('encodes both identifiers without accepting URL, path or query overrides', () => {
    const api = createApprovedInvoicesApi(vi.fn<typeof globalThis.fetch>(), 'eky://app');
    expect(api.getPreservedLegacyInvoicePdfUrl('invoice/other', 'https://other.invalid/file?companyId=foreign#pdf')).toBe(
      'eky://app/invoices/invoice%2Fother/preserved-documents/https%3A%2F%2Fother.invalid%2Ffile%3FcompanyId%3Dforeign%23pdf/pdf',
    );
  });
});
