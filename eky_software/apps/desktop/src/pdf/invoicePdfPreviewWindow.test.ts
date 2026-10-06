import type {
  BrowserWindow,
  BrowserWindowConstructorOptions,
  IpcMain,
  IpcMainInvokeEvent,
} from 'electron';
import { describe, expect, it, vi } from 'vitest';

import {
  invoicePdfPreviewIpcChannel,
  type InvoicePdfPreviewTarget,
} from './invoicePdfPreviewTypes.js';
import { createInvoicePdfPreviewWindowController } from './invoicePdfPreviewWindow.js';

const preservedTarget: InvoicePdfPreviewTarget = {
  kind: 'preservedLegacy',
  documentId: 'document-1',
};
const eventTarget: InvoicePdfPreviewTarget = {
  kind: 'deliveryEvent',
  eventId: 'event-1',
};
const previewCases = [
  { target: undefined, expectedUrl: 'eky://app/invoices/invoice-1/pdf' },
  {
    target: preservedTarget,
    expectedUrl: 'eky://app/invoices/invoice-1/preserved-documents/document-1/pdf',
  },
  {
    target: eventTarget,
    expectedUrl: 'eky://app/invoices/invoice-1/delivery-events/event-1/pdf',
  },
];

describe('invoice PDF preview window controller', () => {
  it('accepts only the known main window main frame and forwards only the id', async () => {
    const context = createContext();
    const handler = context.getHandler();

    await expect(handler(context.trustedEvent, 'invoice-1')).resolves.toBeUndefined();
    expect(context.windows).toHaveLength(1);
    expect(context.windows[0]?.loadedUrls).toEqual([
      'eky://app/invoices/invoice-1/pdf',
    ]);

    await expect(
      handler(
        { ...context.trustedEvent, sender: {} } as unknown as IpcMainInvokeEvent,
        'invoice-1',
      ),
    ).rejects.toThrow('INVOICE_PDF_PREVIEW_FORBIDDEN');
    await expect(
      handler(
        {
          ...context.trustedEvent,
          senderFrame: {},
        } as unknown as IpcMainInvokeEvent,
        'invoice-1',
      ),
    ).rejects.toThrow('INVOICE_PDF_PREVIEW_FORBIDDEN');
    await expect(
      handler(context.trustedEvent, 'https://example.com/invoice.pdf'),
    ).rejects.toThrow('INVOICE_PDF_PREVIEW_INVALID_ID');
    expect(context.windows).toHaveLength(1);
  });

  it('validates explicit targets before checking availability or reusing a normal preview', async () => {
    const context = createContext();
    const handler = context.getHandler();
    await handler(context.trustedEvent, 'invoice-1');
    context.verifyPdfAvailable.mockClear();

    for (const target of [
      null,
      {},
      { kind: 'revision', documentId: 'document-1' },
      { kind: 'unknown', documentId: 'document-1' },
      { kind: 'preservedLegacy', documentId: '../document-1' },
      { ...preservedTarget, body: { companyId: 'other-company' } },
      { kind: 'deliveryEvent' },
      { kind: 'deliveryEvent', documentId: 'event-1' },
      { ...eventTarget, eventId: '../event-1' },
      { ...eventTarget, eventId: 'e'.repeat(101) },
      { ...eventTarget, documentId: 'document-1' },
      { ...eventTarget, url: 'https://example.test/event.pdf' },
      { ...eventTarget, session: 'synthetic' },
      { ...eventTarget, [Symbol('extra')]: true },
      Object.create(eventTarget),
      Object.assign(Object.create({}), eventTarget),
    ]) {
      await expect(handler(context.trustedEvent, 'invoice-1', target))
        .rejects.toThrow('INVOICE_PDF_PREVIEW_INVALID_TARGET');
    }
    await expect(handler(context.trustedEvent, 'invoice-1', preservedTarget, {}))
      .rejects.toThrow('INVOICE_PDF_PREVIEW_INVALID_TARGET');
    await expect(handler(context.trustedEvent, 'invoice-1', eventTarget, undefined))
      .rejects.toThrow('INVOICE_PDF_PREVIEW_INVALID_TARGET');
    await expect(handler(context.trustedEvent, '../invoice-1', eventTarget))
      .rejects.toThrow('INVOICE_PDF_PREVIEW_INVALID_ID');
    expect(context.verifyPdfAvailable).not.toHaveBeenCalled();
    expect(context.windows).toHaveLength(1);
    expect(context.windows[0]?.focus).toHaveBeenCalledOnce();
  });

  it.each([preservedTarget, eventTarget])('rejects $kind previews from a different sender, subframe or destroyed main window', async (target) => {
    const context = createContext();

    for (const untrustedEvent of [
      { ...context.trustedEvent, sender: {} },
      { ...context.trustedEvent, senderFrame: {} },
      { ...context.trustedEvent, senderFrame: null },
    ]) {
      await expect(context.getHandler()(
        untrustedEvent as unknown as IpcMainInvokeEvent,
        'invoice-1',
        target,
      )).rejects.toThrow('INVOICE_PDF_PREVIEW_FORBIDDEN');
    }
    context.mainWindow.isDestroyed.mockReturnValue(true);
    await expect(context.getHandler()(context.trustedEvent, 'invoice-1', target))
      .rejects.toThrow('INVOICE_PDF_PREVIEW_FORBIDDEN');
    expect(context.verifyPdfAvailable).not.toHaveBeenCalled();
    expect(context.windows).toHaveLength(0);
  });

  it('denies popups, webviews, and navigation away from the exact PDF URL', async () => {
    const context = createContext();

    await context.getHandler()(context.trustedEvent, 'invoice-1');
    const previewWindow = context.windows[0];

    expect(previewWindow?.windowOpenHandler?.({})).toEqual({ action: 'deny' });

    const webviewEvent = { preventDefault: vi.fn() };
    previewWindow?.emitWebContents('will-attach-webview', webviewEvent);
    expect(webviewEvent.preventDefault).toHaveBeenCalledOnce();

    const deniedNavigation = { preventDefault: vi.fn() };
    previewWindow?.emitWebContents(
      'will-navigate',
      deniedNavigation,
      'https://example.com/invoice.pdf',
    );
    expect(deniedNavigation.preventDefault).toHaveBeenCalledOnce();

    const allowedNavigation = { preventDefault: vi.fn() };
    previewWindow?.emitWebContents(
      'will-navigate',
      allowedNavigation,
      'eky://app/invoices/invoice-1/pdf',
    );
    expect(allowedNavigation.preventDefault).not.toHaveBeenCalled();
  });

  it.each(previewCases.slice(1))('keeps $expectedUrl sandboxed and denies navigation to any other target', async ({ target, expectedUrl }) => {
    const context = createContext();
    await context.getHandler()(context.trustedEvent, 'invoice-1', target);
    const preview = context.windows[0];

    expect(context.verifyPdfAvailable).toHaveBeenCalledExactlyOnceWith(expectedUrl);
    expect(preview?.loadedUrls).toEqual([expectedUrl]);
    expect(preview?.options.webPreferences).toMatchObject({
      contextIsolation: true,
      devTools: false,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    });
    expect(preview?.options.webPreferences).not.toHaveProperty('preload');
    expect(preview?.windowOpenHandler?.({})).toEqual({ action: 'deny' });
    const webviewEvent = { preventDefault: vi.fn() };
    preview?.emitWebContents('will-attach-webview', webviewEvent);
    expect(webviewEvent.preventDefault).toHaveBeenCalledOnce();

    for (const url of [
      'eky://app/invoices/invoice-1/pdf',
      'eky://app/invoices/invoice-1/preserved-documents/document-2/pdf',
      'eky://app/invoices/invoice-2/preserved-documents/document-1/pdf',
      'eky://app/invoices/invoice-1/delivery-events/event-2/pdf',
      'eky://app/invoices/invoice-2/delivery-events/event-1/pdf',
    ]) {
      const event = { preventDefault: vi.fn() };
      preview?.emitWebContents('will-navigate', event, url);
      expect(event.preventDefault).toHaveBeenCalledOnce();
    }
    const allowedEvent = { preventDefault: vi.fn() };
    preview?.emitWebContents('will-navigate', allowedEvent, expectedUrl);
    expect(allowedEvent.preventDefault).not.toHaveBeenCalled();
  });

  it('revalidates and replaces the mutable current preview on another open', async () => {
    const context = createContext();
    const handler = context.getHandler();

    await handler(context.trustedEvent, 'invoice-1');
    await handler(context.trustedEvent, 'invoice-1');
    expect(context.windows).toHaveLength(2);
    expect(context.windows[0]?.isDestroyed()).toBe(true);
    expect(context.windows[1]?.loadedUrls).toEqual([
      'eky://app/invoices/invoice-1/pdf',
    ]);
    expect(context.verifyPdfAvailable).toHaveBeenCalledTimes(2);

    context.windows[1]?.close();
    expect(context.restoreMainWindowFocus).toHaveBeenCalledTimes(2);
    await handler(context.trustedEvent, 'invoice-1');
    expect(context.windows).toHaveLength(3);
  });

  it.each(['unavailable', 'rejected'])('removes stale current content when its new availability check is %s', async (failure) => {
    const context = createContext();
    const handler = context.getHandler();
    await handler(context.trustedEvent, 'invoice-1');
    if (failure === 'rejected') {
      context.verifyPdfAvailable.mockRejectedValueOnce(new Error('private failure'));
    } else {
      context.verifyPdfAvailable.mockResolvedValueOnce(false);
    }

    await expect(handler(context.trustedEvent, 'invoice-1'))
      .rejects.toThrow('INVOICE_PDF_PREVIEW_FAILED');
    expect(context.windows).toHaveLength(1);
    expect(context.windows[0]?.isDestroyed()).toBe(true);
    expect(context.windows[0]?.focus).toHaveBeenCalledOnce();
    expect(context.verifyPdfAvailable).toHaveBeenCalledTimes(2);
    expect(context.showSafeError).toHaveBeenCalledExactlyOnceWith();
  });

  it('reuses only the exact preserved target and restores focus after close', async () => {
    const context = createContext();
    const handler = context.getHandler();

    await handler(context.trustedEvent, 'invoice-1', preservedTarget);
    await handler(context.trustedEvent, 'invoice-1', { ...preservedTarget });
    expect(context.windows).toHaveLength(1);
    expect(context.windows[0]?.focus).toHaveBeenCalledTimes(2);
    expect(context.verifyPdfAvailable).toHaveBeenCalledOnce();

    context.windows[0]?.close();
    expect(context.restoreMainWindowFocus).toHaveBeenCalledOnce();
    await handler(context.trustedEvent, 'invoice-1', preservedTarget);
    expect(context.windows).toHaveLength(2);
    expect(context.verifyPdfAvailable).toHaveBeenCalledTimes(2);
  });

  it('never reuses a normal or other-document preview for the same invoice', async () => {
    const context = createContext();
    const handler = context.getHandler();
    const secondTarget: InvoicePdfPreviewTarget = {
      kind: 'preservedLegacy', documentId: 'document-2',
    };

    await handler(context.trustedEvent, 'invoice-1');
    await handler(context.trustedEvent, 'invoice-1', preservedTarget);
    await handler(context.trustedEvent, 'invoice-1', secondTarget);
    await handler(context.trustedEvent, 'invoice-1');

    expect(context.windows.map((window) => window.loadedUrls)).toEqual([
      ['eky://app/invoices/invoice-1/pdf'],
      ['eky://app/invoices/invoice-1/preserved-documents/document-1/pdf'],
      ['eky://app/invoices/invoice-1/preserved-documents/document-2/pdf'],
      ['eky://app/invoices/invoice-1/pdf'],
    ]);
    expect(context.windows.map((window) => window.isDestroyed())).toEqual([
      true, true, true, false,
    ]);
    expect(context.verifyPdfAvailable).toHaveBeenCalledTimes(4);
  });

  it('keeps identical document ids on different invoices separate', async () => {
    const context = createContext();
    const handler = context.getHandler();

    await handler(context.trustedEvent, 'invoice-1', preservedTarget);
    await handler(context.trustedEvent, 'invoice-2', preservedTarget);

    expect(context.windows).toHaveLength(2);
    expect(context.windows[0]?.isDestroyed()).toBe(true);
    expect(context.windows[1]?.loadedUrls).toEqual([
      'eky://app/invoices/invoice-2/preserved-documents/document-1/pdf',
    ]);
  });

  it('deduplicates concurrent requests only when their preserved targets match', async () => {
    const context = createContext();
    const handler = context.getHandler();

    await Promise.all([
      handler(context.trustedEvent, 'invoice-1', preservedTarget),
      handler(context.trustedEvent, 'invoice-1', { ...preservedTarget }),
    ]);
    expect(context.windows).toHaveLength(1);

    const otherContext = createContext();
    await Promise.all([
      otherContext.getHandler()(otherContext.trustedEvent, 'invoice-1', preservedTarget),
      otherContext.getHandler()(otherContext.trustedEvent, 'invoice-1', { ...preservedTarget }),
      otherContext.getHandler()(otherContext.trustedEvent, 'invoice-1', {
        kind: 'preservedLegacy', documentId: 'document-2',
      }),
    ]);
    expect(otherContext.windows.map((window) => window.loadedUrls)).toEqual([
      ['eky://app/invoices/invoice-1/preserved-documents/document-1/pdf'],
      ['eky://app/invoices/invoice-1/preserved-documents/document-2/pdf'],
    ]);
    expect(otherContext.windows.map((window) => window.isDestroyed())).toEqual([true, false]);
    expect(otherContext.windows[0]?.focus).not.toHaveBeenCalled();
    expect(otherContext.windows[1]?.focus).toHaveBeenCalledOnce();
  });

  it('does not create duplicate windows for concurrent requests', async () => {
    const context = createContext();
    const handler = context.getHandler();

    await Promise.all([
      handler(context.trustedEvent, 'invoice-1'),
      handler(context.trustedEvent, 'invoice-1'),
    ]);

    expect(context.windows).toHaveLength(1);
    expect(context.windows[0]?.focus).toHaveBeenCalledTimes(2);
  });

  it('reuses only the exact event URL and separates current, preserved and other-event previews', async () => {
    const context = createContext();
    const handler = context.getHandler();

    await handler(context.trustedEvent, 'invoice-1', eventTarget);
    await handler(context.trustedEvent, 'invoice-1', { ...eventTarget });
    expect(context.windows).toHaveLength(1);
    expect(context.windows[0]?.focus).toHaveBeenCalledTimes(2);
    expect(context.verifyPdfAvailable).toHaveBeenCalledOnce();

    await handler(context.trustedEvent, 'invoice-1', {
      kind: 'deliveryEvent', eventId: 'event-2',
    });
    await handler(context.trustedEvent, 'invoice-2', eventTarget);
    await handler(context.trustedEvent, 'invoice-1', {
      kind: 'preservedLegacy', documentId: 'event-1',
    });
    await handler(context.trustedEvent, 'invoice-1');
    await handler(context.trustedEvent, 'invoice-1', eventTarget);

    expect(context.windows.map((window) => window.loadedUrls)).toEqual([
      ['eky://app/invoices/invoice-1/delivery-events/event-1/pdf'],
      ['eky://app/invoices/invoice-1/delivery-events/event-2/pdf'],
      ['eky://app/invoices/invoice-2/delivery-events/event-1/pdf'],
      ['eky://app/invoices/invoice-1/preserved-documents/event-1/pdf'],
      ['eky://app/invoices/invoice-1/pdf'],
      ['eky://app/invoices/invoice-1/delivery-events/event-1/pdf'],
    ]);
    expect(context.windows.map((window) => window.isDestroyed())).toEqual([
      true, true, true, true, true, false,
    ]);
    expect(context.verifyPdfAvailable).toHaveBeenCalledTimes(6);
  });

  it('deduplicates simultaneous opens only for the same delivery event', async () => {
    const context = createContext();
    const handler = context.getHandler();
    await Promise.all([
      handler(context.trustedEvent, 'invoice-1', eventTarget),
      handler(context.trustedEvent, 'invoice-1', { ...eventTarget }),
      handler(context.trustedEvent, 'invoice-1', {
        kind: 'deliveryEvent', eventId: 'event-2',
      }),
    ]);
    expect(context.windows.map((window) => window.loadedUrls)).toEqual([
      ['eky://app/invoices/invoice-1/delivery-events/event-1/pdf'],
      ['eky://app/invoices/invoice-1/delivery-events/event-2/pdf'],
    ]);
    expect(context.windows.map((window) => window.isDestroyed())).toEqual([true, false]);
    expect(context.windows[0]?.focus).not.toHaveBeenCalled();
    expect(context.windows[1]?.focus).toHaveBeenCalledOnce();
  });

  it.each(['unavailable', 'rejected'])('isolates an event PDF check that is %s without opening or reusing the current PDF', async (failure) => {
    const context = createContext();
    const handler = context.getHandler();
    await handler(context.trustedEvent, 'invoice-1');
    context.verifyPdfAvailable.mockClear();
    if (failure === 'rejected') {
      context.verifyPdfAvailable.mockRejectedValueOnce(new Error('raw native failure'));
    } else {
      context.verifyPdfAvailable.mockResolvedValueOnce(false);
    }

    await expect(handler(context.trustedEvent, 'invoice-1', eventTarget))
      .rejects.toThrow('INVOICE_PDF_PREVIEW_FAILED');
    expect(context.verifyPdfAvailable).toHaveBeenCalledExactlyOnceWith(
      'eky://app/invoices/invoice-1/delivery-events/event-1/pdf',
    );
    expect(context.windows).toHaveLength(1);
    expect(context.windows[0]?.isDestroyed()).toBe(false);
    expect(context.windows[0]?.focus).toHaveBeenCalledOnce();
    expect(context.showSafeError).toHaveBeenCalledExactlyOnceWith();

    await handler(context.trustedEvent, 'invoice-1');
    expect(context.windows[0]?.isDestroyed()).toBe(true);
    expect(context.windows[1]?.focus).toHaveBeenCalledOnce();
    await handler(context.trustedEvent, 'invoice-1', eventTarget);
    expect(context.windows).toHaveLength(3);
    expect(context.windows[2]?.loadedUrls).toEqual([
      'eky://app/invoices/invoice-1/delivery-events/event-1/pdf',
    ]);
  });

  it('keeps at most one preview open when another invoice is selected', async () => {
    const context = createContext();
    const handler = context.getHandler();

    await handler(context.trustedEvent, 'invoice-1');
    await handler(context.trustedEvent, 'invoice-2');

    expect(context.windows).toHaveLength(2);
    expect(context.windows[0]?.isDestroyed()).toBe(true);
    expect(context.windows[1]?.isDestroyed()).toBe(false);
  });

  it.each(previewCases)('closes a failed preview and reports only a safe error: $expectedUrl', async ({ target }) => {
    const context = createContext({ failLoad: true });

    await expect(
      context.getHandler()(context.trustedEvent, 'missing-invoice', target),
    ).rejects.toThrow('INVOICE_PDF_PREVIEW_FAILED');
    expect(context.showSafeError).toHaveBeenCalledOnce();
    expect(context.windows[0]?.isDestroyed()).toBe(true);
  });

  it.each(previewCases)('does not create a window when the PDF check fails: $expectedUrl', async ({ target }) => {
    const context = createContext({ pdfAvailable: false });

    await expect(
      context.getHandler()(context.trustedEvent, 'missing-invoice', target),
    ).rejects.toThrow('INVOICE_PDF_PREVIEW_FAILED');
    expect(context.showSafeError).toHaveBeenCalledOnce();
    expect(context.windows).toHaveLength(0);
  });

  it('does not fall back to an open normal preview when a preserved read is denied', async () => {
    const context = createContext();
    const handler = context.getHandler();
    await handler(context.trustedEvent, 'invoice-1');
    context.verifyPdfAvailable.mockResolvedValue(false);

    await expect(handler(context.trustedEvent, 'invoice-1', preservedTarget))
      .rejects.toThrow('INVOICE_PDF_PREVIEW_FAILED');
    expect(context.windows).toHaveLength(1);
    expect(context.windows[0]?.focus).toHaveBeenCalledOnce();
    expect(context.showSafeError).toHaveBeenCalledOnce();
  });
});

