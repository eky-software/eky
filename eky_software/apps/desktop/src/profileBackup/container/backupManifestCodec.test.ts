import { describe, expect, it } from 'vitest';

import type { BackupManifest } from './backupManifest.js';
import {
  decodeBackupManifest,
  encodeBackupManifest,
} from './backupManifestCodec.js';

const manifest: BackupManifest = {
  appVersion: '0.1.0-alpha.1',
  createdAtEpochMilliseconds: 1_775_252_800_000n,
  entries: [
    {
      contentLength: 512n,
      logicalPath: 'database/eky.sqlite',
      sha256: '01'.repeat(32),
      type: 'database',
    },
    {
      contentLength: 128n,
      logicalPath: 'artifacts/snapshot-catalog-v1.json',
      sha256: '02'.repeat(32),
      type: 'artifactCatalog',
    },
  ],
  migrationChainIdentity: 'migration-chain-v1',
  profileId: 'local-default',
};

describe('backup manifest binary codec', () => {
  it('is deterministic and round-trips without JSON ambiguity', () => {
    const first = encodeBackupManifest(manifest);
    const second = encodeBackupManifest(manifest);

    expect(first).toEqual(second);
    expect(decodeBackupManifest(first)).toEqual(manifest);
  });

  it('rejects trailing data and reserved-field changes', () => {
    expect(() =>
      decodeBackupManifest(
        Buffer.concat([encodeBackupManifest(manifest), Buffer.of(0)]),
      ),
    ).toThrow('BACKUP_MANIFEST_INVALID');

    const reservedChanged = encodeBackupManifest(manifest);
    reservedChanged.writeUInt16BE(1, 26);
    expect(() => decodeBackupManifest(reservedChanged)).toThrow(
      'BACKUP_MANIFEST_INVALID',
    );
  });

  it('rejects duplicate paths and manifest entries inside the manifest', () => {
    expect(() =>
      encodeBackupManifest({
        ...manifest,
        entries: [manifest.entries[0]!, manifest.entries[0]!],
      }),
    ).toThrow('BACKUP_ENTRY_PATH_COLLISION');

    expect(() =>
      encodeBackupManifest({
        ...manifest,
        entries: [
          {
            ...manifest.entries[0]!,
            logicalPath: 'manifest.bin',
            type: 'manifest',
          },
        ],
      }),
    ).toThrow('BACKUP_MANIFEST_INVALID');
  });
});
