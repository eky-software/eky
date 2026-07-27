import { describe, expect, it } from 'vitest';

import {
  DesktopBuildInfoValidationError,
  parseDesktopBuildInfo,
} from './desktopBuildInfo.js';

const validBuildInfo = {
  appVersion: '0.1.0-alpha.1',
  buildCreatedAt: '2026-07-28T00:00:00.000Z',
  buildDirty: false,
  buildRevision: '123456789abc',
  schemaVersion: 1,
};

describe('parseDesktopBuildInfo', () => {
  it('accepts a strict packaged build identity', () => {
    expect(parseDesktopBuildInfo(validBuildInfo)).toEqual(validBuildInfo);
  });

  it('rejects unknown fields and development revisions in packaged data', () => {
    expect(() =>
      parseDesktopBuildInfo({ ...validBuildInfo, localPath: 'C:/Users/example' }),
    ).toThrow(DesktopBuildInfoValidationError);
    expect(() =>
      parseDesktopBuildInfo({
        ...validBuildInfo,
        buildRevision: 'development',
      }),
    ).toThrow(DesktopBuildInfoValidationError);
  });

  it('rejects invalid timestamps, versions and dirty values', () => {
    for (const value of [
      { ...validBuildInfo, appVersion: 'alpha' },
      { ...validBuildInfo, buildCreatedAt: '2026-07-28' },
      { ...validBuildInfo, buildDirty: 'false' },
      { ...validBuildInfo, buildRevision: 'ABCDEF1' },
    ]) {
      expect(() => parseDesktopBuildInfo(value)).toThrow(
        DesktopBuildInfoValidationError,
      );
    }
  });
});
