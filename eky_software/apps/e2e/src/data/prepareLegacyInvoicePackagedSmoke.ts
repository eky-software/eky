import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { copyFile, lstat, mkdir, readFile, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { createLegacyInvoiceBackup } from './createLegacyInvoiceBackup.js';

// Only fixed, closed synthetic inputs cross into the packaged smoke root.
// No registry, accepted-build metadata, session or migrated database is seeded.
export async function prepareLegacyInvoicePackagedSmoke(input: {
  readonly runRoot: string;
  readonly userDataPath: string;
  readonly password: string;
  readonly smokeToken: string;
}) {
  if (process.env.EKY_E2E !== '1' || !/^[a-f0-9]{32}$/.test(input.smokeToken)) {
    throw new Error('LEGACY_PACKAGED_SMOKE_ADMISSION_FAILED');
  }
  const smokeBase = join(await realpath(tmpdir()), 'eky-desktop-smoke');
  await mkdir(smokeBase, { recursive: true, mode: 0o700 });
  await requireDirectory(smokeBase);
  const smokeRoot = join(smokeBase, input.smokeToken);
  // Reserve exclusively before preparing input; a duplicate must not overwrite
  // another attempt or delete its evidence. Failed preparation is retained.
  await mkdir(smokeRoot, { mode: 0o700 });
  const fixture = await createLegacyInvoiceBackup(input);
  const files = [
    ['runtime/data/eky.sqlite', 'user-data/runtime/data/eky.sqlite'],
    ['runtime/storage/invoices/legacy/original.pdf', 'user-data/runtime/storage/invoices/legacy/original.pdf'],
    ['legacy-invoice.ekybackup', 'legacy-input/original.ekybackup'],
  ] as const;
  const copied = [];
  for (const [sourceRelativePath, targetRelativePath] of files) {
    let sourceParent = input.userDataPath;
    for (const segment of dirname(sourceRelativePath).split('/')) {
      if (segment === '.') continue;
      sourceParent = join(sourceParent, segment);
      await requireDirectory(sourceParent);
    }
    const sourcePath = join(input.userDataPath, sourceRelativePath);
    const targetPath = join(smokeRoot, targetRelativePath);
    const before = await inspectFile(sourcePath);
    await mkdir(dirname(targetPath), { recursive: true, mode: 0o700 });
    await copyFile(sourcePath, targetPath, constants.COPYFILE_EXCL);
    const sourceAfter = await inspectFile(sourcePath);
    const destination = await inspectFile(targetPath);
    if (before.sha256 !== sourceAfter.sha256 || before.size !== sourceAfter.size ||
        before.sha256 !== destination.sha256 || before.size !== destination.size) {
      throw new Error('LEGACY_PACKAGED_SMOKE_COPY_MISMATCH');
    }
    copied.push(Object.freeze({ relativePath: targetRelativePath, ...destination }));
  }
  return Object.freeze({
    fixture,
    smokeRoot,
    files: Object.freeze(copied),
  });
}

async function requireDirectory(path: string): Promise<void> {
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new Error('LEGACY_PACKAGED_SMOKE_PATH_INVALID');
  }
}

async function inspectFile(path: string): Promise<Readonly<{ sha256: string; size: number }>> {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size === 0) {
    throw new Error('LEGACY_PACKAGED_SMOKE_FILE_INVALID');
  }
  const bytes = await readFile(path);
  if (bytes.length !== info.size) throw new Error('LEGACY_PACKAGED_SMOKE_COPY_MISMATCH');
  return Object.freeze({ sha256: createHash('sha256').update(bytes).digest('hex'), size: bytes.length });
}
