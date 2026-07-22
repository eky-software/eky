import { describe, expect, it, vi } from 'vitest';

import {
  getDesktopInvoicePdfPreview,
  type DesktopInvoicePdfPreviewApi,
} from './desktopBridge.js';

describe('desktop bridge', () => {
  it('returns only the narrow invoice PDF preview callback when available', async () => {
    const openInvoicePdf = vi.fn(async () => undefined);
    const preview = getDesktopInvoicePdfPreview({
      ekyDesktop: { openInvoicePdf },
    } as Pick<Window, 'ekyDesktop'>);

    await preview?.('invoice-1');

    expect(openInvoicePdf).toHaveBeenCalledWith('invoice-1');
  });

  it('does not invent a desktop bridge in the browser runtime', () => {
    expect(
      getDesktopInvoicePdfPreview({} as Pick<Window, 'ekyDesktop'>),
    ).toBeUndefined();
  });

  it('does not expose desktop-only capabilities through a malformed bridge', () => {
    expect(
      getDesktopInvoicePdfPreview({
        ekyDesktop: {} as DesktopInvoicePdfPreviewApi,
      } as Pick<Window, 'ekyDesktop'>),
    ).toBeUndefined();
  });
});
