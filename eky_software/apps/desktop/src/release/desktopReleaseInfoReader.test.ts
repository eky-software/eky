import { describe, expect, it, vi } from 'vitest';

import { readDesktopReleaseInfo } from './desktopReleaseInfoReader.js';

const validReleaseInfo = {
  appIdentity: 'Eky',
  appVersion: '0.1.0-alpha.1',
  architecture: 'x64',
  buildRevision: '123456789abc',
  msiProductVersion: '0.1.1',
  platform: 'win32',
  releaseChannel: 'pilot',
  schemaVersion: 1,
  upgradeCode: '302530B2-D950-41F5-8397-264B485FEE9A',
};

describe('readDesktopReleaseInfo', () => {
  it('keeps the update foundation unavailable in development', async () => {
    const readTextFile = vi.fn();
    await expect(
      readDesktopReleaseInfo({
        applicationPath: '/app',
        appVersion: '0.1.0-alpha.1',
        isPackaged: false,
        readTextFile,
      }),
    ).resolves.toBeUndefined();
    expect(readTextFile).not.toHaveBeenCalled();
  });

  it('reads the packaged identity and rejects missing or mismatching data', async () => {
    await expect(
      readDesktopReleaseInfo({
        applicationPath: '/app',
        appVersion: '0.1.0-alpha.1',
        isPackaged: true,
        readTextFile: vi.fn(async () => JSON.stringify(validReleaseInfo)),
      }),
    ).resolves.toEqual(validReleaseInfo);

    for (const readTextFile of [
      vi.fn(async () => '{'),
      vi.fn(async () =>
        JSON.stringify({ ...validReleaseInfo, appVersion: '0.1.0-alpha.2' }),
      ),
      vi.fn(async () => {
        throw new Error('C:/sensitive');
      }),
    ]) {
      await expect(
        readDesktopReleaseInfo({
          applicationPath: '/app',
          appVersion: '0.1.0-alpha.1',
          isPackaged: true,
          readTextFile,
        }),
      ).rejects.toThrow('PACKAGED_RELEASE_INFO_INVALID');
    }
  });
});
