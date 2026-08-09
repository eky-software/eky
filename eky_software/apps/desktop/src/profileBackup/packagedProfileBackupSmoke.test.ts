import { createHash } from 'node:crypto';
import {
  mkdir,
  mkdtemp,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  assertPackagedRestoreSecretContinuity,
  assertPackagedRestoreSessionChanged,
  verifyPackagedRestoredDatabaseBeforeBackend,
} from './packagedProfileBackupSmoke.js';

describe('packaged profile backup smoke', () => {
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(
      temporaryDirectories
        .splice(0)
        .map((directory) =>
          rm(directory, { force: true, recursive: true }),
        ),
    );
  });

  it('verifies the exact restored database before a fresh backend session opens it', async () => {
    const fixture = await createFixture(Buffer.from('sqlite snapshot'));

    await expect(
      verifyPackagedRestoredDatabaseBeforeBackend(fixture),
    ).resolves.toBeUndefined();
  });

  it('RESTORE-SESSION-001 @security requires a fresh runtime identity after restore', () => {
    expect(() =>
      assertPackagedRestoreSessionChanged(
        'original-runtime',
        'restored-runtime',
        'a'.repeat(64),
        'b'.repeat(64),
      ),
    ).not.toThrow();
    expect(() =>
      assertPackagedRestoreSessionChanged(
        'same-runtime',
        'same-runtime',
        'a'.repeat(64),
        'b'.repeat(64),
      ),
    ).toThrow('DESKTOP_SMOKE_RESTORE_SESSION_FAILED');
    expect(() =>
      assertPackagedRestoreSessionChanged(
        'original-runtime',
        'restored-runtime',
        'a'.repeat(64),
        'a'.repeat(64),
      ),
    ).toThrow('DESKTOP_SMOKE_RESTORE_SESSION_FAILED');
  });

  it('RESTORE-SECRET-001 @security requires the machine-local secret to survive outside the portable backup', () => {
    expect(() =>
      assertPackagedRestoreSecretContinuity(true),
    ).not.toThrow();
    expect(() =>
      assertPackagedRestoreSecretContinuity(false),
    ).toThrow('DESKTOP_SMOKE_RESTORE_SECRET_FAILED');
  });

  it('rejects a restored database whose bytes differ from the backup', async () => {
    const fixture = await createFixture(Buffer.from('sqlite snapshot'));
    await writeFile(
      fixture.activeDatabasePath,
      Buffer.from('changed sqlite'),
    );

    await expect(
      verifyPackagedRestoredDatabaseBeforeBackend(fixture),
    ).rejects.toThrow(
      'DESKTOP_SMOKE_RESTORE_DATABASE_COMPARISON_FAILED',
    );
  });

  async function createFixture(database: Buffer): Promise<{
    activeDatabasePath: string;
    smokeRoot: string;
  }> {
    const root = await mkdtemp(
      join(tmpdir(), 'eky-packaged-profile-smoke-'),
    );
    temporaryDirectories.push(root);
    const activeDatabasePath = join(root, 'runtime', 'data', 'eky.sqlite');
    const smokeRoot = join(root, 'smoke');
    const statePath = join(
      smokeRoot,
      'profile-backup',
      'restore-smoke-state-v1.json',
    );
    await Promise.all([
      mkdir(dirname(activeDatabasePath), { recursive: true }),
      mkdir(dirname(statePath), { recursive: true }),
    ]);
    await writeFile(activeDatabasePath, database);
    await writeFile(
      statePath,
      `${JSON.stringify({
        expectedEntries: [
          {
            contentLength: String(database.byteLength),
            logicalPath: 'profile.sqlite',
            sha256: createHash('sha256').update(database).digest('hex'),
            type: 'database',
          },
        ],
        formatVersion: 1,
        originalRuntimeInstanceId: 'synthetic-runtime-id',
        originalRuntimeSessionSha256: 'a'.repeat(64),
      })}\n`,
      'utf8',
    );
    return { activeDatabasePath, smokeRoot };
  }
});
