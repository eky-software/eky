import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  removeExpiredSupportBundleTemporaryFiles,
  writeSupportBundleAtomically,
} from './supportBundleFileStore.js';

const temporaryRoots: string[] = [];

describe('writeSupportBundleAtomically', () => {
  afterEach(() => {
    for (const root of temporaryRoots.splice(0)) {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('writes through private temporary slots and adds the extension', () => {
    const runtimeRoot = createRoot();
    const targetRoot = createRoot();
    const targetPath = join(targetRoot, 'support');

    writeSupportBundleAtomically({
      archive: Buffer.from('safe bundle'),
      runtimeRoot,
      targetPath,
    });

    expect(readFileSync(`${targetPath}.json.gz`, 'utf8')).toBe(
      'safe bundle',
    );
  });

  it('replaces an existing regular support bundle selected by the user', () => {
    const runtimeRoot = createRoot();
    const targetRoot = createRoot();
    const targetPath = join(targetRoot, 'support.json.gz');
    writeFileSync(targetPath, 'previous bundle');

    writeSupportBundleAtomically({
      archive: Buffer.from('replacement bundle'),
      runtimeRoot,
      targetPath,
    });

    expect(readFileSync(targetPath, 'utf8')).toBe('replacement bundle');
  });

  it('does not follow a symbolic-link destination directory', () => {
    const runtimeRoot = createRoot();
    const targetRoot = createRoot();
    const outsideRoot = createRoot();
    const linkedDirectory = join(targetRoot, 'linked');
    symlinkSync(
      outsideRoot,
      linkedDirectory,
      process.platform === 'win32' ? 'junction' : 'dir',
    );

    expect(() =>
      writeSupportBundleAtomically({
        archive: Buffer.from('safe bundle'),
        runtimeRoot,
        targetPath: join(linkedDirectory, 'support.json.gz'),
      }),
    ).toThrow('SUPPORT_BUNDLE_DIRECTORY_UNSAFE');
  });

  it('removes only expired runtime temporary files', () => {
    const runtimeRoot = createRoot();
    const temporaryDirectory = join(
      runtimeRoot,
      'support-bundles',
      'temporary',
    );
    mkdirSync(temporaryDirectory, { recursive: true });
    const expiredPath = join(
      temporaryDirectory,
      '00000000-0000-4000-8000-000000000001.next',
    );
    const currentPath = join(
      temporaryDirectory,
      '00000000-0000-4000-8000-000000000002.next',
    );
    const unrelatedPath = join(temporaryDirectory, 'do-not-delete.txt');
    writeFileSync(expiredPath, 'expired');
    writeFileSync(currentPath, 'current');
    writeFileSync(unrelatedPath, 'unrelated');
    utimesSync(
      expiredPath,
      new Date('2026-05-01T00:00:00.000Z'),
      new Date('2026-05-01T00:00:00.000Z'),
    );

    removeExpiredSupportBundleTemporaryFiles(
      runtimeRoot,
      new Date('2026-07-27T00:00:00.000Z'),
    );

    expect(existsSync(expiredPath)).toBe(false);
    expect(existsSync(currentPath)).toBe(true);
    expect(existsSync(unrelatedPath)).toBe(true);
  });
});

function createRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'eky-support-bundle-'));
  temporaryRoots.push(root);
  return root;
}
