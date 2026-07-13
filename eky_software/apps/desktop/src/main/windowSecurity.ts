import type { BrowserWindowConstructorOptions } from 'electron';

export function createSecureWindowOptions(
  preloadPath: string,
): BrowserWindowConstructorOptions {
  return {
    backgroundColor: '#eef4fb',
    height: 900,
    minHeight: 640,
    minWidth: 960,
    show: false,
    title: 'Eky',
    width: 1440,
    webPreferences: {
      allowRunningInsecureContent: false,
      contextIsolation: true,
      devTools: false,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      preload: preloadPath,
      sandbox: true,
      webSecurity: true,
    },
  };
}

export function isAllowedApplicationNavigation(targetUrl: string): boolean {
  try {
    const url = new URL(targetUrl);

    return url.protocol === 'eky:' && url.hostname === 'app';
  } catch {
    return false;
  }
}
