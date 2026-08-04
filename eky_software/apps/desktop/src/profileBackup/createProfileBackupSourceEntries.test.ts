import { link, mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createProfileBackupSourceEntries } from './createProfileBackupSourceEntries.js';

const roots: string[] = [];

afterEach(async () => {
  const { rm } = await import('node:fs/promises');
  await Promise.all(
    roots.splice(0).map((root) =>
      rm(root, { force: true, recursive: true }),
    ),
  );
});

describe('profile backup source entries', () => {
  it('accepts only the exact snapshot database, catalog and hashed PDF layout', async () => {
    const root = await createSnapshotRoot();
    const pdfDirectory = join(
      root,
      'artifacts',
      'invoicing',
      'invoice-documents',
    );
    const pdfName = `${'a'.repeat(64)}.pdf`;
    await mkdir(pdfDirectory, { recursive: true });
    await writeFile(join(pdfDirectory, pdfName), '%PDF-1.7\nsynthetic');

    const entries = await createProfileBackupSourceEntries(root);

    expect(entries.map(({ logicalPath, type }) => ({
      logicalPath,
      type,
    }))).toEqual([
      {
        logicalPath:
          `artifacts/invoicing/invoice-documents/${pdfName}`,
        type: 'businessArtifact',
      },
      {
        logicalPath: 'profile.sqlite',
        type: 'database',
      },
      {
        logicalPath: 'snapshot-catalog-v1.json',
        type: 'artifactCatalog',
      },
    ]);
    expect(entries.every(({ sha256 }) => /^[a-f0-9]{64}$/.test(sha256)))
      .toBe(true);
  });

  it.each([
    'company-email-secret.dat',
    'operational-log.jsonl',
    'invoice-pdf-archive-config.json',
  ])(
    'BACKUP-PRIVACY-001 @security rejects non-business runtime file %s instead of silently including it',
    async (fileName) => {
      const root = await createSnapshotRoot();
      await writeFile(
        join(root, fileName),
        'synthetic private runtime data that must never be included',
      );

      await expect(
        createProfileBackupSourceEntries(root),
      ).rejects.toThrow('PROFILE_BACKUP_SOURCE_INVALID');
    },
  );

  it.runIf(process.platform !== 'win32')(
    'rejects symbolic links and hard-linked files',
    async () => {
      const symlinkRoot = await createSnapshotRoot();
      await symlink(
        join(symlinkRoot, 'profile.sqlite'),
        join(symlinkRoot, 'linked.sqlite'),
      );

      await expect(
        createProfileBackupSourceEntries(symlinkRoot),
      ).rejects.toThrow('PROFILE_BACKUP_SOURCE_INVALID');

      const hardLinkRoot = await createSnapshotRoot();
      await link(
        join(hardLinkRoot, 'profile.sqlite'),
        join(hardLinkRoot, 'profile-copy.sqlite'),
      );

      await expect(
        createProfileBackupSourceEntries(hardLinkRoot),
      ).rejects.toThrow('PROFILE_BACKUP_SOURCE_INVALID');
    },
  );
});

async function createSnapshotRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'eky-backup-source-'));
  roots.push(root);
  await writeFile(join(root, 'profile.sqlite'), 'synthetic sqlite');
  await writeFile(
    join(root, 'snapshot-catalog-v1.json'),
    '{"artifacts":[]}',
  );
  return root;
}
