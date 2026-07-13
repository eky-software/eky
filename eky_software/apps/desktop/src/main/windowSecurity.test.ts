import { describe, expect, it } from 'vitest';

import {
  createSecureWindowOptions,
  isAllowedApplicationNavigation,
} from './windowSecurity.js';

describe('desktop window security', () => {
  it('uses an isolated and sandboxed renderer without Node integration', () => {
    const options = createSecureWindowOptions('C:\\Eky\\preload.js');

    expect(options.webPreferences).toMatchObject({
      allowRunningInsecureContent: false,
      contextIsolation: true,
      devTools: false,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      sandbox: true,
      webSecurity: true,
    });
  });

  it('allows navigation only inside the packaged application origin', () => {
    expect(isAllowedApplicationNavigation('eky://app/index.html')).toBe(true);
    expect(isAllowedApplicationNavigation('https://example.com')).toBe(false);
    expect(isAllowedApplicationNavigation('file:///C:/secret.txt')).toBe(false);
    expect(isAllowedApplicationNavigation('not a url')).toBe(false);
  });
});
