import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { createPackagedSmokeConfiguration } from '../main/packagedSmoke.js';
import { createDesktopProfilePaths } from './desktopProfilePaths.js';

describe('desktop profile paths', () => {
  it('keeps the normal packaged profile under Electron userData', () => {
    const userDataPath = resolve('synthetic-normal-user-data');

    expect(createDesktopProfilePaths(userDataPath)).toEqual({
      databaseFilePath: join(userDataPath, 'runtime', 'data', 'eky.sqlite'),
      invoiceDocumentStorageRoot: join(
        userDataPath,
        'runtime',
        'storage',
        'invoices',
      ),
      runtimeRoot: join(userDataPath, 'runtime'),
    });
  });

  it('keeps packaged smoke and normal packaged profiles in different roots', () => {
    const normalUserDataPath = resolve('synthetic-normal-user-data');
    const canonicalTempPath = mkdtempSync(
      join(tmpdir(), 'eky-desktop-profile-path-test-'),
    );

    try {
      const smoke = createPackagedSmokeConfiguration({
        hasSmokeSwitch: true,
        tempPath: canonicalTempPath,
        tokenValue: 'a'.repeat(32),
      });

      expect(smoke.userDataPath).toBeDefined();
      expect(smoke.userDataPath).not.toBe(normalUserDataPath);
      expect(
        createDesktopProfilePaths(smoke.userDataPath!).runtimeRoot,
      ).not.toBe(createDesktopProfilePaths(normalUserDataPath).runtimeRoot);
    } finally {
      rmSync(canonicalTempPath, { force: true, recursive: true });
    }
  });
});
