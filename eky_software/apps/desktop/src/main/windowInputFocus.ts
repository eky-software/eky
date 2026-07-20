import type { BrowserWindow } from 'electron';

export function restoreWindowInputFocus(
  window: BrowserWindow | undefined,
): void {
  if (window === undefined || window.isDestroyed()) {
    return;
  }

  if (window.isMinimized()) {
    window.restore();
  }

  if (!window.isVisible()) {
    window.show();
  }

  window.focus();
  window.webContents.focus();
}
