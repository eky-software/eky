import { describe, expect, it } from 'vitest';

import {
  backupAuthenticationTagLength,
  backupContainerHeaderLength,
  backupContainerMagic,
} from './backupContainerConstants.js';
import {
  decodeBackupContainerHeader,
  encodeBackupContainerHeader,
  expectedBackupContainerByteLength,
  type BackupContainerHeader,
} from './backupContainerHeader.js';

const header: BackupContainerHeader = {
  cipherProfileId: 1,
  ciphertextLength: 4_096n,
  containerVersion: 1,
  kdfProfileId: 1,
  nonce: Buffer.from('101112131415161718191a1b', 'hex'),
  salt: Buffer.from('000102030405060708090a0b0c0d0e0f', 'hex'),
};

describe('backup container header', () => {
  it('uses the fixed canonical big-endian v1 layout', () => {
    const encoded = encodeBackupContainerHeader(header);

    expect(encoded).toHaveLength(backupContainerHeaderLength);
    expect(encoded.subarray(0, 8)).toEqual(backupContainerMagic);
    expect(encoded.readUInt16BE(8)).toBe(1);
    expect(encoded.readUInt16BE(10)).toBe(64);
    expect(encoded.readUInt16BE(12)).toBe(1);
    expect(encoded.readUInt16BE(14)).toBe(1);
    expect(encoded.subarray(16, 32)).toEqual(header.salt);
    expect(encoded.subarray(32, 44)).toEqual(header.nonce);
    expect(encoded.readBigUInt64BE(44)).toBe(4_096n);
    expect(encoded.subarray(52)).toEqual(Buffer.alloc(12));
    expect(decodeBackupContainerHeader(encoded)).toEqual(header);
    expect(expectedBackupContainerByteLength(header)).toBe(
      BigInt(backupContainerHeaderLength) +
        header.ciphertextLength +
        BigInt(backupAuthenticationTagLength),
    );
  });

  it.each([
    ['magic', 0, 0x00],
    ['version', 9, 0x02],
    ['header length', 11, 0x3f],
    ['cipher profile', 13, 0x02],
    ['KDF profile', 15, 0x02],
    ['reserved bytes', 63, 0x01],
  ])('rejects a non-canonical %s field', (_name, offset, value) => {
    const encoded = encodeBackupContainerHeader(header);
    encoded.writeUInt8(value, offset);

    expect(() => decodeBackupContainerHeader(encoded)).toThrow(
      'BACKUP_CONTAINER_HEADER_INVALID',
    );
  });

  it('rejects a ciphertext length outside the R0 boundary', () => {
    expect(() =>
      encodeBackupContainerHeader({
        ...header,
        ciphertextLength: 0n,
      }),
    ).toThrow('BACKUP_CONTAINER_HEADER_INVALID');
  });
});
