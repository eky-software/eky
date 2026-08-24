import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createW6bLegacyUpgradeAcceptanceArguments,
  isW6bLineageProfileId,
  runW6bLegacyUpgradeAcceptance,
  w6bLineageProfileIdPattern,
} from './runW6bLegacyUpgradeAcceptance.mjs';
import {
  HISTORICAL_WINDOWS_INSTALLER_FIXTURE,
} from './historicalWindowsInstallerFixtureProvenance.mjs';

const source = Object.freeze({
  appVersion: '0.2.6',
  artifactClass: 'exact-local-release',
  buildRevision: '6ed99f5319c328f4d3cfbc03b912f21dbc4d1032',
  installerPath: resolve('synthetic-source.msi'),
  packageSha256: 'a'.repeat(64),
  productCode: 'C30C9E67-3E4F-5B04-A1ED-7A096A446FA7',
  runtimeBuildRevision:
    HISTORICAL_WINDOWS_INSTALLER_FIXTURE.expectedRuntimeBuildRevision,
});
const target = Object.freeze({
  appVersion: '0.2.7',
  buildRevision: '2349f4673ff5',
  installerManifest: Object.freeze({
    appVersion: '0.2.7',
    buildRevision: '2349f4673ff5',
    msiProductVersion: '0.2.7',
    packageSha256: 'b'.repeat(64),
    releaseChannel: 'pilot',
  }),
  installerPath: resolve('synthetic-target.msi'),
  msiProductVersion: '0.2.7',
  packageVersion: '0.2.7',
  packageSha256: 'b'.repeat(64),
  packagedApplicationPath: resolve('synthetic-target-payload'),
  productCode: 'F7DB5A4D-B704-59D8-A463-3D56CD04DA8F',
  releaseChannel: 'pilot',
  upgradeCode: '302530B2-D950-41F5-8397-264B485FEE9A',
});
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const processChainTestCases = Object.freeze([
  Object.freeze({ name: 'observerNoOutput', progressCount: 0 }),
  Object.freeze({ name: 'observerSingleOutput', progressCount: 1 }),
  Object.freeze({ name: 'observerMultipleOutput', progressCount: 4 }),
  Object.freeze({
    errorCode: 'W6B_LEGACY_OBSERVER_FAILED',
    name: 'observerFailure',
    progressCount: 0,
  }),
  Object.freeze({
    errorCode: 'W6B_LEGACY_OBSERVER_OUTPUT_INVALID',
    name: 'observerInvalidOutput',
    progressCount: 0,
  }),
  Object.freeze({ name: 'ownedDescendantChain', progressCount: 0 }),
  Object.freeze({ name: 'invalidStarts', progressCount: 0 }),
]);
const gracefulShutdownTestCases = Object.freeze([
  'windowDelayed',
  'windowTimeout',
  'duplicateWindowOwners',
  'foreignWindowIgnored',
  'processIdentityMismatch',
  'rootExitsBeforeWindow',
]);
const longPathTempForms = Object.freeze(['canonical', 'lexical']);

function parseProcessChainOutput(output) {
  return output.split(/\r?\n/u).filter((line) => line.trim() !== '');
}

function createSafeProcessChainFailureMessage(testCase, output) {
  const fallback = `${testCase}:W6B_LEGACY_PROCESS_CHAIN_TEST_FAILED`;
  const lines = parseProcessChainOutput(output);
  if (lines.length === 0) {
    return fallback;
  }
  try {
    const terminal = JSON.parse(lines.at(-1));
    if (
      terminal.status !== 'failed' ||
      terminal.testCase !== testCase ||
      !/^(?:W6B|INSTALLER)_[A-Z0-9_]+$/u.test(terminal.errorCode) ||
      Object.keys(terminal).sort().join(',') !==
        'errorCode,status,testCase'
    ) {
      return fallback;
    }
    return `${terminal.testCase}:${terminal.errorCode}`;
  } catch {
    return fallback;
  }
}

