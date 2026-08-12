import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { PackagedUpdateSmokeConfiguration } from './packagedUpdateSmokeConfiguration.js';
import {
  readPackagedUpdateSmokeResult,
  runPackagedUpdateSmoke,
  writePackagedUpdateSmokeFailure,
  writePackagedUpdateSmokeHandoffResult,
  writePackagedUpdateSmokePreviousSetupResult,
  writePackagedUpdateSmokeRollbackHandoffResult,
} from './packagedUpdateSmoke.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) =>
      rm(root, { force: true, recursive: true }),
    ),
  );
});

describe('packaged update smoke result boundary', () => {
  it('writes only a bounded handoff status for a prepare phase', async () => {
    const configuration = await createConfiguration('prepareSuccess');

    await writePackagedUpdateSmokeHandoffResult(configuration, '1.2.3');

    expect(await readResult(configuration)).toEqual({
      appVersion: '1.2.3',
      phase: 'prepareSuccess',
      status: 'handoffReady',
    });
  });

  it('rejects handoff output outside a prepare phase', async () => {
    const configuration = await createConfiguration('verifySuccess');

    await expect(
      writePackagedUpdateSmokeHandoffResult(configuration, '1.2.3'),
    ).rejects.toThrow('DESKTOP_UPDATE_SMOKE_HANDOFF_INVALID');
  });

  it('writes only a bounded previous Setup status for direct recovery', async () => {
    const configuration = await createConfiguration('verifyDirectFailure');

    await writePackagedUpdateSmokePreviousSetupResult(configuration, '1.2.3');

    expect(await readResult(configuration)).toEqual({
      appVersion: '1.2.3',
      phase: 'verifyDirectFailure',
      status: 'previousSetupReady',
    });
  });

  it('writes only a bounded rollback installer handoff status', async () => {
    const configuration = await createConfiguration('verifyRollback');

    await writePackagedUpdateSmokeRollbackHandoffResult(
      configuration,
      '1.2.3',
    );

    expect(await readResult(configuration)).toEqual({
      appVersion: '1.2.3',
      phase: 'verifyRollback',
      status: 'rollbackInstallerLaunched',
    });
  });

  it('writes a safe startup failure without raw error details', async () => {
    const configuration = await createConfiguration('verifyRollback');

    await writePackagedUpdateSmokeFailure(
      configuration,
      'UPDATE_RECOVERY_REQUIRED',
    );

    expect(await readResult(configuration)).toEqual({
      code: 'UPDATE_RECOVERY_REQUIRED',
      phase: 'verifyRollback',
      status: 'failed',
    });
  });

  it.each([
    {
      expectedCode: 'DESKTOP_UPDATE_SMOKE_SECRET_FAILED',
      thrownError: new Error('DESKTOP_UPDATE_SMOKE_SECRET_FAILED'),
    },
    {
      expectedCode: 'DESKTOP_UPDATE_SMOKE_REGISTRATION_FAILED',
      thrownError: new Error('raw failure with C:\\private\\profile path'),
    },
  ])(
    'preserves only the safe failure code at the outer startup boundary: $expectedCode',
    async ({ expectedCode, thrownError }) => {
      const configuration = await createConfiguration('seed');

      await expect(
        runPackagedUpdateSmoke(
          createFailingSmokeDependencies(configuration, thrownError),
        ),
      ).rejects.toThrow(expectedCode);

      expect(await readResult(configuration)).toEqual({
        code: expectedCode,
        phase: 'seed',
        status: 'failed',
      });
    },
  );

  it.each([
    {
      expectedCode: 'DESKTOP_UPDATE_SMOKE_PACKAGE_STAGE_FAILED',
      failingStep: 'stage' as const,
    },
    {
      expectedCode: 'DESKTOP_UPDATE_SMOKE_PREPARATION_FAILED',
      failingStep: 'prepare' as const,
    },
    {
      expectedCode: 'DESKTOP_UPDATE_SMOKE_HANDOFF_FAILED',
      failingStep: 'handoff' as const,
    },
  ])(
    'reports only the named prepare failure stage: $expectedCode',
    async ({ expectedCode, failingStep }) => {
      const configuration = await createConfiguration('prepareSuccess');
      const dependencies = createPrepareSmokeDependencies(
        configuration,
        failingStep,
      );

      await expect(runPackagedUpdateSmoke(dependencies)).rejects.toThrow(
        expectedCode,
      );
      expect(await readResult(configuration)).toEqual({
        code: expectedCode,
        phase: 'prepareSuccess',
        status: 'failed',
      });
    },
  );

  it('rejects extra result fields and malformed fingerprints', () => {
    expect(
      readPackagedUpdateSmokeResult({
        appVersion: '1.2.3',
        phase: 'prepareSuccess',
        rawPath: 'C:\\secret',
        status: 'handoffReady',
      }),
    ).toBeUndefined();
    expect(
      readPackagedUpdateSmokeResult({
        acceptedVersion: '1.2.3',
        appVersion: '1.2.3',
        artifactCount: 1,
        journalState: 'accepted',
        migrationChainIdentity: 'invalid',
        pdfSha256: 'a'.repeat(64),
        phase: 'verifySuccess',
        secretConfigured: true,
        status: 'ok',
      }),
    ).toBeUndefined();
  });

  it('accepts the exact successful packaged update smoke result contract', () => {
    const result = {
      acceptedVersion: '1.2.3',
      appVersion: '1.2.3',
      artifactCount: 1,
      journalState: 'accepted',
      migrationChainIdentity: 'b'.repeat(64),
      pdfSha256: 'a'.repeat(64),
      phase: 'verifySuccess' as const,
      secretConfigured: true as const,
      status: 'ok' as const,
    };

    expect(readPackagedUpdateSmokeResult(result)).toEqual(result);
    expect(
      readPackagedUpdateSmokeResult({
        ...result,
        rawPath: 'C:\\private\\profile',
      }),
    ).toBeUndefined();
  });
});

