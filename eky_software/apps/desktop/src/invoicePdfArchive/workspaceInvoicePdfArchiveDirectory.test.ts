import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { validateWorkspaceId } from '../workspaces/registry/workspaceIdValidation.js';
import { createWorkspaceInvoicePdfArchiveDirectoryResolver } from './workspaceInvoicePdfArchiveDirectory.js';

const firstWorkspaceId = validateWorkspaceId(
  '11111111-1111-4111-8111-111111111111',
);
const secondWorkspaceId = validateWorkspaceId(
  '22222222-2222-4222-8222-222222222222',
);
const cleanupRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    cleanupRoots.splice(0).map((root) =>
      rm(root, { force: true, recursive: true }),
    ),
  );
});

describe('workspace invoice PDF archive directory', () => {
  it('derives separate direct children for workspaces sharing one archive root', async () => {
    const archiveRoot = await createArchiveRoot();
    const first = await createWorkspaceInvoicePdfArchiveDirectoryResolver(
      firstWorkspaceId,
    )(archiveRoot);
    const second = await createWorkspaceInvoicePdfArchiveDirectoryResolver(
      secondWorkspaceId,
    )(archiveRoot);

    await writeFile(join(first, 'Lasku-1.pdf'), 'first');
    await writeFile(join(second, 'Lasku-1.pdf'), 'second');

    await expect(readFile(join(first, 'Lasku-1.pdf'), 'utf8')).resolves.toBe(
      'first',
    );
    await expect(readFile(join(second, 'Lasku-1.pdf'), 'utf8')).resolves.toBe(
      'second',
    );
    expect(first).not.toBe(second);
  });

  it('rejects a non-directory workspace slot without replacing it', async () => {
    const archiveRoot = await createArchiveRoot();
    const occupiedPath = join(archiveRoot, firstWorkspaceId);
    await writeFile(occupiedPath, 'occupied');

    await expect(
      createWorkspaceInvoicePdfArchiveDirectoryResolver(firstWorkspaceId)(
        archiveRoot,
      ),
    ).rejects.toMatchObject({
      code: 'ARCHIVE_DIRECTORY_UNAVAILABLE',
    });
    await expect(readFile(occupiedPath, 'utf8')).resolves.toBe('occupied');
  });
});

async function createArchiveRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'eky-workspace-pdf-archive-'));
  cleanupRoots.push(root);
  if (process.platform !== 'win32') await chmod(root, 0o700);
  const archiveRoot = join(root, 'archive');
  await mkdir(archiveRoot, { mode: 0o700 });
  if (process.platform !== 'win32') await chmod(archiveRoot, 0o700);
  return archiveRoot;
}
