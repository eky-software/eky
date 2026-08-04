import { randomBytes } from 'node:crypto';
import {
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { decryptRecoveryPointPayload } from './decryptRecoveryPointPayload.js';
import { encryptRecoveryPointPayload } from './encryptRecoveryPointPayload.js';
import {
  decodeRecoveryPointContainerHeader,
  encodeRecoveryPointContainerHeader,
  recoveryPointAuthenticationTagLength,
  recoveryPointCipherProfileId,
  recoveryPointContainerHeaderLength,
  recoveryPointContainerVersion,
  recoveryPointDataKeyLength,
  recoveryPointKeyModeId,
} from './recoveryPointContainerHeader.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) =>
      rm(root, { force: true, recursive: true }),
    ),
  );
});

describe('recovery point container', () => {
  it('round-trips an AES-256-GCM payload with an authenticated header', async () => {
    const root = await createRoot();
    const containerPath = join(root, 'point.ekyrecovery');
    const payloadPath = join(root, 'payload');
    const dataKey = Buffer.alloc(recoveryPointDataKeyLength, 0x42);
    const payload = Buffer.from('synthetic profile payload', 'utf8');
    const nonce = Buffer.alloc(12, 0x24);

    const encrypted = await encryptRecoveryPointPayload({
      dataKey,
      destinationPath: containerPath,
      nonce,
      plaintext: toChunks(payload),
      plaintextLength: BigInt(payload.byteLength),
    });
    const container = await readFile(containerPath);

    expect(
      container.subarray(0, 8).toString('ascii'),
    ).toBe('EKYRCV01');
    expect(encrypted.byteLength).toBe(
      BigInt(
        recoveryPointContainerHeaderLength +
          payload.byteLength +
          recoveryPointAuthenticationTagLength,
      ),
    );
    await decryptRecoveryPointPayload({
      containerPath,
      dataKey,
      quarantinePath: payloadPath,
    });
    await expect(readFile(payloadPath)).resolves.toEqual(payload);
  });

  it.each([
    ['header', 9],
    ['ciphertext', recoveryPointContainerHeaderLength],
    ['authentication tag', -1],
  ])(
    'rejects a modified %s without leaving plaintext',
    async (_part, requestedOffset) => {
      const root = await createRoot();
      const containerPath = join(root, 'point.ekyrecovery');
      const payloadPath = join(root, 'payload');
      const dataKey = randomBytes(recoveryPointDataKeyLength);
      const payload = Buffer.from('confidential synthetic data');
      await encryptRecoveryPointPayload({
        dataKey,
        destinationPath: containerPath,
        plaintext: toChunks(payload),
        plaintextLength: BigInt(payload.byteLength),
      });
      const tampered = await readFile(containerPath);
      const offset =
        requestedOffset < 0
          ? tampered.byteLength + requestedOffset
          : requestedOffset;
      tampered[offset] = (tampered[offset] ?? 0) ^ 0x01;
      await rm(containerPath);
      await writeFile(containerPath, tampered, { mode: 0o400 });

      await expect(
        decryptRecoveryPointPayload({
          containerPath,
          dataKey,
          quarantinePath: payloadPath,
        }),
      ).rejects.toThrow();
      await expect(readFile(payloadPath)).rejects.toMatchObject({
        code: 'ENOENT',
      });
    },
  );

  it('rejects a wrong key and trailing data', async () => {
    const root = await createRoot();
    const containerPath = join(root, 'point.ekyrecovery');
    const payloadPath = join(root, 'payload');
    const dataKey = randomBytes(recoveryPointDataKeyLength);
    const payload = Buffer.from('synthetic profile payload');
    await encryptRecoveryPointPayload({
      dataKey,
      destinationPath: containerPath,
      plaintext: toChunks(payload),
      plaintextLength: BigInt(payload.byteLength),
    });

    await expect(
      decryptRecoveryPointPayload({
        containerPath,
        dataKey: randomBytes(recoveryPointDataKeyLength),
        quarantinePath: payloadPath,
      }),
    ).rejects.toThrow('RECOVERY_POINT_AUTHENTICATION_FAILED');

    const container = await readFile(containerPath);
    await rm(containerPath);
    await writeFile(
      containerPath,
      Buffer.concat([container, Buffer.from([0])]),
      { mode: 0o400 },
    );
    await expect(
      decryptRecoveryPointPayload({
        containerPath,
        dataKey,
        quarantinePath: payloadPath,
      }),
    ).rejects.toThrow('RECOVERY_POINT_LENGTH_INVALID');
  });

  it('rejects unsupported header values and non-zero reserved bytes', () => {
    const canonical = encodeRecoveryPointContainerHeader({
      cipherProfileId: recoveryPointCipherProfileId,
      ciphertextLength: 100n,
      containerVersion: recoveryPointContainerVersion,
      keyModeId: recoveryPointKeyModeId,
      nonce: Buffer.alloc(12),
    });
    const unsupported = Buffer.from(canonical);
    unsupported.writeUInt16BE(2, 14);
    expect(() =>
      decodeRecoveryPointContainerHeader(unsupported),
    ).toThrow('RECOVERY_POINT_HEADER_INVALID');

    const reserved = Buffer.from(canonical);
    reserved[reserved.byteLength - 1] = 1;
    expect(() =>
      decodeRecoveryPointContainerHeader(reserved),
    ).toThrow('RECOVERY_POINT_HEADER_INVALID');
  });
});

async function createRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'eky-recovery-crypto-'));
  roots.push(root);
  return root;
}

async function* toChunks(payload: Buffer): AsyncGenerator<Buffer> {
  yield payload.subarray(0, Math.max(1, payload.byteLength - 3));
  yield payload.subarray(Math.max(1, payload.byteLength - 3));
}
