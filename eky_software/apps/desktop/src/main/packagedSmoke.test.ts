import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  assertPackagedSmokeBuildAcceptance,
  createPackagedSmokeConfiguration,
  createPackagedSmokeFailureMessage,
  createPackagedSmokeProgressReporter,
  createPackagedSmokeTimeoutMessage,
  packagedSmokeStages,
  readPackagedSmokeResult,
  resolvePackagedSmokeTempPath,
} from './packagedSmoke.js';

const acceptedBuild = {
  acceptedAt: '2026-08-21T10:00:00.000Z',
  appVersion: '0.2.6',
  buildRevision: '123456789abc',
  formatVersion: 1 as const,
  releaseChannel: 'pilot' as const,
};

describe('packaged smoke progress', () => {
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(
      temporaryDirectories
        .splice(0)
        .map((directory) =>
          rm(directory, { force: true, recursive: true }),
        ),
    );
  });

  it('requires pilot acceptance only from pilot packages', () => {
    expect(() =>
      assertPackagedSmokeBuildAcceptance({
        acceptedBuild,
        appVersion: acceptedBuild.appVersion,
        buildRevision: acceptedBuild.buildRevision,
        requiresPilotAcceptance: true,
      }),
    ).not.toThrow();
    expect(() =>
      assertPackagedSmokeBuildAcceptance({
        acceptedBuild: undefined,
        appVersion: acceptedBuild.appVersion,
        buildRevision: acceptedBuild.buildRevision,
        requiresPilotAcceptance: false,
      }),
    ).not.toThrow();
  });

  it('rejects missing pilot acceptance and development acceptance state', () => {
    expect(() =>
      assertPackagedSmokeBuildAcceptance({
        acceptedBuild: undefined,
        appVersion: acceptedBuild.appVersion,
        buildRevision: acceptedBuild.buildRevision,
        requiresPilotAcceptance: true,
      }),
    ).toThrow('DESKTOP_SMOKE_FIRST_START_ACCEPTANCE_FAILED');
    expect(() =>
      assertPackagedSmokeBuildAcceptance({
        acceptedBuild,
        appVersion: acceptedBuild.appVersion,
        buildRevision: acceptedBuild.buildRevision,
        requiresPilotAcceptance: false,
      }),
    ).toThrow('DESKTOP_SMOKE_FIRST_START_ACCEPTANCE_FAILED');
  });

  it('writes every allowlisted stage in the required order', async () => {
    const temporaryDirectory = await mkdtemp(
      join(tmpdir(), 'eky-packaged-smoke-test-'),
    );
    temporaryDirectories.push(temporaryDirectory);
    const configuration = createPackagedSmokeConfiguration({
      hasSmokeSwitch: true,
      tempPath: temporaryDirectory,
      tokenValue: 'a'.repeat(32),
    });
    const reporter = createPackagedSmokeProgressReporter(configuration);

    for (const stage of packagedSmokeStages) {
      await reporter.reportStage(stage);
      expect(reporter.currentStage()).toBe(stage);
      expect(await readResult(configuration.root)).toEqual({
        stage,
        status: 'started',
      });
    }
  });

  it('canonicalizes the smoke temp root before deriving runtime paths', async () => {
    const temporaryDirectory = await mkdtemp(
      join(tmpdir(), 'eky-packaged-smoke-path-test-'),
    );
    temporaryDirectories.push(temporaryDirectory);
    const nestedDirectory = join(temporaryDirectory, 'nested');
    await mkdir(nestedDirectory);
    const nonCanonicalTempPath = join(nestedDirectory, '..');
    const canonicalTempPath = resolvePackagedSmokeTempPath(temporaryDirectory);

    const configuration = createPackagedSmokeConfiguration({
      hasSmokeSwitch: true,
      tempPath: nonCanonicalTempPath,
      tokenValue: 'b'.repeat(32),
    });

    expect(configuration.root).toBe(
      join(canonicalTempPath, 'eky-desktop-smoke', 'b'.repeat(32)),
    );
    expect(configuration.userDataPath).toBe(
      join(
        canonicalTempPath,
        'eky-desktop-smoke',
        'b'.repeat(32),
        'user-data',
      ),
    );
  });

  it('rejects an unavailable smoke temp root without exposing its path', () => {
    const unavailablePath = join(
      tmpdir(),
      `eky-packaged-smoke-missing-${'c'.repeat(32)}`,
    );

    expect(() => resolvePackagedSmokeTempPath(unavailablePath)).toThrow(
      'DESKTOP_SMOKE_PATH_INVALID',
    );
  });

  it('does not resolve the temp root when packaged smoke is disabled', () => {
    expect(
      createPackagedSmokeConfiguration({
        hasSmokeSwitch: false,
        tempPath: 'C:\\private\\path-that-does-not-exist',
        tokenValue: undefined,
      }),
    ).toEqual({
      enabled: false,
      phase: 'initial',
      root: undefined,
      userDataPath: undefined,
    });
  });

  it('rejects unknown, skipped and repeated stages', async () => {
    const reporter = createPackagedSmokeProgressReporter({
      enabled: false,
      phase: 'initial',
      root: undefined,
      userDataPath: undefined,
    });

    await expect(
      reporter.reportStage('backend'),
    ).rejects.toThrow('DESKTOP_SMOKE_STAGE_INVALID');
    await expect(
      reporter.reportStage('unsafe' as never),
    ).rejects.toThrow('DESKTOP_SMOKE_STAGE_INVALID');

    await reporter.reportStage('startup');
    await expect(
      reporter.reportStage('startup'),
    ).rejects.toThrow('DESKTOP_SMOKE_STAGE_INVALID');
  });

  it('continues a restored profile run after the restart boundary', async () => {
    const reporter = createPackagedSmokeProgressReporter({
      enabled: false,
      phase: 'restoredProfile',
      root: undefined,
      userDataPath: undefined,
    });

    await reporter.reportStage('restoredStartup');
    await reporter.reportStage('restoreActivationJournalLoaded');
    await reporter.reportStage('restoredBackend');
    await reporter.reportStage('restoredSessionValidated');
    await reporter.reportStage('profileComparison');
    await reporter.reportStage('secondBackup');
    await reporter.reportStage('shutdown');

    expect(reporter.currentStage()).toBe('shutdown');
  });

  it('reports only the last safe stage in timeout messages', () => {
    expect(
      createPackagedSmokeTimeoutMessage({
        code: 'C:\\Users\\Example\\secret',
        stage: 'supportBundle',
        status: 'started',
      }),
    ).toBe(
      'Packaged desktop smoke check timed out (stage supportBundle).',
    );
    expect(
      createPackagedSmokeTimeoutMessage({
        stage: 'C:\\Users\\Example\\secret',
        status: 'started',
      }),
    ).toBe('Packaged desktop smoke check timed out (stage startup).');
  });

  it('reports only the safe smoke code and stage in failure messages', () => {
    expect(
      createPackagedSmokeFailureMessage(
        {
          code: 'PROFILE_SNAPSHOT_BROKER_UNAVAILABLE',
          stage: 'profileSnapshotMaintenance',
          status: 'failed',
        },
        1,
      ),
    ).toBe(
      'Packaged desktop smoke check failed (PROFILE_SNAPSHOT_BROKER_UNAVAILABLE, stage profileSnapshotMaintenance, process code 1).',
    );

    expect(
      createPackagedSmokeFailureMessage(
        {
          code: 'C:\\Users\\Example\\secret',
          stage: 'C:\\Users\\Example\\secret',
          status: 'failed',
        },
        null,
      ),
    ).toBe(
      'Packaged desktop smoke check failed (DESKTOP_SMOKE_FAILED, stage startup, process code null).',
    );
  });

  it('accepts only allowlisted result shapes', () => {
    expect(
      readPackagedSmokeResult({
        code: 'PACKAGED_SMOKE_FAILED',
        stage: 'backend',
        status: 'failed',
      }),
    ).toEqual({
      code: 'PACKAGED_SMOKE_FAILED',
      stage: 'backend',
      status: 'failed',
    });
    expect(
      readPackagedSmokeResult({
        code: 'raw path C:\\Users\\Example',
        stage: 'backend',
        status: 'failed',
      }),
    ).toBeUndefined();
    expect(
      readPackagedSmokeResult({
        electronVersion: '42.8.0',
        stage: 'shutdown',
        status: 'ok',
      }),
    ).toEqual({
      electronVersion: '42.8.0',
      stage: 'shutdown',
      status: 'ok',
    });
    expect(
      readPackagedSmokeResult({
        electronVersion: '^42.8.0',
        stage: 'shutdown',
        status: 'ok',
      }),
    ).toBeUndefined();
    expect(
      readPackagedSmokeResult({
        stage: 'backend',
        status: 'ok',
      }),
    ).toBeUndefined();
  });
});

async function readResult(root: string | undefined) {
  if (root === undefined) {
    throw new Error('DESKTOP_SMOKE_TEST_ROOT_MISSING');
  }

  return JSON.parse(
    await readFile(
      join(root, 'result', 'desktop-smoke-result.json'),
      'utf8',
    ),
  ) as unknown;
}