function assertSafeProcessChainProgress(progress) {
  assert.deepEqual(Object.keys(progress).sort(), [
    'durationMs',
    'elapsedMs',
    'resultCode',
    'scenario',
    'stage',
    'status',
  ]);
  assert.equal(progress.scenario, 'legacyUpgrade');
  assert.equal(progress.stage, 'sourceStartup');
  assert.equal(progress.status, 'observed');
  assert.equal(
    ['backendHealthReady', 'backendUtilityReady'].includes(
      progress.resultCode,
    ),
    true,
  );
  assert.equal(Number.isSafeInteger(progress.durationMs), true);
  assert.equal(progress.durationMs >= 0, true);
  assert.equal(Number.isSafeInteger(progress.elapsedMs), true);
  assert.equal(progress.elapsedMs >= 0, true);
}

function runLongPathEvidenceTest({ tempForm, testCase = 'success' }) {
  const tempRoot = mkdtempSync(resolve(tmpdir(), 'eky-w6b-long-path-'));
  const aliasSegment = resolve(tempRoot, 'alias-segment');
  mkdirSync(aliasSegment);
  const fixtureTemp =
    tempForm === 'lexical' ? `${aliasSegment}\\..` : tempRoot;
  try {
    const arguments_ = [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      resolve(scriptDirectory, 'w6bLegacy', 'longPathEvidence.test.ps1'),
    ];
    if (testCase !== 'success') {
      arguments_.push('-TestCase', testCase);
    }
    return spawnSync('powershell.exe', arguments_, {
      encoding: 'utf8',
      env: { ...process.env, TEMP: fixtureTemp, TMP: fixtureTemp },
      windowsHide: true,
    });
  } finally {
    rmSync(tempRoot, { force: true, recursive: true });
  }
}

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
  assert.equal(arguments_.includes('-SourceRuntimeBuildRevision'), true);
  assert.equal(arguments_.includes(source.runtimeBuildRevision), true);
  assert.equal(arguments_.includes('-TargetPackageSha256'), true);
  assert.equal(arguments_.includes(target.packageSha256), true);
  assert.equal(arguments_.includes('-TargetMsiProductVersion'), true);
  assert.equal(arguments_.includes('-TargetPackageVersion'), true);
  assert.equal(arguments_.includes('-TargetReleaseChannel'), true);
  assert.equal(arguments_.includes('-TargetUpgradeCode'), true);
  assert.equal(arguments_.includes('-LineageProfileIdPattern'), true);
  assert.equal(arguments_.includes(w6bLineageProfileIdPattern), true);
  assert.equal(arguments_.includes('--user-data-dir'), false);
  assert.equal(
    arguments_.some((value) => /password|companyId|session/iu.test(value)),
    false,
  );
});

test('rejects a missing or drifting historical runtime identity', () => {
  const { runtimeBuildRevision: _runtimeBuildRevision, ...withoutRuntime } =
    source;
  for (const invalidSource of [
    withoutRuntime,
    { ...source, runtimeBuildRevision: source.buildRevision },
    { ...source, runtimeBuildRevision: 'a'.repeat(12) },
    {
      ...source,
      runtimeBuildRevision: source.runtimeBuildRevision.toUpperCase(),
    },
  ]) {
    assert.throws(
      () =>
        createW6bLegacyUpgradeAcceptanceArguments({
          source: invalidSource,
          target,
        }),
      /W6B_LEGACY_SOURCE_IDENTITY_INVALID/,
    );
  }
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

test('classifies current and legacy accepted-build slots independently', {
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
      resolve(scriptDirectory, 'w6bLegacy', 'acceptedBuildEvidence.test.ps1'),
    ],
    { encoding: 'utf8', windowsHide: true },
  );

  assert.equal(result.status, 0, 'W6B_ACCEPTED_BUILD_EVIDENCE_TEST_FAILED');
  const lines = result.stdout
    .split(/\r?\n/u)
    .filter((line) => line.trim() !== '');
  assert.equal(lines.length, 1);
  assert.deepEqual(JSON.parse(lines[0]), {
    currentAndLegacyClassifiedSeparately: true,
    invalidMetadataRejected: true,
    status: 'succeeded',
    targetRevisionMismatchDistinguished: true,
  });
});

