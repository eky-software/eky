import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { resolve } from 'node:path';

import {
  createW6bLegacyUpgradeAcceptanceArguments,
  runW6bLegacyUpgradeAcceptance,
} from './runW6bLegacyUpgradeAcceptance.mjs';

const source = Object.freeze({
  appVersion: '0.2.6',
  artifactClass: 'exact-local-release',
  buildRevision: '6ed99f5319c328f4d3cfbc03b912f21dbc4d1032',
  installerPath: resolve('synthetic-source.msi'),
  packageSha256: 'a'.repeat(64),
  productCode: 'C30C9E67-3E4F-5B04-A1ED-7A096A446FA7',
});
const target = Object.freeze({
  appVersion: '0.2.7',
  buildRevision: '2349f4673ff5d9625aeed1a084d2146c07e9d18a',
  installerPath: resolve('synthetic-target.msi'),
  msiProductVersion: '0.2.7',
  packageSha256: 'b'.repeat(64),
  packagedApplicationPath: resolve('synthetic-target-payload'),
  productCode: 'F7DB5A4D-B704-59D8-A463-3D56CD04DA8F',
});

test('uses the verified exact local release without rebuilding it', async () => {
  const calls = [];
  const result = await runW6bLegacyUpgradeAcceptance({
    buildTarget: async () => target,
    pathExists: async () => true,
    runProcess: async (command, arguments_) => {
      calls.push({ arguments_, command });
    },
    verifyExactLocal: async () => source,
    withHistoricalRebuild: async () => {
      throw new Error('unexpected historical rebuild');
    },
  });

  assert.equal(result.sourceClassification, 'exact-local-release');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, 'powershell.exe');
  assert.deepEqual(
    calls[0].arguments_,
    createW6bLegacyUpgradeAcceptanceArguments({ source, target }),
  );
});

test('uses the historical source rebuild only when the local bundle is absent', async () => {
  const rebuiltSource = {
    ...source,
    artifactClass: 'historical-source-rebuild',
  };
  let exactVerificationCalled = false;
  let rebuildCalled = false;

  const result = await runW6bLegacyUpgradeAcceptance({
    buildTarget: async () => target,
    pathExists: async () => false,
    runProcess: async () => undefined,
    verifyExactLocal: async () => {
      exactVerificationCalled = true;
      return source;
    },
    withHistoricalRebuild: async (task) => {
      rebuildCalled = true;
      return task(rebuiltSource);
    },
  });

  assert.equal(exactVerificationCalled, false);
  assert.equal(rebuildCalled, true);
  assert.equal(result.sourceClassification, 'historical-source-rebuild');
});

test('does not hide an invalid local release behind a source rebuild', async () => {
  let rebuildCalled = false;
  await assert.rejects(
    runW6bLegacyUpgradeAcceptance({
      buildTarget: async () => target,
      pathExists: async () => true,
      runProcess: async () => undefined,
      verifyExactLocal: async () => {
        throw new Error('HISTORICAL_FIXTURE_LOCAL_RELEASE_MISMATCH');
      },
      withHistoricalRebuild: async () => {
        rebuildCalled = true;
      },
    }),
    /HISTORICAL_FIXTURE_LOCAL_RELEASE_MISMATCH/,
  );
  assert.equal(rebuildCalled, false);
});

test('rejects same-version, non-adjacent and same-product target fixtures', () => {
  assert.throws(
    () =>
      createW6bLegacyUpgradeAcceptanceArguments({
        source,
        target: { ...target, appVersion: '0.2.6', msiProductVersion: '0.2.6' },
      }),
    /W6B_LEGACY_TARGET_IDENTITY_INVALID/,
  );
  assert.throws(
    () =>
      createW6bLegacyUpgradeAcceptanceArguments({
        source,
        target: { ...target, appVersion: '0.2.8', msiProductVersion: '0.2.8' },
      }),
    /W6B_LEGACY_TARGET_IDENTITY_INVALID/,
  );
  assert.throws(
    () =>
      createW6bLegacyUpgradeAcceptanceArguments({
        source,
        target: { ...target, productCode: source.productCode },
      }),
    /W6B_LEGACY_TARGET_IDENTITY_INVALID/,
  );
});

test('passes only the closed identity and filesystem arguments to PowerShell', () => {
  const arguments_ = createW6bLegacyUpgradeAcceptanceArguments({
    source,
    target,
  });
  assert.equal(arguments_[0], '-NoLogo');
  assert.equal(arguments_.includes('-SourceMsiPath'), true);
  assert.equal(arguments_.includes('-TargetMsiPath'), true);
  assert.equal(arguments_.includes('-TargetPayloadRoot'), true);
  assert.equal(arguments_.includes('-SourcePackageSha256'), true);
  assert.equal(arguments_.includes(source.packageSha256), true);
  assert.equal(arguments_.includes('-TargetPackageSha256'), true);
  assert.equal(arguments_.includes(target.packageSha256), true);
  assert.equal(arguments_.includes('--user-data-dir'), false);
  assert.equal(arguments_.some((value) => /password|companyId|session/iu.test(value)), false);
});

test('keeps the PowerShell acceptance boundary synthetic and identity-safe', () => {
  const sourceText = readFileSync(
    new URL('./testW6bLegacyUpgradeAcceptance.ps1', import.meta.url),
    'utf8',
  );

  assert.match(sourceText, /--user-data-dir/iu);
  assert.match(sourceText, /New-EkyProcessIdentity/iu);
  assert.match(sourceText, /Get-EkyOwnedProcessIdentitiesFromSnapshot/iu);
  assert.match(sourceText, /Assert-W6bPackageHash/iu);
  assert.match(sourceText, /W6B_LEGACY_NORMAL_PROFILE_CHANGED/iu);
  assert.doesNotMatch(sourceText, /Stop-Process\s+-Name/iu);
  assert.doesNotMatch(sourceText, /Write-(?:Host|Output).*Exception\.Message/iu);
  assert.doesNotMatch(sourceText, /Write-(?:Host|Output).*StackTrace/iu);
});
