import { constants } from 'node:fs';
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
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
  it('publishes the encrypted artifact with the default file operations', async () => {
    const root = await createRoot();
    const sourcePath = join(root, 'backup.partial');
    const destinationPath = join(root, 'backup.ekybackup');
    await writeFile(sourcePath, 'encrypted backup');

    await finalizePortableProfileBackup(sourcePath, destinationPath);

    await expect(readFile(destinationPath, 'utf8')).resolves.toBe(
      'encrypted backup',
    );
  });

  it('copies the encrypted artifact when hard links are unavailable', async () => {
    const root = await createRoot();
    const sourcePath = join(root, 'backup.partial');
    const destinationPath = join(root, 'backup.ekybackup');
    await writeFile(sourcePath, 'encrypted backup');

    await finalizePortableProfileBackup(sourcePath, destinationPath, {
      copyWithoutOverwrite: async (source, destination) => {
        await copyFile(source, destination, constants.COPYFILE_EXCL);
      },
      linkWithoutOverwrite: async () => {
        throw createNodeError('EPERM');
      },
      protectReadOnly: async () => undefined,
      remove: async (path) => {
        await rm(path, { force: true });
      },
      setWritable: async () => undefined,
      sync: async () => undefined,
    });

    await expect(readFile(destinationPath, 'utf8')).resolves.toBe(
      'encrypted backup',
    );
  });

  it('publishes a complete artifact through a no-overwrite hard link when supported', async () => {
    const calls: string[] = [];

    await finalizePortableProfileBackup('source', 'destination', {
      copyWithoutOverwrite: vi.fn(async () => {
        calls.push('copy');
      }),
      linkWithoutOverwrite: vi.fn(async () => {
        calls.push('link');
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

    expect(calls).toEqual(['link', 'protect']);
  });

  it('syncs a copied read-only artifact before restoring its protection', async () => {
    const calls: string[] = [];

    await finalizePortableProfileBackup('source', 'destination', {
      copyWithoutOverwrite: vi.fn(async () => {
        calls.push('copy');
      }),
      linkWithoutOverwrite: vi.fn(async () => {
        calls.push('link');
        throw createNodeError('EPERM');
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

    expect(calls).toEqual([
      'link',
      'copy',
      'writable',
      'sync',
      'protect',
    ]);
  });

  it('never overwrites or removes an existing destination', async () => {
    const root = await createRoot();
    const sourcePath = join(root, 'backup.partial');
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
        linkWithoutOverwrite: vi.fn(async () => {
          throw createNodeError('EPERM');
        }),
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

  it.each(['link', 'copy', 'writable', 'sync', 'protect'] as const)(
    'keeps the source and removes only a destination created before a controlled %s interruption',
    async (failingPhase) => {
      let destinationCreated = false;
      const remove = vi.fn(async () => undefined);
      const fail = (phase: typeof failingPhase) => {
        if (phase === failingPhase) {
          throw createNodeError(phase === 'link' ? 'EIO' : 'ENOSPC');
        }
      };

      await expect(
        finalizePortableProfileBackup('source', 'destination', {
          copyWithoutOverwrite: vi.fn(async () => {
            fail('copy');
            destinationCreated = true;
          }),
          linkWithoutOverwrite: vi.fn(async () => {
            if (failingPhase === 'link') {
              fail('link');
            }
            throw createNodeError('EPERM');
          }),
          protectReadOnly: vi.fn(async () => {
            fail('protect');
          }),
          remove,
          setWritable: vi.fn(async () => {
            fail('writable');
          }),
          sync: vi.fn(async () => {
            fail('sync');
          }),
        }),
      ).rejects.toEqual(new PortableBackupFinalizationError('writeFailed'));

      expect(remove).toHaveBeenCalledTimes(destinationCreated ? 1 : 0);
    },
  );

  it('does not fall back to copying or remove a destination that appears before publication', async () => {
    const copyWithoutOverwrite = vi.fn(async () => undefined);
    const remove = vi.fn(async () => undefined);

    await expect(
      finalizePortableProfileBackup('source', 'destination', {
        copyWithoutOverwrite,
        linkWithoutOverwrite: vi.fn(async () => {
          throw createNodeError('EEXIST');
        }),
        protectReadOnly: vi.fn(async () => undefined),
        remove,
        setWritable: vi.fn(async () => undefined),
        sync: vi.fn(async () => undefined),
      }),
    ).rejects.toEqual(
      new PortableBackupFinalizationError('destinationExists'),
    );
    expect(copyWithoutOverwrite).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });

  it('removes a hard-linked destination if its final protection fails', async () => {
    const remove = vi.fn(async () => undefined);

    await expect(
      finalizePortableProfileBackup('source', 'destination', {
        copyWithoutOverwrite: vi.fn(async () => undefined),
        linkWithoutOverwrite: vi.fn(async () => undefined),
        protectReadOnly: vi.fn(async () => {
          throw createNodeError('EIO');
        }),
        remove,
        setWritable: vi.fn(async () => undefined),
        sync: vi.fn(async () => undefined),
      }),
    ).rejects.toEqual(new PortableBackupFinalizationError('writeFailed'));
    expect(remove).toHaveBeenCalledWith('destination');
  });
});

function createNodeError(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(code), { code });
}

async function createRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'eky-backup-finalize-'));
  roots.push(root);
  await mkdir(root, { recursive: true });
  return root;
}
