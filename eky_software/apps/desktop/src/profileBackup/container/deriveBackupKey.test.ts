import { describe, expect, it } from 'vitest';

import {
  deriveBackupKey,
  validateBackupPassword,
} from './deriveBackupKey.js';

const testPassword = 'Eky deterministic password 2026!';
const testSalt = Buffer.from(
  '000102030405060708090a0b0c0d0e0f',
  'hex',
);

describe('backup key derivation', () => {
  it('matches the fixed synthetic Node 24 scrypt vector', async () => {
    const key = await deriveBackupKey({
      kdfProfileId: 1,
      password: testPassword,
      salt: testSalt,
    });

    try {
      expect(key.toString('hex')).toBe(
        '698c7a076cc4c35abdb8a423cf7cebb1fcd51345598995ba2470045a7cd00739',
      );
    } finally {
      key.fill(0);
    }
  });

  it('preserves whitespace and Unicode while enforcing both limits', () => {
    expect(() =>
      validateBackupPassword('  pitkä salasana 🔐  '),
    ).not.toThrow();
    expect(() => validateBackupPassword('too short')).toThrow(
      'BACKUP_PASSWORD_INVALID',
    );
    expect(() => validateBackupPassword('a'.repeat(257))).toThrow(
      'BACKUP_PASSWORD_INVALID',
    );
    expect(() =>
      validateBackupPassword('🔐'.repeat(256)),
    ).not.toThrow();
    expect(() => validateBackupPassword('🔐'.repeat(257))).toThrow(
      'BACKUP_PASSWORD_INVALID',
    );
  });

  it('rejects unknown KDF profiles before running scrypt', async () => {
    await expect(
      deriveBackupKey({
        kdfProfileId: 9_999,
        password: testPassword,
        salt: testSalt,
      }),
    ).rejects.toThrow('BACKUP_KDF_PROFILE_UNSUPPORTED');
  });
});
