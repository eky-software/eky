import type { StringProtector } from '../../secrets/safeStorageStringProtector.js';
import { recoveryPointDataKeyLength } from './recoveryPointContainerHeader.js';

const encodedDataKeyLength = 44;
const base64Pattern =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

export class RecoveryPointKeyError extends Error {
  constructor(
    readonly code:
      | 'RECOVERY_POINT_KEY_INVALID'
      | 'RECOVERY_POINT_KEY_PROTECTION_UNAVAILABLE',
  ) {
    super(code);
    this.name = 'RecoveryPointKeyError';
  }
}

export interface UnprotectedRecoveryPointKey {
  dataKey: Buffer;
  shouldReEncrypt: boolean;
}

export class RecoveryPointKeyProtector {
  constructor(private readonly protector: StringProtector) {}

  async protect(dataKey: Buffer): Promise<Uint8Array> {
    if (dataKey.byteLength !== recoveryPointDataKeyLength) {
      throw new RecoveryPointKeyError('RECOVERY_POINT_KEY_INVALID');
    }

    try {
      return await this.protector.encrypt(dataKey.toString('base64'));
    } catch {
      throw new RecoveryPointKeyError(
        'RECOVERY_POINT_KEY_PROTECTION_UNAVAILABLE',
      );
    }
  }

  async unprotect(
    encryptedDataKey: Uint8Array,
  ): Promise<UnprotectedRecoveryPointKey> {
    try {
      const decrypted = await this.protector.decrypt(encryptedDataKey);
      if (
        decrypted.value.length !== encodedDataKeyLength ||
        !base64Pattern.test(decrypted.value)
      ) {
        throw new Error('Invalid recovery point key encoding.');
      }
      const dataKey = Buffer.from(decrypted.value, 'base64');
      if (
        dataKey.byteLength !== recoveryPointDataKeyLength ||
        dataKey.toString('base64') !== decrypted.value
      ) {
        dataKey.fill(0);
        throw new Error('Invalid recovery point key length.');
      }
      return {
        dataKey,
        shouldReEncrypt: decrypted.shouldReEncrypt,
      };
    } catch {
      throw new RecoveryPointKeyError(
        'RECOVERY_POINT_KEY_PROTECTION_UNAVAILABLE',
      );
    }
  }
}
