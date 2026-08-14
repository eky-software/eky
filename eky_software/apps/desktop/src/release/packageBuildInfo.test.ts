import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  createPackageBuildInfo,
  readDesktopPackageVersion,
} from './packageBuildInfo.js';

describe('package build identity', () => {
  it('reads the only product version from the desktop package metadata', async () => {
    const packageMetadata = JSON.parse(
      await readFile(resolve(process.cwd(), 'package.json'), 'utf8'),
    ) as unknown;

    expect(readDesktopPackageVersion(packageMetadata)).toBe('0.1.1');
  });

  it('uses an allowlisted environment revision and reports a dirty tree', async () => {
    const readGitOutput = vi.fn(async (args: readonly string[]) =>
      args[0] === 'status' ? ' M apps/desktop/package.json\n' : '',
    );

    await expect(
      createPackageBuildInfo({
        appVersion: '0.1.0',
        environment: { EKY_BUILD_REVISION: '1234567abcdef' },
        now: () => new Date('2026-07-28T00:00:00.000Z'),
        readGitOutput,
        repositoryRoot: '/repository',
      }),
    ).resolves.toEqual({
      appVersion: '0.1.0',
      buildCreatedAt: '2026-07-28T00:00:00.000Z',
      buildDirty: true,
      buildRevision: '1234567abcdef',
      schemaVersion: 1,
    });
    expect(readGitOutput).toHaveBeenCalledTimes(1);
  });

  it('uses the git revision fallback and reports a clean tree', async () => {
    const readGitOutput = vi.fn(async (args: readonly string[]) =>
      args[0] === 'rev-parse' ? '123456789abc\n' : '',
    );

    await expect(
      createPackageBuildInfo({
        appVersion: '0.1.0',
        environment: {},
        now: () => new Date('2026-07-28T00:00:00.000Z'),
        readGitOutput,
        repositoryRoot: '/repository',
      }),
    ).resolves.toMatchObject({
      buildDirty: false,
      buildRevision: '123456789abc',
    });
  });

  it('fails closed when no valid revision can be formed', async () => {
    await expect(
      createPackageBuildInfo({
        appVersion: '0.1.0',
        environment: {},
        readGitOutput: vi.fn(async () => {
          throw new Error('git unavailable');
        }),
        repositoryRoot: '/repository',
      }),
    ).rejects.toThrow('DESKTOP_BUILD_REVISION_UNAVAILABLE');

    await expect(
      createPackageBuildInfo({
        appVersion: '0.1.0',
        environment: { EKY_BUILD_REVISION: 'NOT-A-REVISION' },
        readGitOutput: vi.fn(async () => ''),
        repositoryRoot: '/repository',
      }),
    ).rejects.toThrow('DESKTOP_BUILD_INFO_INVALID');
  });

  it('rejects prerelease package versions while legacy metadata stays readable', async () => {
    expect(() =>
      readDesktopPackageVersion({ version: '0.1.0-alpha.2' }),
    ).toThrow('DESKTOP_PACKAGE_VERSION_INVALID');
    await expect(
      createPackageBuildInfo({
        appVersion: '0.1.0-alpha.2',
        environment: { EKY_BUILD_REVISION: '1234567abcdef' },
        readGitOutput: vi.fn(async () => ''),
        repositoryRoot: '/repository',
      }),
    ).rejects.toThrow('DESKTOP_PACKAGE_VERSION_INVALID');
  });

  it('keeps package-windows free of a copied 0.0.0 product version', async () => {
    const packageScript = await readFile(
      resolve(process.cwd(), 'scripts/package-windows.mjs'),
      'utf8',
    );

    expect(packageScript).not.toContain("'0.0.0'");
    expect(packageScript).not.toContain('"0.0.0"');
  });
});
