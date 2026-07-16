import { describe, expect, it } from 'vitest';

import {
  createInvoicePdfPreviewUrl,
  createInvoicePdfPreviewWindowOptions,
  isAllowedInvoicePdfPreviewNavigation,
} from './invoicePdfPreviewPolicy.js';

describe('invoice PDF preview policy', () => {
  it('creates only the approved application PDF URL from a strict resource id', () => {
    expect(createInvoicePdfPreviewUrl('invoice_2026-1')).toBe(
      'eky://app/invoices/invoice_2026-1/pdf',
    );

    for (const value of [
      '',
      '../invoice-1',
      'invoice/1',
      'invoice%2f1',
      'https://example.com/invoice.pdf',
      'file:///C:/secret.pdf',
      'data:application/pdf;base64,JVBERi0=',
      'javascript:alert(1)',
      'x'.repeat(101),
      123,
      null,
    ]) {
      expect(() => createInvoicePdfPreviewUrl(value)).toThrow(
        'INVOICE_PDF_PREVIEW_INVALID_ID',
      );
    }
  });

  it('allows navigation only to the exact main-created PDF URL', () => {
    const expectedUrl = createInvoicePdfPreviewUrl('invoice-1');

    expect(
      isAllowedInvoicePdfPreviewNavigation(expectedUrl, expectedUrl),
    ).toBe(true);
    expect(
      isAllowedInvoicePdfPreviewNavigation(
        'eky://app/invoices/invoice-2/pdf',
        expectedUrl,
      ),
    ).toBe(false);
    expect(
      isAllowedInvoicePdfPreviewNavigation(`${expectedUrl}?session=secret`, expectedUrl),
    ).toBe(false);
    expect(
      isAllowedInvoicePdfPreviewNavigation(`${expectedUrl}#page=2`, expectedUrl),
    ).toBe(false);

    for (const targetUrl of [
      'http://127.0.0.1:3000/invoices/invoice-1/pdf',
      'https://example.com/invoice.pdf',
      'file:///C:/secret.pdf',
      'data:application/pdf;base64,JVBERi0=',
      'javascript:alert(1)',
    ]) {
      expect(
        isAllowedInvoicePdfPreviewNavigation(targetUrl, expectedUrl),
      ).toBe(false);
    }
  });

  it('creates a sandboxed child window without preload or Node privileges', () => {
    const parent = {} as never;
    const options = createInvoicePdfPreviewWindowOptions(parent);

    expect(options).toMatchObject({
      modal: false,
      parent,
      show: false,
    });
    expect(options.webPreferences).toEqual({
      allowRunningInsecureContent: false,
      contextIsolation: true,
      devTools: false,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      plugins: true,
      sandbox: true,
      webSecurity: true,
      webviewTag: false,
    });
    expect(options.webPreferences).not.toHaveProperty('preload');
  });
});
