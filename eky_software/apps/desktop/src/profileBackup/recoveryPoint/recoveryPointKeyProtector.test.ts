import { describe, expect, it, vi } from 'vitest';

import { recoveryPointDataKeyLength } from './recoveryPointContainerHeader.js';
import {
  RecoveryPointKeyError,
  RecoveryPointKeyProtector,
} from './recoveryPointKeyProtector.js';

describe('recovery point key protector', () => {
  it('converts the key to base64 only at the async protector boundary', async () => {
    const dataKey = Buffer.alloc(recoveryPointDataKeyLength, 0x2a);
    const expectedBase64 = dataKey.toString('base64');
    const encrypt = vi.fn(async () =>
      Uint8Array.from(Buffer.from('protected')),
    );
    const decrypt = vi.fn(async () => ({
      shouldReEncrypt: true,
      value: expectedBase64,
    }));
    const protector = new RecoveryPointKeyProtector({
      decrypt,
      encrypt,
    });

    await expect(protector.protect(dataKey)).resolves.toEqual(
      Uint8Array.from(Buffer.from('protected')),
    );
    await expect(
      protector.unprotect(Uint8Array.from(Buffer.from('protected'))),
    ).resolves.toMatchObject({
      dataKey,
      shouldReEncrypt: true,
    });
    expect(encrypt).toHaveBeenCalledWith(expectedBase64);
  });

  it('fails closed for unavailable protection and malformed plaintext keys', async () => {
    const unavailable = new RecoveryPointKeyProtector({
      decrypt: vi.fn(async () => {
        throw new Error('raw safeStorage failure');
      }),
      encrypt: vi.fn(async () => {
        throw new Error('raw safeStorage failure');
      }),
    });

    await expect(
      unavailable.protect(
        Buffer.alloc(recoveryPointDataKeyLength),
      ),
    ).rejects.toEqual(
      new RecoveryPointKeyError(
        'RECOVERY_POINT_KEY_PROTECTION_UNAVAILABLE',
      ),
    );
    await expect(
      unavailable.unprotect(Uint8Array.from([1])),
    ).rejects.toEqual(
      new RecoveryPointKeyError(
        'RECOVERY_POINT_KEY_PROTECTION_UNAVAILABLE',
      ),
    );

    const malformed = new RecoveryPointKeyProtector({
      decrypt: vi.fn(async () => ({
        shouldReEncrypt: false,
        value: 'not-a-key',
      })),
      encrypt: vi.fn(),
    });
    await expect(
      malformed.unprotect(Uint8Array.from([1])),
    ).rejects.toMatchObject({
      code: 'RECOVERY_POINT_KEY_PROTECTION_UNAVAILABLE',
    });
  });
});