for (const tempForm of longPathTempForms) {
  test(`reads deep adopted workspace evidence with ${tempForm} Windows temp`, {
    skip: process.platform !== 'win32',
  }, () => {
    const result = runLongPathEvidenceTest({ tempForm });

    assert.equal(result.status, 0, 'W6B_LONG_PATH_EVIDENCE_TEST_FAILED');
    assert.equal(result.stderr, '');
    const lines = result.stdout
      .split(/\r?\n/u)
      .filter((line) => line.trim() !== '');
    assert.equal(lines.length, 1);
    assert.deepEqual(JSON.parse(lines[0]), {
      invalidCleanupRootRejected: true,
      longPathCleanupValidated: true,
      longPathHashValidated: true,
      longPathInventoryValidated: true,
      readOnlyCleanupValidated: true,
      reparsePointRejected: true,
      registryEvidenceValidated: true,
      status: 'succeeded',
    });
  });

  test(`reports one safe long-path failure with ${tempForm} Windows temp`, {
    skip: process.platform !== 'win32',
  }, () => {
    const result = runLongPathEvidenceTest({
      tempForm,
      testCase: 'safeFailure',
    });

    assert.equal(result.status, 1, 'W6B_LONG_PATH_SAFE_FAILURE_TEST_FAILED');
    assert.equal(result.stderr, '');
    const lines = result.stdout
      .split(/\r?\n/u)
      .filter((line) => line.trim() !== '');
    assert.equal(lines.length, 1);
    assert.deepEqual(JSON.parse(lines[0]), {
      errorCode: 'W6B_LONG_PATH_SAFE_FAILURE_FIXTURE',
      status: 'failed',
      testCase: 'longPathEvidence',
    });
  });
}

test('keeps the PowerShell acceptance boundary synthetic and identity-safe', () => {
  const sourceSmokeText = readFileSync(
    new URL('./w6bLegacy/sourceSmoke.ps1', import.meta.url),
    'utf8',
  );
  const sourceText = [
    './testW6bLegacyUpgradeAcceptance.ps1',
    './w6bLegacy/evidence.ps1',
    './w6bLegacy/gracefulApplicationShutdown.ps1',
    './w6bLegacy/historicalPackagedSmokeProcessChain.ps1',
    './w6bLegacy/installerLifecycle.ps1',
    './w6bLegacy/nativeWindowsPath.ps1',
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
  assert.match(sourceText, /Read-W6bAcceptedBuildIdentitySlots/iu);
  assert.doesNotMatch(sourceText, /function Read-W6bAcceptedBuild\s*\{/iu);
  assert.match(sourceText, /function Wait-W6bOwnedApplicationWindow/iu);
  assert.match(
    sourceText,
    /\$script:PreflightIsolationEstablished\s*=\s*\$false/iu,
  );
  assert.match(
    sourceText,
    /Assert-EkyInstallerRegistrationAbsent[\s\S]*?\$script:PreflightIsolationEstablished\s*=\s*\$true/iu,
  );
  assert.match(
    sourceText,
    /Start-W6bLegacyStage -Stage sourceInstall\s+\$script:SourceCleanupAuthorized\s*=\s*\$true\s+Install-W6bPackage/iu,
  );
  assert.match(
    sourceText,
    /Start-W6bLegacyStage -Stage targetInstall\s+\$script:TargetCleanupAuthorized\s*=\s*\$true\s+Install-W6bPackage/iu,
  );
  assert.match(
    sourceText,
    /\$cleanupProducts = if \(\$script:PreflightIsolationEstablished\)[\s\S]*?if \(\$script:TargetCleanupAuthorized\)[\s\S]*?if \(\$script:SourceCleanupAuthorized\)/iu,
  );
  assert.match(
    sourceText,
    /\$isolatedAppDataRoot\s*=\s*Join-Path \$testRoot 'app-data-roaming'/iu,
  );
  assert.match(
    sourceText,
    /\$testRootToken\s*=\s*\[guid\]::NewGuid\(\)\.ToString\('N'\)\.Substring\(0, 12\)/u,
  );
  assert.match(
    sourceText,
    /\$sourceSmokeTempRoot\s*=\s*Join-Path \$testRoot 's'/u,
  );
  assert.match(sourceText, /Assert-W6bLegacyArtifactPathBudget/u);
  assert.match(sourceText, /W6B_LEGACY_TEST_PATH_BUDGET_EXCEEDED/u);
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
  assert.match(
    sourceText,
    /W6B_LEGACY_TARGET_ACCEPTED_BUILD_REVISION_MISMATCH/iu,
  );
  assert.match(
    sourceText,
    /\$SourceBuildRevision\.Substring\(0, 12\) -cne \$SourceRuntimeBuildRevision/iu,
  );
  assert.match(
    sourceText,
    /-ExpectedRevision \$SourceRuntimeBuildRevision/iu,
  );
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
  assert.match(
    sourceText,
    /Wait-W6bOwnedApplicationWindow[\s\S]*?CloseMainWindow\(\)/iu,
  );
  assert.match(sourceText, /Assert-W6bPackageHash/iu);
  assert.match(sourceText, /W6B_LEGACY_NORMAL_PROFILE_CHANGED/iu);
  assert.doesNotMatch(sourceText, /Stop-Process\s+-Name/iu);
  assert.doesNotMatch(sourceText, /Write-(?:Host|Output).*Exception\.Message/iu);
  assert.doesNotMatch(sourceText, /Write-(?:Host|Output).*StackTrace/iu);
});

for (const gracefulShutdownTestCase of gracefulShutdownTestCases) {
  test(`graceful application shutdown case ${gracefulShutdownTestCase}`, {
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
          'gracefulApplicationShutdown.test.ps1',
        ),
        '-TestCase',
        gracefulShutdownTestCase,
      ],
      { encoding: 'utf8', windowsHide: true },
    );
    const lines = parseProcessChainOutput(result.stdout);
    assert.equal(
      result.status,
      0,
      createSafeProcessChainFailureMessage(
        gracefulShutdownTestCase,
        result.stdout,
      ),
    );
    assert.equal(lines.length, 1);
    assert.deepEqual(JSON.parse(lines[0]), {
      status: 'passed',
      testCase: gracefulShutdownTestCase,
    });
  });
}

