import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  createPackagedSmokeConfiguration,
  createPackagedSmokeProgressReporter,
  createPackagedSmokeTimeoutMessage,
  packagedSmokeStages,
  readPackagedSmokeResult,
} from './packagedSmoke.js';

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
