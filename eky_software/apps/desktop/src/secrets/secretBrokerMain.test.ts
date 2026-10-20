import { randomUUID } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import type { EncryptedSecretFileStore } from './encryptedSecretFile.js';
import { CompanyEmailSecretBrokerClient } from './secretBrokerClient.js';
import {
  startSecretBrokerMain,
  type SecretBrokerObserver,
} from './secretBrokerMain.js';
import { handleSecretBrokerMessage } from './secretBrokerMain.js';
import { secretBrokerProtocolVersion } from './secretBrokerProtocol.js';
import { createLinkedSecretTransports } from './secretBrokerTestSupport.js';
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
      expect(await harness.client.getSecret('example-company') === '  synthetic-password  ').toBe(true);
      expect(harness.file.readRawText().includes('synthetic-password')).toBe(false);

      await harness.client.removeSecret('example-company');
      await expect(harness.client.hasSecret('example-company')).resolves.toBe(false);
      await expect(harness.client.getSecret('example-company')).resolves.toBeNull();
    } finally {
      await harness.close();
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
      expect(await harness.client.getSecret('company-a') === 'synthetic-company-a-password').toBe(true);
    } finally {
      await harness.close();
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
      await harness.close();
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

      expect(await harness.client.getSecret('example-company') === 'synthetic-second').toBe(true);
    } finally {
      await harness.close();
    }
  });

  it('does not confirm or clean a candidate when safeStorage decryption fails', async () => {
    const file = new InMemoryEncryptedSecretFile();
    await file.write(Buffer.from('synthetic-ciphertext', 'ascii'));

    const response = await handleSecretBrokerMessage(
      {
        companyId: 'example-company',
        generationId: randomUUID(),
        operation: 'hasCompanyEmailSecret',
        protocolVersion: secretBrokerProtocolVersion,
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
      const generationId = randomUUID();
      const response = await handleSecretBrokerMessage(
        {
          companyId: 'example-company',
          generationId,
          operation: 'readCompanyEmailSecret',
          protocolVersion: secretBrokerProtocolVersion,
          requestId,
          technicalPath: 'C:\\private\\secret.dat',
        },
        {
          encryptedSecretFile: harness.file,
          protector: createXorStringProtector(),
        },
      );

      expect(response).toEqual({
        companyId: 'example-company', generationId, operation: 'readCompanyEmailSecret', effect: 'noEffect',
        errorCode: 'SECRET_BROKER_REQUEST_INVALID',
        ok: false,
        protocolVersion: secretBrokerProtocolVersion,
        requestId,
      });
      expect(JSON.stringify(response)).not.toContain('private');
    } finally {
      await harness.close();
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
  close(): Promise<void>;
  file: InMemoryEncryptedSecretFile;
} {
  const [clientTransport, mainTransport] = createLinkedSecretTransports();
  const generationId = randomUUID();
  const file = new InMemoryEncryptedSecretFile();
  const mainHandle = startSecretBrokerMain({
    encryptedSecretFile: file,
    generationId,
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
    generationId,
  });

  return {
    client,
    async close() {
      await mainHandle.sealAndDrain();
      client.close();
      await mainHandle.close();
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
