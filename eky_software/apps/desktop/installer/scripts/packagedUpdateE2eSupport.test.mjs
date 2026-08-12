import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';

import {
  createPackagedUpdateScenarioPlan,
  formatPackagedUpdateSmokeFailureDiagnostic,
  parsePackagedUpdateSmokeResult,
  readPackagedUpdateE2eFixture,
} from './packagedUpdateE2eSupport.mjs';

const roots = [];

describe('packaged update smoke failure diagnostics', () => {
  it('reports only an allowlisted startup stage', () => {
    assert.equal(
      formatPackagedUpdateSmokeFailureDiagnostic({
        code: 'DESKTOP_UPDATE_SMOKE_UNEXPECTED_RECOVERY_REQUIRED',
        failureStage: 'firstStartAcceptance',
      }),
      'PACKAGED_UPDATE_E2E_APPLICATION_DESKTOP_UPDATE_SMOKE_UNEXPECTED_RECOVERY_REQUIRED_AT_firstStartAcceptance',
    );
    assert.equal(
      formatPackagedUpdateSmokeFailureDiagnostic({
        code: 'DESKTOP_UPDATE_SMOKE_UNEXPECTED_RECOVERY_REQUIRED',
        failureStage: 'C:\\private\\profile',
      }),
      'PACKAGED_UPDATE_E2E_APPLICATION_DESKTOP_UPDATE_SMOKE_UNEXPECTED_RECOVERY_REQUIRED',
    );
  });
});

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

describe('packaged update E2E support', () => {
  it('keeps the six reviewed scenarios in a stable order', () => {
    assert.deepEqual(
      createPackagedUpdateScenarioPlan().map((scenario) => scenario.name),
      [
        'coordinatedSuccess',
        'coordinatedCancel',
        'coordinatedRollback',
        'directSetupSuccess',
        'directSetupFailure',
        'backupForwardRestore',
      ],
    );
  });

  it('parses only the exact three fixture identities under the fixture root', async () => {
    const { fixturePath, fixture } = await createFixture();

    assert.equal(
      (await readPackagedUpdateE2eFixture(fixturePath)).packages.next.appVersion,
      '0.0.0-update-fixture.2',
    );

    fixture.packages.next.msiPath = 'C:\\outside\\Eky.msi';
    await writeFile(fixturePath, JSON.stringify(fixture), 'utf8');
    await assert.rejects(
      readPackagedUpdateE2eFixture(fixturePath),
      /PACKAGED_UPDATE_E2E_FIXTURE_INVALID/,
    );
  });

  it('rejects result fields that could expose paths or raw errors', () => {
    assert.throws(
      () =>
        parsePackagedUpdateSmokeResult(
          {
            appVersion: '0.0.0-update-fixture.1',
            path: 'C:\\private',
            phase: 'prepareSuccess',
            status: 'handoffReady',
          },
          'prepareSuccess',
        ),
      /PACKAGED_UPDATE_E2E_RESULT_INVALID/,
    );
    assert.throws(
      () =>
        parsePackagedUpdateSmokeResult(
          {
            code: 'UPDATE_RECOVERY_REQUIRED',
            failureStage: 'C:\\private\\profile',
            phase: 'verifySuccess',
            status: 'failed',
          },
          'verifySuccess',
        ),
      /PACKAGED_UPDATE_E2E_RESULT_INVALID/,
    );
    assert.throws(
      () =>
        parsePackagedUpdateSmokeResult(
          {
            code: 'safe-but-wrong-case',
            phase: 'verifyRollback',
            status: 'failed',
          },
          'verifyRollback',
        ),
      /PACKAGED_UPDATE_E2E_RESULT_INVALID/,
    );
  });

  it('accepts only the bounded handoff and profile result contracts', () => {
    assert.deepEqual(
      parsePackagedUpdateSmokeResult(
        {
          appVersion: '0.0.0-update-fixture.1',
          phase: 'prepareSuccess',
          status: 'handoffReady',
        },
        'prepareSuccess',
      ),
      {
        appVersion: '0.0.0-update-fixture.1',
        phase: 'prepareSuccess',
        status: 'handoffReady',
      },
    );
    assert.equal(
      parsePackagedUpdateSmokeResult(
        {
          acceptedVersion: '0.0.0-update-fixture.2',
          appVersion: '0.0.0-update-fixture.2',
          artifactCount: 1,
          journalState: 'accepted',
          migrationChainIdentity: 'a'.repeat(64),
          pdfSha256: 'b'.repeat(64),
          phase: 'verifySuccess',
          secretConfigured: true,
          status: 'ok',
        },
        'verifySuccess',
      ).journalState,
      'accepted',
    );
    assert.equal(
      parsePackagedUpdateSmokeResult(
        {
          appVersion: '0.0.0-update-fixture.3',
          phase: 'verifyDirectFailure',
          status: 'previousSetupReady',
        },
        'verifyDirectFailure',
      ).status,
      'previousSetupReady',
    );
    assert.equal(
      parsePackagedUpdateSmokeResult(
        {
          appVersion: '0.0.0-update-fixture.3',
          phase: 'verifyRollback',
          status: 'rollbackInstallerLaunched',
        },
        'verifyRollback',
      ).status,
      'rollbackInstallerLaunched',
    );
    assert.deepEqual(
      parsePackagedUpdateSmokeResult(
        {
          code: 'UPDATE_RECOVERY_REQUIRED',
          failureStage: 'packageCacheRotation',
          phase: 'verifySuccess',
          status: 'failed',
        },
        'verifySuccess',
      ),
      {
        code: 'UPDATE_RECOVERY_REQUIRED',
        failureStage: 'packageCacheRotation',
        phase: 'verifySuccess',
        status: 'failed',
      },
    );
  });
});

async function createFixture() {
  const root = await mkdtemp(join(tmpdir(), 'eky-update-fixture-support-'));
  roots.push(root);
  const packages = {};
  for (const [index, role] of ['current', 'next', 'failure'].entries()) {
    const packageRoot = join(root, 'packages', role);
    await mkdir(packageRoot, { recursive: true });
    packages[role] = {
      appVersion: `0.0.0-update-fixture.${index + 1}`,
      applicationPath: join(packageRoot, 'Eky-win32-x64'),
      manifestPath: join(packageRoot, 'package.manifest.json'),
      msiPath: join(packageRoot, `Eky-0.0.0-update-fixture.${index + 1}-x64.msi`),
      msiProductVersion: `0.0.${index + 1}`,
      packageSha256: String(index + 1).repeat(64),
      packageSize: 123,
      productCode: `0000000${index + 1}-0000-4000-8000-00000000000${index + 1}`,
    };
  }
  const fixture = {
    buildRevision: 'abcdef1',
    fixtureFormatVersion: 1,
    packages,
  };
  const fixturePath = join(root, 'fixture.json');
  await writeFile(fixturePath, JSON.stringify(fixture), 'utf8');
  return { fixture, fixturePath };
}
