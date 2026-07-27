import { describe, expect, it, vi } from 'vitest';

import { readDesktopBuildInfo } from './desktopBuildInfoReader.js';

describe('readDesktopBuildInfo', () => {
  it('uses an explicit dirty development fallback without reading a file', async () => {
    const readTextFile = vi.fn();

    await expect(
      readDesktopBuildInfo({
        applicationPath: '/app',
        appVersion: '0.1.0-alpha.1',
        isPackaged: false,
        now: () => new Date('2026-07-28T00:00:00.000Z'),
        readTextFile,
      }),
    ).resolves.toEqual({
      appVersion: '0.1.0-alpha.1',
      buildCreatedAt: '2026-07-28T00:00:00.000Z',
      buildDirty: true,
      buildRevision: 'development',
      schemaVersion: 1,
    });
    expect(readTextFile).not.toHaveBeenCalled();
  });

  it('reads and validates packaged data against the Electron app version', async () => {
    await expect(
      readDesktopBuildInfo({
        applicationPath: '/app',
        appVersion: '0.1.0-alpha.1',
        isPackaged: true,
        readTextFile: vi.fn(async () =>
          JSON.stringify({
            appVersion: '0.1.0-alpha.1',
            buildCreatedAt: '2026-07-28T00:00:00.000Z',
            buildDirty: false,
            buildRevision: '123456789abc',
            schemaVersion: 1,
          }),
        ),
      }),
    ).resolves.toMatchObject({
      appVersion: '0.1.0-alpha.1',
      buildRevision: '123456789abc',
    });
  });

  it('rejects missing, malformed and mismatched packaged data safely', async () => {
    for (const readTextFile of [
      vi.fn(async () => {
        throw new Error('missing path');
      }),
      vi.fn(async () => '{"schemaVersion":1}'),
      vi.fn(async () =>
        JSON.stringify({
          appVersion: '0.1.0-alpha.2',
          buildCreatedAt: '2026-07-28T00:00:00.000Z',
          buildDirty: false,
          buildRevision: '123456789abc',
          schemaVersion: 1,
        }),
      ),
    ]) {
      await expect(
        readDesktopBuildInfo({
          applicationPath: '/app',
          appVersion: '0.1.0-alpha.1',
          isPackaged: true,
          readTextFile,
        }),
      ).rejects.toThrow('PACKAGED_BUILD_INFO_INVALID');
    }
  });
});
