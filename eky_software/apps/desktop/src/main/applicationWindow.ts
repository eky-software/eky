import { join } from 'node:path';

import { BrowserWindow } from 'electron';

import {
  createSecureWindowOptions,
  isAllowedApplicationNavigation,
} from './windowSecurity.js';

export function createApplicationWindow(
  applicationPath: string,
  showWhenReady = true,
): BrowserWindow {
  const preloadPath = join(applicationPath, 'dist/preload/index.cjs');
  const window = new BrowserWindow(createSecureWindowOptions(preloadPath));

  window.removeMenu();
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-attach-webview', (event) => {
    event.preventDefault();
  });
  window.webContents.on('will-navigate', (event, targetUrl) => {
    if (!isAllowedApplicationNavigation(targetUrl)) {
      event.preventDefault();
    }
  });

  if (showWhenReady) {
    window.once('ready-to-show', () => window.show());
  }

  return window;
}

export async function loadApplicationWindow(
  window: BrowserWindow,
): Promise<void> {
  try {
    await window.loadURL('eky://app/index.html');
  } catch {
    throw new Error('DESKTOP_SMOKE_RENDERER_FAILED');
  }
}
