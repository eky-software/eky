import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createW6bLegacyUpgradeAcceptanceArguments,
  isW6bLineageProfileId,
  runW6bLegacyUpgradeAcceptance,
  w6bLineageProfileIdPattern,
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
  buildRevision: '2349f4673ff5',
  installerPath: resolve('synthetic-target.msi'),
  msiProductVersion: '0.2.7',
  packageSha256: 'b'.repeat(64),
  packagedApplicationPath: resolve('synthetic-target-payload'),
  productCode: 'F7DB5A4D-B704-59D8-A463-3D56CD04DA8F',
});
const scriptDirectory = dirname(fileURLToPath(import.meta.url));

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
  assert.throws(
    () =>
      createW6bLegacyUpgradeAcceptanceArguments({
        source,
        target: { ...target, buildRevision: '123456' },
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
  assert.equal(arguments_.includes('-LineageProfileIdPattern'), true);
  assert.equal(arguments_.includes(w6bLineageProfileIdPattern), true);
  assert.equal(arguments_.includes('--user-data-dir'), false);
  assert.equal(
    arguments_.some((value) => /password|companyId|session/iu.test(value)),
    false,
  );
});

test('accepts only a lowercase 64-hex lineage profile id', () => {
  assert.equal(isW6bLineageProfileId('a'.repeat(64)), true);
  assert.equal(
    isW6bLineageProfileId('11111111-1111-4111-8111-111111111111'),
    false,
  );
  assert.equal(
    isW6bLineageProfileId('a'.repeat(32) + '-' + 'b'.repeat(31)),
    false,
  );
  assert.equal(isW6bLineageProfileId('A'.repeat(64)), false);
  assert.equal(isW6bLineageProfileId('a'.repeat(63)), false);
  assert.equal(isW6bLineageProfileId('a'.repeat(65)), false);
});

test('keeps the PowerShell acceptance boundary synthetic and identity-safe', () => {
  const sourceSmokeText = readFileSync(
    new URL('./w6bLegacy/sourceSmoke.ps1', import.meta.url),
    'utf8',
  );
  const sourceText = [
    './testW6bLegacyUpgradeAcceptance.ps1',
    './w6bLegacy/evidence.ps1',
    './w6bLegacy/historicalPackagedSmokeProcessChain.ps1',
    './w6bLegacy/installerLifecycle.ps1',
    './w6bLegacy/pathSafety.ps1',
    './w6bLegacy/progress.ps1',
    './w6bLegacy/sourceSmoke.ps1',
    './w6bLegacy/sourceUserData.ps1',
  ]
    .map((path) => readFileSync(new URL(path, import.meta.url), 'utf8'))
    .join('\n');

  assert.match(sourceText, /--user-data-dir/iu);
  assert.match(sourceText, /function Start-W6bIsolatedEkyProcess/iu);
  assert.match(sourceText, /function Wait-W6bEkyAccepted/iu);
  assert.match(
    sourceText,
    /\$isolatedAppDataRoot\s*=\s*Join-Path \$testRoot 'app-data-roaming'/iu,
  );
  assert.match(
    sourceText,
    /function Start-W6bEkyProcess[\s\S]*?EnvironmentOverrides/iu,
  );
  assert.match(
    sourceText,
    /finally\s*\{[\s\S]*?SetEnvironmentVariable\([\s\S]*?\$previousValues/iu,
  );
  assert.match(sourceText, /APPDATA = \$isolatedAppDataRoot/iu);
  assert.match(sourceText, /TEMP = \$sourceSmokeTempRoot/iu);
  assert.match(sourceText, /EKY_DESKTOP_SMOKE_TOKEN = \$sourceSmokeToken/iu);
  assert.match(
    sourceText,
    /\$runningProcess\s*=\s*Start-W6bIsolatedEkyProcess\s+Wait-W6bEkyAccepted -Process \$runningProcess/iu,
  );
  assert.match(sourceText, /W6B_LEGACY_ACCEPTED_BUILD_MISSING/iu);
  assert.match(sourceText, /W6B_LEGACY_ACCEPTED_BUILD_IDENTITY_MISMATCH/iu);
  assert.match(sourceText, /W6B_LEGACY_BACKEND_UTILITY_MISSING/iu);
  assert.match(sourceText, /W6B_LEGACY_DATABASE_MISSING_AT_STARTUP/iu);
  assert.match(sourceText, /'backendHealthReady'/u);
  assert.match(sourceText, /'legacyBusinessFixtureReady'/u);
  assert.match(sourceText, /'runtimeSessionValidated'/u);
  assert.match(sourceText, /-cnotmatch \$LineageProfileIdPattern/u);
  assert.match(sourceText, /Invoke-W6bSourcePackagedSmoke/u);
  assert.match(
    sourceText,
    /w6bLegacy\\historicalPackagedSmokeProcessChain\.ps1/u,
  );
  assert.match(
    sourceText,
    /Invoke-HistoricalPackagedSmokeProcessChain/u,
  );
  assert.match(sourceText, /w6bLegacy\\sourceUserData\.ps1/u);
  assert.match(sourceText, /Resolve-W6bLegacySourceUserData/u);
  assert.doesNotMatch(sourceText, /Find-W6bSourceUserDataRoot/u);
  assert.doesNotMatch(
    sourceText,
    /Get-W6bSafeFilesUnderRoot\s+-Root \$testRoot[\s\S]{0,200}?-FileName 'accepted-build-v1\.json'/u,
  );
  assert.match(sourceText, /Find-W6bAuthoritativeInvoicePdf/u);
  assert.match(sourceText, /--desktop-smoke-restored/u);
  const sourcePackagedSmoke = sourceSmokeText.slice(
    sourceSmokeText.indexOf('function Invoke-W6bSourcePackagedSmoke'),
  );
  assert.doesNotMatch(sourcePackagedSmoke, /Assert-W6bNoEkyProcesses/u);
  assert.ok(
    sourceText.indexOf('$legacyPdfHash = Get-EkyFileSha256') <
      sourceText.indexOf(
        'Write-W6bLegacyReadinessObservation -Signal legacyBusinessFixtureReady',
      ),
  );
  assert.doesNotMatch(sourceText, /Eky W6B synthetic legacy invoice/iu);
  assert.doesNotMatch(
    sourceText,
    /WriteAllText\([\s\S]*?approved-invoice\.pdf/iu,
  );
  assert.doesNotMatch(
    sourceText,
    /\b(?:INSERT|UPDATE|DELETE)\s+(?:INTO|FROM)?\s*invoice/iu,
  );
  assert.match(sourceText, /status = 'observed'/iu);
  assert.match(sourceText, /New-EkyProcessIdentity/iu);
  assert.match(sourceText, /Get-EkyOwnedProcessIdentitiesFromSnapshot/iu);
  assert.match(sourceText, /Assert-W6bPackageHash/iu);
  assert.match(sourceText, /W6B_LEGACY_NORMAL_PROFILE_CHANGED/iu);
  assert.doesNotMatch(sourceText, /Stop-Process\s+-Name/iu);
  assert.doesNotMatch(sourceText, /Write-(?:Host|Output).*Exception\.Message/iu);
  assert.doesNotMatch(sourceText, /Write-(?:Host|Output).*StackTrace/iu);
});

test('historical smoke process chain is exact and foreign-process safe', {
  skip: process.platform !== 'win32',
}, () => {
  const result = spawnSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      resolve(
        scriptDirectory,
        'w6bLegacy',
        'historicalPackagedSmokeProcessChain.test.ps1',
      ),
    ],
    { encoding: 'utf8', windowsHide: true },
  );

  assert.equal(result.status, 0, 'W6B_LEGACY_PROCESS_CHAIN_TEST_FAILED');
  const lines = result.stdout
    .split(/\r?\n/u)
    .filter((line) => line.trim() !== '');
  assert.equal(lines.length, 1);
  const outcome = JSON.parse(lines[0]);
  assert.deepEqual(outcome, {
    contract: 'explicitTwoPhase',
    fixture: 'synthetic',
    foreignProcessUntouched: true,
    initialGenerationCount: 1,
    invalidProcessStartsRejected: true,
    remainingOwnedProcessCount: 0,
    restoredGenerationCount: 1,
    status: 'succeeded',
  });
});

test('legacy source user data is deterministic and path safe', {
  skip: process.platform !== 'win32',
}, () => {
  const result = spawnSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      resolve(scriptDirectory, 'w6bLegacy', 'sourceUserData.test.ps1'),
    ],
    { encoding: 'utf8', windowsHide: true },
  );

  assert.equal(result.status, 0, 'W6B_SOURCE_USER_DATA_TEST_FAILED');
  const lines = result.stdout
    .split(/\r?\n/u)
    .filter((line) => line.trim() !== '');
  assert.equal(lines.length, 1);
  assert.deepEqual(JSON.parse(lines[0]), {
    acceptedBuildLocations: 'currentAndLegacy',
    deterministicUserDataRoot: true,
    pathAliasesCanonicalized: true,
    reparsePointRejected: true,
    status: 'succeeded',
  });
});
