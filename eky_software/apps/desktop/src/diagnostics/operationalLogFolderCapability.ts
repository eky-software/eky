import { lstatSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

import type {
  BrowserWindow,
  IpcMain,
  IpcMainInvokeEvent,
} from 'electron';

import { openOperationalLogFolderIpcChannel } from './desktopDiagnosticsTypes.js';

interface OperationalLogFolderCapabilityOptions {
  ipcMain: Pick<IpcMain, 'handle' | 'removeHandler'>;
  mainWindow: BrowserWindow;
  openPath(path: string): Promise<string>;
  runtimeRoot: string;
  showSafeError(): void;
}

export interface OperationalLogFolderCapability {
  dispose(): void;
}

export function createOperationalLogFolderCapability(
  options: OperationalLogFolderCapabilityOptions,
): OperationalLogFolderCapability {
  const logsRoot = resolveOperationalLogsRoot(options.runtimeRoot);

  options.ipcMain.removeHandler(openOperationalLogFolderIpcChannel);
  options.ipcMain.handle(
    openOperationalLogFolderIpcChannel,
    async (event, ...args: unknown[]) => {
      if (
        !isTrustedMainWindowRequest(event, options.mainWindow) ||
        args.length !== 0
      ) {
        throw new Error('OPERATIONAL_LOG_FOLDER_FORBIDDEN');
      }

      try {
        ensureSafeDirectory(logsRoot);
        const errorMessage = await options.openPath(logsRoot);
        if (errorMessage.length > 0) {
          throw new Error('OPERATIONAL_LOG_FOLDER_OPEN_FAILED');
        }
      } catch {
        options.showSafeError();
        throw new Error('OPERATIONAL_LOG_FOLDER_OPEN_FAILED');
      }
    },
  );

  return {
    dispose() {
      options.ipcMain.removeHandler(openOperationalLogFolderIpcChannel);
    },
  };
}

export function resolveOperationalLogsRoot(runtimeRoot: string): string {
  const absoluteRuntimeRoot = resolve(runtimeRoot);
  if (absoluteRuntimeRoot !== runtimeRoot) {
    throw new Error('Desktop runtime root must be absolute.');
  }
  return join(absoluteRuntimeRoot, 'logs');
}

function ensureSafeDirectory(directoryPath: string): void {
  try {
    const metadata = lstatSync(directoryPath);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      throw new Error('Operational logs root is unsafe.');
    }
  } catch (error) {
    if (isMissingPathError(error)) {
      mkdirSync(directoryPath, { mode: 0o700, recursive: true });
      const metadata = lstatSync(directoryPath);
      if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
        throw new Error('Operational logs root is unsafe.');
      }
      return;
    }
    throw error;
  }
}

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

function isMissingPathError(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === 'ENOENT'
  );
}
