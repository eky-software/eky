import { describe, expect, it } from 'vitest';

import {
  assertUniqueBackupEntryPaths,
  decodeBackupEntryHeader,
  encodeBackupEntryHeader,
  encodeBackupPayloadHeader,
  type BackupContainerEntryDescriptor,
} from './backupContainerEntry.js';
import {
  maximumBackupEntryBytes,
  maximumBackupEntryCount,
} from './backupContainerLimits.js';

const descriptor: BackupContainerEntryDescriptor = {
  contentLength: 10n,
  logicalPath: 'database/eky.sqlite',
  sha256: 'ab'.repeat(32),
  type: 'database',
};

describe('backup container entries', () => {
  it('round-trips an entry through the fixed binary header', () => {
    const encoded = encodeBackupEntryHeader(descriptor);

    expect(decodeBackupEntryHeader(encoded.header, encoded.path)).toEqual(
      descriptor,
    );
  });

  it.each([
    '/absolute',
    'C:/drive',
    'directory\\file',
    'directory//file',
    'directory/../file',
    'directory/./file',
    'directory/\u0000file',
    'directory/\nfile',
  ])('rejects unsafe logical path %j', (logicalPath) => {
    expect(() =>
      encodeBackupEntryHeader({ ...descriptor, logicalPath }),
    ).toThrow('BACKUP_ENTRY_INVALID');
  });

  it('rejects invalid UTF-8 without replacement decoding', () => {
    const encoded = encodeBackupEntryHeader(descriptor);
    const invalidPath = Buffer.from([0xc3, 0x28]);
    encoded.header.writeUInt32BE(invalidPath.byteLength, 4);

    expect(() =>
      decodeBackupEntryHeader(encoded.header, invalidPath),
    ).toThrow('BACKUP_ENTRY_INVALID');
  });

  it('rejects duplicate and Windows case-insensitive path collisions', () => {
    expect(() =>
      assertUniqueBackupEntryPaths([
        descriptor,
        { ...descriptor, logicalPath: 'DATABASE/EKY.SQLITE' },
      ]),
    ).toThrow('BACKUP_ENTRY_PATH_COLLISION');
  });

  it('rejects oversized content and entry counts before allocation', () => {
    expect(() =>
      encodeBackupEntryHeader({
        ...descriptor,
        contentLength: maximumBackupEntryBytes + 1n,
      }),
    ).toThrow('BACKUP_ENTRY_INVALID');
    expect(() =>
      encodeBackupPayloadHeader(maximumBackupEntryCount + 1),
    ).toThrow('BACKUP_PAYLOAD_INVALID');
  });
});
