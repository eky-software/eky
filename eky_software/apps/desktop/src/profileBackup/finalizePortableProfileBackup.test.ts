import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  finalizePortableProfileBackup,
  PortableBackupFinalizationError,
} from './finalizePortableProfileBackup.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) =>
      rm(root, { force: true, recursive: true }),
    ),
  );
});

describe('portable backup finalization', () => {
  it('copies the encrypted artifact without relying on hard links', async () => {
    const root = await createRoot();
    const sourcePath = join(root, 'backup.next');
    const destinationPath = join(root, 'backup.ekybackup');
    await writeFile(sourcePath, 'encrypted backup');

    await finalizePortableProfileBackup(sourcePath, destinationPath);

    await expect(readFile(destinationPath, 'utf8')).resolves.toBe(
      'encrypted backup',
    );
  });

  it('syncs a copied read-only artifact before restoring its protection', async () => {
    const calls: string[] = [];

    await finalizePortableProfileBackup('source', 'destination', {
      copyWithoutOverwrite: vi.fn(async () => {
        calls.push('copy');
      }),
      protectReadOnly: vi.fn(async () => {
        calls.push('protect');
      }),
      remove: vi.fn(async () => undefined),
      setWritable: vi.fn(async () => {
        calls.push('writable');
      }),
      sync: vi.fn(async () => {
        calls.push('sync');
      }),
    });

    expect(calls).toEqual(['copy', 'writable', 'sync', 'protect']);
  });

  it('never overwrites or removes an existing destination', async () => {
    const root = await createRoot();
    const sourcePath = join(root, 'backup.next');
    const destinationPath = join(root, 'backup.ekybackup');
    await writeFile(sourcePath, 'new backup');
    await writeFile(destinationPath, 'existing backup');

    await expect(
      finalizePortableProfileBackup(sourcePath, destinationPath),
    ).rejects.toEqual(
      new PortableBackupFinalizationError('destinationExists'),
    );
    await expect(readFile(destinationPath, 'utf8')).resolves.toBe(
      'existing backup',
    );
  });

  it('removes only the newly-created destination when durable sync fails', async () => {
    const copyWithoutOverwrite = vi.fn(async () => undefined);
    const remove = vi.fn(async () => undefined);

    await expect(
      finalizePortableProfileBackup('source', 'destination', {
        copyWithoutOverwrite,
        protectReadOnly: vi.fn(async () => undefined),
        remove,
        setWritable: vi.fn(async () => undefined),
        sync: vi.fn(async () => {
          throw new Error('synthetic sync failure');
        }),
      }),
    ).rejects.toEqual(new PortableBackupFinalizationError('writeFailed'));
    expect(remove).toHaveBeenCalledWith('destination');
  });
});

async function createRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'eky-backup-finalize-'));
  roots.push(root);
  await mkdir(root, { recursive: true });
  return root;
}
