import type { BrowserWindow, IpcMain } from 'electron';

import type { IncidentIndexDesktopLogFailureSink } from '../observability/infrastructure/incidentIndexDesktopLogFailureSink.js';
import {
  getOperationalLogFailureStatusIpcChannel,
  operationalLogFailureObservedIpcChannel,
} from './desktopDiagnosticsTypes.js';

export function createOperationalLogFailureCapability(options: {
  ipcMain: Pick<IpcMain, 'handle' | 'removeHandler'>;
  mainWindow: BrowserWindow;
  failureSink: Pick<IncidentIndexDesktopLogFailureSink, 'failureObserved' | 'subscribe'>;
}): { dispose(): void } {
  let disposed = false;
  options.ipcMain.removeHandler(getOperationalLogFailureStatusIpcChannel);
  options.ipcMain.handle(getOperationalLogFailureStatusIpcChannel, (event, ...args: unknown[]) => {
    if (disposed || options.mainWindow.isDestroyed() || args.length !== 0 ||
      event.sender !== options.mainWindow.webContents ||
      event.senderFrame !== options.mainWindow.webContents.mainFrame) {
      throw new Error('OPERATIONAL_LOG_FAILURE_STATUS_FORBIDDEN');
    }
    return { failureObserved: options.failureSink.failureObserved };
  });
  const unsubscribe = options.failureSink.subscribe(() => {
    if (disposed || options.mainWindow.isDestroyed() ||
      options.mainWindow.webContents.isDestroyed()) return;
    try { options.mainWindow.webContents.send(operationalLogFailureObservedIpcChannel); }
    catch { /* The retained snapshot remains available; no recursive logging. */ }
  });
  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      try { unsubscribe(); }
      finally { options.ipcMain.removeHandler(getOperationalLogFailureStatusIpcChannel); }
    },
  };
}
