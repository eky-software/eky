import type {
  BrowserWindow,
  IpcMain,
  IpcMainInvokeEvent,
} from 'electron';

import type { InvoicePdfArchiveService } from './invoicePdfArchiveService.js';
import {
  chooseInvoicePdfArchiveDirectoryIpcChannel,
  disableInvoicePdfArchiveIpcChannel,
  getInvoicePdfArchiveStatusIpcChannel,
  openInvoicePdfArchiveDirectoryIpcChannel,
  retryPendingInvoicePdfArchiveTasksIpcChannel,
} from './invoicePdfArchiveCapabilityTypes.js';

interface InvoicePdfArchiveCapabilityOptions {
  confirmChange(): Promise<boolean>;
  confirmDisable(): Promise<boolean>;
  ipcMain: Pick<IpcMain, 'handle' | 'removeHandler'>;
  mainWindow: BrowserWindow;
  openPath(path: string): Promise<string>;
  onConfigurationChanged?(stage: 'disabled' | 'enabled'): void;
  selectDirectory(): Promise<string | null>;
  service: Pick<
    InvoicePdfArchiveService,
    | 'chooseDirectory'
    | 'disable'
    | 'getOpenDirectoryPath'
    | 'getStatus'
    | 'retryPending'
  >;
  showSafeError(): void;
}

export interface InvoicePdfArchiveCapability {
  dispose(): void;
}

export function createInvoicePdfArchiveCapability(
  options: InvoicePdfArchiveCapabilityOptions,
): InvoicePdfArchiveCapability {
  let operationInProgress = false;
  let disposed = false;
  let documentEpoch = 0;
  const invalidateDocument = () => { documentEpoch += 1; };
  const navigationStarted = (details: { isMainFrame: boolean }) => {
    if (details.isMainFrame) invalidateDocument();
  };
  options.mainWindow.webContents.on('did-start-navigation', navigationStarted);
  options.mainWindow.webContents.on('did-start-loading', invalidateDocument);
  options.mainWindow.webContents.on('render-process-gone', invalidateDocument);
  options.mainWindow.webContents.on('destroyed', invalidateDocument);
  options.mainWindow.on('close', invalidateDocument);
  const channels = [
    getInvoicePdfArchiveStatusIpcChannel,
    chooseInvoicePdfArchiveDirectoryIpcChannel,
    openInvoicePdfArchiveDirectoryIpcChannel,
    disableInvoicePdfArchiveIpcChannel,
    retryPendingInvoicePdfArchiveTasksIpcChannel,
  ] as const;

  for (const channel of channels) {
    options.ipcMain.removeHandler(channel);
  }

  options.ipcMain.handle(
    getInvoicePdfArchiveStatusIpcChannel,
    async (event, ...args: unknown[]) => {
      const assertCurrent = captureRequest(event, args);
      const status = await options.service.getStatus();
      assertCurrent();
      return status;
    },
  );
  options.ipcMain.handle(
    chooseInvoicePdfArchiveDirectoryIpcChannel,
    async (event, ...args: unknown[]) =>
      runExclusiveOperation(options, event, args, async assertCurrent => {
        const current = await options.service.getStatus();
        assertCurrent();

        if (current.enabled) {
          const confirmed = await options.confirmChange();
          assertCurrent();
          if (!confirmed) return current;
        }
        const directoryPath = await options.selectDirectory();
        assertCurrent();

        if (directoryPath === null) {
          return current;
        }
        const nextStatus =
          await options.service.chooseDirectory(directoryPath);
        assertCurrent();
        options.onConfigurationChanged?.('enabled');
        return nextStatus;
      }),
  );
  options.ipcMain.handle(
    openInvoicePdfArchiveDirectoryIpcChannel,
    async (event, ...args: unknown[]) =>
      runExclusiveOperation(options, event, args, async assertCurrent => {
        const directoryPath = await options.service.getOpenDirectoryPath();
        assertCurrent();

        if (directoryPath === null) {
          throw new Error('INVOICE_PDF_ARCHIVE_NOT_CONFIGURED');
        }
        const errorMessage = await options.openPath(directoryPath);
        assertCurrent();

        if (errorMessage.length > 0) {
          throw new Error('INVOICE_PDF_ARCHIVE_OPEN_FAILED');
        }
      }),
  );
  options.ipcMain.handle(
    disableInvoicePdfArchiveIpcChannel,
    async (event, ...args: unknown[]) =>
      runExclusiveOperation(options, event, args, async assertCurrent => {
        const current = await options.service.getStatus();
        assertCurrent();

        if (!current.enabled) return current;
        const confirmed = await options.confirmDisable();
        assertCurrent();
        if (!confirmed) return current;
        const nextStatus = await options.service.disable();
        assertCurrent();
        options.onConfigurationChanged?.('disabled');
        return nextStatus;
      }),
  );
  options.ipcMain.handle(
    retryPendingInvoicePdfArchiveTasksIpcChannel,
    async (event, ...args: unknown[]) =>
      runExclusiveOperation(options, event, args, () =>
        options.service.retryPending(false),
      ),
  );

  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      invalidateDocument();
      for (const channel of channels) {
        options.ipcMain.removeHandler(channel);
      }
      options.mainWindow.webContents.off('did-start-navigation', navigationStarted);
      options.mainWindow.webContents.off('did-start-loading', invalidateDocument);
      options.mainWindow.webContents.off('render-process-gone', invalidateDocument);
      options.mainWindow.webContents.off('destroyed', invalidateDocument);
      options.mainWindow.off('close', invalidateDocument);
    },
  };

  function captureRequest(event: IpcMainInvokeEvent, args: unknown[]): () => void {
    const epoch = documentEpoch;
    const assertCurrent = () => {
      requireTrustedRequest(event, args, options.mainWindow);
      if (disposed || documentEpoch !== epoch || options.mainWindow.webContents.isDestroyed()) {
        throw new Error('INVOICE_PDF_ARCHIVE_FORBIDDEN');
      }
    };
    assertCurrent();
    return assertCurrent;
  }

  async function runExclusiveOperation<Result>(
    capabilityOptions: InvoicePdfArchiveCapabilityOptions,
    event: IpcMainInvokeEvent,
    args: unknown[],
    operation: (assertCurrent: () => void) => Promise<Result>,
  ): Promise<Result> {
    const assertCurrent = captureRequest(event, args);

    if (operationInProgress) {
      throw new Error('INVOICE_PDF_ARCHIVE_OPERATION_IN_PROGRESS');
    }
    operationInProgress = true;

    try {
      const result = await operation(assertCurrent);
      assertCurrent();
      return result;
    } catch {
      try {
        assertCurrent();
        capabilityOptions.showSafeError();
      } catch {
        // A stale document must not receive a late native error dialog.
      }
      throw new Error('INVOICE_PDF_ARCHIVE_OPERATION_FAILED');
    } finally {
      operationInProgress = false;
    }
  }
}

function requireTrustedRequest(
  event: IpcMainInvokeEvent,
  args: unknown[],
  mainWindow: BrowserWindow,
): void {
  if (
    mainWindow.isDestroyed() ||
    event.sender !== mainWindow.webContents ||
    event.senderFrame !== mainWindow.webContents.mainFrame ||
    args.length !== 0
  ) {
    throw new Error('INVOICE_PDF_ARCHIVE_FORBIDDEN');
  }
}
