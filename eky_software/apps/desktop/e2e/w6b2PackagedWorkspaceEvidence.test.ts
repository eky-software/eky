import { createHash } from 'node:crypto';
import {
  link,
  mkdir,
  mkdtemp,
  open,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { snapshotW6b2PackagedWorkspaceFileEvidence } from './w6b2PackagedWorkspaceEvidence.js';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) =>
      rm(root, { force: true, recursive: true }),
    ),
  );
});

describe('W6B.2 packaged workspace file evidence', () => {
  it('accepts one ordinary regular file inside the canonical workspace root', async () => {
    const root = await createRoot();
    const path = join(root, 'evidence.bin');
    const bytes = Buffer.from('w6b2-evidence');
    await writeFile(path, bytes);

    await expect(
      snapshotW6b2PackagedWorkspaceFileEvidence(path, root),
    ).resolves.toEqual({
      sha256: createHash('sha256').update(bytes).digest('hex'),
      size: bytes.byteLength,
    });
  });

  it('rejects a symbolic link', async () => {
    const root = await createRoot();
    const target = join(root, 'target.bin');
    const path = join(root, 'evidence.bin');
    await writeFile(target, 'target');
    await symlink(target, path, 'file');

    await expect(
      snapshotW6b2PackagedWorkspaceFileEvidence(path, root),
    ).rejects.toThrowError('W6B2_EVIDENCE_FILE_INVALID');
  });

  it('rejects a hard-linked file', async () => {
    const root = await createRoot();
    const target = join(root, 'target.bin');
    const path = join(root, 'evidence.bin');
    await writeFile(target, 'target');
    await link(target, path);

    await expect(
      snapshotW6b2PackagedWorkspaceFileEvidence(path, root),
    ).rejects.toThrowError('W6B2_EVIDENCE_FILE_INVALID');
  });

  it('rejects a directory and a missing path with one safe error', async () => {
    const root = await createRoot();
    const directory = join(root, 'directory');
    await mkdir(directory);

    await expect(
      snapshotW6b2PackagedWorkspaceFileEvidence(directory, root),
    ).rejects.toThrowError('W6B2_EVIDENCE_FILE_INVALID');
    await expect(
      snapshotW6b2PackagedWorkspaceFileEvidence(
        join(root, 'missing.bin'),
        root,
      ),
    ).rejects.toThrowError('W6B2_EVIDENCE_FILE_INVALID');
  });

  it('rejects a regular file outside the canonical workspace root', async () => {
    const root = await createRoot();
    const outsideRoot = await createRoot();
    const path = join(outsideRoot, 'outside.bin');
    await writeFile(path, 'outside');

    await expect(
      snapshotW6b2PackagedWorkspaceFileEvidence(path, root),
    ).rejects.toThrowError('W6B2_EVIDENCE_FILE_INVALID');
  });

  it('fails closed if the path identity changes between inspection and open', async () => {
    const root = await createRoot();
    const path = join(root, 'evidence.bin');
    const originalPath = join(root, 'original.bin');
    await writeFile(path, 'original');
    let swapped = false;

    await expect(
      snapshotW6b2PackagedWorkspaceFileEvidence(path, root, {
        async open(candidate, flags) {
          if (!swapped) {
            swapped = true;
            await rename(candidate, originalPath);
            await writeFile(candidate, 'replacement');
          }
          return open(candidate, flags);
        },
      }),
    ).rejects.toThrowError('W6B2_EVIDENCE_FILE_INVALID');
  });
});

async function createRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'eky-w6b2-evidence-'));
  temporaryRoots.push(root);
  return root;
}
