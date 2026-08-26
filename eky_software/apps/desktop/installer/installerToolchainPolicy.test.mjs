import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const installerDirectory = dirname(fileURLToPath(import.meta.url));
const desktopDirectory = resolve(installerDirectory, '..');
const repositoryRoot = resolve(installerDirectory, '..', '..', '..');
const workspaceRoot = resolve(repositoryRoot, '..');

test('pins the approved .NET and WiX toolchain without broad ICE suppression', async () => {
  const globalJson = JSON.parse(
    await readFile(join(repositoryRoot, 'global.json'), 'utf8'),
  );
  assert.deepEqual(globalJson, {
    sdk: {
      allowPrerelease: false,
      rollForward: 'disable',
      version: '10.0.302',
    },
  });

  const project = await readFile(
    join(installerDirectory, 'Eky.Installer.wixproj'),
    'utf8',
  );
  assert.match(project, /Project Sdk="WixToolset\.Sdk\/7\.0\.0"/);
  assert.match(project, /<RestoreLockedMode>true<\/RestoreLockedMode>/);
  assert.match(project, /<SuppressIces>ICE91<\/SuppressIces>/);
  assert.match(project, /<SuppressValidation>false<\/SuppressValidation>/);
  assert.match(project, /<TreatWarningsAsErrors>true<\/TreatWarningsAsErrors>/);
  assert.doesNotMatch(project, /SuppressIces>[^<]*(?:;|ICE(?!91))/);
});

test('allows only the approved signed NuGet source and exact setup-dotnet SHA', async () => {
  const nugetConfig = await readFile(
    join(installerDirectory, 'NuGet.Config'),
    'utf8',
  );
  assert.match(
    nugetConfig,
    /signatureValidationMode" value="require"/,
  );
  assert.equal(
    (nugetConfig.match(/<add key="nuget\.org"/g) ?? []).length,
    1,
  );
  assert.match(nugetConfig, /package pattern="WixToolset\.Sdk"/);
  assert.match(nugetConfig, /<trustedSigners>/);
  assert.match(nugetConfig, /<author name="FireGiant">/);

  const ci = await readFile(join(workspaceRoot, '.github', 'workflows', 'ci.yml'), 'utf8');
  assert.match(
    ci,
    /actions\/setup-dotnet@26b0ec14cb23fa6904739307f278c14f94c95bf1 # v5\.4\.0/,
  );
  assert.match(ci, /dotnet-version: 10\.0\.302/);
  assert.doesNotMatch(ci, /actions\/setup-dotnet@v\d/);
});

test('isolates W6B acceptance jobs from the regular MSI release gate', async () => {
  const ci = await readFile(
    join(workspaceRoot, '.github', 'workflows', 'ci.yml'),
    'utf8',
  );
  const installerJobIndex = ci.indexOf('  installer-windows:');
  const legacyJobIndex = ci.indexOf('  installer-w6b-legacy-windows:');
  const packagedSuccessJobIndex = ci.indexOf(
    '  installer-w6b2-success-windows:',
  );
  const installerJob = ci.slice(installerJobIndex, legacyJobIndex);
  const legacyJob = ci.slice(legacyJobIndex, packagedSuccessJobIndex);
  const packagedSuccessJob = ci.slice(packagedSuccessJobIndex);
  const legacyAcceptance =
    'run: pnpm --filter @eky/desktop installer:w6b-legacy';
  const packagedSuccessAcceptance =
    'run: pnpm --filter @eky/desktop installer:w6b2-success';
  const prepareElectronRuntime =
    'run: pnpm --filter @eky/desktop e2e:prepare-electron-runtime';
  const localPilotBundle =
    'run: pnpm --filter @eky/desktop installer:local-pilot-bundle';

  assert.ok(installerJobIndex >= 0);
  assert.ok(legacyJobIndex > installerJobIndex);
  assert.ok(packagedSuccessJobIndex > legacyJobIndex);
  assert.match(
    installerJob,
    /- name: Check out repository[\s\S]*?persist-credentials: false\s+fetch-depth: 0/u,
  );
  assert.match(installerJob, /timeout-minutes: 45/u);
  assert.match(installerJob, new RegExp(localPilotBundle, 'u'));
  assert.doesNotMatch(installerJob, new RegExp(legacyAcceptance, 'u'));
  assert.match(
    legacyJob,
    /- name: Check out repository[\s\S]*?persist-credentials: false\s+fetch-depth: 0/u,
  );
  assert.match(legacyJob, /timeout-minutes: 30/u);
  assert.match(legacyJob, new RegExp(legacyAcceptance, 'u'));
  assert.doesNotMatch(legacyJob, new RegExp(packagedSuccessAcceptance, 'u'));
  assert.doesNotMatch(legacyJob, new RegExp(localPilotBundle, 'u'));
  assert.match(
    packagedSuccessJob,
    /- name: Check out repository[\s\S]*?persist-credentials: false\s+fetch-depth: 0/u,
  );
  assert.match(packagedSuccessJob, /timeout-minutes: 30/u);
  assert.match(
    packagedSuccessJob,
    new RegExp(prepareElectronRuntime, 'u'),
  );
  assert.match(
    packagedSuccessJob,
    new RegExp(packagedSuccessAcceptance, 'u'),
  );
  assert.doesNotMatch(
    packagedSuccessJob,
    new RegExp(legacyAcceptance, 'u'),
  );
  assert.doesNotMatch(packagedSuccessJob, new RegExp(localPilotBundle, 'u'));
  assert.equal(ci.split('fetch-depth: 0').length - 1, 3);
  assert.equal(ci.split(legacyAcceptance).length - 1, 1);
  assert.equal(ci.split(packagedSuccessAcceptance).length - 1, 1);
});

