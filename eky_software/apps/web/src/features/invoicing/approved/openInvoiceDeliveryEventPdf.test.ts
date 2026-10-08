import { describe, expect, it, vi } from 'vitest';
import { openInvoiceDeliveryEventPdf } from './openInvoiceDeliveryEventPdf.js';

function setup() {
  const preview = { close: vi.fn(), location: { href: '' }, opener: {} as unknown };
  return { preview, input: {
    invoiceId: 'invoice-1', eventId: 'event-old',
    getPdfUrl: vi.fn(() => '/invoices/invoice-1/delivery-events/event-old/pdf'),
    openBrowserWindow: vi.fn(() => preview),
  } };
}

describe('openInvoiceDeliveryEventPdf', () => {
  it('opens the exact event in native without an invoice-only fallback', async () => {
    const { input } = setup();
    const openDesktopPreview = vi.fn(async () => undefined);
    expect(await openInvoiceDeliveryEventPdf({ ...input, openDesktopPreview })).toBe(true);
    expect(openDesktopPreview).toHaveBeenCalledExactlyOnceWith('invoice-1', { kind: 'deliveryEvent', eventId: 'event-old' });
    expect(input.getPdfUrl).not.toHaveBeenCalled();
    expect(input.openBrowserWindow).not.toHaveBeenCalled();
  });
  it('does not use browser fallback after native failure', async () => {
    const { input } = setup();
    expect(await openInvoiceDeliveryEventPdf({ ...input,
      openDesktopPreview: vi.fn().mockRejectedValue(new Error('private detail')),
    })).toBe(false);
    expect(input.openBrowserWindow).not.toHaveBeenCalled();
  });
  it('opens only the event URL synchronously for browser activation and removes opener', async () => {
    const { input, preview } = setup();
    const result = openInvoiceDeliveryEventPdf(input);
    expect(input.getPdfUrl).toHaveBeenCalledExactlyOnceWith('invoice-1', 'event-old');
    expect(preview.location.href).toBe('/invoices/invoice-1/delivery-events/event-old/pdf');
    expect(preview.opener).toBeNull();
    expect(await result).toBe(true);
  });
  it('reports a blocked popup without another attempt', async () => {
    const { input } = setup();
    const openBrowserWindow = vi.fn(() => null);
    expect(await openInvoiceDeliveryEventPdf({ ...input, openBrowserWindow })).toBe(false);
    expect(openBrowserWindow).toHaveBeenCalledOnce();
  });
  it('closes a failed navigation and hides raw errors', async () => {
    const { input, preview } = setup();
    Object.defineProperty(preview.location, 'href', { set: () => { throw new Error('private path'); } });
    expect(await openInvoiceDeliveryEventPdf(input)).toBe(false);
    expect(preview.close).toHaveBeenCalledOnce();
  });
});
