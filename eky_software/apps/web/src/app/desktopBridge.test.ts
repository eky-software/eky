import { describe, expect, it, vi } from 'vitest';

import {
  getDesktopInvoicePdfPreview,
  getDesktopOperationalLogFolder,
  type EkyDesktopApi,
} from './desktopBridge.js';

describe('desktop bridge', () => {
  it('returns only the narrow invoice PDF preview callback when available', async () => {
    const openInvoicePdf = vi.fn(async () => undefined);
    const preview = getDesktopInvoicePdfPreview({
      ekyDesktop: {
        openInvoicePdf,
        openOperationalLogFolder: vi.fn(async () => undefined),
      },
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
        ekyDesktop: {} as EkyDesktopApi,
      } as Pick<Window, 'ekyDesktop'>),
    ).toBeUndefined();
  });

  it('exposes the fixed desktop log folder capability when available', async () => {
    const openOperationalLogFolder = vi.fn(async () => undefined);
    const openLogFolder = getDesktopOperationalLogFolder({
      ekyDesktop: {
        openInvoicePdf: vi.fn(async () => undefined),
        openOperationalLogFolder,
      },
    } as Pick<Window, 'ekyDesktop'>);

    await openLogFolder?.();

    expect(openOperationalLogFolder).toHaveBeenCalledOnce();
  });
});
