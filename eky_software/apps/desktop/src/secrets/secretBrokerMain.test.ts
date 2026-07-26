import { describe, expect, it, vi } from 'vitest';

import type { EncryptedSecretFileStore } from './encryptedSecretFile.js';
import { CompanyEmailSecretBrokerClient } from './secretBrokerClient.js';
import {
  startSecretBrokerMain,
  type SecretBrokerObserver,
} from './secretBrokerMain.js';
import { handleSecretBrokerMessage } from './secretBrokerMain.js';
import type { SecretBrokerTransport } from './secretBrokerTransport.js';
import type {
  DecryptedString,
  StringProtector,
} from './safeStorageStringProtector.js';

describe('Electron safeStorage secret broker', () => {
  it('supports set, has, read, and remove without changing secret text', async () => {
    const harness = createBrokerHarness();

    try {
      await harness.client.setSecret({
        companyId: 'example-company',
        secret: '  synthetic-password  ',
      });

      await expect(harness.client.hasSecret('example-company')).resolves.toBe(true);
      await expect(harness.client.getSecret('example-company')).resolves.toBe(
        '  synthetic-password  ',
      );
      expect(harness.file.readRawText()).not.toContain('synthetic-password');

      await harness.client.removeSecret('example-company');
      await expect(harness.client.hasSecret('example-company')).resolves.toBe(false);
      await expect(harness.client.getSecret('example-company')).resolves.toBeNull();
    } finally {
      harness.close();
    }
  });

  it('does not expose or remove another company secret', async () => {
    const harness = createBrokerHarness();

    try {
      await harness.client.setSecret({
        companyId: 'company-a',
        secret: 'synthetic-company-a-password',
      });

      await expect(harness.client.hasSecret('company-b')).resolves.toBe(false);
      await expect(harness.client.getSecret('company-b')).resolves.toBeNull();
      await harness.client.removeSecret('company-b');
      await expect(harness.client.getSecret('company-a')).resolves.toBe(
        'synthetic-company-a-password',
      );
    } finally {
      harness.close();
    }
  });

  it('fails closed without encryption and never writes the secret', async () => {
    const operationFailed = vi.fn();
    const harness = createBrokerHarness({
      operationFailed,
      protector: {
        async decrypt(): Promise<DecryptedString> {
          throw new Error('unavailable');
        },
        async encrypt(): Promise<Uint8Array> {
          throw new Error('unavailable');
        },
      },
    });

    try {
      await expect(
        harness.client.setSecret({
          companyId: 'example-company',
          secret: 'synthetic-password',
        }),
      ).rejects.toEqual(
        expect.objectContaining({ code: 'SECRET_STORAGE_UNAVAILABLE' }),
      );
      await expect(harness.file.readCandidate()).resolves.toBeNull();
      expect(operationFailed).toHaveBeenCalledWith(
        'setCompanyEmailSecret',
        'SECRET_STORAGE_UNAVAILABLE',
      );
    } finally {
      harness.close();
    }
  });

  it('serializes concurrent writes so the final payload remains complete', async () => {
    const harness = createBrokerHarness();

    try {
      await Promise.all([
        harness.client.setSecret({
          companyId: 'example-company',
          secret: 'synthetic-first',
        }),
        harness.client.setSecret({
          companyId: 'example-company',
          secret: 'synthetic-second',
        }),
      ]);

      await expect(harness.client.getSecret('example-company')).resolves.toBe(
        'synthetic-second',
      );
    } finally {
      harness.close();
    }
  });

  it('does not confirm or clean a candidate when safeStorage decryption fails', async () => {
    const file = new InMemoryEncryptedSecretFile();
    await file.write(Buffer.from('synthetic-ciphertext', 'ascii'));

    const response = await handleSecretBrokerMessage(
      {
        companyId: 'example-company',
        operation: 'hasCompanyEmailSecret',
        protocolVersion: 1,
        requestId: '47a8881e-e9b8-4f40-b5c7-8fe2c9f2ed5e',
      },
      {
        encryptedSecretFile: file,
        protector: {
          async decrypt(): Promise<DecryptedString> {
            throw new Error('synthetic decrypt failure');
          },
          async encrypt(): Promise<Uint8Array> {
            throw new Error('not used');
          },
        },
      },
    );

    expect(response).toMatchObject({
      errorCode: 'SECRET_STORAGE_UNAVAILABLE',
      ok: false,
    });
    expect(file.confirmCount).toBe(0);
    await expect(file.readCandidate()).resolves.not.toBeNull();
  });

  it('rejects malformed messages with only a safe broker error code', async () => {
    const harness = createBrokerHarness();

    try {
      const requestId = '47a8881e-e9b8-4f40-b5c7-8fe2c9f2ed5e';
      const response = await handleSecretBrokerMessage(
        {
          companyId: 'example-company',
          operation: 'readArbitrarySecret',
          protocolVersion: 1,
          requestId,
          technicalPath: 'C:\\private\\secret.dat',
        },
        {
          encryptedSecretFile: harness.file,
          protector: createXorStringProtector(),
        },
      );

      expect(response).toEqual({
        errorCode: 'SECRET_BROKER_REQUEST_INVALID',
        ok: false,
        protocolVersion: 1,
        requestId,
      });
      expect(JSON.stringify(response)).not.toContain('private');
    } finally {
      harness.close();
    }
  });
});

