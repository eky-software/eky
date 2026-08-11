import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  parseUpdatePackageManifestBytes,
  UPDATE_PACKAGE_MANIFEST_MAX_BYTES,
  UpdatePackageManifestValidationError,
  validateUpdatePackageManifest,
} from './updatePackageManifest.js';

interface CodecFixture {
  accepted: boolean;
  name: string;
  source: string;
}

const validManifest = {
  appIdentity: 'Eky',
  appVersion: '0.1.0-alpha.1',
  architecture: 'x64',
  buildRevision: '123456789abc',
  manifestFormatVersion: 1,
  msiProductVersion: '0.1.1',
  packageFilename: 'Eky-0.1.0-alpha.1-x64.msi',
  packageKind: 'windows-installer-msi',
  packageSha256: 'a'.repeat(64),
  packageSize: 123,
  platform: 'win32',
  releaseChannel: 'pilot',
  signing: {
    publisher: null,
    status: 'unsigned-prototype',
    thumbprint: null,
    timestamped: false,
  },
};

describe('update package manifest codec', () => {
  it('uses the canonical installer and runtime fixture corpus', async () => {
    const fixtures = JSON.parse(
      await readFile(
        resolve(
          process.cwd(),
          'installer/fixtures/installerManifestCodecFixtures.json',
        ),
        'utf8',
      ),
    ) as CodecFixture[];

    for (const fixture of fixtures) {
      const parse = () =>
        parseUpdatePackageManifestBytes(Buffer.from(fixture.source, 'utf8'));
      if (fixture.accepted) {
        expect(parse, fixture.name).not.toThrow();
      } else {
        expect(parse, fixture.name).toThrow(
          UpdatePackageManifestValidationError,
        );
      }
    }
  });

  it('rejects oversized, empty, invalid UTF-8 and malformed JSON bytes', () => {
    for (const bytes of [
      new Uint8Array(),
      Buffer.alloc(UPDATE_PACKAGE_MANIFEST_MAX_BYTES + 1, 0x20),
      Uint8Array.from([0xc3, 0x28]),
      Buffer.from('{', 'utf8'),
    ]) {
      expect(() => parseUpdatePackageManifestBytes(bytes)).toThrow(
        UpdatePackageManifestValidationError,
      );
    }
  });

  it('rejects nulls, unknown fields and invalid package limits', () => {
    for (const value of [
      null,
      { ...validManifest, sourcePath: 'C:/unsafe' },
      { ...validManifest, packageSize: 0 },
      { ...validManifest, packageSize: 512 * 1024 * 1024 + 1 },
      { ...validManifest, packageSha256: 'A'.repeat(64) },
      { ...validManifest, signing: null },
      {
        ...validManifest,
        signing: { ...validManifest.signing, publisher: 'Unverified' },
      },
    ]) {
      expect(() => validateUpdatePackageManifest(value)).toThrow(
        UpdatePackageManifestValidationError,
      );
    }
  });
});
