import { join } from 'node:path';

import { BrowserWindow } from 'electron';

import {
  createSecureWindowOptions,
  isAllowedApplicationNavigation,
} from './windowSecurity.js';

export interface ApplicationWindowObserver {
  loadFailed(): void;
  navigationBlocked(): void;
  newWindowBlocked(): void;
  renderProcessGone(): void;
}

export function createApplicationWindow(
  applicationPath: string,
  showWhenReady = true,
  observer?: ApplicationWindowObserver,
): BrowserWindow {
  const preloadPath = join(applicationPath, 'dist/preload/index.cjs');
  const window = new BrowserWindow(createSecureWindowOptions(preloadPath));

  window.removeMenu();
  window.webContents.setWindowOpenHandler(() => {
    observer?.newWindowBlocked();
    return { action: 'deny' };
  });
  window.webContents.on('will-attach-webview', (event) => {
    event.preventDefault();
  });
  window.webContents.on('will-navigate', (event, targetUrl) => {
    if (!isAllowedApplicationNavigation(targetUrl)) {
      event.preventDefault();
      observer?.navigationBlocked();
    }
  });
  window.webContents.on('did-fail-load', () => observer?.loadFailed());
  window.webContents.on('render-process-gone', () =>
    observer?.renderProcessGone(),
  );

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