type IpcHandler = (
  event: IpcMainInvokeEvent,
  invoiceId: unknown,
  target?: unknown,
  ...extraArgs: unknown[]
) => Promise<void>;

function createContext(
  options: { failLoad?: boolean; pdfAvailable?: boolean } = {},
) {
  const handlers = new Map<string, IpcHandler>();
  const mainFrame = {};
  const mainWebContents = { mainFrame };
  const mainWindow = {
    isDestroyed: vi.fn(() => false),
    webContents: mainWebContents,
  };
  const trustedEvent = {
    sender: mainWebContents,
    senderFrame: mainFrame,
  } as unknown as IpcMainInvokeEvent;
  const windows: FakeBrowserWindow[] = [];
  const showSafeError = vi.fn();
  const restoreMainWindowFocus = vi.fn();
  const verifyPdfAvailable = vi.fn<(url: string) => Promise<boolean>>()
    .mockResolvedValue(options.pdfAvailable !== false);
  const ipc = {
    handle(channel: string, handler: IpcHandler) {
      handlers.set(channel, handler);
    },
    removeHandler(channel: string) {
      handlers.delete(channel);
    },
  } as unknown as Pick<IpcMain, 'handle' | 'removeHandler'>;

  createInvoicePdfPreviewWindowController({
    createWindow(windowOptions) {
      const window = new FakeBrowserWindow(windowOptions, options.failLoad === true);
      windows.push(window);
      return window as unknown as BrowserWindow;
    },
    ipcMain: ipc,
    mainWindow: mainWindow as unknown as BrowserWindow,
    restoreMainWindowFocus,
    showSafeError,
    verifyPdfAvailable,
  });

  return {
    getHandler(): IpcHandler {
      const handler = handlers.get(invoicePdfPreviewIpcChannel);

      if (handler === undefined) {
        throw new Error('Preview handler was not registered.');
      }

      return handler;
    },
    showSafeError,
    mainWindow,
    restoreMainWindowFocus,
    trustedEvent,
    verifyPdfAvailable,
    windows,
  };
}

