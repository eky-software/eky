import { createHash } from 'node:crypto';

import type { EncryptedSecretFileStore } from '../secrets/encryptedSecretFile.js';

export async function readEncryptedSecretStorageIdentity(
  store: Pick<EncryptedSecretFileStore, 'readCandidate'>,
): Promise<string | null> {
  const candidate = await store.readCandidate();
  if (candidate === null) {
    return null;
  }
  try {
    return createHash('sha256').update(candidate.ciphertext).digest('hex');
  } finally {
    candidate.ciphertext.fill(0);
  }
}
