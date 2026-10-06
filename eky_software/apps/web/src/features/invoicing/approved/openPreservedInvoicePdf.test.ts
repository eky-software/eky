import { describe, expect, it, vi } from 'vitest';

import { openPreservedInvoicePdf } from './openPreservedInvoicePdf.js';

function setup() {
  const preview = { close: vi.fn(), location: { href: '' }, opener: {} as unknown };
  return {
    preview,
    input: {
      invoiceId: 'invoice-1', documentId: 'copy-2',
      getPdfUrl: vi.fn(() => '/invoices/invoice-1/preserved-documents/copy-2/pdf'),
      openBrowserWindow: vi.fn(() => preview),
    },
  };
}

describe('openPreservedInvoicePdf', () => {
  it('uses the named desktop copy, not an invoice-only preview or browser fallback', async () => {
    const { input } = setup();
    const openDesktopPreview = vi.fn(async () => undefined);
    expect(await openPreservedInvoicePdf({ ...input, openDesktopPreview })).toBe(true);
    expect(openDesktopPreview).toHaveBeenCalledExactlyOnceWith('invoice-1', {
      kind: 'preservedLegacy', documentId: 'copy-2',
    });
    expect(input.getPdfUrl).not.toHaveBeenCalled();
    expect(input.openBrowserWindow).not.toHaveBeenCalled();
  });

  it('does not fall back to a different document when native opening fails', async () => {
    const { input } = setup();
    const openDesktopPreview = vi.fn().mockRejectedValue(new Error('private native detail'));
    expect(await openPreservedInvoicePdf({ ...input, openDesktopPreview })).toBe(false);
    expect(input.getPdfUrl).not.toHaveBeenCalled();
    expect(input.openBrowserWindow).not.toHaveBeenCalled();
  });

  it('opens only the exact API-client URL and removes the browser opener', async () => {
    const { input, preview } = setup();
    const result = openPreservedInvoicePdf(input);
    expect(input.openBrowserWindow).toHaveBeenCalledExactlyOnceWith('', '_blank');
    expect(preview.opener).toBeNull();
    expect(preview.location.href).toBe('/invoices/invoice-1/preserved-documents/copy-2/pdf');
    expect(input.getPdfUrl).toHaveBeenCalledExactlyOnceWith('invoice-1', 'copy-2');
    expect(await result).toBe(true);
  });

  it('reports a blocked browser popup without another opening attempt', async () => {
    const { input } = setup();
    const openBrowserWindow = vi.fn(() => null);
    expect(await openPreservedInvoicePdf({ ...input, openBrowserWindow })).toBe(false);
    expect(openBrowserWindow).toHaveBeenCalledTimes(1);
  });

  it.each(['url', 'window', 'navigation', 'close'] as const)('handles %s failure without exposing details', async (fault) => {
    const { input, preview } = setup();
    const fail = () => { throw new Error('private path and raw error'); };
    if (fault === 'url') input.getPdfUrl.mockImplementation(fail);
    else if (fault === 'window') input.openBrowserWindow.mockImplementation(fail);
    else {
      Object.defineProperty(preview.location, 'href', { set: fail });
      if (fault === 'close') preview.close.mockImplementation(fail);
    }
    expect(await openPreservedInvoicePdf(input)).toBe(false);
    if (fault === 'navigation' || fault === 'close') expect(preview.close).toHaveBeenCalledOnce();
  });
});
