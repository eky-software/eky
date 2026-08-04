import { scrypt } from 'node:crypto';

import {
  getBackupKdfProfile,
  type BackupKdfProfile,
} from './backupCryptoProfile.js';
import { backupSaltLength } from './backupContainerConstants.js';

const minimumPasswordCodePoints = 16;
const maximumPasswordCodePoints = 256;
const maximumPasswordBytes = 1_024;

export async function deriveBackupKey(input: {
  kdfProfileId: number;
  password: string;
  salt: Buffer;
}): Promise<Buffer> {
  validateBackupPassword(input.password);
  if (input.salt.byteLength !== backupSaltLength) {
    throw new Error('BACKUP_KDF_INPUT_INVALID');
  }

  const profile = getBackupKdfProfile(input.kdfProfileId);
  if (profile === undefined) {
    throw new Error('BACKUP_KDF_PROFILE_UNSUPPORTED');
  }

  return await runScrypt(input.password, input.salt, profile);
}

export function validateBackupPassword(password: string): void {
  if (typeof password !== 'string') {
    throw new Error('BACKUP_PASSWORD_INVALID');
  }

  const codePointCount = [...password].length;
  const byteLength = Buffer.byteLength(password, 'utf8');

  if (
    codePointCount < minimumPasswordCodePoints ||
    codePointCount > maximumPasswordCodePoints ||
    byteLength > maximumPasswordBytes
  ) {
    throw new Error('BACKUP_PASSWORD_INVALID');
  }
}

function runScrypt(
  password: string,
  salt: Buffer,
  profile: BackupKdfProfile,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password,
      salt,
      profile.keyLength,
      {
        N: profile.cost,
        maxmem: profile.maxmem,
        p: profile.parallelization,
        r: profile.blockSize,
      },
      (error, derivedKey) => {
        if (error !== null) {
          reject(new Error('BACKUP_KDF_FAILED'));
          return;
        }
        resolve(derivedKey);
      },
    );
  });
}

