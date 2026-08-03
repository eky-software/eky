import type {
  BrowserWindow,
  IpcMain,
  IpcMainInvokeEvent,
} from 'electron';

import { hasVisiblePdfPreview } from './invoicePdfPreviewRendering.js';
import {
  createInvoicePdfPreviewUrl,
  createInvoicePdfPreviewWindowOptions,
  isAllowedInvoicePdfPreviewNavigation,
} from './invoicePdfPreviewPolicy.js';
import { invoicePdfPreviewIpcChannel } from './invoicePdfPreviewTypes.js';

interface InvoicePdfPreviewWindowControllerOptions {
  createWindow(
    options: ReturnType<typeof createInvoicePdfPreviewWindowOptions>,
  ): BrowserWindow;
  ipcMain: Pick<IpcMain, 'handle' | 'removeHandler'>;
  mainWindow: BrowserWindow;
  restoreMainWindowFocus(): void;
  showSafeError(): void;
  verifyPdfAvailable(url: string): Promise<boolean>;
}

interface ActiveInvoicePdfPreview {
  invoiceId: string;
  ready: Promise<void>;
  window: BrowserWindow;
}

export interface InvoicePdfPreviewWindowController {
  close(): void;
  dispose(): void;
  hasRendererBridgeForSmoke(): Promise<boolean>;
  openForSmoke(invoiceId: string): Promise<void>;
}

const blockedSmokeNavigationUrl = 'data:text/plain,blocked-by-eky';
const previewPaintPollIntervalMilliseconds = 100;
const previewPaintTimeoutMilliseconds = 5_000;

function isTrustedMainWindowRequest(
  event: IpcMainInvokeEvent,
  mainWindow: BrowserWindow,
): boolean {
  return (
    !mainWindow.isDestroyed() &&
    event.sender === mainWindow.webContents &&
    event.senderFrame === mainWindow.webContents.mainFrame
  );
}

export function createInvoicePdfPreviewWindowController(
  options: InvoicePdfPreviewWindowControllerOptions,
): InvoicePdfPreviewWindowController {
  let activePreview: ActiveInvoicePdfPreview | undefined;

  async function openInvoicePdf(invoiceId: unknown): Promise<void> {
    const expectedUrl = createInvoicePdfPreviewUrl(invoiceId);

    if (
      activePreview !== undefined &&
      activePreview.invoiceId === invoiceId &&
      !activePreview.window.isDestroyed()
    ) {
      await activePreview.ready;
      activePreview.window.focus();
      return;
    }

    let pdfAvailable = false;

    try {
      pdfAvailable = await options.verifyPdfAvailable(expectedUrl);
    } catch {
      pdfAvailable = false;
    }

    if (!pdfAvailable) {
      options.showSafeError();
      throw new Error('INVOICE_PDF_PREVIEW_FAILED');
    }

    if (
      activePreview !== undefined &&
      activePreview.invoiceId === invoiceId &&
      !activePreview.window.isDestroyed()
    ) {
      await activePreview.ready;
      activePreview.window.focus();
      return;
    }

    if (activePreview !== undefined && !activePreview.window.isDestroyed()) {
      activePreview.window.close();
    }

    const previewWindow = options.createWindow(
      createInvoicePdfPreviewWindowOptions(options.mainWindow),
    );

    previewWindow.removeMenu();
    previewWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    previewWindow.webContents.on('will-attach-webview', (event) => {
      event.preventDefault();
    });
    previewWindow.webContents.on('will-navigate', (event, targetUrl) => {
      if (!isAllowedInvoicePdfPreviewNavigation(targetUrl, expectedUrl)) {
        event.preventDefault();
      }
    });

    const ready = previewWindow
      .loadURL(expectedUrl)
      .then(() => {
        if (
          activePreview?.window === previewWindow &&
          !previewWindow.isDestroyed()
        ) {
          previewWindow.show();
          previewWindow.focus();
        }
      })
      .catch(() => {
        if (activePreview?.window === previewWindow) {
          activePreview = undefined;

          if (!previewWindow.isDestroyed()) {
            previewWindow.close();
          }

          options.showSafeError();
        }

        throw new Error('INVOICE_PDF_PREVIEW_FAILED');
      });

    activePreview = {
      invoiceId: invoiceId as string,
      ready,
      window: previewWindow,
    };
    previewWindow.once('closed', () => {
      if (activePreview?.window === previewWindow) {
        activePreview = undefined;
      }

      options.restoreMainWindowFocus();
    });

    await ready;
  }

  options.ipcMain.removeHandler(invoicePdfPreviewIpcChannel);
  options.ipcMain.handle(
    invoicePdfPreviewIpcChannel,
    async (event, invoiceId: unknown) => {
      if (!isTrustedMainWindowRequest(event, options.mainWindow)) {
        throw new Error('INVOICE_PDF_PREVIEW_FORBIDDEN');
      }

      await openInvoicePdf(invoiceId);
    },
  );

  return {
    close() {
      if (activePreview !== undefined && !activePreview.window.isDestroyed()) {
        activePreview.window.close();
      }

      activePreview = undefined;
    },
    dispose() {
      options.ipcMain.removeHandler(invoicePdfPreviewIpcChannel);

      if (activePreview !== undefined && !activePreview.window.isDestroyed()) {
        activePreview.window.close();
      }

      activePreview = undefined;
    },
    async hasRendererBridgeForSmoke() {
      return options.mainWindow.webContents.executeJavaScript(
        `typeof window.ekyDesktop === 'object' &&
          typeof window.ekyDesktop.chooseInvoicePdfArchiveDirectory === 'function' &&
          typeof window.ekyDesktop.createSupportBundle === 'function' &&
          typeof window.ekyDesktop.disableInvoicePdfArchive === 'function' &&
          typeof window.ekyDesktop.getInvoicePdfArchiveStatus === 'function' &&
          typeof window.ekyDesktop.openInvoicePdf === 'function' &&
          typeof window.ekyDesktop.openInvoicePdfArchiveDirectory === 'function' &&
          typeof window.ekyDesktop.openOperationalLogFolder === 'function' &&
          typeof window.ekyDesktop.retryPendingInvoicePdfArchiveTasks === 'function' &&
          Object.keys(window.ekyDesktop).length === 8`,
        true,
      );
    },
    async openForSmoke(invoiceId) {
      await openInvoicePdf(invoiceId);

      if (
        activePreview === undefined ||
        activePreview.invoiceId !== invoiceId ||
        activePreview.window.isDestroyed()
      ) {
        throw new Error('DESKTOP_SMOKE_PDF_PREVIEW_SECURITY_FAILED');
      }

      await assertPackagedPreviewSecurity(
        activePreview.window,
        createInvoicePdfPreviewUrl(invoiceId),
      );
      await assertPackagedPreviewRendering(activePreview.window);
    },
  };
}

