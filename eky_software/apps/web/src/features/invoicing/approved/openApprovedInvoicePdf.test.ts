import type { ApprovedInvoiceDocumentMetadata } from '@eky/api-client';
import { describe, expect, it, vi } from 'vitest';

import { openApprovedInvoicePdf } from './openApprovedInvoicePdf.js';

describe('openApprovedInvoicePdf', () => {
  it('sends only the invoice id to the desktop preview after ensuring the PDF', async () => {
    const callOrder: string[] = [];
    const openDesktopPreview = vi.fn(async (invoiceId: string) => {
      callOrder.push(`open:${invoiceId}`);
    });

    await expect(
      openApprovedInvoicePdf({
        createPdf: async (invoiceId) => {
          callOrder.push(`create:${invoiceId}`);
          return createMetadata();
        },
        getPdfUrl: vi.fn(() => {
          throw new Error('Browser URL must not be created in desktop mode.');
        }),
        id: 'invoice-1',
        openBrowserWindow: vi.fn(() => {
          throw new Error('Browser window must not open in desktop mode.');
        }),
        openDesktopPreview,
      }),
    ).resolves.toBe(true);
    expect(callOrder).toEqual(['create:invoice-1', 'open:invoice-1']);
    expect(openDesktopPreview).toHaveBeenCalledWith('invoice-1');
  });

  it('does not open a desktop preview when PDF creation fails', async () => {
    const openDesktopPreview = vi.fn(async () => undefined);

    await expect(
      openApprovedInvoicePdf({
        createPdf: vi.fn(async () => null),
        getPdfUrl: vi.fn(() => '/invoices/invoice-1/pdf'),
        id: 'invoice-1',
        openBrowserWindow: vi.fn(() => null),
        openDesktopPreview,
      }),
    ).resolves.toBe(false);
    expect(openDesktopPreview).not.toHaveBeenCalled();
  });

  it('keeps the existing browser preview behavior outside Electron', async () => {
    const browserWindow = {
      close: vi.fn(),
      location: { href: '' },
      opener: 'unsafe-opener' as unknown,
    };
    const openBrowserWindow = vi.fn(() => browserWindow);

    await expect(
      openApprovedInvoicePdf({
        createPdf: vi.fn(async () => createMetadata()),
        getPdfUrl: vi.fn(() => '/invoices/invoice-1/pdf'),
        id: 'invoice-1',
        openBrowserWindow,
      }),
    ).resolves.toBe(true);
    expect(browserWindow.opener).toBeNull();
    expect(browserWindow.location.href).toBe('/invoices/invoice-1/pdf');
  });
});

function createMetadata(): ApprovedInvoiceDocumentMetadata {
  return {
    companyId: 'company-1',
    createdAt: '2026-07-16T20:00:00.000Z',
    documentType: 'approved_invoice_pdf',
    fileName: 'invoice.pdf',
    id: 'document-1',
    invoiceId: 'invoice-1',
    mimeType: 'application/pdf',
    sha256: 'a'.repeat(64),
    sizeBytes: 1024,
    storagePath: 'company-1/invoice-1/invoice.pdf',
  };
}
