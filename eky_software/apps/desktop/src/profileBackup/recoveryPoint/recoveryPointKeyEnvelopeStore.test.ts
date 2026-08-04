import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  RecoveryPointKeyEnvelopeError,
  RecoveryPointKeyEnvelopeStore,
} from './recoveryPointKeyEnvelopeStore.js';

const roots: string[] = [];
const artifactId = '11111111-1111-4111-8111-111111111111';

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) =>
      rm(root, { force: true, recursive: true }),
    ),
  );
});

describe('recovery point key envelope store', () => {
  it('writes and reads only the protected data key envelope', async () => {
    const fixture = await createFixture();
    const encryptedDataKey = Uint8Array.from([1, 2, 3, 4]);

    await fixture.store.write(encryptedDataKey);

    await expect(fixture.store.read()).resolves.toEqual(
      encryptedDataKey,
    );
    const envelope = JSON.parse(
      await readFile(fixture.filePath, 'utf8'),
    ) as Record<string, unknown>;
    expect(envelope).toEqual({
      artifactId,
      encryptedDataKey: 'AQIDBA==',
      formatVersion: 1,
    });
  });

  it('restores a valid backup slot when the current slot is missing', async () => {
    const fixture = await createFixture();
    const encryptedDataKey = Uint8Array.from([5, 6, 7, 8]);
    await fixture.store.write(encryptedDataKey);
    await writeFile(
      `${fixture.filePath}.backup`,
      await readFile(fixture.filePath),
    );
    await rm(fixture.filePath);

    await expect(fixture.store.read()).resolves.toEqual(
      encryptedDataKey,
    );
    await expect(readFile(fixture.filePath, 'utf8')).resolves.toContain(
      '"formatVersion":1',
    );
  });

  it.each([
    ['null', 'null'],
    [
      'unknown property',
      JSON.stringify({
        artifactId,
        encryptedDataKey: 'AQIDBA==',
        formatVersion: 1,
        unknown: true,
      }),
    ],
    [
      'wrong artifact',
      JSON.stringify({
        artifactId: '22222222-2222-4222-8222-222222222222',
        encryptedDataKey: 'AQIDBA==',
        formatVersion: 1,
      }),
    ],
    [
      'non-canonical base64',
      JSON.stringify({
        artifactId,
        encryptedDataKey: 'AQIDBA',
        formatVersion: 1,
      }),
    ],
  ])('rejects a strict-schema violation: %s', async (_, contents) => {
    const fixture = await createFixture();
    await writeFile(fixture.filePath, contents);

    await expect(fixture.store.read()).rejects.toEqual(
      expect.objectContaining<Partial<RecoveryPointKeyEnvelopeError>>({
        code: 'RECOVERY_POINT_KEY_ENVELOPE_INVALID',
      }),
    );
  });

  it('removes the current, next and backup slots together', async () => {
    const fixture = await createFixture();
    const envelope = JSON.stringify({
      artifactId,
      encryptedDataKey: 'AQIDBA==',
      formatVersion: 1,
    });
    await Promise.all([
      writeFile(fixture.filePath, envelope),
      writeFile(`${fixture.filePath}.next`, envelope),
      writeFile(`${fixture.filePath}.backup`, envelope),
    ]);

    await fixture.store.remove();

    await expect(fixture.store.read()).rejects.toEqual(
      expect.objectContaining<Partial<RecoveryPointKeyEnvelopeError>>({
        code: 'RECOVERY_POINT_KEY_ENVELOPE_INVALID',
      }),
    );
  });
});

async function createFixture() {
  const root = await mkdtemp(join(tmpdir(), 'eky-recovery-key-'));
  roots.push(root);
  const directoryPath = join(root, 'keys');
  await mkdir(directoryPath, { mode: 0o700, recursive: true });
  const filePath = join(directoryPath, `${artifactId}.key.json`);

  return {
    filePath,
    store: new RecoveryPointKeyEnvelopeStore(artifactId, filePath),
  };
}
