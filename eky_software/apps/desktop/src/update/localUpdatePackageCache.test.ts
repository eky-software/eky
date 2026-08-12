import { createHash } from 'node:crypto';
import {
  appendFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { DesktopReleaseInfo } from '../release/desktopReleaseInfo.js';
import { LocalUnsignedPilotUpdatePackageTrustPolicy } from './localUnsignedPilotUpdatePackageTrustPolicy.js';
import { copyLocalUpdatePackageWithHash } from './localUpdateFileOperations.js';
import {
  LocalUpdatePackageCache,
  LocalUpdatePackageCacheError,
} from './localUpdatePackageCache.js';
import type { WindowsInstallerIdentity } from './windowsInstallerIdentity.js';
import { createExpectedWindowsInstallerProductCode } from './windowsInstallerProductCode.js';

const roots: string[] = [];
const releaseInfo: DesktopReleaseInfo = {
  appIdentity: 'Eky',
  appVersion: '0.1.0-alpha.1',
  architecture: 'x64',
  buildRevision: '123456789abc',
  msiProductVersion: '0.1.1',
  platform: 'win32',
  releaseChannel: 'pilot',
  schemaVersion: 1,
  upgradeCode: '302530B2-D950-41F5-8397-264B485FEE9A',
};

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

describe('local update package cache', () => {
  it('registers and idempotently revalidates the exact current rollback package', async () => {
    const fixture = await createFixture();
    const cache = createCache(fixture.cacheRoot);
    await expect(cache.getCurrentRegistrationState()).resolves.toBe('missing');
    await expect(
      cache.stageSelectedPackage({
        manifestPath: fixture.manifestPath,
        role: 'current',
      }),
    ).resolves.toMatchObject({
      appVersion: releaseInfo.appVersion,
      role: 'current',
      signingStatus: 'unsigned-prototype',
    });
    await expect(cache.getCurrentRegistrationState()).resolves.toBe('ready');
    await expect(
      cache.stageSelectedPackage({
        manifestPath: fixture.manifestPath,
        role: 'current',
      }),
    ).resolves.toMatchObject({ role: 'current' });
    expect(await readdir(fixture.cacheRoot)).toEqual(['current']);
  });

  it('stages a strictly newer candidate without exposing source paths', async () => {
    const fixture = await createFixture({
      appVersion: '0.1.0-alpha.2',
      buildRevision: 'abcdef012345',
      msiProductVersion: '0.1.2',
    });
    const summary = await createCache(fixture.cacheRoot).stageSelectedPackage({
      manifestPath: fixture.manifestPath,
      role: 'candidate',
    });
    expect(summary).toEqual({
      appVersion: '0.1.0-alpha.2',
      buildRevision: 'abcdef012345',
      msiProductVersion: '0.1.2',
      releaseChannel: 'pilot',
      role: 'candidate',
      signingStatus: 'unsigned-prototype',
    });
    expect(JSON.stringify(summary)).not.toContain(fixture.root);
  });

  it('rejects a wrong current package and one-byte package mutation without a slot', async () => {
    const wrong = await createFixture({
      appVersion: '0.1.0-alpha.2',
      buildRevision: 'abcdef012345',
      msiProductVersion: '0.1.2',
    });
    await expect(
      createCache(wrong.cacheRoot).stageSelectedPackage({
        manifestPath: wrong.manifestPath,
        role: 'current',
      }),
    ).rejects.toThrow(LocalUpdatePackageCacheError);
    await expect(readdir(wrong.cacheRoot)).rejects.toMatchObject({ code: 'ENOENT' });

    const mutated = await createFixture();
    const mutatedBytes = (await readFile(mutated.packagePath, 'utf8')).replace(
      'synthetic',
      'synthetix',
    );
    await writeFile(mutated.packagePath, mutatedBytes);
    await expect(
      createCache(mutated.cacheRoot).stageSelectedPackage({
        manifestPath: mutated.manifestPath,
        role: 'current',
      }),
    ).rejects.toThrow(LocalUpdatePackageCacheError);
    expect(await safeReadDirectory(mutated.cacheRoot)).toEqual([]);
  });

  it('detects mutation during copy and removes interrupted staging state', async () => {
    const fixture = await createFixture();
    const cache = createCache(fixture.cacheRoot, {
      async copyPackage(sourcePath, destinationPath) {
        const identity = await copyLocalUpdatePackageWithHash(
          sourcePath,
          destinationPath,
        );
        await appendFile(sourcePath, '!');
        return identity;
      },
    });
    await expect(
      cache.stageSelectedPackage({
        manifestPath: fixture.manifestPath,
        role: 'current',
      }),
    ).rejects.toThrow(LocalUpdatePackageCacheError);
    expect(await safeReadDirectory(fixture.cacheRoot)).toEqual([]);

    const interrupted = await createFixture();
    const interruptedCache = createCache(interrupted.cacheRoot, {
      async copyPackage(_sourcePath, destinationPath) {
        await writeFile(destinationPath, 'partial', { flag: 'wx' });
        throw new Error('simulated interruption');
      },
    });
    await expect(
      interruptedCache.stageSelectedPackage({
        manifestPath: interrupted.manifestPath,
        role: 'current',
      }),
    ).rejects.toThrow(LocalUpdatePackageCacheError);
    expect(await safeReadDirectory(interrupted.cacheRoot)).toEqual([]);
  });

  it('fails closed on insufficient space, write failure and reparse inspection', async () => {
    const noSpace = await createFixture();
    await expect(
      createCache(noSpace.cacheRoot, {
        getAvailableBytes: async () => 0n,
      }).stageSelectedPackage({
        manifestPath: noSpace.manifestPath,
        role: 'current',
      }),
    ).rejects.toThrow(LocalUpdatePackageCacheError);

    const readOnly = await createFixture();
    await expect(
      createCache(readOnly.cacheRoot, {
        copyPackage: async () => {
          throw Object.assign(new Error('read only'), { code: 'EACCES' });
        },
      }).stageSelectedPackage({
        manifestPath: readOnly.manifestPath,
        role: 'current',
      }),
    ).rejects.toThrow(LocalUpdatePackageCacheError);
    expect(await safeReadDirectory(readOnly.cacheRoot)).toEqual([]);

    const reparse = await createFixture();
    await expect(
      createCache(reparse.cacheRoot, {
        inspectRegularFile: async () => {
          throw new Error('reparse point');
        },
      }).stageSelectedPackage({
        manifestPath: reparse.manifestPath,
        role: 'current',
      }),
    ).rejects.toThrow(LocalUpdatePackageCacheError);
  });

  it('rejects corrupted slot metadata instead of treating current as missing', async () => {
    const fixture = await createFixture();
    const cache = createCache(fixture.cacheRoot);
    await cache.stageSelectedPackage({
      manifestPath: fixture.manifestPath,
      role: 'current',
    });
    await writeFile(
      join(fixture.cacheRoot, 'current', 'slot-metadata.json'),
      '{',
    );
    await expect(cache.getCurrentRegistrationState()).rejects.toThrow(
      LocalUpdatePackageCacheError,
    );
  });

  it('revalidates journal-bound package identity without applying running-version ordering', async () => {
    const fixture = await createFixture({
      appVersion: '0.1.0-alpha.2',
      buildRevision: 'abcdef012345',
      msiProductVersion: '0.1.2',
    });
    const cache = createCache(fixture.cacheRoot);
    await cache.stageSelectedPackage({
      manifestPath: fixture.manifestPath,
      role: 'candidate',
    });
    const expectedIdentity = expectedIdentityOf(fixture.manifest);
    await expect(
      cache.revalidateJournalPackage({
        expectedIdentity,
        role: 'candidate',
      }),
    ).resolves.toMatchObject({
      appVersion: '0.1.0-alpha.2',
      buildRevision: 'abcdef012345',
      msiProductVersion: '0.1.2',
    });
    await expect(
      cache.revalidateJournalPackage({
        expectedIdentity: {
          ...expectedIdentity,
          packageSha256: 'f'.repeat(64),
        },
        role: 'candidate',
      }),
    ).rejects.toThrow(LocalUpdatePackageCacheError);
  });

  it('returns a bounded package identity without exposing a cached path', async () => {
    const fixture = await createFixture();
    const cache = createCache(fixture.cacheRoot);
    await cache.stageSelectedPackage({
      manifestPath: fixture.manifestPath,
      role: 'current',
    });

    const identity = await cache.readExpectedPackageIdentity('current');

    expect(identity).toEqual(expectedIdentityOf(fixture.manifest));
    expect(JSON.stringify(identity)).not.toContain(fixture.root);
    expect(Object.isFrozen(identity)).toBe(true);
  });

  it('promotes candidate to current and keeps the prior current as previous', async () => {
    const pair = await createCurrentAndCandidatePair();
    await pair.cache.promoteAcceptedCandidate({
      candidateIdentity: expectedIdentityOf(pair.candidate.manifest),
      currentIdentity: expectedIdentityOf(pair.current.manifest),
    });

    expect((await readdir(pair.current.cacheRoot)).sort()).toEqual([
      'current',
      'previous',
    ]);
    await expect(
      pair.cache.revalidateJournalPackage({
        expectedIdentity: expectedIdentityOf(pair.candidate.manifest),
        role: 'current',
      }),
    ).resolves.toMatchObject({ appVersion: '0.1.0-alpha.2' });
    await expect(
      pair.cache.revalidateJournalPackage({
        expectedIdentity: expectedIdentityOf(pair.current.manifest),
        role: 'previous',
      }),
    ).resolves.toMatchObject({ appVersion: releaseInfo.appVersion });
  });

  it('resumes promotion after either durable directory rename', async () => {
    for (const interruption of ['afterCurrentRename', 'afterCandidateRename']) {
      const pair = await createCurrentAndCandidatePair();
      await rename(
        join(pair.current.cacheRoot, 'current'),
        join(pair.current.cacheRoot, 'previous'),
      );
      if (interruption === 'afterCandidateRename') {
        await rename(
          join(pair.current.cacheRoot, 'candidate'),
          join(pair.current.cacheRoot, 'current'),
        );
      }

      await pair.cache.promoteAcceptedCandidate({
        candidateIdentity: expectedIdentityOf(pair.candidate.manifest),
        currentIdentity: expectedIdentityOf(pair.current.manifest),
      });
      expect((await readdir(pair.current.cacheRoot)).sort()).toEqual([
        'current',
        'previous',
      ]);
      await expect(
        pair.cache.revalidateJournalPackage({
          expectedIdentity: expectedIdentityOf(pair.candidate.manifest),
          role: 'current',
        }),
      ).resolves.toBeDefined();
      await expect(
        pair.cache.revalidateJournalPackage({
          expectedIdentity: expectedIdentityOf(pair.current.manifest),
          role: 'previous',
        }),
      ).resolves.toBeDefined();
    }
  });

  it('normalizes unrotated rollback packages idempotently', async () => {
    const pair = await createCurrentAndCandidatePair();

    await expect(
      pair.cache.normalizeRolledBackPackages({
        candidateIdentity: expectedIdentityOf(pair.candidate.manifest),
        currentIdentity: expectedIdentityOf(pair.current.manifest),
      }),
    ).resolves.toMatchObject({
      appVersion: releaseInfo.appVersion,
    });
    await expect(
      pair.cache.normalizeRolledBackPackages({
        candidateIdentity: expectedIdentityOf(pair.candidate.manifest),
        currentIdentity: expectedIdentityOf(pair.current.manifest),
      }),
    ).resolves.toMatchObject({ appVersion: releaseInfo.appVersion });

    expect((await readdir(pair.current.cacheRoot)).sort()).toEqual([
      'candidate',
      'current',
    ]);
  });

  it('restores the exact previous package after accepted candidate rotation', async () => {
    const pair = await createCurrentAndCandidatePair();
    await pair.cache.promoteAcceptedCandidate({
      candidateIdentity: expectedIdentityOf(pair.candidate.manifest),
      currentIdentity: expectedIdentityOf(pair.current.manifest),
    });

    await pair.cache.normalizeRolledBackPackages({
      candidateIdentity: expectedIdentityOf(pair.candidate.manifest),
      currentIdentity: expectedIdentityOf(pair.current.manifest),
    });

    expect((await readdir(pair.current.cacheRoot)).sort()).toEqual([
      'candidate',
      'current',
    ]);
    await expect(
      pair.cache.revalidateJournalPackage({
        expectedIdentity: expectedIdentityOf(pair.current.manifest),
        role: 'current',
      }),
    ).resolves.toBeDefined();
    await expect(
      pair.cache.revalidateJournalPackage({
        expectedIdentity: expectedIdentityOf(pair.candidate.manifest),
        role: 'candidate',
      }),
    ).resolves.toBeDefined();
  });

  it('resumes rollback normalization after either durable directory rename', async () => {
    for (const interruption of ['afterCurrentRename', 'afterPreviousRename']) {
      const pair = await createCurrentAndCandidatePair();
      await pair.cache.promoteAcceptedCandidate({
        candidateIdentity: expectedIdentityOf(pair.candidate.manifest),
        currentIdentity: expectedIdentityOf(pair.current.manifest),
      });
      await rename(
        join(pair.current.cacheRoot, 'current'),
        join(pair.current.cacheRoot, '.rollback-candidate-next'),
      );
      if (interruption === 'afterPreviousRename') {
        await rename(
          join(pair.current.cacheRoot, 'previous'),
          join(pair.current.cacheRoot, 'current'),
        );
      }

      await pair.cache.normalizeRolledBackPackages({
        candidateIdentity: expectedIdentityOf(pair.candidate.manifest),
        currentIdentity: expectedIdentityOf(pair.current.manifest),
      });

      expect((await readdir(pair.current.cacheRoot)).sort()).toEqual([
        'candidate',
        'current',
      ]);
    }
  });

  it('rejects a mismatched rollback identity without rotating package slots', async () => {
    const pair = await createCurrentAndCandidatePair();
    await pair.cache.promoteAcceptedCandidate({
      candidateIdentity: expectedIdentityOf(pair.candidate.manifest),
      currentIdentity: expectedIdentityOf(pair.current.manifest),
    });

    await expect(
      pair.cache.normalizeRolledBackPackages({
        candidateIdentity: expectedIdentityOf(pair.candidate.manifest),
        currentIdentity: {
          ...expectedIdentityOf(pair.current.manifest),
          packageSha256: 'f'.repeat(64),
        },
      }),
    ).rejects.toThrow(LocalUpdatePackageCacheError);

    expect((await readdir(pair.current.cacheRoot)).sort()).toEqual([
      'current',
      'previous',
    ]);
  });

  it('discards a corrupted candidate without changing current or previous', async () => {
    const pair = await createCurrentAndCandidatePair();
    await pair.cache.promoteAcceptedCandidate({
      candidateIdentity: expectedIdentityOf(pair.candidate.manifest),
      currentIdentity: expectedIdentityOf(pair.current.manifest),
    });
    const nextCandidate = await createFixture(
      {
        appVersion: '0.1.0-alpha.3',
        buildRevision: 'fedcba987654',
        msiProductVersion: '0.1.3',
      },
      pair.current,
    );
    await pair.cache.stageSelectedPackage({
      manifestPath: nextCandidate.manifestPath,
      role: 'candidate',
    });
    await writeFile(
      join(pair.current.cacheRoot, 'candidate', 'slot-metadata.json'),
      '{',
    );

    await pair.cache.discardCandidate();

    expect((await readdir(pair.current.cacheRoot)).sort()).toEqual([
      'current',
      'previous',
    ]);
    await expect(
      pair.cache.revalidateJournalPackage({
        expectedIdentity: expectedIdentityOf(pair.candidate.manifest),
        role: 'current',
      }),
    ).resolves.toBeDefined();
    await expect(
      pair.cache.revalidateJournalPackage({
        expectedIdentity: expectedIdentityOf(pair.current.manifest),
        role: 'previous',
      }),
    ).resolves.toBeDefined();
  });

  it('repairs corrupted current registration without changing candidate or previous', async () => {
    const pair = await createCurrentAndCandidatePair();
    await pair.cache.promoteAcceptedCandidate({
      candidateIdentity: expectedIdentityOf(pair.candidate.manifest),
      currentIdentity: expectedIdentityOf(pair.current.manifest),
    });
    const nextCandidate = await createFixture(
      {
        appVersion: '0.1.0-alpha.3',
        buildRevision: 'fedcba987654',
        msiProductVersion: '0.1.3',
      },
      pair.current,
    );
    await pair.cache.stageSelectedPackage({
      manifestPath: nextCandidate.manifestPath,
      role: 'candidate',
    });
    await writeFile(
      join(pair.current.cacheRoot, 'current', 'slot-metadata.json'),
      '{',
    );

    await expect(
      pair.cache.repairCurrentRegistration({
        manifestPath: pair.current.manifestPath,
      }),
    ).resolves.toMatchObject({ role: 'current' });

    expect((await readdir(pair.current.cacheRoot)).sort()).toEqual([
      'candidate',
      'current',
      'previous',
    ]);
    await expect(
      pair.cache.revalidateJournalPackage({
        expectedIdentity: expectedIdentityOf(pair.current.manifest),
        role: 'current',
      }),
    ).resolves.toBeDefined();
    await expect(
      pair.cache.revalidateJournalPackage({
        expectedIdentity: expectedIdentityOf(nextCandidate.manifest),
        role: 'candidate',
      }),
    ).resolves.toBeDefined();
    await expect(
      pair.cache.revalidateJournalPackage({
        expectedIdentity: expectedIdentityOf(pair.current.manifest),
        role: 'previous',
      }),
    ).resolves.toBeDefined();
  });

  it('rejects a wrong current repair package before touching corrupted current', async () => {
    const pair = await createCurrentAndCandidatePair();
    const currentMetadataPath = join(
      pair.current.cacheRoot,
      'current',
      'slot-metadata.json',
    );
    await writeFile(currentMetadataPath, '{');

    await expect(
      pair.cache.repairCurrentRegistration({
        manifestPath: pair.candidate.manifestPath,
      }),
    ).rejects.toThrow(LocalUpdatePackageCacheError);

    expect(await readFile(currentMetadataPath, 'utf8')).toBe('{');
    await expect(
      pair.cache.revalidateJournalPackage({
        expectedIdentity: expectedIdentityOf(pair.candidate.manifest),
        role: 'candidate',
      }),
    ).resolves.toBeDefined();
  });

  it('recovers both interrupted current repair rename states', async () => {
    for (const interruption of ['backupOnly', 'nextOnly'] as const) {
      const fixture = await createFixture();
      const cache = createCache(fixture.cacheRoot);
      await cache.stageSelectedPackage({
        manifestPath: fixture.manifestPath,
        role: 'current',
      });
      await rename(
        join(fixture.cacheRoot, 'current'),
        join(
          fixture.cacheRoot,
          interruption === 'backupOnly'
            ? '.current-repair-backup'
            : '.current-repair-next',
        ),
      );

      await expect(
        cache.repairCurrentRegistration({
          manifestPath: fixture.manifestPath,
        }),
      ).resolves.toMatchObject({ role: 'current' });

      expect(await readdir(fixture.cacheRoot)).toEqual(['current']);
      await expect(cache.getCurrentRegistrationState()).resolves.toBe(
        'ready',
      );
    }
  });
});

interface FixtureOptions {
  appVersion?: string;
  buildRevision?: string;
  msiProductVersion?: string;
}

async function createFixture(
  options: FixtureOptions = {},
  shared?: { cacheRoot: string; root: string },
) {
  const root = shared?.root ?? await mkdtemp(join(tmpdir(), 'eky-update-cache-'));
  if (shared === undefined) {
    roots.push(root);
  }
  const appVersion = options.appVersion ?? releaseInfo.appVersion;
  const buildRevision = options.buildRevision ?? releaseInfo.buildRevision;
  const msiProductVersion =
    options.msiProductVersion ?? releaseInfo.msiProductVersion;
  const sourceRoot = join(root, `source-${appVersion}`);
  const cacheRoot = shared?.cacheRoot ?? join(root, 'cache');
  await mkdir(sourceRoot);
  const packageFilename = `Eky-${appVersion}-x64.msi`;
  const packagePath = join(sourceRoot, packageFilename);
  const packageBytes = Buffer.from(
    JSON.stringify({ msiProductVersion, synthetic: true }),
    'utf8',
  );
  await writeFile(packagePath, packageBytes);
  const manifest = {
    appIdentity: 'Eky',
    appVersion,
    architecture: 'x64',
    buildRevision,
    manifestFormatVersion: 1,
    msiProductVersion,
    packageFilename,
    packageKind: 'windows-installer-msi',
    packageSha256: createHash('sha256').update(packageBytes).digest('hex'),
    packageSize: packageBytes.length,
    platform: 'win32',
    releaseChannel: 'pilot',
    signing: {
      publisher: null,
      status: 'unsigned-prototype',
      thumbprint: null,
      timestamped: false,
    },
  };
  const manifestPath = join(sourceRoot, `Eky-${appVersion}-x64.manifest.json`);
  await writeFile(manifestPath, `${JSON.stringify(manifest)}\n`);
  return { cacheRoot, manifest, manifestPath, packagePath, root };
}

async function createCurrentAndCandidatePair() {
  const current = await createFixture();
  const candidate = await createFixture(
    {
      appVersion: '0.1.0-alpha.2',
      buildRevision: 'abcdef012345',
      msiProductVersion: '0.1.2',
    },
    current,
  );
  const cache = createCache(current.cacheRoot);
  await cache.stageSelectedPackage({
    manifestPath: current.manifestPath,
    role: 'current',
  });
  await cache.stageSelectedPackage({
    manifestPath: candidate.manifestPath,
    role: 'candidate',
  });
  return { cache, candidate, current };
}

function expectedIdentityOf(manifest: {
  appVersion: string;
  buildRevision: string;
  msiProductVersion: string;
  packageSha256: string;
  packageSize: number;
}) {
  return {
    appVersion: manifest.appVersion,
    buildRevision: manifest.buildRevision,
    msiProductVersion: manifest.msiProductVersion,
    packageSha256: manifest.packageSha256,
    packageSize: manifest.packageSize,
  };
}

function createCache(
  cacheRoot: string,
  overrides: Partial<ConstructorParameters<typeof LocalUpdatePackageCache>[0]> = {},
) {
  return new LocalUpdatePackageCache({
    cacheRoot,
    getAvailableBytes: async () => 2_000_000_000n,
    inspectInstaller: async (path): Promise<WindowsInstallerIdentity> => {
      const value = JSON.parse(await readFile(path, 'utf8')) as {
        msiProductVersion: string;
      };
      return {
        architecture: 'x64',
        packageScope: 'perUser',
        productCode: `{${createExpectedWindowsInstallerProductCode(
          value.msiProductVersion,
        )}}`,
        productVersion: value.msiProductVersion,
        upgradeCode: '{302530B2-D950-41F5-8397-264B485FEE9A}',
      };
    },
    inspectRegularFile,
    now: () => new Date('2026-08-11T18:00:00.000Z'),
    releaseInfo,
    trustPolicy: new LocalUnsignedPilotUpdatePackageTrustPolicy(),
    ...overrides,
  });
}

async function inspectRegularFile(path: string) {
  const metadata = await stat(path);
  return {
    lastWriteTimeUtcTicks: String(
      621_355_968_000_000_000n + BigInt(Math.trunc(metadata.mtimeMs * 10_000)),
    ),
    length: metadata.size,
  };
}

async function safeReadDirectory(path: string): Promise<string[]> {
  try {
    return await readdir(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}
