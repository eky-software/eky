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

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { DesktopReleaseInfo } from '../release/desktopReleaseInfo.js';
import { createPackageBuildInfo } from '../release/packageBuildInfo.js';
import { LocalUnsignedPilotUpdatePackageTrustPolicy } from './localUnsignedPilotUpdatePackageTrustPolicy.js';
import { copyLocalUpdatePackageWithHash } from './localUpdateFileOperations.js';
import * as localUpdateFiles from './localUpdateFileOperations.js';
import { UpdatePackageTrustError } from './updatePackageTrustPolicy.js';
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
  vi.restoreAllMocks();
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

describe('local update package cache', () => {
  it('preserves the real candidate version reason and leaves an existing candidate byte-identical', async () => {
    const { cache, current, candidate } = await createCurrentAndCandidatePair();
    const candidateRoot = join(current.cacheRoot, 'candidate');
    const before = await Promise.all((await readdir(candidateRoot)).map(async name =>
      [name, await readFile(join(candidateRoot, name))] as const));
    const copy = vi.spyOn(localUpdateFiles, 'copyLocalUpdatePackageWithHash');
    const hash = vi.spyOn(localUpdateFiles, 'hashLocalUpdateFile');
    const result = cache.stageSelectedPackage({ manifestPath: current.manifestPath, role: 'candidate' });
    await expect(result).rejects.toMatchObject({ stage: 'sourceValidation', reason: 'versionNotNewer' });
    const error = await result.catch((value: unknown) => value);
    expect(error).not.toHaveProperty('cause');
    expect(JSON.stringify(error)).not.toContain(current.root);
    expect(copy).not.toHaveBeenCalled();
    expect(hash).not.toHaveBeenCalled();
    for (const [name, bytes] of before) expect((await readFile(join(candidateRoot, name))).equals(bytes)).toBe(true);
    expect(await cache.getPackageStatus('candidate')).toMatchObject({ appVersion: candidate.manifest.appVersion });
    expect((await readdir(current.cacheRoot)).sort()).toEqual(['candidate', 'current']);
  });

  it.each(['inspectInstaller', 'inspectRegularFile'] as const)(
    'drops even authentic typed reasons from %s', async (dependency) => {
      const fixture = await createFixture();
      for (const injected of [new UpdatePackageTrustError('versionNotNewer'),
        new LocalUpdatePackageCacheError('sourceValidation', 'versionNotNewer')]) {
        const cache = createCache(fixture.cacheRoot, { [dependency]: async () => { throw injected; } });
        const result = cache.stageSelectedPackage({ manifestPath: fixture.manifestPath, role: 'candidate' });
        await expect(result).rejects.toMatchObject({ stage: 'sourceValidation', reason: undefined });
        expect(await result.catch((error: unknown) => error)).not.toHaveProperty('cause');
      }
    },
  );

  it.each(['absent', 'unknown', 'lookalike', 'cacheError', 'cause', 'aggregate'] as const)(
    'does not extract candidate reasons from %s policy failures', async (kind) => {
      const fixture = await createFixture();
      const reason = new UpdatePackageTrustError('versionNotNewer');
      const injected = kind === 'absent' ? new UpdatePackageTrustError()
        : kind === 'unknown' ? Object.assign(new UpdatePackageTrustError(), { reason: 'futureReason' })
        : kind === 'lookalike' ? { name: reason.name, reason: reason.reason, stage: 'sourceValidation' }
        : kind === 'cacheError' ? new LocalUpdatePackageCacheError('sourceValidation', 'versionNotNewer')
        : kind === 'cause' ? new Error('synthetic-private-failure', { cause: reason })
        : new AggregateError([reason], 'synthetic-private-failure');
      const cache = createCache(fixture.cacheRoot, { trustPolicy: { verifyPackage() { throw injected; } } });
      const result = cache.stageSelectedPackage({ manifestPath: fixture.manifestPath, role: 'candidate' });
      await expect(result).rejects.toMatchObject({ stage: 'sourceValidation', reason: undefined });
      const error = await result.catch((value: unknown) => value);
      expect(error).not.toHaveProperty('cause');
      expect(JSON.stringify(error)).not.toContain('synthetic-private');
    },
  );

  it('keeps current policy failures generic and exact rollback independent of candidate ordering', async () => {
    const fixture = await createFixture();
    const policy = { verifyPackage: vi.fn(() => { throw new UpdatePackageTrustError('versionNotNewer'); }) };
    const cache = createCache(fixture.cacheRoot, { trustPolicy: policy });
    await expect(cache.stageSelectedPackage({ manifestPath: fixture.manifestPath, role: 'current' }))
      .rejects.toMatchObject({ reason: undefined });
    policy.verifyPackage.mockClear();
    await expect(cache.registerExactRollbackPackage({ manifestPath: fixture.manifestPath,
      expectedIdentity: expectedIdentityOf(fixture.manifest) })).resolves.toMatchObject({ role: 'current' });
    expect(policy.verifyPackage).not.toHaveBeenCalled();
  });

  it.each(['cachePreparation', 'packageCopy', 'stagedValidation'] as const)(
    'does not promote a later %s failure to a source reason', async (phase) => {
      const fixture = await createFixture({ appVersion: '0.1.0-alpha.2', msiProductVersion: '0.1.2' });
      const injected = new LocalUpdatePackageCacheError('sourceValidation', 'versionNotNewer');
      const policy = new LocalUnsignedPilotUpdatePackageTrustPolicy();
      let policyCalls = 0;
      const cache = createCache(fixture.cacheRoot, {
        ...(phase === 'cachePreparation' ? { getAvailableBytes: async () => { throw injected; } } : {}),
        ...(phase === 'packageCopy' ? { copyPackage: async () => { throw injected; } } : {}),
        trustPolicy: { verifyPackage(input) {
          if (++policyCalls > 1 && phase === 'stagedValidation') throw new UpdatePackageTrustError('versionNotNewer');
          return policy.verifyPackage(input);
        } },
      });
      await expect(cache.stageSelectedPackage({ manifestPath: fixture.manifestPath, role: 'candidate' }))
        .rejects.toMatchObject({ reason: undefined });
      expect((await safeReadDirectory(fixture.cacheRoot)).filter(name => name.startsWith('.staging-'))).toEqual([]);
    },
  );

  it.each(['same', 'newer'] as const)('keeps version-before-hash precedence for %s metadata', async (version) => {
    const fixture = await createFixture(version === 'newer'
      ? { appVersion: '0.1.0-alpha.2', msiProductVersion: '0.1.2' } : {});
    const bytes = await readFile(fixture.packagePath, 'utf8');
    await writeFile(fixture.packagePath, bytes.replace('synthetic', 'synthetix'));
    const hash = vi.spyOn(localUpdateFiles, 'hashLocalUpdateFile');
    await expect(createCache(fixture.cacheRoot).stageSelectedPackage({ manifestPath: fixture.manifestPath, role: 'candidate' }))
      .rejects.toMatchObject({ stage: 'sourceValidation', reason: version === 'same' ? 'versionNotNewer' : undefined });
    expect(hash).toHaveBeenCalledTimes(version === 'same' ? 0 : 1);
  });

  it.each(['manifest', 'size', 'sharedIdentity', 'relativePath'] as const)(
    'keeps an earlier %s rejection generic despite non-newer metadata', async (fault) => {
      const fixture = await createFixture();
      if (fault === 'manifest') await writeFile(fixture.manifestPath, JSON.stringify({ ...fixture.manifest, appVersion: 'invalid' }));
      if (fault === 'size') await appendFile(fixture.packagePath, '!');
      const cache = createCache(fixture.cacheRoot, fault === 'sharedIdentity'
        ? { inspectInstaller: async () => ({ architecture: 'x64', packageScope: 'perMachine',
          productCode: `{${createExpectedWindowsInstallerProductCode('0.1.1')}}`, productVersion: '0.1.1',
          upgradeCode: `{${releaseInfo.upgradeCode}}` } as unknown as WindowsInstallerIdentity) } : {});
      await expect(cache.stageSelectedPackage({ manifestPath: fault === 'relativePath' ? 'relative.json' : fixture.manifestPath,
        role: 'candidate' })).rejects.toMatchObject({ reason: undefined });
    },
  );
  it.each([
    'sourceValidation', 'cachePreparation', 'packageCopy',
    'stagedValidation', 'slotPublication', 'slotValidation',
  ] as const)('retains only the owned %s failure boundary', async (stage) => {
    const fixture = await createFixture();
    const privateError = new Error('synthetic-private-path-and-error');
    const cache = createCache(fixture.cacheRoot, {
      ...(stage === 'sourceValidation' ? { inspectInstaller: async () => { throw privateError; } } : {}),
      ...(stage === 'cachePreparation' ? { getAvailableBytes: async () => 0n } : {}),
      async copyPackage(source, destination) {
        if (stage === 'packageCopy') throw privateError;
        const identity = await copyLocalUpdatePackageWithHash(source, destination);
        if (stage === 'stagedValidation') await appendFile(source, '!');
        if (stage === 'slotPublication') {
          await mkdir(join(fixture.cacheRoot, 'current'));
          await writeFile(join(fixture.cacheRoot, 'current', 'sentinel'), 'owned-test-obstacle');
        }
        return identity;
      },
    });
    if (stage === 'slotValidation') {
      await cache.stageSelectedPackage({ manifestPath: fixture.manifestPath, role: 'current' });
      await writeFile(join(fixture.cacheRoot, 'current', 'slot-metadata.json'), '{');
    }
    const result = cache.stageSelectedPackage({ manifestPath: fixture.manifestPath, role: 'current' });
    await expect(result).rejects.toBeInstanceOf(LocalUpdatePackageCacheError);
    await expect(result).rejects.toMatchObject({
      stage, message: 'The local update package could not be stored safely.',
    });
    const error = await result.catch((value: unknown) => value);
    expect(JSON.stringify(error)).not.toContain('synthetic-private');
    expect(error).not.toHaveProperty('cause');
    expect((await safeReadDirectory(fixture.cacheRoot)).filter((name) => name.startsWith('.staging-'))).toEqual([]);
    if (stage === 'slotPublication') {
      expect(await readFile(join(fixture.cacheRoot, 'current', 'sentinel'), 'utf8')).toBe('owned-test-obstacle');
    }
  });

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

  it.each(['exact', 'shortPrefix', 'differentSuffix', 'legacyRuntimePrefix'] as const)(
    'keeps current registration exact for the %s build/manifest pair',
    async (variant) => {
      const head = '0123456789'.repeat(4);
      const buildInfo = await createPackageBuildInfo({
        appVersion: '0.1.0',
        environment: {},
        repositoryRoot: '/synthetic-repository',
        readGitOutput: async (args) => {
          if (args[0] === 'status') return '';
          expect(args).toEqual(['rev-parse', 'HEAD']);
          return `${head}\n`;
        },
      });
      const fixture = await createFixture({
        appVersion: buildInfo.appVersion,
        buildRevision: variant === 'shortPrefix' ? head.slice(0, 12)
          : variant === 'differentSuffix' ? `${head.slice(0, -1)}b`
          : head,
        msiProductVersion: '0.1.0',
      });
      const cache = createCache(fixture.cacheRoot, {
        releaseInfo: {
          ...releaseInfo,
          appVersion: buildInfo.appVersion,
          buildRevision: variant === 'legacyRuntimePrefix'
            ? head.slice(0, 12) : buildInfo.buildRevision,
          msiProductVersion: '0.1.0',
        },
      });
      const registration = cache.stageSelectedPackage({
        manifestPath: fixture.manifestPath,
        role: 'current',
      });
      if (variant !== 'exact') {
        await expect(registration).rejects.toThrow(LocalUpdatePackageCacheError);
        await expect(readdir(fixture.cacheRoot)).rejects.toMatchObject({
          code: 'ENOENT',
        });
        await expect(cache.getCurrentRegistrationState()).resolves.toBe('missing');
        await expect(readdir(fixture.cacheRoot)).resolves.toEqual([]);
        return;
      }
      await expect(registration).resolves.toMatchObject({ buildRevision: head });
      await expect(cache.getCurrentRegistrationState()).resolves.toBe('ready');
      await expect(
        cache.stageSelectedPackage({
          manifestPath: fixture.manifestPath,
          role: 'current',
        }),
      ).resolves.toMatchObject({ buildRevision: head });
    },
  );

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

  it('returns only a short safe fingerprint in package status', async () => {
    const fixture = await createFixture();
    const cache = createCache(fixture.cacheRoot);
    await cache.stageSelectedPackage({
      manifestPath: fixture.manifestPath,
      role: 'current',
    });

    const status = await cache.getPackageStatus('current');

    expect(status).toEqual({
      appVersion: releaseInfo.appVersion,
      buildRevision: releaseInfo.buildRevision,
      msiProductVersion: releaseInfo.msiProductVersion,
      packageFingerprint: expectedIdentityOf(fixture.manifest)
        .packageSha256.slice(0, 12),
      releaseChannel: 'pilot',
      role: 'current',
      signingStatus: 'unsigned-prototype',
    });
    expect(JSON.stringify(status)).not.toContain(fixture.root);
    expect(JSON.stringify(status)).not.toContain(
      expectedIdentityOf(fixture.manifest).packageSha256,
    );
    expect(Object.isFrozen(status)).toBe(true);
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

  it.for(['afterCurrentRename', 'afterPreviousRename'] as const)(
    'resumes rollback normalization %s',
    async (interruption, { onTestFinished, signal }) => {
      const ownedRoots: string[] = [];
      const progress = {
        scenario: interruption,
        phase: 'notStarted',
        lastCompletedPhase: 'none',
        bodySettled: false,
      };
      const advance = (phase: string) => {
        signal.throwIfAborted();
        progress.lastCompletedPhase = progress.phase;
        progress.phase = phase;
      };
      onTestFinished(async ({ task }) => {
        // Timeout does not settle the body. Its roots must not enter another
        // test's cleanup or be deleted while an owned operation can still write.
        if (task.result?.state !== 'pass' || !progress.bodySettled) {
          console.error(JSON.stringify({
            diagnostic: 'updateCacheRollbackTest',
            ...progress,
            rootsRetained: true,
          }));
          return;
        }
        await Promise.all(ownedRoots.map((root) => rm(root, { force: true, recursive: true })));
      });
      try {
        const pair = await createCurrentAndCandidatePair(ownedRoots, advance);
        advance('promoteCandidate');
        await pair.cache.promoteAcceptedCandidate({
          candidateIdentity: expectedIdentityOf(pair.candidate.manifest),
          currentIdentity: expectedIdentityOf(pair.current.manifest),
        });
        advance('renameCurrent');
        await rename(
          join(pair.current.cacheRoot, 'current'),
          join(pair.current.cacheRoot, '.rollback-candidate-next'),
        );
        if (interruption === 'afterPreviousRename') {
          advance('renamePrevious');
          await rename(
            join(pair.current.cacheRoot, 'previous'),
            join(pair.current.cacheRoot, 'current'),
          );
        }

        advance('normalizeRollback');
        await pair.cache.normalizeRolledBackPackages({
          candidateIdentity: expectedIdentityOf(pair.candidate.manifest),
          currentIdentity: expectedIdentityOf(pair.current.manifest),
        });

        advance('verifySlots');
        expect((await readdir(pair.current.cacheRoot)).sort()).toEqual([
          'candidate',
          'current',
        ]);
        // Both recovered slots must match their exact original identities.
        advance('verifyCurrentPackage');
        await expect(pair.cache.revalidateJournalPackage({
          expectedIdentity: expectedIdentityOf(pair.current.manifest),
          role: 'current',
        })).resolves.toMatchObject({
          appVersion: pair.current.manifest.appVersion,
          buildRevision: pair.current.manifest.buildRevision,
          msiProductVersion: pair.current.manifest.msiProductVersion,
          manifest: expectedIdentityOf(pair.current.manifest),
        });
        advance('verifyCandidatePackage');
        await expect(pair.cache.revalidateJournalPackage({
          expectedIdentity: expectedIdentityOf(pair.candidate.manifest),
          role: 'candidate',
        })).resolves.toMatchObject({
          appVersion: pair.candidate.manifest.appVersion,
          buildRevision: pair.candidate.manifest.buildRevision,
          msiProductVersion: pair.candidate.manifest.msiProductVersion,
          manifest: expectedIdentityOf(pair.candidate.manifest),
        });
        advance('completed');
      } finally {
        progress.bodySettled = true;
      }
    },
  );

  it('keeps explicit fixture roots outside the shared cleanup collection', async () => {
    const ownedRoots: string[] = [];
    try {
      const pair = await createCurrentAndCandidatePair(ownedRoots);
      expect(ownedRoots).toEqual([pair.current.root]);
      expect(pair.candidate.root).toBe(pair.current.root);
      expect(roots).not.toContain(pair.current.root);
      expect((await readdir(pair.current.cacheRoot)).sort()).toEqual(['candidate', 'current']);
    } finally {
      await Promise.all(ownedRoots.map((root) => rm(root, { force: true, recursive: true })));
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

  it('registers an exact journal-bound rollback package under the failed target build', async () => {
    const fixture = await createFixture();
    const failedTargetRelease = {
      ...releaseInfo,
      appVersion: '0.1.0-alpha.2',
      buildRevision: 'abcdef012345',
      msiProductVersion: '0.1.2',
    };
    const cache = createCache(fixture.cacheRoot, {
      releaseInfo: failedTargetRelease,
    });
    const expectedIdentity = expectedIdentityOf(fixture.manifest);

    await expect(
      cache.registerExactRollbackPackage({
        expectedIdentity,
        manifestPath: fixture.manifestPath,
      }),
    ).resolves.toMatchObject({
      appVersion: releaseInfo.appVersion,
      role: 'current',
    });
    await expect(
      cache.hasExpectedJournalPackage({
        expectedIdentity,
        roles: ['current', 'previous'],
      }),
    ).resolves.toBe(true);
  });

  it('rejects a manually selected rollback package that differs from the journal identity', async () => {
    const fixture = await createFixture();
    const cache = createCache(fixture.cacheRoot, {
      releaseInfo: {
        ...releaseInfo,
        appVersion: '0.1.0-alpha.2',
        buildRevision: 'abcdef012345',
        msiProductVersion: '0.1.2',
      },
    });

    await expect(
      cache.registerExactRollbackPackage({
        expectedIdentity: {
          ...expectedIdentityOf(fixture.manifest),
          packageSha256: 'f'.repeat(64),
        },
        manifestPath: fixture.manifestPath,
      }),
    ).rejects.toThrow(LocalUpdatePackageCacheError);
    expect(await safeReadDirectory(fixture.cacheRoot)).toEqual([]);
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
  ownedRoots: string[] = roots,
) {
  const root = shared?.root ?? await mkdtemp(join(tmpdir(), 'eky-update-cache-'));
  if (shared === undefined) {
    ownedRoots.push(root);
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

async function createCurrentAndCandidatePair(
  ownedRoots: string[] = roots,
  observePhase: (phase: string) => void = () => {},
) {
  observePhase('createCurrentFixture');
  const current = await createFixture({}, undefined, ownedRoots);
  observePhase('createCandidateFixture');
  const candidate = await createFixture(
    {
      appVersion: '0.1.0-alpha.2',
      buildRevision: 'abcdef012345',
      msiProductVersion: '0.1.2',
    },
    current,
    ownedRoots,
  );
  const cache = createCache(current.cacheRoot);
  observePhase('stageCurrentPackage');
  await cache.stageSelectedPackage({
    manifestPath: current.manifestPath,
    role: 'current',
  });
  observePhase('stageCandidatePackage');
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
