import { mkdtemp, open, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { probeInvoicePdfArchiveDirectory } from './invoicePdfArchiveDirectoryProbe.js';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) =>
      rm(root, { force: true, recursive: true }),
    ),
  );
});

describe('probeInvoicePdfArchiveDirectory', () => {
  it('accepts a directory supporting the real hard-link finalization path', async () => {
    const root = await createRoot();

    await expect(
      probeInvoicePdfArchiveDirectory(root),
    ).resolves.toBeUndefined();
    await expect(readdir(root)).resolves.toEqual([]);
  });

  it('rejects a target without hard-link support and removes the probe file', async () => {
    const root = await createRoot();

    await expect(
      probeInvoicePdfArchiveDirectory(root, {
        link: vi.fn(async () => {
          throw createFileSystemError('EPERM');
        }),
      }),
    ).rejects.toMatchObject({
      code: 'ARCHIVE_DIRECTORY_UNSUPPORTED',
      retryable: false,
    });
    await expect(readdir(root)).resolves.toEqual([]);
  });

  it('rejects a read-only target without leaving probe files', async () => {
    const root = await createRoot();

    await expect(
      probeInvoicePdfArchiveDirectory(root, {
        open: vi.fn(async () => {
          throw createFileSystemError('EACCES');
        }),
      }),
    ).rejects.toMatchObject({
      code: 'ARCHIVE_DIRECTORY_UNSUPPORTED',
    });
    await expect(readdir(root)).resolves.toEqual([]);
  });

  it('rejects a target disappearing after validation', async () => {
    const root = await createRoot();

    await expect(
      probeInvoicePdfArchiveDirectory(root, {
        open: vi.fn(async (path, flags, mode) => {
          await rm(root, { force: true, recursive: true });
          return open(path, flags, mode);
        }),
      }),
    ).rejects.toMatchObject({
      code: 'ARCHIVE_DIRECTORY_UNSUPPORTED',
    });
  });
});

async function createRoot(): Promise<string> {
  const root = await mkdtemp(
    join(tmpdir(), 'eky-invoice-pdf-archive-probe-'),
  );
  temporaryRoots.push(root);
  return root;
}

function createFileSystemError(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(code), { code });
}
