import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { EncryptedSecretFile } from './encryptedSecretFile.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true }),
    ),
  );
});

describe('EncryptedSecretFile', () => {
  it('writes and replaces only a versioned ciphertext envelope', async () => {
    const { filePath, store } = await createStore();

    await store.write(Buffer.from('ciphertext-one', 'utf8'));
    await expect(store.read()).resolves.toEqual(
      Uint8Array.from(Buffer.from('ciphertext-one', 'utf8')),
    );
    await store.write(Buffer.from('ciphertext-two', 'utf8'));
    await expect(store.read()).resolves.toEqual(
      Uint8Array.from(Buffer.from('ciphertext-two', 'utf8')),
    );

    const contents = await readFile(filePath, 'utf8');
    expect(contents).toContain('"formatVersion":1');
    expect(contents).not.toContain('synthetic-plaintext-secret');
  });

  it('returns null for a missing file and removes idempotently', async () => {
    const { store } = await createStore();

    await expect(store.read()).resolves.toBeNull();
    await expect(store.remove()).resolves.toBeUndefined();
  });

  it('rejects corrupt and unknown envelope versions without overwriting them', async () => {
    const { filePath, store } = await createStore();
    const corruptEnvelope = '{"formatVersion":2,"ciphertext":"YQ=="}\n';

    await writeFile(filePath, corruptEnvelope, 'utf8');
    await expect(store.read()).rejects.toEqual(
      expect.objectContaining({ code: 'SECRET_PAYLOAD_INVALID' }),
    );
    await expect(readFile(filePath, 'utf8')).resolves.toBe(corruptEnvelope);
  });

  it('rejects a non-regular secret slot', async () => {
    const { filePath, store } = await createStore();

    await mkdir(filePath);

    await expect(store.read()).rejects.toEqual(
      expect.objectContaining({ code: 'SECRET_PAYLOAD_INVALID' }),
    );
  });
});

async function createStore(): Promise<{
  directory: string;
  filePath: string;
  store: EncryptedSecretFile;
}> {
  const directory = await mkdtemp(join(tmpdir(), 'eky-secret-file-'));
  const filePath = join(directory, 'company-email-smtp-v1.dat');
  temporaryDirectories.push(directory);

  return {
    directory,
    filePath,
    store: new EncryptedSecretFile(filePath),
  };
}
