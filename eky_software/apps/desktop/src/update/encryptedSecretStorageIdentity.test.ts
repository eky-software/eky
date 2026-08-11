import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { readEncryptedSecretStorageIdentity } from './encryptedSecretStorageIdentity.js';

describe('encrypted secret storage identity', () => {
  it('returns no identity when no encrypted secret exists', async () => {
    await expect(
      readEncryptedSecretStorageIdentity({
        readCandidate: async () => null,
      }),
    ).resolves.toBeNull();
  });

  it('hashes only ciphertext and clears the temporary bytes', async () => {
    const ciphertext = Uint8Array.from([1, 2, 3, 4]);
    const expected = createHash('sha256')
      .update(Uint8Array.from(ciphertext))
      .digest('hex');

    await expect(
      readEncryptedSecretStorageIdentity({
        readCandidate: async () => ({ ciphertext, slot: 'current' }),
      }),
    ).resolves.toBe(expected);
    expect(ciphertext).toEqual(Uint8Array.from([0, 0, 0, 0]));
  });
});
