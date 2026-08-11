import { describe, expect, it } from 'vitest';

import {
  LocalUpdateCacheMetadataError,
  parseLocalUpdateCacheMetadata,
} from './localUpdateCacheMetadata.js';

const validMetadata = {
  appVersion: '0.1.0-alpha.1',
  buildRevision: '123456789abc',
  createdAt: '2026-08-11T18:00:00.000Z',
  msiProductVersion: '0.1.1',
  packageFilename: 'Eky-0.1.0-alpha.1-x64.msi',
  packageSha256: 'a'.repeat(64),
  packageSize: 123,
  role: 'current',
  schemaVersion: 1,
};

describe('local update cache metadata', () => {
  it('accepts only the exact safe schema', () => {
    expect(parseLocalUpdateCacheMetadata(validMetadata)).toEqual(validMetadata);
    for (const value of [
      { ...validMetadata, sourcePath: 'C:/unsafe' },
      { ...validMetadata, role: 'previous' },
      { ...validMetadata, packageSize: 0 },
      { ...validMetadata, createdAt: 'today' },
      { ...validMetadata, packageFilename: '../Eky.msi' },
    ]) {
      expect(() => parseLocalUpdateCacheMetadata(value)).toThrow(
        LocalUpdateCacheMetadataError,
      );
    }
  });
});