for (const processChainTestCase of processChainTestCases) {
  test(`historical smoke process chain case ${processChainTestCase.name}`, {
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
        '-TestCase',
        processChainTestCase.name,
      ],
      { encoding: 'utf8', windowsHide: true },
    );

    const lines = parseProcessChainOutput(result.stdout);
    if (processChainTestCase.errorCode !== undefined) {
      assert.equal(
        result.status,
        1,
        createSafeProcessChainFailureMessage(
          processChainTestCase.name,
          result.stdout,
        ),
      );
      assert.equal(lines.length, 1);
      assert.deepEqual(JSON.parse(lines[0]), {
        errorCode: processChainTestCase.errorCode,
        status: 'failed',
        testCase: processChainTestCase.name,
      });
      return;
    }

    assert.equal(
      result.status,
      0,
      createSafeProcessChainFailureMessage(
        processChainTestCase.name,
        result.stdout,
      ),
    );
    assert.equal(lines.length, processChainTestCase.progressCount + 1);
    const progressLines = lines
      .slice(0, -1)
      .map((line) => JSON.parse(line));
    for (const progress of progressLines) {
      assertSafeProcessChainProgress(progress);
    }
    const outcome = JSON.parse(lines.at(-1));
    assert.equal(outcome.status, 'succeeded');
    assert.equal(outcome.testCase, processChainTestCase.name);

    if (processChainTestCase.name === 'ownedDescendantChain') {
      assert.deepEqual(Object.keys(outcome).sort(), [
        'contract',
        'fixture',
        'foreignProcessUntouched',
        'initialGenerationCount',
        'initialOwnedProcessCount',
        'remainingOwnedProcessCount',
        'restoredGenerationCount',
        'restoredOwnedProcessCount',
        'status',
        'testCase',
      ]);
      assert.equal(outcome.contract, 'explicitTwoPhase');
      assert.equal(outcome.fixture, 'synthetic');
      assert.equal(outcome.foreignProcessUntouched, true);
      assert.equal(outcome.initialGenerationCount, 1);
      assert.equal(outcome.initialOwnedProcessCount >= 2, true);
      assert.equal(outcome.remainingOwnedProcessCount, 0);
      assert.equal(outcome.restoredGenerationCount, 1);
      assert.equal(outcome.restoredOwnedProcessCount >= 2, true);
    } else if (processChainTestCase.name === 'invalidStarts') {
      assert.deepEqual(outcome, {
        invalidProcessStartsRejected: true,
        status: 'succeeded',
        testCase: 'invalidStarts',
      });
    } else {
      assert.deepEqual(outcome, {
        status: 'succeeded',
        testCase: processChainTestCase.name,
      });
    }
  });
}

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
    legacyArtifactPathBudget: 'bounded',
    pathAliasesCanonicalized: true,
    reparsePointRejected: true,
    safeFileEnumeration: 'flat',
    status: 'succeeded',
  });
});
