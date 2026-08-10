import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const installerDirectory = dirname(fileURLToPath(import.meta.url));
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
