import { describe, expect, it, vi } from 'vitest';

import type { SafeStorageApi } from './safeStorageStringProtector.js';
import { SafeStorageStringProtector } from './safeStorageStringProtector.js';

describe('SafeStorageStringProtector', () => {
  it('uses only asynchronous safeStorage operations', async () => {
    const safeStorage = createSafeStorage();
    const protector = new SafeStorageStringProtector(safeStorage);

    await expect(protector.encrypt('synthetic-secret')).resolves.toEqual(
      Uint8Array.from([1, 2, 3]),
    );
    await expect(protector.decrypt(Uint8Array.from([1, 2, 3]))).resolves.toEqual({
      shouldReEncrypt: false,
      value: 'synthetic-secret',
    });
    expect(safeStorage.encryptStringAsync).toHaveBeenCalledWith('synthetic-secret');
    expect(safeStorage.decryptStringAsync).toHaveBeenCalledWith(
      Buffer.from([1, 2, 3]),
    );
  });

  it('fails closed when encryption is unavailable', async () => {
    const protector = new SafeStorageStringProtector(
      createSafeStorage({ isEncryptionAvailable: vi.fn(() => false) }),
    );

    await expect(protector.encrypt('synthetic-secret')).rejects.toEqual(
      expect.objectContaining({ code: 'SECRET_STORAGE_UNAVAILABLE' }),
    );
  });

  it('does not expose raw safeStorage failures', async () => {
    const protector = new SafeStorageStringProtector(
      createSafeStorage({
        decryptStringAsync: vi.fn(async () => {
          throw new Error('C:\\private\\secret.dat and synthetic-secret');
        }),
      }),
    );

    await expect(protector.decrypt(Uint8Array.from([1]))).rejects.toEqual(
      expect.objectContaining({
        code: 'SECRET_DECRYPTION_FAILED',
        message: 'Email secret operation failed.',
      }),
    );
  });
});

function createSafeStorage(
  overrides: Partial<SafeStorageApi> = {},
): SafeStorageApi {
  return {
    decryptStringAsync: vi.fn(async () => ({
      result: 'synthetic-secret',
      shouldReEncrypt: false,
    })),
    encryptStringAsync: vi.fn(async () => Buffer.from([1, 2, 3])),
    isAsyncEncryptionAvailable: vi.fn(async () => true),
    isEncryptionAvailable: vi.fn(() => true),
    ...overrides,
  };
}