async function assertPackagedPreviewRendering(
  previewWindow: BrowserWindow,
): Promise<void> {
  const deadline = Date.now() + previewPaintTimeoutMilliseconds;

  while (Date.now() < deadline) {
    const capture = await previewWindow.webContents.capturePage();
    const size = capture.getSize();

    if (
      hasVisiblePdfPreview({
        bitmap: capture.toBitmap(),
        height: size.height,
        width: size.width,
      })
    ) {
      return;
    }

    await new Promise((resolve) =>
      setTimeout(resolve, previewPaintPollIntervalMilliseconds),
    );
  }

  throw new Error('DESKTOP_SMOKE_PDF_PREVIEW_RENDERING_FAILED');
}

async function assertPackagedPreviewSecurity(
  previewWindow: BrowserWindow,
  expectedUrl: string,
): Promise<void> {
  const nodePrivilegesAbsent = await previewWindow.webContents.executeJavaScript(
    `typeof require === 'undefined' &&
      typeof module === 'undefined' &&
      typeof process === 'undefined'`,
    true,
  );

  if (nodePrivilegesAbsent !== true) {
    throw new Error('DESKTOP_SMOKE_PDF_PREVIEW_SECURITY_FAILED');
  }

  const popupDenied = await previewWindow.webContents.executeJavaScript(
    `(() => {
      try {
        return window.open(${JSON.stringify(blockedSmokeNavigationUrl)}) === null;
      } catch {
        return true;
      }
    })()`,
    true,
  );

  if (popupDenied !== true) {
    throw new Error('DESKTOP_SMOKE_PDF_PREVIEW_SECURITY_FAILED');
  }

  await previewWindow.webContents
    .executeJavaScript(
      `(() => {
        try {
          window.location.href = ${JSON.stringify(blockedSmokeNavigationUrl)};
        } catch {
          // A rejected assignment is also an acceptable secure outcome.
        }
      })()`,
      true,
    )
    .catch(() => undefined);
  await new Promise((resolve) => setTimeout(resolve, 50));

  if (previewWindow.webContents.getURL() !== expectedUrl) {
    throw new Error('DESKTOP_SMOKE_PDF_PREVIEW_SECURITY_FAILED');
  }
}
