import { SecretBrokerError } from './secretBrokerErrors.js';

export interface SafeStorageApi {
  decryptStringAsync(encrypted: Buffer): Promise<{
    result: string;
    shouldReEncrypt: boolean;
  }>;
  encryptStringAsync(plainText: string): Promise<Buffer>;
  isAsyncEncryptionAvailable(): Promise<boolean>;
  isEncryptionAvailable(): boolean;
}

export interface DecryptedString {
  shouldReEncrypt: boolean;
  value: string;
}

export interface StringProtector {
  decrypt(encrypted: Uint8Array): Promise<DecryptedString>;
  encrypt(value: string): Promise<Uint8Array>;
}

export class SafeStorageStringProtector implements StringProtector {
  constructor(private readonly safeStorage: SafeStorageApi) {}

  async decrypt(encrypted: Uint8Array): Promise<DecryptedString> {
    await this.assertAvailable();

    try {
      const decrypted = await this.safeStorage.decryptStringAsync(
        Buffer.from(encrypted),
      );

      if (
        typeof decrypted.result !== 'string' ||
        typeof decrypted.shouldReEncrypt !== 'boolean'
      ) {
        throw new Error('Invalid safeStorage result.');
      }

      return {
        shouldReEncrypt: decrypted.shouldReEncrypt,
        value: decrypted.result,
      };
    } catch {
      throw new SecretBrokerError('SECRET_DECRYPTION_FAILED');
    }
  }

  async encrypt(value: string): Promise<Uint8Array> {
    await this.assertAvailable();

    try {
      const encrypted = await this.safeStorage.encryptStringAsync(value);

      if (encrypted.byteLength === 0) {
        throw new Error('safeStorage returned empty ciphertext.');
      }

      return Uint8Array.from(encrypted);
    } catch {
      throw new SecretBrokerError('SECRET_STORAGE_UNAVAILABLE');
    }
  }

  private async assertAvailable(): Promise<void> {
    let available = false;

    try {
      available =
        this.safeStorage.isEncryptionAvailable() &&
        (await this.safeStorage.isAsyncEncryptionAvailable());
    } catch {
      available = false;
    }

    if (!available) {
      throw new SecretBrokerError('SECRET_STORAGE_UNAVAILABLE');
    }
  }
}
