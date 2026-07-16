import type {
  BrowserWindow,
  BrowserWindowConstructorOptions,
  IpcMain,
  IpcMainInvokeEvent,
} from 'electron';
import { describe, expect, it, vi } from 'vitest';

import { invoicePdfPreviewIpcChannel } from './invoicePdfPreviewTypes.js';
import { createInvoicePdfPreviewWindowController } from './invoicePdfPreviewWindow.js';

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

  it('focuses an existing preview and releases it after close', async () => {
    const context = createContext();
    const handler = context.getHandler();

    await handler(context.trustedEvent, 'invoice-1');
    await handler(context.trustedEvent, 'invoice-1');
    expect(context.windows).toHaveLength(1);
    expect(context.windows[0]?.focus).toHaveBeenCalledTimes(2);

    context.windows[0]?.close();
    await handler(context.trustedEvent, 'invoice-1');
    expect(context.windows).toHaveLength(2);
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

  it('keeps at most one preview open when another invoice is selected', async () => {
    const context = createContext();
    const handler = context.getHandler();

    await handler(context.trustedEvent, 'invoice-1');
    await handler(context.trustedEvent, 'invoice-2');

    expect(context.windows).toHaveLength(2);
    expect(context.windows[0]?.isDestroyed()).toBe(true);
    expect(context.windows[1]?.isDestroyed()).toBe(false);
  });

  it('closes a failed preview and reports only a safe main-process error', async () => {
    const context = createContext({ failLoad: true });

    await expect(
      context.getHandler()(context.trustedEvent, 'missing-invoice'),
    ).rejects.toThrow('INVOICE_PDF_PREVIEW_FAILED');
    expect(context.showSafeError).toHaveBeenCalledOnce();
    expect(context.windows[0]?.isDestroyed()).toBe(true);
  });

  it('does not create a window when the main-process PDF check fails', async () => {
    const context = createContext({ pdfAvailable: false });

    await expect(
      context.getHandler()(context.trustedEvent, 'missing-invoice'),
    ).rejects.toThrow('INVOICE_PDF_PREVIEW_FAILED');
    expect(context.showSafeError).toHaveBeenCalledOnce();
    expect(context.windows).toHaveLength(0);
  });
});

type IpcHandler = (
  event: IpcMainInvokeEvent,
  invoiceId: unknown,
) => Promise<void>;

function createContext(
  options: { failLoad?: boolean; pdfAvailable?: boolean } = {},
) {
  const handlers = new Map<string, IpcHandler>();
  const mainFrame = {};
  const mainWebContents = { mainFrame };
  const mainWindow = {
    isDestroyed: () => false,
    webContents: mainWebContents,
  } as unknown as BrowserWindow;
  const trustedEvent = {
    sender: mainWebContents,
    senderFrame: mainFrame,
  } as unknown as IpcMainInvokeEvent;
  const windows: FakeBrowserWindow[] = [];
  const showSafeError = vi.fn();
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
    mainWindow,
    showSafeError,
    verifyPdfAvailable: vi
      .fn()
      .mockResolvedValue(options.pdfAvailable !== false),
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
    trustedEvent,
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