class FakeBrowserWindow {
  readonly focus = vi.fn();
  readonly loadedUrls: string[] = [];
  readonly options: BrowserWindowConstructorOptions;
  readonly removeMenu = vi.fn();
  readonly show = vi.fn();
  windowOpenHandler?: (details: unknown) => { action: 'deny' };
  private destroyed = false;
  private readonly failLoad: boolean;
  private readonly windowListeners = new Map<string, Array<() => void>>();
  private readonly webContentsListeners = new Map<
    string,
    Array<(...args: never[]) => void>
  >();

  readonly webContents = {
    on: (eventName: string, listener: (...args: never[]) => void) => {
      const listeners = this.webContentsListeners.get(eventName) ?? [];
      listeners.push(listener);
      this.webContentsListeners.set(eventName, listeners);
    },
    setWindowOpenHandler: (
      handler: (details: unknown) => { action: 'deny' },
    ) => {
      this.windowOpenHandler = handler;
    },
  };

  constructor(options: BrowserWindowConstructorOptions, failLoad: boolean) {
    this.options = options;
    this.failLoad = failLoad;
  }

  close(): void {
    this.destroyed = true;

    for (const listener of this.windowListeners.get('closed') ?? []) {
      listener();
    }
  }

  emitWebContents(eventName: string, ...args: unknown[]): void {
    for (const listener of this.webContentsListeners.get(eventName) ?? []) {
      listener(...(args as never[]));
    }
  }

  isDestroyed(): boolean {
    return this.destroyed;
  }

  async loadURL(url: string): Promise<void> {
    this.loadedUrls.push(url);

    if (this.failLoad) {
      throw new Error('raw load failure');
    }
  }

  once(eventName: string, listener: () => void): void {
    this.windowListeners.set(eventName, [listener]);
  }
}
