import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  createExpectedWindowsInstallerProductCode,
  WindowsInstallerProductCodeError,
} from './windowsInstallerProductCode.js';

describe('Windows installer ProductCode runtime contract', () => {
  it('matches the build-time contract for the canonical fixture corpus', async () => {
    const fixtures = JSON.parse(
      await readFile(
        join(
          process.cwd(),
          'installer',
          'fixtures',
          'installerProductCodeContractFixtures.json',
        ),
        'utf8',
      ),
    ) as Array<{ msiProductVersion: string; productCode: string }>;

    expect(
      fixtures.map((fixture) =>
        createExpectedWindowsInstallerProductCode(
          fixture.msiProductVersion,
        ),
      ),
    ).toEqual(fixtures.map((fixture) => fixture.productCode));
  });

  it('rejects versions outside the MSI product-version contract', () => {
    for (const value of ['1', '01.2.3', '256.0.0', '1.256.0', '1.2.65536']) {
      expect(() => createExpectedWindowsInstallerProductCode(value)).toThrow(
        WindowsInstallerProductCodeError,
      );
    }
  });
});
