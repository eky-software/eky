import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';

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

const capabilities: ReturnType<typeof createInvoicePdfArchiveCapability>[] = [];
afterEach(() => { for (const capability of capabilities.splice(0)) capability.dispose(); });

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

  it.each(['dispose', 'navigation', 'loading', 'rendererGone', 'windowClose'] as const)(
    'rejects a late directory selection after %s without new effects', async invalidation => {
      const fixture = createFixture();
      const entered = deferred<void>();
      const finish = deferred<string | null>();
      fixture.selectDirectory.mockImplementationOnce(async () => {
        entered.resolve();
        return finish.promise;
      });
      const result = fixture.invoke(chooseInvoicePdfArchiveDirectoryIpcChannel, fixture.trustedEvent)
        .catch(error => error);
      try {
        await entered.promise;
        if (invalidation === 'dispose') fixture.capability.dispose();
        if (invalidation === 'navigation') fixture.webContents.emit('did-start-navigation', { isMainFrame: true });
        if (invalidation === 'loading') fixture.webContents.emit('did-start-loading');
        if (invalidation === 'rendererGone') fixture.webContents.emit('render-process-gone');
        if (invalidation === 'windowClose') fixture.mainWindow.emit('close');
        finish.resolve('C:\\SyntheticArchive');
        expect(await result).toMatchObject({ message: 'INVOICE_PDF_ARCHIVE_OPERATION_FAILED' });
        expect(fixture.chooseDirectory).not.toHaveBeenCalled();
        expect(fixture.onConfigurationChanged).not.toHaveBeenCalled();
        expect(fixture.showSafeError).not.toHaveBeenCalled();
      } finally { finish.resolve(null); await result; }
    },
  );

  it.each(['change', 'disable'] as const)('does not use a late %s confirmation', async kind => {
    const fixture = createFixture({ status: enabledStatus });
    const entered = deferred<void>();
    const finish = deferred<boolean>();
    const confirm = kind === 'change' ? fixture.confirmChange : fixture.confirmDisable;
    confirm.mockImplementationOnce(async () => { entered.resolve(); return finish.promise; });
    const channel = kind === 'change' ? chooseInvoicePdfArchiveDirectoryIpcChannel : disableInvoicePdfArchiveIpcChannel;
    const result = fixture.invoke(channel, fixture.trustedEvent).catch(error => error);
    try {
      await entered.promise;
      fixture.capability.dispose();
      finish.resolve(true);
      expect(await result).toBeInstanceOf(Error);
      expect(fixture.selectDirectory).not.toHaveBeenCalled();
      expect(fixture.disable).not.toHaveBeenCalled();
      expect(fixture.onConfigurationChanged).not.toHaveBeenCalled();
      expect(fixture.showSafeError).not.toHaveBeenCalled();
    } finally { finish.resolve(false); await result; }
  });

  it('does not open an archive path resolved after disposal', async () => {
    const fixture = createFixture({ status: enabledStatus });
    const entered = deferred<void>();
    const finish = deferred<string | null>();
    fixture.getOpenDirectoryPath.mockImplementationOnce(async () => { entered.resolve(); return finish.promise; });
    const result = fixture.invoke(openInvoicePdfArchiveDirectoryIpcChannel, fixture.trustedEvent).catch(error => error);
    try {
      await entered.promise;
      fixture.capability.dispose();
      finish.resolve('C:\\SyntheticArchive');
      expect(await result).toBeInstanceOf(Error);
      expect(fixture.openPath).not.toHaveBeenCalled();
    } finally { finish.resolve(null); await result; }
  });

  it('rejects stale status while leaving a fresh document request available', async () => {
    const fixture = createFixture();
    const finish = deferred<InvoicePdfArchiveStatus>();
    fixture.getStatus.mockImplementationOnce(() => finish.promise);
    const result = fixture.invoke(getInvoicePdfArchiveStatusIpcChannel, fixture.trustedEvent).catch(error => error);
    fixture.webContents.emit('did-start-loading');
    try {
      finish.resolve(enabledStatus);
      expect(await result).toMatchObject({ message: 'INVOICE_PDF_ARCHIVE_FORBIDDEN' });
      await expect(fixture.invoke(getInvoicePdfArchiveStatusIpcChannel, fixture.trustedEvent)).resolves.toEqual(disabledStatus);
    } finally { finish.resolve(enabledStatus); await result; }
  });

  it('ignores subframe navigation and releases all document listeners on disposal', async () => {
    const fixture = createFixture();
    fixture.webContents.emit('did-start-navigation', { isMainFrame: false });
    await expect(fixture.invoke(chooseInvoicePdfArchiveDirectoryIpcChannel, fixture.trustedEvent)).resolves.toEqual(enabledStatus);
    fixture.capability.dispose();
    fixture.capability.dispose();
    for (const event of ['did-start-navigation', 'did-start-loading', 'render-process-gone', 'destroyed']) {
      expect(fixture.webContents.listenerCount(event)).toBe(0);
    }
    expect(fixture.mainWindow.listenerCount('close')).toBe(0);
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
  const webContents = Object.assign(new EventEmitter(), { mainFrame, isDestroyed: () => false });
  const mainWindow = Object.assign(new EventEmitter(), { isDestroyed: () => false, webContents });
  const status = options.status ?? disabledStatus;
  const chooseDirectory = vi.fn(async () => enabledStatus);
  const disable = vi.fn(async () => disabledStatus);
  const getOpenDirectoryPath = vi.fn(async (): Promise<string | null> => 'C:\\Invoices\\Archive');
  const getStatus = vi.fn(async () => status);
  const retryPending = vi.fn(async () => enabledStatus);
  const openPath = vi.fn(async () => '');
  const onConfigurationChanged = vi.fn();
  const selectDirectory = vi.fn(async (): Promise<string | null> => 'C:\\Invoices\\Archive');
  const confirmChange = vi.fn(async () => options.changeConfirmed ?? true);
  const confirmDisable = vi.fn(async () => options.disableConfirmed ?? true);
  const showSafeError = vi.fn();
  const capability = createInvoicePdfArchiveCapability({
    confirmChange,
    confirmDisable,
    ipcMain: { handle, removeHandler } as never,
    mainWindow: mainWindow as never,
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
    showSafeError,
  });
  capabilities.push(capability);

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
    mainWindow,
    webContents,
    getStatus,
    confirmChange,
    confirmDisable,
    showSafeError,
    onConfigurationChanged,
    openPath,
    removeHandler,
    retryPending,
    selectDirectory,
    trustedEvent: { sender: webContents, senderFrame: mainFrame },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(complete => { resolve = complete; });
  return { promise, resolve };
}
