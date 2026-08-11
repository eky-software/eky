import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  assertLocalUpdateSourceUnchanged,
  copyLocalUpdatePackageWithHash,
  hashLocalUpdateFile,
  readLocalUpdateSourceSnapshot,
} from './localUpdateFileOperations.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true })));
});

describe('local update file operations', () => {
  it('copies with exclusive creation, fsync-compatible bytes and SHA-256', async () => {
    const root = await createRoot();
    const source = join(root, 'source.msi');
    const destination = join(root, 'destination.msi');
    const bytes = Buffer.from('synthetic installer bytes', 'utf8');
    await writeFile(source, bytes);
    const identity = await copyLocalUpdatePackageWithHash(source, destination);
    expect(identity).toEqual({
      sha256: createHash('sha256').update(bytes).digest('hex'),
      size: bytes.length,
    });
    await expect(readFile(destination)).resolves.toEqual(bytes);
    await expect(
      copyLocalUpdatePackageWithHash(source, destination),
    ).rejects.toMatchObject({ code: 'EEXIST' });
    await expect(hashLocalUpdateFile(destination)).resolves.toEqual(identity);
  });

  it('detects source replacement and metadata mutation', async () => {
    const root = await createRoot();
    const source = join(root, 'source.msi');
    await writeFile(source, 'one');
    const inspect = async () => {
      const metadata = await import('node:fs/promises').then(({ stat }) =>
        stat(source),
      );
      return {
        lastWriteTimeUtcTicks: String(
          621_355_968_000_000_000n + BigInt(Math.trunc(metadata.mtimeMs * 10_000)),
        ),
        length: metadata.size,
      };
    };
    const before = await readLocalUpdateSourceSnapshot(source, inspect);
    await writeFile(source, 'changed');
    const after = await readLocalUpdateSourceSnapshot(source, inspect);
    expect(() => assertLocalUpdateSourceUnchanged(before, after)).toThrow(
      'LOCAL_UPDATE_SOURCE_FILE_CHANGED',
    );
  });

  it('rejects a symbolic-link source before external inspection', async () => {
    const root = await createRoot();
    const target = join(root, 'target.msi');
    const link = join(root, 'link.msi');
    await writeFile(target, 'target');
    try {
      await symlink(target, link, 'file');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EPERM') {
        return;
      }
      throw error;
    }
    let inspected = false;
    await expect(
      readLocalUpdateSourceSnapshot(link, async () => {
        inspected = true;
        return { lastWriteTimeUtcTicks: '638905536000000000', length: 6 };
      }),
    ).rejects.toThrow('LOCAL_UPDATE_SOURCE_FILE_INVALID');
    expect(inspected).toBe(false);
  });
});

async function createRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'eky-update-files-'));
  roots.push(root);
  return root;
}