function createBrokerHarness(
  options: {
    operationFailed?: SecretBrokerObserver['operationFailed'];
    protector?: StringProtector;
  } = {},
): {
  client: CompanyEmailSecretBrokerClient;
  close(): void;
  file: InMemoryEncryptedSecretFile;
} {
  const [clientTransport, mainTransport] = createLinkedTransports();
  const file = new InMemoryEncryptedSecretFile();
  const mainHandle = startSecretBrokerMain({
    encryptedSecretFile: file,
    ...(options.operationFailed === undefined
      ? {}
      : {
          observer: {
            operationFailed: options.operationFailed,
          },
        }),
    protector: options.protector ?? createXorStringProtector(),
    transport: mainTransport,
  });
  const client = new CompanyEmailSecretBrokerClient(clientTransport, {
    requestTimeoutMilliseconds: 1_000,
  });

  return {
    client,
    close() {
      client.close();
      mainHandle.close();
    },
    file,
  };
}

class InMemoryEncryptedSecretFile implements EncryptedSecretFileStore {
  private ciphertext: Uint8Array | null = null;
  confirmCount = 0;

  async confirm(): Promise<void> {
    this.confirmCount += 1;
  }

  async readCandidate(): Promise<{
    ciphertext: Uint8Array;
    slot: 'current';
  } | null> {
    return this.ciphertext === null
      ? null
      : { ciphertext: Uint8Array.from(this.ciphertext), slot: 'current' };
  }

  readRawText(): string {
    return this.ciphertext === null
      ? ''
      : Buffer.from(this.ciphertext).toString('utf8');
  }

  async remove(): Promise<void> {
    this.ciphertext = null;
  }

  async write(ciphertext: Uint8Array): Promise<void> {
    this.ciphertext = Uint8Array.from(ciphertext);
  }
}

function createXorStringProtector(): StringProtector {
  return {
    async decrypt(encrypted): Promise<DecryptedString> {
      const plaintext = Uint8Array.from(encrypted, (value) => value ^ 0xa5);

      return {
        shouldReEncrypt: false,
        value: Buffer.from(plaintext).toString('utf8'),
      };
    },
    async encrypt(value): Promise<Uint8Array> {
      return Uint8Array.from(Buffer.from(value, 'utf8'), (byte) => byte ^ 0xa5);
    },
  };
}

function createLinkedTransports(): [
  SecretBrokerTransport,
  SecretBrokerTransport,
] {
  const leftListeners = new Set<(value: unknown) => void>();
  const rightListeners = new Set<(value: unknown) => void>();
  let closed = false;

  const createTransport = (
    ownListeners: Set<(value: unknown) => void>,
    peerListeners: Set<(value: unknown) => void>,
  ): SecretBrokerTransport => ({
    close() {
      closed = true;
      ownListeners.clear();
    },
    send(value) {
      if (closed) {
        throw new Error('Transport closed.');
      }

      queueMicrotask(() => {
        for (const listener of peerListeners) {
          listener(value);
        }
      });
    },
    subscribe(listener) {
      ownListeners.add(listener);

      return () => ownListeners.delete(listener);
    },
  });

  return [
    createTransport(leftListeners, rightListeners),
    createTransport(rightListeners, leftListeners),
  ];
}
