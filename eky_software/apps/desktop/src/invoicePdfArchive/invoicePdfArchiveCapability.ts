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
      requireTrustedRequest(event, args, options.mainWindow);
      return options.service.getStatus();
    },
  );
  options.ipcMain.handle(
    chooseInvoicePdfArchiveDirectoryIpcChannel,
    async (event, ...args: unknown[]) =>
      runExclusiveOperation(options, event, args, async () => {
        const current = await options.service.getStatus();

        if (current.enabled && !(await options.confirmChange())) {
          return current;
        }
        const directoryPath = await options.selectDirectory();

        if (directoryPath === null) {
          return current;
        }
        const nextStatus =
          await options.service.chooseDirectory(directoryPath);
        options.onConfigurationChanged?.('enabled');
        return nextStatus;
      }),
  );
  options.ipcMain.handle(
    openInvoicePdfArchiveDirectoryIpcChannel,
    async (event, ...args: unknown[]) =>
      runExclusiveOperation(options, event, args, async () => {
        const directoryPath = await options.service.getOpenDirectoryPath();

        if (directoryPath === null) {
          throw new Error('INVOICE_PDF_ARCHIVE_NOT_CONFIGURED');
        }
        const errorMessage = await options.openPath(directoryPath);

        if (errorMessage.length > 0) {
          throw new Error('INVOICE_PDF_ARCHIVE_OPEN_FAILED');
        }
      }),
  );
  options.ipcMain.handle(
    disableInvoicePdfArchiveIpcChannel,
    async (event, ...args: unknown[]) =>
      runExclusiveOperation(options, event, args, async () => {
        const current = await options.service.getStatus();

        if (!current.enabled || !(await options.confirmDisable())) {
          return current;
        }
        const nextStatus = await options.service.disable();
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
      for (const channel of channels) {
        options.ipcMain.removeHandler(channel);
      }
    },
  };

  async function runExclusiveOperation<Result>(
    capabilityOptions: InvoicePdfArchiveCapabilityOptions,
    event: IpcMainInvokeEvent,
    args: unknown[],
    operation: () => Promise<Result>,
  ): Promise<Result> {
    requireTrustedRequest(event, args, capabilityOptions.mainWindow);

    if (operationInProgress) {
      throw new Error('INVOICE_PDF_ARCHIVE_OPERATION_IN_PROGRESS');
    }
    operationInProgress = true;

    try {
      return await operation();
    } catch {
      capabilityOptions.showSafeError();
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
