import { randomBytes } from 'node:crypto';
import { promises as fileSystem } from 'node:fs';
import {
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

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

afterEach(async ({ task }) => {
  vi.restoreAllMocks();
  if (task.result?.state !== 'pass') { roots.splice(0); return; }
  await Promise.all(
    roots.splice(0).map((root) =>
      rm(root, { force: true, recursive: true }),
    ),
  );
});

describe('recovery point container', () => {
  it.each([
    ['destination', 'resolve'], ['destination', 'reject'],
    ['source', 'resolve'], ['source', 'reject'],
  ] as const)('joins the guarded %s close before failed quarantine cleanup: %s', async (target, outcome) => {
    const fixture = await createCloseFixture();
    const primary = new Error('SYNTHETIC_SYNC_FAILED');
    const closeError = new Error('SYNTHETIC_CLOSE_FAILED');
    const entered = deferred();
    const closing = deferred();
    const open = fileSystem.open.bind(fileSystem);
    const removals = vi.spyOn(fileSystem, 'rm');
    const assertCleanupCurrent = vi.fn(() => {});
    let closeCalls = 0;
    vi.spyOn(fileSystem, 'open').mockImplementation(async (...args) => {
      const handle = await open(...args);
      const destination = args[1] === 'wx';
      if (destination) vi.spyOn(handle, 'sync').mockRejectedValueOnce(primary);
      if ((target === 'destination') === destination) {
        const close = handle.close.bind(handle);
        vi.spyOn(handle, 'close').mockImplementation(async () => {
          closeCalls++;
          entered.resolve();
          await closing.promise;
          await close();
          if (outcome === 'reject') throw closeError;
        });
      }
      return handle;
    });
    let settled = false;
    const task = decryptRecoveryPointPayload({ ...fixture.input, assertCleanupCurrent })
      .catch((error: unknown) => error).finally(() => { settled = true; });
    try {
      await Promise.race([entered.promise, task.then(() => { throw new Error('CLOSE_NOT_REACHED'); })]);
      expect(settled).toBe(false);
      expect(removals).not.toHaveBeenCalled();
      expect(assertCleanupCurrent).not.toHaveBeenCalled();
      expect(await readFile(fixture.input.quarantinePath)).toEqual(fixture.payload);
    } finally { closing.resolve(); await task; }
    const error = await task;
    expect(closeCalls).toBe(1);
    if (outcome === 'reject') {
      expect(error).toMatchObject({ cleanupStatus: 'unverified', cause: { errors: [primary, closeError] } });
      expect(removals).not.toHaveBeenCalled();
      expect(await readFile(fixture.input.quarantinePath)).toEqual(fixture.payload);
    } else {
      expect(error).toBe(primary);
      expect(removals).toHaveBeenCalledExactlyOnceWith(fixture.input.quarantinePath, { force: true });
      await expect(readFile(fixture.input.quarantinePath)).rejects.toMatchObject({ code: 'ENOENT' });
    }
    expect(await readFile(fixture.input.containerPath)).toEqual(fixture.container);
  });

  it('does not retry a rejected guarded destination close after successful decryption', async () => {
    const fixture = await createCloseFixture();
    const closeError = new Error('SYNTHETIC_DESTINATION_CLOSE_FAILED');
    const open = fileSystem.open.bind(fileSystem);
    const removals = vi.spyOn(fileSystem, 'rm');
    let closeCalls = 0;
    vi.spyOn(fileSystem, 'open').mockImplementation(async (...args) => {
      const handle = await open(...args);
      if (args[1] === 'wx') {
        const close = handle.close.bind(handle);
        vi.spyOn(handle, 'close').mockImplementation(async () => {
          closeCalls++;
          await close();
          throw closeError;
        });
      }
      return handle;
    });
    await expect(decryptRecoveryPointPayload({ ...fixture.input, assertCleanupCurrent: () => {} }))
      .rejects.toMatchObject({ cleanupStatus: 'unverified', cause: closeError });
    expect(closeCalls).toBe(1);
    expect(removals).not.toHaveBeenCalled();
    expect(await readFile(fixture.input.quarantinePath)).toEqual(fixture.payload);
    expect(await readFile(fixture.input.containerPath)).toEqual(fixture.container);
  });

  it.each(['sync', 'async'])('preserves failed quarantine bytes with a denied %s cleanup callback', async mode => {
    const root = await createRoot();
    const containerPath = join(root, 'point.ekyrecovery');
    const quarantinePath = join(root, 'payload');
    const dataKey = Buffer.alloc(recoveryPointDataKeyLength, 0x31);
    const payload = Buffer.from('synthetic recovery evidence');
    await encryptRecoveryPointPayload({ dataKey, destinationPath: containerPath,
      plaintext: toChunks(payload), plaintextLength: BigInt(payload.byteLength) });
    const tampered = await readFile(containerPath);
    tampered[tampered.length - 1]! ^= 1;
    await rm(containerPath);
    await writeFile(containerPath, tampered, { mode: 0o400 });
    let checked = false;
    await expect(decryptRecoveryPointPayload({ containerPath, dataKey, quarantinePath,
      assertCleanupCurrent: mode === 'async'
        ? async () => { checked = true; throw new Error('SYNTHETIC_OWNER_LOST'); }
        : () => { checked = true; throw new Error('SYNTHETIC_OWNER_LOST'); },
    })).rejects.toThrow('RECOVERY_POINT_AUTHENTICATION_FAILED');
    expect(checked).toBe(true);
    expect(await readFile(quarantinePath)).toEqual(payload);
    expect(await readFile(containerPath)).toEqual(tampered);
  });

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

async function createCloseFixture() {
  const root = await createRoot();
  const containerPath = join(root, 'point.ekyrecovery');
  const quarantinePath = join(root, 'payload');
  const dataKey = Buffer.alloc(recoveryPointDataKeyLength, 0x31);
  const payload = Buffer.from('synthetic recovery evidence');
  await encryptRecoveryPointPayload({ dataKey, destinationPath: containerPath,
    plaintext: toChunks(payload), plaintextLength: BigInt(payload.byteLength) });
  const container = await readFile(containerPath);
  return { container, payload, input: { containerPath, dataKey, quarantinePath } };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(complete => { resolve = complete; });
  return { promise, resolve };
}

async function createRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'eky-recovery-crypto-'));
  roots.push(root);
  return root;
}

async function* toChunks(payload: Buffer): AsyncGenerator<Buffer> {
  yield payload.subarray(0, Math.max(1, payload.byteLength - 3));
  yield payload.subarray(Math.max(1, payload.byteLength - 3));
}
