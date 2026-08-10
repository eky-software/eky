import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  portableProfileBackupStatusFileName,
  PortableProfileBackupStatusStore,
} from './portableProfileBackupStatusStore.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) =>
      rm(root, { force: true, recursive: true }),
    ),
  );
});

describe('PortableProfileBackupStatusStore', () => {
  it('persists only safe validated-backup metadata across service restarts', async () => {
    const filePath = await createStatusPath();
    const record = {
      appVersion: '0.1.0-alpha.1',
      backupFormatVersion: 1 as const,
      completedAt: '2026-08-04T12:00:00.000Z',
      validationStatus: 'validated' as const,
    };

    await new PortableProfileBackupStatusStore(filePath).write(record);

    await expect(
      new PortableProfileBackupStatusStore(filePath).read(),
    ).resolves.toEqual(record);
  });

  it('fails closed for malformed or extended status data', async () => {
    const filePath = await createStatusPath();
    await writeFile(
      filePath,
      JSON.stringify({
        appVersion: '0.1.0-alpha.1',
        backupFormatVersion: 1,
        completedAt: '2026-08-04T12:00:00.000Z',
        destinationPath: 'D:/private/backup.ekybackup',
        formatVersion: 1,
        validationStatus: 'validated',
      }),
    );

    await expect(
      new PortableProfileBackupStatusStore(filePath).read(),
    ).rejects.toThrow('PROFILE_BACKUP_STATUS_INVALID');
  });

  it('recovers a valid backup slot after an interrupted replacement', async () => {
    const filePath = await createStatusPath();
    const storedStatus = {
      appVersion: '0.1.0-alpha.1',
      backupFormatVersion: 1,
      completedAt: '2026-08-04T12:00:00.000Z',
      formatVersion: 1,
      validationStatus: 'validated',
    } as const;
    await writeFile(`${filePath}.backup`, JSON.stringify(storedStatus));

    await expect(
      new PortableProfileBackupStatusStore(filePath).read(),
    ).resolves.toEqual({
      appVersion: storedStatus.appVersion,
      backupFormatVersion: storedStatus.backupFormatVersion,
      completedAt: storedStatus.completedAt,
      validationStatus: storedStatus.validationStatus,
    });
    await expect(readFile(filePath, 'utf8')).resolves.toBe(
      JSON.stringify(storedStatus),
    );
  });
});

async function createStatusPath(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'eky-backup-status-'));
  roots.push(root);
  return join(root, portableProfileBackupStatusFileName);
}
