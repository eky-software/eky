import {
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
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
    await expect(readAndConfirm(store)).resolves.toEqual(
      Uint8Array.from(Buffer.from('ciphertext-one', 'utf8')),
    );
    await store.write(Buffer.from('ciphertext-two', 'utf8'));
    await expect(readAndConfirm(store)).resolves.toEqual(
      Uint8Array.from(Buffer.from('ciphertext-two', 'utf8')),
    );

    const contents = await readFile(filePath, 'utf8');
    expect(contents).toContain('"formatVersion":1');
    expect(contents).not.toContain('synthetic-plaintext-secret');
  });

  it('returns null for a missing file and removes idempotently', async () => {
    const { store } = await createStore();

    await expect(readAndConfirm(store)).resolves.toBeNull();
    await expect(store.remove()).resolves.toBeUndefined();
  });

  it('rejects corrupt and unknown envelope versions without overwriting them', async () => {
    const { filePath, store } = await createStore();
    const corruptEnvelope = '{"formatVersion":2,"ciphertext":"YQ=="}\n';

    await writeFile(filePath, corruptEnvelope, 'utf8');
    await expect(store.readCandidate()).rejects.toEqual(
      expect.objectContaining({ code: 'SECRET_PAYLOAD_INVALID' }),
    );
    await expect(readFile(filePath, 'utf8')).resolves.toBe(corruptEnvelope);
  });

  it('rejects a non-regular secret slot', async () => {
    const { filePath, store } = await createStore();

    await mkdir(filePath);

    await expect(store.readCandidate()).rejects.toEqual(
      expect.objectContaining({ code: 'SECRET_PAYLOAD_INVALID' }),
    );
  });

  it('keeps a valid current value and removes interrupted replacement files', async () => {
    const { filePath, store } = await createStore();

    await store.write(Buffer.from('current', 'utf8'));
    const envelope = await readFile(filePath, 'utf8');
    await writeFile(`${filePath}.next`, envelope, 'utf8');
    await writeFile(`${filePath}.backup`, envelope, 'utf8');

    const candidate = await store.readCandidate();
    expect(candidate).toMatchObject({ slot: 'current' });
    await expect(stat(`${filePath}.next`)).resolves.toBeDefined();
    await expect(stat(`${filePath}.backup`)).resolves.toBeDefined();
    await store.confirm(requireCandidate(candidate));
    await expectFileToBeMissing(`${filePath}.next`);
    await expectFileToBeMissing(`${filePath}.backup`);
  });

  it('restores a valid backup when replacement was interrupted after moving current', async () => {
    const { filePath, store } = await createStore();

    await store.write(Buffer.from('previous', 'utf8'));
    const previousEnvelope = await readFile(filePath, 'utf8');
    await store.write(Buffer.from('next-value', 'utf8'));
    const nextEnvelope = await readFile(filePath, 'utf8');
    await rm(filePath);
    await writeFile(`${filePath}.backup`, previousEnvelope, 'utf8');
    await writeFile(`${filePath}.next`, nextEnvelope, 'utf8');

    await expect(readAndConfirm(store)).resolves.toEqual(bytes('previous'));
    await expect(readFile(filePath, 'utf8')).resolves.toContain('cHJldmlvdXM=');
    await expectFileToBeMissing(`${filePath}.next`);
    await expectFileToBeMissing(`${filePath}.backup`);
  });

  it('promotes a valid next file when the first write was interrupted', async () => {
    const { filePath, store } = await createStore();

    await store.write(Buffer.from('first-value', 'utf8'));
    await rename(filePath, `${filePath}.next`);

    await expect(readAndConfirm(store)).resolves.toEqual(bytes('first-value'));
    await expectFileToBeMissing(`${filePath}.next`);
  });

  it('does not replace a corrupt current file with a valid backup', async () => {
    const { filePath, store } = await createStore();

    await store.write(Buffer.from('backup-value', 'utf8'));
    await rename(filePath, `${filePath}.backup`);
    await writeFile(filePath, '{"corrupt":true}\n', 'utf8');

    await expect(store.readCandidate()).rejects.toEqual(
      expect.objectContaining({ code: 'SECRET_PAYLOAD_INVALID' }),
    );
    await expect(readFile(filePath, 'utf8')).resolves.toBe('{"corrupt":true}\n');
    await expect(stat(`${filePath}.backup`)).resolves.toBeDefined();
  });

  it('removes current, next, and backup slots idempotently', async () => {
    const { filePath, store } = await createStore();

    await store.write(Buffer.from('current', 'utf8'));
    const envelope = await readFile(filePath, 'utf8');
    await writeFile(`${filePath}.next`, envelope, 'utf8');
    await writeFile(`${filePath}.backup`, envelope, 'utf8');

    await expect(store.remove()).resolves.toBeUndefined();
    await expect(store.remove()).resolves.toBeUndefined();
    await expectFileToBeMissing(filePath);
    await expectFileToBeMissing(`${filePath}.next`);
    await expectFileToBeMissing(`${filePath}.backup`);
  });
});

function bytes(value: string): Uint8Array {
  return Uint8Array.from(Buffer.from(value, 'utf8'));
}

async function readAndConfirm(
  store: EncryptedSecretFile,
): Promise<Uint8Array | null> {
  const candidate = await store.readCandidate();

  if (candidate === null) {
    return null;
  }

  const ciphertext = Uint8Array.from(candidate.ciphertext);
  await store.confirm(candidate);

  return ciphertext;
}

function requireCandidate<T>(candidate: T | null): T {
  if (candidate === null) {
    throw new Error('Expected a synthetic encrypted secret candidate.');
  }

  return candidate;
}

async function expectFileToBeMissing(filePath: string): Promise<void> {
  await expect(stat(filePath)).rejects.toMatchObject({ code: 'ENOENT' });
}

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
