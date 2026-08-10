import { describe, expect, it } from 'vitest';

import { createDesktopBackendEnvironment } from './backendEnvironment.js';

describe('desktop backend environment', () => {
  it('passes only required Windows runtime values to the backend process', () => {
    expect(
      createDesktopBackendEnvironment({
        API_TOKEN: 'must-not-leak',
        DATABASE_FILE_PATH: 'must-not-control-desktop.sqlite',
        Path: 'C:\\Windows\\System32',
        SystemRoot: 'C:\\Windows',
        TEMP: 'C:\\Temp',
        USER_SECRET: 'must-not-leak',
      }),
    ).toEqual({
      NODE_ENV: 'production',
      PATH: 'C:\\Windows\\System32',
      SystemRoot: 'C:\\Windows',
      TEMP: 'C:\\Temp',
    });
  });
});
