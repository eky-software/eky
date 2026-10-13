import { describe, expect, it } from 'vitest';

import { createProfileSnapshotArtifactIdentity } from '../runtime/profileInspectionArtifactIdentity.js';

import type { ProfileInspectionReceipt } from '../runtime/profileInspectionMessages.js';
import type { BackupContainerSourceEntry } from './container/backupContainerWriter.js';
import { assertProfileBackupSourceReceipt } from './createProfileBackupSourceEntries.js';

describe('inspection receipt binding before encrypted backup creation', () => {
  it('accepts only the inspected database, catalog and exact counted artifact bytes', () => {
    expect(() => assertProfileBackupSourceReceipt(entries(), receipt)).not.toThrow();
  });

  it.each(['database', 'artifactCatalog'] as const)('rejects changed %s bytes before writing a container', type => {
    const changed = entries().map(entry => entry.type === type ? { ...entry, sha256: 'f'.repeat(64) } : entry);
    expect(() => assertProfileBackupSourceReceipt(changed, receipt)).toThrow('PROFILE_BACKUP_SOURCE_INVALID');
  });

  it.each(['database', 'artifactCatalog'] as const)('rejects a changed %s size', type => {
    const changed = entries().map(entry => entry.type === type ? { ...entry, contentLength: 1n } : entry);
    expect(() => assertProfileBackupSourceReceipt(changed, receipt)).toThrow('PROFILE_BACKUP_SOURCE_INVALID');
  });

  it('rejects a missing artifact instead of accepting aggregate metadata alone', () => {
    expect(() => assertProfileBackupSourceReceipt(entries().filter(entry => entry.type !== 'businessArtifact'), receipt))
      .toThrow('PROFILE_BACKUP_SOURCE_INVALID');
  });

  it('rejects changed artifact bytes despite an unchanged document address and size', () => {
    const changed = entries().map(entry => entry.type === 'businessArtifact' ? { ...entry, sha256: 'f'.repeat(64) } : entry);
    expect(() => assertProfileBackupSourceReceipt(changed, receipt)).toThrow('PROFILE_BACKUP_SOURCE_INVALID');
  });

  it('rejects an artifact size change despite a matching artifact count', () => {
    const changed = entries().map(entry => entry.type === 'businessArtifact' ? { ...entry, contentLength: 1n } : entry);
    expect(() => assertProfileBackupSourceReceipt(changed, receipt)).toThrow('PROFILE_BACKUP_SOURCE_INVALID');
  });

  it('rejects a renamed document with unchanged PDF bytes', () => {
    const changed = entries().map(entry => entry.type === 'businessArtifact'
      ? { ...entry, logicalPath: `artifacts/invoicing/invoice-documents/${'f'.repeat(64)}.pdf` } : entry);
    expect(() => assertProfileBackupSourceReceipt(changed, receipt)).toThrow('PROFILE_BACKUP_SOURCE_INVALID');
  });

  it('rejects equal-sized PDFs swapped without changing the count or total bytes', () => {
    const original = entries();
    const first = original.find(entry => entry.type === 'businessArtifact')!;
    const second = { ...first, logicalPath: `artifacts/invoicing/invoice-documents/${'f'.repeat(64)}.pdf`, sha256: 'f'.repeat(64) };
    original.push(second);
    const bound = { ...receipt, artifactCount: 2, artifactTotalByteSize: 10, artifactIdentity: artifactIdentity(original) };
    expect(() => assertProfileBackupSourceReceipt(original, bound)).not.toThrow();
    const swapped = original.map(entry => entry.type !== 'businessArtifact' ? entry :
      { ...entry, sha256: entry.logicalPath === first.logicalPath ? second.sha256 : first.sha256 });
    expect(() => assertProfileBackupSourceReceipt(swapped, bound)).toThrow('PROFILE_BACKUP_SOURCE_INVALID');
  });
});

const receipt: ProfileInspectionReceipt = {
  artifactIdentity: artifactIdentity(entries()),
  artifactCount: 1, artifactTotalByteSize: 5, databaseHealth: 'healthy',
  profileId: 'a'.repeat(64), migrationChainIdentity: 'b'.repeat(64), migrationPolicy: 'restoreCompatible',
  database: { byteSize: 10, sha256: 'c'.repeat(64) }, artifactCatalog: { byteSize: 2, sha256: 'd'.repeat(64) },
};
function entries(): BackupContainerSourceEntry[] {
  return [
    { logicalPath: 'profile.sqlite', type: 'database', sourcePath: 'unused', contentLength: 10n, sha256: 'c'.repeat(64) },
    { logicalPath: 'snapshot-catalog-v1.json', type: 'artifactCatalog', sourcePath: 'unused', contentLength: 2n, sha256: 'd'.repeat(64) },
    { logicalPath: `artifacts/invoicing/invoice-documents/${'e'.repeat(64)}.pdf`, type: 'businessArtifact',
      sourcePath: 'unused', contentLength: 5n, sha256: 'e'.repeat(64) },
  ];
}

function artifactIdentity(source: readonly BackupContainerSourceEntry[]): string {
  return createProfileSnapshotArtifactIdentity(source.filter(entry => entry.type === 'businessArtifact').map(entry => ({
    logicalPath: entry.logicalPath, byteSize: Number(entry.contentLength), sha256: entry.sha256,
  })));
}
