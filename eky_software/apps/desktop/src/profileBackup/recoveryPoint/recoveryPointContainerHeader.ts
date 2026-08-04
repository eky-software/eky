import { maximumBackupCiphertextBytes } from '../container/backupContainerLimits.js';

export const recoveryPointAuthenticationTagLength = 16;
export const recoveryPointCipherProfileId = 1;
export const recoveryPointContainerHeaderLength = 48;
export const recoveryPointContainerMagic = Buffer.from('EKYRCV01', 'ascii');
export const recoveryPointContainerVersion = 1;
export const recoveryPointDataKeyLength = 32;
export const recoveryPointKeyModeId = 1;
export const recoveryPointNonceLength = 12;

const containerVersionOffset = 8;
const headerLengthOffset = 10;
const cipherProfileOffset = 12;
const keyModeOffset = 14;
const nonceOffset = 16;
const ciphertextLengthOffset = nonceOffset + recoveryPointNonceLength;
const reservedOffset = ciphertextLengthOffset + 8;

export interface RecoveryPointContainerHeader {
  cipherProfileId: typeof recoveryPointCipherProfileId;
  ciphertextLength: bigint;
  containerVersion: typeof recoveryPointContainerVersion;
  keyModeId: typeof recoveryPointKeyModeId;
  nonce: Buffer;
}

export function encodeRecoveryPointContainerHeader(
  input: RecoveryPointContainerHeader,
): Buffer {
  validateRecoveryPointContainerHeader(input);
  const header = Buffer.alloc(recoveryPointContainerHeaderLength);

  recoveryPointContainerMagic.copy(header, 0);
  header.writeUInt16BE(input.containerVersion, containerVersionOffset);
  header.writeUInt16BE(
    recoveryPointContainerHeaderLength,
    headerLengthOffset,
  );
  header.writeUInt16BE(input.cipherProfileId, cipherProfileOffset);
  header.writeUInt16BE(input.keyModeId, keyModeOffset);
  input.nonce.copy(header, nonceOffset);
  header.writeBigUInt64BE(
    input.ciphertextLength,
    ciphertextLengthOffset,
  );
  return header;
}

export function decodeRecoveryPointContainerHeader(
  header: Buffer,
): RecoveryPointContainerHeader {
  if (
    header.byteLength !== recoveryPointContainerHeaderLength ||
    !header
      .subarray(0, recoveryPointContainerMagic.byteLength)
      .equals(recoveryPointContainerMagic) ||
    header.readUInt16BE(headerLengthOffset) !==
      recoveryPointContainerHeaderLength ||
    header.subarray(reservedOffset).some((value) => value !== 0)
  ) {
    throw new Error('RECOVERY_POINT_HEADER_INVALID');
  }

  const decoded: RecoveryPointContainerHeader = {
    cipherProfileId: header.readUInt16BE(cipherProfileOffset) as 1,
    ciphertextLength: header.readBigUInt64BE(
      ciphertextLengthOffset,
    ),
    containerVersion: header.readUInt16BE(containerVersionOffset) as 1,
    keyModeId: header.readUInt16BE(keyModeOffset) as 1,
    nonce: Buffer.from(
      header.subarray(
        nonceOffset,
        nonceOffset + recoveryPointNonceLength,
      ),
    ),
  };
  validateRecoveryPointContainerHeader(decoded);
  return decoded;
}

export function expectedRecoveryPointContainerByteLength(
  header: RecoveryPointContainerHeader,
): bigint {
  return (
    BigInt(recoveryPointContainerHeaderLength) +
    header.ciphertextLength +
    BigInt(recoveryPointAuthenticationTagLength)
  );
}

function validateRecoveryPointContainerHeader(
  input: RecoveryPointContainerHeader,
): void {
  if (
    input.containerVersion !== recoveryPointContainerVersion ||
    input.cipherProfileId !== recoveryPointCipherProfileId ||
    input.keyModeId !== recoveryPointKeyModeId ||
    input.nonce.byteLength !== recoveryPointNonceLength ||
    input.ciphertextLength <= 0n ||
    input.ciphertextLength > maximumBackupCiphertextBytes
  ) {
    throw new Error('RECOVERY_POINT_HEADER_INVALID');
  }
}
