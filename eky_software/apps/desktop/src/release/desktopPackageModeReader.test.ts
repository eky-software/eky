import { describe, expect, it, vi } from 'vitest';

import { readDesktopPackageMode } from './desktopPackageModeReader.js';

describe('readDesktopPackageMode', () => {
  it('keeps the unpackaged runtime outside packaged mode files', () => {
    const readTextFile = vi.fn();

    expect(
      readDesktopPackageMode({
        applicationPath: '/app',
        isPackaged: false,
        readTextFile,
      }),
    ).toBe('unpackagedDevelopment');
    expect(readTextFile).not.toHaveBeenCalled();
  });

  it('reads a strict packaged mode without exposing file failures', () => {
    expect(
      readDesktopPackageMode({
        applicationPath: '/app',
        isPackaged: true,
        readTextFile: vi.fn(() =>
          JSON.stringify({ mode: 'localDevelopment', schemaVersion: 1 }),
        ),
      }),
    ).toBe('localDevelopment');

    for (const readTextFile of [
      vi.fn(() => '{'),
      vi.fn(() => JSON.stringify({ mode: 'unknown', schemaVersion: 1 })),
      vi.fn(() => {
        throw new Error('C:/sensitive/package-mode.json');
      }),
    ]) {
      expect(() =>
        readDesktopPackageMode({
          applicationPath: '/app',
          isPackaged: true,
          readTextFile,
        }),
      ).toThrow('PACKAGED_PACKAGE_MODE_INVALID');
    }
  });
});
