import { createHash } from 'node:crypto';
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { resolveActiveWorkspaceStartup } from './resolveActiveWorkspaceStartup.js';

const temporaryRoots: string[] = [];
const profileId = 'a'.repeat(64);

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) =>
      rm(root, { force: true, recursive: true }),
    ),
  );
});

describe('active workspace startup resolution', () => {
  it('adopts a fresh installation once and reopens the same workspace normally', async () => {
    const userDataRoot = await createPrivateTemporaryRoot();

    const first = await resolveActiveWorkspaceStartup(userDataRoot);

    expect(first.mode).toBe('adoption');
    await first.accept(profileId);
    expect(await readdir(join(userDataRoot, 'workspace-operations'))).toEqual(
      [],
    );

    const second = await resolveActiveWorkspaceStartup(userDataRoot);

    expect(second).toMatchObject({
      mode: 'normal',
      workspaceId: first.workspaceId,
      workspaceRoot: first.workspaceRoot,
    });
    await second.accept(profileId);
    await expect(
      readdir(join(second.workspaceRoot, 'runtime', 'storage', 'invoices')),
    ).resolves.toEqual([]);
  });

  it('copies a legacy profile without changing its authoritative source', async () => {
    const userDataRoot = await createPrivateTemporaryRoot();
    const legacyRuntimeRoot = join(userDataRoot, 'runtime');
    const sourceDatabase = join(legacyRuntimeRoot, 'data', 'eky.sqlite');
    const sourcePdf = join(
      legacyRuntimeRoot,
      'storage',
      'invoices',
      'approved-invoice.pdf',
    );
    await createPrivateDirectory(join(legacyRuntimeRoot, 'data'));
    await createPrivateDirectory(join(legacyRuntimeRoot, 'storage'));
    await createPrivateDirectory(
      join(legacyRuntimeRoot, 'storage', 'invoices'),
    );
    await writePrivateFile(sourceDatabase, 'synthetic-sqlite-profile');
    await writePrivateFile(sourcePdf, '%PDF-1.7\nsynthetic');
    const sourceIdentity = await hashFiles([sourceDatabase, sourcePdf]);

    const first = await resolveActiveWorkspaceStartup(userDataRoot);

    expect(first.mode).toBe('adoption');
    expect(
      await hashFiles([
        join(first.workspaceRoot, 'runtime', 'data', 'eky.sqlite'),
        join(
          first.workspaceRoot,
          'runtime',
          'storage',
          'invoices',
          'approved-invoice.pdf',
        ),
      ]),
    ).toBe(sourceIdentity);
    await first.accept(profileId);

    const second = await resolveActiveWorkspaceStartup(userDataRoot);

    expect(second).toMatchObject({
      mode: 'normal',
      workspaceId: first.workspaceId,
      workspaceRoot: first.workspaceRoot,
    });
    await second.accept(profileId);
    expect(await hashFiles([sourceDatabase, sourcePdf])).toBe(sourceIdentity);
  });
});

async function createPrivateTemporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'eky-active-workspace-'));
  temporaryRoots.push(root);
  if (process.platform !== 'win32') await chmod(root, 0o700);
  return root;
}

async function createPrivateDirectory(path: string): Promise<void> {
  await mkdir(path, { mode: 0o700, recursive: true });
  if (process.platform !== 'win32') await chmod(path, 0o700);
}

async function writePrivateFile(path: string, content: string): Promise<void> {
  await writeFile(path, content, { mode: 0o600 });
  if (process.platform !== 'win32') await chmod(path, 0o600);
}

async function hashFiles(paths: readonly string[]): Promise<string> {
  const hash = createHash('sha256');
  for (const path of paths) hash.update(await readFile(path));
  return hash.digest('hex');
}
