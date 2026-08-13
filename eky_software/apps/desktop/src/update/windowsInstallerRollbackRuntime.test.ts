import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  prepareWindowsInstallerRollbackRuntime,
  WindowsInstallerRollbackRuntimeError,
} from './windowsInstallerRollbackRuntime.js';

const runtimeFiles = [
  'rollbackWindowsInstallerLauncher.cmd',
  'rollbackWindowsInstallerLauncher.ps1',
  'rollbackWindowsInstaller.ps1',
] as const;
const roots: string[] = [];

describe('Windows installer rollback runtime', () => {
  afterEach(async () => {
    await Promise.all(
      roots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
    );
  });

  it('copies only the fixed helper runtime into a private root outside the package', async () => {
    const fixture = await createFixture();

    const prepared = await prepareWindowsInstallerRollbackRuntime(fixture);

    expect(prepared.rollbackScriptPath.startsWith(fixture.privateRuntimeRoot))
      .toBe(true);
    expect(prepared.rollbackScriptPath.startsWith(fixture.packagedRuntimeRoot))
      .toBe(false);
    const operationRoot = dirname(prepared.rollbackScriptPath);
    expect((await readdir(operationRoot)).sort()).toEqual([...runtimeFiles].sort());
    for (const fileName of runtimeFiles) {
      expect(await readFile(join(operationRoot, fileName), 'utf8')).toBe(
        `synthetic ${fileName}`,
      );
    }
  });

  it('removes a previous owned operation before creating the next runtime', async () => {
    const fixture = await createFixture();
    const first = await prepareWindowsInstallerRollbackRuntime(fixture);

    const second = await prepareWindowsInstallerRollbackRuntime(fixture);

    await expect(readFile(first.rollbackScriptPath)).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await expect(readFile(second.rollbackScriptPath)).resolves.toBeInstanceOf(
      Buffer,
    );
  });

  it('fails closed on missing, empty and linked helper files', async () => {
    const missing = await createFixture();
    await rm(join(missing.packagedRuntimeRoot, runtimeFiles[0]));
    await expect(
      prepareWindowsInstallerRollbackRuntime(missing),
    ).rejects.toBeInstanceOf(WindowsInstallerRollbackRuntimeError);

    const empty = await createFixture();
    await writeFile(join(empty.packagedRuntimeRoot, runtimeFiles[1]), '');
    await expect(
      prepareWindowsInstallerRollbackRuntime(empty),
    ).rejects.toBeInstanceOf(WindowsInstallerRollbackRuntimeError);

    const linked = await createFixture();
    const target = join(linked.packagedRuntimeRoot, 'target.ps1');
    await writeFile(target, 'synthetic target');
    await rm(join(linked.packagedRuntimeRoot, runtimeFiles[2]));
    await symlink(target, join(linked.packagedRuntimeRoot, runtimeFiles[2]));
    await expect(
      prepareWindowsInstallerRollbackRuntime(linked),
    ).rejects.toBeInstanceOf(WindowsInstallerRollbackRuntimeError);
  });

  it('does not remove unknown content from the private runtime root', async () => {
    const fixture = await createFixture();
    await mkdir(fixture.privateRuntimeRoot, { recursive: true });
    const unknownPath = join(fixture.privateRuntimeRoot, 'owner-note.txt');
    await writeFile(unknownPath, 'keep');

    await expect(
      prepareWindowsInstallerRollbackRuntime(fixture),
    ).rejects.toBeInstanceOf(WindowsInstallerRollbackRuntimeError);
    await expect(readFile(unknownPath, 'utf8')).resolves.toBe('keep');
  });

  it('rejects overlapping package and private runtime roots', async () => {
    const fixture = await createFixture();

    await expect(
      prepareWindowsInstallerRollbackRuntime({
        packagedRuntimeRoot: fixture.packagedRuntimeRoot,
        privateRuntimeRoot: join(fixture.packagedRuntimeRoot, 'private'),
      }),
    ).rejects.toBeInstanceOf(WindowsInstallerRollbackRuntimeError);
  });
});

async function createFixture() {
  const root = await mkdtemp(join(tmpdir(), 'eky-rollback-runtime-'));
  roots.push(root);
  const packagedRuntimeRoot = join(root, 'package', 'update-runtime');
  const privateRuntimeRoot = join(root, 'user-data', 'rollback-runtime');
  await mkdir(packagedRuntimeRoot, { recursive: true });
  for (const fileName of runtimeFiles) {
    await writeFile(
      join(packagedRuntimeRoot, fileName),
      `synthetic ${fileName}`,
    );
  }
  return { packagedRuntimeRoot, privateRuntimeRoot };
}
