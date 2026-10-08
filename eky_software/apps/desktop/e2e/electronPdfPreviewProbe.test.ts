import { describe, expect, it } from 'vitest';

import { isElectronPdfPreviewUrl } from './electronPdfPreviewProbe.js';

describe('Electron E2E PDF window selection', () => {
  it.each([
    'eky://app/invoices/invoice-1/pdf',
    'eky://app/invoices/invoice-1/delivery-events/event-1/pdf',
    'eky://app/invoices/invoice-1/preserved-documents/copy-1/pdf',
  ])('observes and closes the exact preview: %s', value => {
    expect(isElectronPdfPreviewUrl(value)).toBe(true);
  });

  it.each([
    'eky://app/', 'about:blank', 'https://app/invoices/invoice-1/pdf',
    'eky://other/invoices/invoice-1/pdf', 'eky://app/invoices/invoice-1',
    'eky://app/invoices/invoice-1/other/event-1/pdf',
    'eky://app/invoices/invoice-1/delivery-events//pdf',
    'eky://app/invoices/invoice-1/delivery-events/event-1/pdf?other=1',
    'eky://app/invoices/invoice-1/pdf#other',
    'eky://app/invoices/invoice-1/pdf\n',
    'eky://app/invoices/%69nvoice-1/pdf',
    'eky://app/invoices/invoice-1/delivery-events/../pdf',
  ])('does not select another window: %s', value => {
    expect(isElectronPdfPreviewUrl(value)).toBe(false);
  });
});
