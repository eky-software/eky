import { describe, expect, it, vi } from 'vitest';

import {
  createInvoicePdfArchiveCapability,
} from './invoicePdfArchiveCapability.js';
import {
  chooseInvoicePdfArchiveDirectoryIpcChannel,
  disableInvoicePdfArchiveIpcChannel,
  getInvoicePdfArchiveStatusIpcChannel,
  openInvoicePdfArchiveDirectoryIpcChannel,
  retryPendingInvoicePdfArchiveTasksIpcChannel,
} from './invoicePdfArchiveCapabilityTypes.js';
import type { InvoicePdfArchiveStatus } from './invoicePdfArchiveTypes.js';

describe('invoice PDF archive capability', () => {
  it('lets main own directory selection without accepting renderer input', async () => {
    const fixture = createFixture();

    await expect(
      fixture.invoke(
        chooseInvoicePdfArchiveDirectoryIpcChannel,
        fixture.trustedEvent,
      ),
    ).resolves.toEqual(enabledStatus);

    expect(fixture.selectDirectory).toHaveBeenCalledWith();
    expect(fixture.chooseDirectory).toHaveBeenCalledWith(
      'C:\\Invoices\\Archive',
    );
    await expect(
      fixture.invoke(
        chooseInvoicePdfArchiveDirectoryIpcChannel,
        fixture.trustedEvent,
        'C:\\Renderer\\Controlled',
      ),
    ).rejects.toThrow('INVOICE_PDF_ARCHIVE_FORBIDDEN');
  });

  it('returns only the safe status and opens only the stored directory', async () => {
    const fixture = createFixture({ status: enabledStatus });

    await expect(
      fixture.invoke(
        getInvoicePdfArchiveStatusIpcChannel,
        fixture.trustedEvent,
      ),
    ).resolves.toEqual(enabledStatus);
    await expect(
      fixture.invoke(
        openInvoicePdfArchiveDirectoryIpcChannel,
        fixture.trustedEvent,
      ),
    ).resolves.toBeUndefined();

    expect(fixture.getOpenDirectoryPath).toHaveBeenCalledWith();
    expect(fixture.openPath).toHaveBeenCalledWith('C:\\Invoices\\Archive');
  });

  it('requires main-owned confirmation before changing or disabling', async () => {
    const fixture = createFixture({
      changeConfirmed: false,
      disableConfirmed: false,
      status: enabledStatus,
    });

    await expect(
      fixture.invoke(
        chooseInvoicePdfArchiveDirectoryIpcChannel,
        fixture.trustedEvent,
      ),
    ).resolves.toEqual(enabledStatus);
    await expect(
      fixture.invoke(
        disableInvoicePdfArchiveIpcChannel,
        fixture.trustedEvent,
      ),
    ).resolves.toEqual(enabledStatus);

    expect(fixture.selectDirectory).not.toHaveBeenCalled();
    expect(fixture.disable).not.toHaveBeenCalled();
    expect(fixture.onConfigurationChanged).not.toHaveBeenCalled();
  });

  it('reports configuration changes without exposing the selected path', async () => {
    const fixture = createFixture({ status: enabledStatus });

    await fixture.invoke(
      chooseInvoicePdfArchiveDirectoryIpcChannel,
      fixture.trustedEvent,
    );
    await fixture.invoke(
      disableInvoicePdfArchiveIpcChannel,
      fixture.trustedEvent,
    );

    expect(fixture.onConfigurationChanged).toHaveBeenNthCalledWith(
      1,
      'enabled',
    );
    expect(fixture.onConfigurationChanged).toHaveBeenNthCalledWith(
      2,
      'disabled',
    );
  });

  it('retries all pending tasks without accepting a task identifier', async () => {
    const fixture = createFixture();

    await expect(
      fixture.invoke(
        retryPendingInvoicePdfArchiveTasksIpcChannel,
        fixture.trustedEvent,
      ),
    ).resolves.toEqual(enabledStatus);
    expect(fixture.retryPending).toHaveBeenCalledWith(false);

    await expect(
      fixture.invoke(
        retryPendingInvoicePdfArchiveTasksIpcChannel,
        fixture.trustedEvent,
        'task-id',
      ),
    ).rejects.toThrow('INVOICE_PDF_ARCHIVE_FORBIDDEN');
  });

  it('rejects requests outside the trusted main frame and disposes all handlers', async () => {
    const fixture = createFixture();

    await expect(
      fixture.invoke(getInvoicePdfArchiveStatusIpcChannel, {
        sender: {},
        senderFrame: fixture.mainFrame,
      }),
    ).rejects.toThrow('INVOICE_PDF_ARCHIVE_FORBIDDEN');

    fixture.capability.dispose();
    expect(fixture.removeHandler).toHaveBeenCalledWith(
      getInvoicePdfArchiveStatusIpcChannel,
    );
    expect(fixture.removeHandler).toHaveBeenCalledWith(
      chooseInvoicePdfArchiveDirectoryIpcChannel,
    );
    expect(fixture.removeHandler).toHaveBeenCalledWith(
      openInvoicePdfArchiveDirectoryIpcChannel,
    );
    expect(fixture.removeHandler).toHaveBeenCalledWith(
      disableInvoicePdfArchiveIpcChannel,
    );
    expect(fixture.removeHandler).toHaveBeenCalledWith(
      retryPendingInvoicePdfArchiveTasksIpcChannel,
    );
  });
});

