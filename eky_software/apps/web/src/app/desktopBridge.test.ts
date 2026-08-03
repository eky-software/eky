import { describe, expect, it, vi } from 'vitest';

import {
  getDesktopInvoicePdfArchive,
  getDesktopInvoicePdfPreview,
  getDesktopOperationalLogFolder,
  getDesktopSupportBundleCreator,
  type EkyDesktopApi,
} from './desktopBridge.js';

describe('desktop bridge', () => {
  it('returns only the narrow invoice PDF preview callback when available', async () => {
    const openInvoicePdf = vi.fn(async () => undefined);
    const preview = getDesktopInvoicePdfPreview({
      ekyDesktop: createDesktopApi({ openInvoicePdf }),
    });

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
      ekyDesktop: createDesktopApi({ openOperationalLogFolder }),
    });

    await openLogFolder?.();

    expect(openOperationalLogFolder).toHaveBeenCalledOnce();
  });

  it('exposes support bundle creation without returning a file path', async () => {
    const createSupportBundle = vi.fn(async () => 'created' as const);
    const createBundle = getDesktopSupportBundleCreator({
      ekyDesktop: createDesktopApi({ createSupportBundle }),
    });

    await expect(createBundle?.()).resolves.toBe('created');
    expect(createSupportBundle).toHaveBeenCalledWith();
  });

  it('exposes the narrow invoice PDF archive capability', async () => {
    const chooseInvoicePdfArchiveDirectory = vi.fn(async () => enabledStatus);
    const disableInvoicePdfArchive = vi.fn(async () => disabledStatus);
    const getInvoicePdfArchiveStatus = vi.fn(async () => enabledStatus);
    const openInvoicePdfArchiveDirectory = vi.fn(async () => undefined);
    const retryPendingInvoicePdfArchiveTasks = vi.fn(
      async () => enabledStatus,
    );
    const capability = getDesktopInvoicePdfArchive({
      ekyDesktop: createDesktopApi({
        chooseInvoicePdfArchiveDirectory,
        disableInvoicePdfArchive,
        getInvoicePdfArchiveStatus,
        openInvoicePdfArchiveDirectory,
        retryPendingInvoicePdfArchiveTasks,
      }),
    });

    await expect(capability?.getStatus()).resolves.toEqual(enabledStatus);
    await expect(capability?.chooseDirectory()).resolves.toEqual(enabledStatus);
    await expect(capability?.retryPending()).resolves.toEqual(enabledStatus);
    await expect(capability?.disable()).resolves.toEqual(disabledStatus);
    await expect(capability?.openDirectory()).resolves.toBeUndefined();

    expect(chooseInvoicePdfArchiveDirectory).toHaveBeenCalledWith();
    expect(disableInvoicePdfArchive).toHaveBeenCalledWith();
    expect(getInvoicePdfArchiveStatus).toHaveBeenCalledWith();
    expect(openInvoicePdfArchiveDirectory).toHaveBeenCalledWith();
    expect(retryPendingInvoicePdfArchiveTasks).toHaveBeenCalledWith();
  });

  it('does not expose an incomplete invoice PDF archive bridge', () => {
    const desktop = createDesktopApi();
    desktop.retryPendingInvoicePdfArchiveTasks = undefined as never;

    expect(
      getDesktopInvoicePdfArchive({ ekyDesktop: desktop }),
    ).toBeUndefined();
  });

  it.each([
    {
      ...enabledStatus,
      displayName: 'C:\\Renderer\\Path',
    },
    {
      ...enabledStatus,
      lastSafeErrorCode: 'INTERNAL_ERROR',
    },
    {
      ...enabledStatus,
      pendingCount: -1,
    },
    {
      ...enabledStatus,
      rawDirectoryPath: 'C:\\Secret',
    },
  ])('rejects an unsafe invoice PDF archive status', async (status) => {
    const capability = getDesktopInvoicePdfArchive({
      ekyDesktop: createDesktopApi({
        getInvoicePdfArchiveStatus: vi.fn(async () => status),
      }),
    });

    await expect(capability?.getStatus()).rejects.toThrow(
      'Invalid invoice PDF archive status.',
    );
  });
});

const enabledStatus = {
  displayName: 'Laskuarkisto',
  enabled: true,
  lastArchivedAt: '2026-08-03T20:00:00.000Z',
  lastSafeErrorCode: null,
  pendingCount: 2,
};

const disabledStatus = {
  displayName: null,
  enabled: false,
  lastArchivedAt: null,
  lastSafeErrorCode: null,
  pendingCount: 0,
};

function createDesktopApi(
  overrides: Partial<EkyDesktopApi> = {},
): EkyDesktopApi {
  return {
    chooseInvoicePdfArchiveDirectory: vi.fn(async () => disabledStatus),
    createSupportBundle: vi.fn(async () => 'cancelled' as const),
    disableInvoicePdfArchive: vi.fn(async () => disabledStatus),
    getInvoicePdfArchiveStatus: vi.fn(async () => disabledStatus),
    openInvoicePdf: vi.fn(async () => undefined),
    openInvoicePdfArchiveDirectory: vi.fn(async () => undefined),
    openOperationalLogFolder: vi.fn(async () => undefined),
    retryPendingInvoicePdfArchiveTasks: vi.fn(async () => disabledStatus),
    ...overrides,
  };
}
