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

test('uses runtime-independent SHA-256 APIs in Windows installer gates', async () => {
  const scripts = await Promise.all(
    [
      'scripts/verifyLockedInstallerRestore.ps1',
      'scripts/windowsInstallerTestSupport.ps1',
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
  assert.equal((support.match(/AllowEmptyCollection/g) ?? []).length, 2);
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
  assert.ok(uninstallIndex >= 0);
  assert.ok(rollbackInstallIndex > uninstallIndex);
  assert.ok(failedRepairIndex > rollbackInstallIndex);
  assert.match(rollbackScript, /\$ErrorActionPreference = 'Continue'/);
  assert.match(rollbackScript, /2>\$null/);
  assert.match(rollbackScript, /return 1603/);
  assert.doesNotMatch(
    rollbackScript,
    /Invoke-Expression|Start-Process|cmd\.exe|\.bat\b|\.cmd\b/iu,
  );
});
