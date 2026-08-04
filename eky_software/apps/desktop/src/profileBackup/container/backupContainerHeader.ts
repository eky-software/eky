import {
  backupAuthenticationTagLength,
  backupCipherProfileId,
  backupContainerHeaderLength,
  backupContainerMagic,
  backupContainerVersion,
  backupKdfProfileId,
  backupNonceLength,
  backupSaltLength,
} from './backupContainerConstants.js';
import { maximumBackupCiphertextBytes } from './backupContainerLimits.js';
import { getBackupKdfProfile } from './backupCryptoProfile.js';

const containerVersionOffset = 8;
const headerLengthOffset = 10;
const cipherProfileOffset = 12;
const kdfProfileOffset = 14;
const saltOffset = 16;
const nonceOffset = saltOffset + backupSaltLength;
const ciphertextLengthOffset = nonceOffset + backupNonceLength;
const reservedOffset = ciphertextLengthOffset + 8;

export interface BackupContainerHeader {
  cipherProfileId: typeof backupCipherProfileId;
  ciphertextLength: bigint;
  containerVersion: typeof backupContainerVersion;
  kdfProfileId: typeof backupKdfProfileId;
  nonce: Buffer;
  salt: Buffer;
}

export function encodeBackupContainerHeader(
  input: BackupContainerHeader,
): Buffer {
  validateHeaderFields(input);
  const header = Buffer.alloc(backupContainerHeaderLength);

  backupContainerMagic.copy(header, 0);
  header.writeUInt16BE(input.containerVersion, containerVersionOffset);
  header.writeUInt16BE(
    backupContainerHeaderLength,
    headerLengthOffset,
  );
  header.writeUInt16BE(input.cipherProfileId, cipherProfileOffset);
  header.writeUInt16BE(input.kdfProfileId, kdfProfileOffset);
  input.salt.copy(header, saltOffset);
  input.nonce.copy(header, nonceOffset);
  header.writeBigUInt64BE(
    input.ciphertextLength,
    ciphertextLengthOffset,
  );

  return header;
}

export function decodeBackupContainerHeader(
  header: Buffer,
): BackupContainerHeader {
  if (
    header.byteLength !== backupContainerHeaderLength ||
    !header.subarray(0, backupContainerMagic.byteLength).equals(
      backupContainerMagic,
    )
  ) {
    throw new Error('BACKUP_CONTAINER_HEADER_INVALID');
  }

  const containerVersion = header.readUInt16BE(containerVersionOffset);
  const headerLength = header.readUInt16BE(headerLengthOffset);
  const cipherProfileId = header.readUInt16BE(cipherProfileOffset);
  const kdfProfileId = header.readUInt16BE(kdfProfileOffset);
  const reserved = header.subarray(reservedOffset);

  if (
    containerVersion !== backupContainerVersion ||
    headerLength !== backupContainerHeaderLength ||
    cipherProfileId !== backupCipherProfileId ||
    kdfProfileId !== backupKdfProfileId ||
    getBackupKdfProfile(kdfProfileId) === undefined ||
    reserved.some((value) => value !== 0)
  ) {
    throw new Error('BACKUP_CONTAINER_HEADER_INVALID');
  }

  const decoded: BackupContainerHeader = {
    cipherProfileId,
    ciphertextLength: header.readBigUInt64BE(ciphertextLengthOffset),
    containerVersion,
    kdfProfileId,
    nonce: Buffer.from(
      header.subarray(nonceOffset, nonceOffset + backupNonceLength),
    ),
    salt: Buffer.from(
      header.subarray(saltOffset, saltOffset + backupSaltLength),
    ),
  };
  validateHeaderFields(decoded);
  return decoded;
}

export function expectedBackupContainerByteLength(
  header: BackupContainerHeader,
): bigint {
  return (
    BigInt(backupContainerHeaderLength) +
    header.ciphertextLength +
    BigInt(backupAuthenticationTagLength)
  );
}

function validateHeaderFields(input: BackupContainerHeader): void {
  if (
    input.containerVersion !== backupContainerVersion ||
    input.cipherProfileId !== backupCipherProfileId ||
    input.kdfProfileId !== backupKdfProfileId ||
    input.salt.byteLength !== backupSaltLength ||
    input.nonce.byteLength !== backupNonceLength ||
    input.ciphertextLength <= 0n ||
    input.ciphertextLength > maximumBackupCiphertextBytes
  ) {
    throw new Error('BACKUP_CONTAINER_HEADER_INVALID');
  }
}

