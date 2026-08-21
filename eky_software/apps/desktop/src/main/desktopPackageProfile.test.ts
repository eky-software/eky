import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { resolveDesktopPackageUserDataOverride } from './desktopPackageProfile.js';

describe('desktop package profile', () => {
  it('isolates only the local packaged development runtime', () => {
    const appDataPath = resolve('synthetic-app-data');

    expect(
      resolveDesktopPackageUserDataOverride({
        appDataPath,
        packageMode: 'localDevelopment',
      }),
    ).toBe(join(appDataPath, 'Eky Test'));
    expect(
      resolveDesktopPackageUserDataOverride({
        appDataPath,
        packageMode: 'pilot',
      }),
    ).toBeUndefined();
    expect(
      resolveDesktopPackageUserDataOverride({
        appDataPath,
        packageMode: 'unpackagedDevelopment',
      }),
    ).toBeUndefined();
  });
});