async function createConfiguration(
  phase: NonNullable<PackagedUpdateSmokeConfiguration['phase']>,
): Promise<PackagedUpdateSmokeConfiguration> {
  const root = await mkdtemp(join(tmpdir(), 'eky-update-smoke-result-'));
  roots.push(root);
  return {
    enabled: true,
    phase,
    root,
    userDataPath: join(root, 'user-data'),
  };
}

async function readResult(
  configuration: PackagedUpdateSmokeConfiguration,
): Promise<unknown> {
  return JSON.parse(
    await readFile(
      join(
        configuration.root!,
        'result',
        'desktop-update-smoke-result.json',
      ),
      'utf8',
    ),
  );
}

function createFailingSmokeDependencies(
  configuration: PackagedUpdateSmokeConfiguration,
  thrownError: Error,
): Parameters<typeof runPackagedUpdateSmoke>[0] {
  return {
    acceptedBuildStore: { read: async () => undefined },
    appVersion: '0.1.0-alpha.1',
    backend: { port: 1 },
    buildRevision: 'a'.repeat(40),
    cache: {
      getPackageStatus: async () => {
        throw new Error('unused');
      },
      repairCurrentRegistration: async () => {
        throw thrownError;
      },
      stageSelectedPackage: async () => {
        throw new Error('unused');
      },
    },
    configuration,
    directSetupRecoveryStore: { read: async () => undefined },
    handoffCoordinator: {
      handoffPreparedUpdate: async () => undefined,
      prepareConfirmedUpdate: async () => {
        throw new Error('unused');
      },
    },
    journalStore: { read: async () => undefined },
    portableProfileBackupService: {
      create: async () => {
        throw new Error('unused');
      },
    },
    profileRestoreActivationService: {
      activate: async () => {
        throw new Error('unused');
      },
    },
    profileRestoreStagingService: {
      inspect: async () => {
        throw new Error('unused');
      },
      stage: async () => {
        throw new Error('unused');
      },
    },
    profileSnapshotClient: {
      validateActiveProfile: async () => {
        throw new Error('unused');
      },
    },
    releaseInfo: {
      appIdentity: 'Eky',
      appVersion: '0.1.0-alpha.1',
      architecture: 'x64',
      buildRevision: 'a'.repeat(40),
      msiProductVersion: '0.1.1',
      platform: 'win32',
      releaseChannel: 'pilot',
      schemaVersion: 1,
      upgradeCode: 'B1F359BB-A75C-44AB-B995-2D43D202177C',
    },
    runtimeSessionSecret: 'synthetic-session-secret',
    shutdownAndQuit: async () => undefined,
  } as Parameters<typeof runPackagedUpdateSmoke>[0];
}

function createPrepareSmokeDependencies(
  configuration: PackagedUpdateSmokeConfiguration,
  failingStep: 'handoff' | 'prepare' | 'stage',
): Parameters<typeof runPackagedUpdateSmoke>[0] {
  const dependencies = createFailingSmokeDependencies(
    configuration,
    new Error('unused'),
  );
  dependencies.cache.stageSelectedPackage = async () => {
    if (failingStep === 'stage') {
      throw new Error('raw package staging failure');
    }
    return {
      appVersion: '0.1.0-alpha.2',
      buildRevision: 'b'.repeat(40),
      msiProductVersion: '0.1.2',
      releaseChannel: 'pilot',
      role: 'candidate',
      signingStatus: 'unsigned-prototype',
    };
  };
  dependencies.handoffCoordinator.prepareConfirmedUpdate = async () => {
    if (failingStep === 'prepare') {
      throw new Error('raw recovery point failure');
    }
    return {} as never;
  };
  dependencies.handoffCoordinator.handoffPreparedUpdate = async () => {
    if (failingStep === 'handoff') {
      throw new Error('raw installer handoff failure');
    }
  };
  return dependencies;
}
