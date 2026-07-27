import { lstatSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

import type {
  BrowserWindow,
  IpcMain,
  IpcMainInvokeEvent,
} from 'electron';

import { createDesktopOperationalEvent } from '../observability/createDesktopOperationalEvent.js';
import type { DesktopOperationalEventInput } from '../observability/desktopOperationalEvent.js';
import type { DesktopOperationalLogger } from '../observability/desktopOperationalLogger.js';
import { openOperationalLogFolderIpcChannel } from './desktopDiagnosticsTypes.js';

interface OperationalLogFolderCapabilityOptions {
  appVersion: string;
  ipcMain: Pick<IpcMain, 'handle' | 'removeHandler'>;
  mainWindow: BrowserWindow;
  openPath(path: string): Promise<string>;
  operationalLogger: DesktopOperationalLogger;
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
      const startedAt = Date.now();
      if (
        !isTrustedMainWindowRequest(event, options.mainWindow) ||
        args.length !== 0
      ) {
        writeEvent(options, {
          errorCode: 'OPERATIONAL_LOG_FOLDER_FORBIDDEN',
          eventName: 'operationalLogFolder.requestBlocked',
          sideEffectState: 'none',
          stage: 'ipc',
        });
        throw new Error('OPERATIONAL_LOG_FOLDER_FORBIDDEN');
      }

      try {
        ensureSafeDirectory(logsRoot);
      } catch {
        return failOpen(options, startedAt, 'ensureDirectory');
      }

      let errorMessage: string;
      try {
        errorMessage = await options.openPath(logsRoot);
      } catch {
        return failOpen(options, startedAt, 'shellOpen');
      }
      if (errorMessage.length > 0) {
        return failOpen(options, startedAt, 'shellOpen');
      }

      writeEvent(options, {
        durationMs: Date.now() - startedAt,
        eventName: 'operationalLogFolder.opened',
        stage: 'shellOpen',
      });
    },
  );

  return {
    dispose() {
      options.ipcMain.removeHandler(openOperationalLogFolderIpcChannel);
    },
  };
}

function failOpen(
  options: OperationalLogFolderCapabilityOptions,
  startedAt: number,
  stage: 'ensureDirectory' | 'shellOpen',
): never {
  writeEvent(options, {
    durationMs: Date.now() - startedAt,
    errorCode: 'OPERATIONAL_LOG_FOLDER_OPEN_FAILED',
    eventName: 'operationalLogFolder.openFailed',
    retryable: true,
    sideEffectState: 'none',
    stage,
  });
  options.showSafeError();
  throw new Error('OPERATIONAL_LOG_FOLDER_OPEN_FAILED');
}

function writeEvent<Input extends DesktopOperationalEventInput>(
  options: OperationalLogFolderCapabilityOptions,
  input: Readonly<Input>,
): void {
  options.operationalLogger.write(
    createDesktopOperationalEvent(input, {
      appVersion: options.appVersion,
    }),
  );
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