test('uses runtime-independent SHA-256 APIs in Windows installer gates', async () => {
  const scripts = await Promise.all(
    [
      'scripts/verifyLockedInstallerRestore.ps1',
      'scripts/windowsInstallerTestSupport.ps1',
      'scripts/windowsInstallerUpgradeAttempt.ps1',
      'scripts/testWindowsInstallerUpgrade.ps1',
    ].map((path) => readFile(join(installerDirectory, path), 'utf8')),
  );
  const source = scripts.join('\n');

  assert.doesNotMatch(source, /Get-FileHash/);
  assert.match(source, /System\.Security\.Cryptography\.SHA256/);
  assert.match(source, /System\.IO\.File.*OpenRead/);
});

test('keeps empty installer directory inventories as comparable arrays', async () => {
  const support = await readFile(
    join(installerDirectory, 'scripts/windowsInstallerTestSupport.ps1'),
    'utf8',
  );

  assert.match(support, /return ,@\(\)/);
  assert.match(support, /return ,\$inventory/);
  const inventoryComparisonSource = support.slice(
    support.indexOf('function Assert-EkyInventoryEqual'),
    support.indexOf('function Assert-EkyInstalledPayload'),
  );
  assert.equal(
    (inventoryComparisonSource.match(/AllowEmptyCollection/g) ?? []).length,
    2,
  );
});

test('keeps direct downgrade blocked and rollback outside MSI authoring', async () => {
  const packageSource = await readFile(
    join(installerDirectory, 'wix', 'Package.wxs'),
    'utf8',
  );
  const rollbackScript = await readFile(
    join(
      desktopDirectory,
      'resources',
      'update',
      'rollbackWindowsInstaller.ps1',
    ),
    'utf8',
  );

  assert.match(packageSource, /<MajorUpgrade/);
  assert.match(packageSource, /AllowDowngrades="no"/);
  assert.match(packageSource, /AllowSameVersionUpgrades="no"/);
  assert.doesNotMatch(packageSource, /EKY_COORDINATED_ROLLBACK/);
  assert.doesNotMatch(packageSource, /<UpgradeVersion/);

  const uninstallIndex = rollbackScript.indexOf("'/x', $FailedProductCode");
  const rollbackInstallIndex = rollbackScript.indexOf(
    "'/i', $RollbackPackagePath",
  );
  const failedRepairIndex = rollbackScript.indexOf("'/i', $FailedPackagePath");
  const launcherExitIndex = rollbackScript.indexOf(
    'Wait-LauncherProcessExit -ProcessId $LauncherProcessId',
  );
  assert.ok(launcherExitIndex >= 0);
  assert.ok(uninstallIndex > launcherExitIndex);
  assert.ok(uninstallIndex >= 0);
  assert.ok(rollbackInstallIndex > uninstallIndex);
  assert.ok(failedRepairIndex > rollbackInstallIndex);
  assert.match(rollbackScript, /System\.Diagnostics\.ProcessStartInfo/);
  assert.match(rollbackScript, /UseShellExecute = \$false/);
  assert.match(rollbackScript, /CreateNoWindow = \$true/);
  assert.match(rollbackScript, /WaitForExit\(\)/);
  assert.match(rollbackScript, /ROLLBACK_ARGUMENT_INVALID/);
  assert.match(rollbackScript, /exit 24/);
  assert.match(rollbackScript, /exit 25/);
  assert.match(rollbackScript, /exit 26/);
  assert.match(rollbackScript, /exit 27/);
  assert.match(rollbackScript, /Test observability must never change rollback behavior/u);
  for (const phase of [
    'inputValidation',
    'launcherExitWait',
    'failedPackageUninstall',
    'rollbackPackageInstall',
    'failedPackageRepair',
  ]) {
    assert.match(rollbackScript, new RegExp(`-Phase ${phase}`, 'u'));
    assert.match(
      rollbackScript,
      new RegExp(`ActiveProgressPhase = '${phase}'`, 'u'),
    );
  }
  assert.match(
    rollbackScript,
    /if \(\$null -ne \$script:ActiveProgressPhase\)[\s\S]*Write-RollbackProgress -Phase \$script:ActiveProgressPhase -Event failed/u,
  );
  assert.doesNotMatch(
    rollbackScript,
    /Invoke-Expression|Start-Process|cmd\.exe|\.bat\b|\.cmd\b/iu,
  );
});
