import { describe, expect, it } from 'vitest';
import type { ProfileInspectionReceipt } from '../runtime/profileInspectionMessages.js';
import { assertDeletionBackupCorrespondence } from './assertDeletionBackupCorrespondence.js';

function receipt(migrationPolicy: ProfileInspectionReceipt['migrationPolicy']): ProfileInspectionReceipt {
  return {
    migrationPolicy, profileId: 'a'.repeat(64), migrationChainIdentity: 'b'.repeat(64),
    databaseHealth: 'healthy', artifactIdentity: 'c'.repeat(64),
    artifactCount: 1, artifactTotalByteSize: 100,
    database: { byteSize: 4096, sha256: 'd'.repeat(64) },
    artifactCatalog: { byteSize: 128, sha256: 'e'.repeat(64) },
  };
}

describe('deletion backup content correspondence', () => {
  it('requires equal content with distinct source and export policy roles', () => {
    expect(() => assertDeletionBackupCorrespondence(receipt('exactCurrentManifest'), receipt('restoreCompatible'))).not.toThrow();
  });

  it.each([
    { profileId: 'f'.repeat(64) }, { migrationChainIdentity: 'f'.repeat(64) },
    { artifactIdentity: 'f'.repeat(64) }, { artifactCount: 2 },
    { artifactTotalByteSize: 101 },
    { database: { byteSize: 4097, sha256: 'd'.repeat(64) } },
    { database: { byteSize: 4096, sha256: 'f'.repeat(64) } },
    { artifactCatalog: { byteSize: 129, sha256: 'e'.repeat(64) } },
    { artifactCatalog: { byteSize: 128, sha256: 'f'.repeat(64) } },
  ])('rejects changed authenticated content %j', changed => {
    expect(() => assertDeletionBackupCorrespondence(receipt('exactCurrentManifest'), {
      ...receipt('restoreCompatible'), ...changed,
    })).toThrow('PROFILE_BACKUP_CONTENT_MISMATCH');
  });

  it.each(['compatibleHistoricalPrefix', 'restoreCompatible'] as const)(
    'rejects %s as a current source', policy => {
      expect(() => assertDeletionBackupCorrespondence(receipt(policy), receipt('restoreCompatible')))
        .toThrow('PROFILE_BACKUP_CONTENT_MISMATCH');
    },
  );

  it.each(['compatibleHistoricalPrefix', 'exactCurrentManifest'] as const)(
    'rejects %s as a restored export', policy => {
      expect(() => assertDeletionBackupCorrespondence(receipt('exactCurrentManifest'), receipt(policy)))
        .toThrow('PROFILE_BACKUP_CONTENT_MISMATCH');
    },
  );
});
