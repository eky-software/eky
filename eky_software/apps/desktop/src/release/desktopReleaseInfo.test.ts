import { describe, expect, it } from 'vitest';

import {
  DesktopReleaseInfoValidationError,
  parseDesktopReleaseInfo,
} from './desktopReleaseInfo.js';

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

describe('desktop release information', () => {
  it('accepts the exact packaged local pilot identity', () => {
    expect(
      parseDesktopReleaseInfo(validReleaseInfo, '0.1.0-alpha.1'),
    ).toEqual(validReleaseInfo);
  });

  it('rejects identity drift, unknown fields and invalid MSI versions', () => {
    for (const value of [
      { ...validReleaseInfo, appIdentity: 'Other' },
      { ...validReleaseInfo, appVersion: '0.1.0-alpha.2' },
      { ...validReleaseInfo, msiProductVersion: '256.0.0' },
      { ...validReleaseInfo, releaseChannel: 'stable' },
      { ...validReleaseInfo, sourcePath: 'C:/unsafe' },
      { ...validReleaseInfo, upgradeCode: validReleaseInfo.upgradeCode.toLowerCase() },
    ]) {
      expect(() =>
        parseDesktopReleaseInfo(value, '0.1.0-alpha.1'),
      ).toThrow(DesktopReleaseInfoValidationError);
    }
  });
});