const disabledStatus: InvoicePdfArchiveStatus = {
  displayName: null,
  enabled: false,
  lastArchivedAt: null,
  lastSafeErrorCode: null,
  pendingCount: 0,
};

const enabledStatus: InvoicePdfArchiveStatus = {
  displayName: 'Archive',
  enabled: true,
  lastArchivedAt: null,
  lastSafeErrorCode: null,
  pendingCount: 0,
};

function createFixture(
  options: {
    changeConfirmed?: boolean;
    disableConfirmed?: boolean;
    status?: InvoicePdfArchiveStatus;
  } = {},
) {
  const handlers = new Map<
    string,
    (event: unknown, ...args: unknown[]) => Promise<unknown>
  >();
  const handle = vi.fn(
    (
      channel: string,
      handler: (event: unknown, ...args: unknown[]) => Promise<unknown>,
    ) => {
      handlers.set(channel, handler);
    },
  );
  const removeHandler = vi.fn((channel: string) => {
    handlers.delete(channel);
  });
  const mainFrame = {};
  const webContents = { mainFrame };
  const status = options.status ?? disabledStatus;
  const chooseDirectory = vi.fn(async () => enabledStatus);
  const disable = vi.fn(async () => disabledStatus);
  const getOpenDirectoryPath = vi.fn(async () => 'C:\\Invoices\\Archive');
  const getStatus = vi.fn(async () => status);
  const retryPending = vi.fn(async () => enabledStatus);
  const openPath = vi.fn(async () => '');
  const onConfigurationChanged = vi.fn();
  const selectDirectory = vi.fn(async () => 'C:\\Invoices\\Archive');
  const capability = createInvoicePdfArchiveCapability({
    confirmChange: vi.fn(async () => options.changeConfirmed ?? true),
    confirmDisable: vi.fn(async () => options.disableConfirmed ?? true),
    ipcMain: { handle, removeHandler } as never,
    mainWindow: {
      isDestroyed: () => false,
      webContents,
    } as never,
    onConfigurationChanged,
    openPath,
    selectDirectory,
    service: {
      chooseDirectory,
      disable,
      getOpenDirectoryPath,
      getStatus,
      retryPending,
    } as never,
    showSafeError: vi.fn(),
  });

  return {
    capability,
    chooseDirectory,
    disable,
    getOpenDirectoryPath,
    invoke(channel: string, event: unknown, ...args: unknown[]) {
      const handler = handlers.get(channel);
      if (handler === undefined) {
        throw new Error('Test handler was not registered.');
      }
      return handler(event, ...args);
    },
    mainFrame,
    onConfigurationChanged,
    openPath,
    removeHandler,
    retryPending,
    selectDirectory,
    trustedEvent: { sender: webContents, senderFrame: mainFrame },
  };
}
