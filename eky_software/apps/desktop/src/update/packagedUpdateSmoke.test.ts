import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { PackagedUpdateSmokeConfiguration } from './packagedUpdateSmokeConfiguration.js';
import {
  readPackagedUpdateSmokeResult,
  writePackagedUpdateSmokeFailure,
  writePackagedUpdateSmokeHandoffResult,
  writePackagedUpdateSmokePreviousSetupResult,
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
