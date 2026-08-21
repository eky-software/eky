import { describe, expect, it } from 'vitest';

import {
  createDesktopPackageModeInfo,
  DesktopPackageModeValidationError,
  parseDesktopPackageModeInfo,
} from './desktopPackageMode.js';

describe('desktop package mode', () => {
  it('creates and accepts only the two named package modes', () => {
    expect(createDesktopPackageModeInfo('localDevelopment')).toEqual({
      mode: 'localDevelopment',
      schemaVersion: 1,
    });
    expect(parseDesktopPackageModeInfo({ mode: 'pilot', schemaVersion: 1 })).toEqual(
      { mode: 'pilot', schemaVersion: 1 },
    );
  });

  it('rejects unknown modes, schema drift and extra fields', () => {
    for (const value of [
      undefined,
      { mode: 'stable', schemaVersion: 1 },
      { mode: 'localDevelopment', schemaVersion: 2 },
      { mode: 'pilot', schemaVersion: 1, userDataPath: 'C:/unsafe' },
    ]) {
      expect(() => parseDesktopPackageModeInfo(value)).toThrow(
        DesktopPackageModeValidationError,
      );
    }
  });
});
