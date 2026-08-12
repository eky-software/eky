import { execFile } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import { readInstallerReleaseGitState } from '../installerReleaseContext.mjs';
import { readInstallerReleaseConfig } from '../installerVersion.mjs';
import {
  createWindowsPackageReleaseIdentity,
  getWindowsUpdateFixtureDefinition,
  windowsUpdateFixtureNames,
} from '../../scripts/windows-update-package-fixture.mjs';
import { buildWindowsInstaller } from './buildWindowsInstaller.mjs';
import { createWindowsInstallerRelease } from './releaseWindowsInstaller.mjs';

const execFileAsync = promisify(execFile);
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const installerDirectory = resolve(scriptDirectory, '..');
const desktopDirectory = resolve(installerDirectory, '..');
const repositoryRoot = resolve(desktopDirectory, '..', '..');
const fixtureRoot = join(installerDirectory, 'artifacts', 'update-e2e');
const releaseConfigPath = join(installerDirectory, 'installer-release.json');
const desktopPackagePath = join(desktopDirectory, 'package.json');
const packageScriptPath = join(desktopDirectory, 'scripts', 'package-windows.mjs');

export async function preparePackagedUpdateE2eFixture() {
  const [baseRelease, buildRevision] = await Promise.all([
    readInstallerReleaseConfig(releaseConfigPath, desktopPackagePath),
    readInstallerReleaseGitState({ repositoryRoot }),
  ]);

  await rm(fixtureRoot, { force: true, recursive: true });
  const packages = {};

  for (const role of windowsUpdateFixtureNames) {
    const mode = Object.freeze({
      definition: getWindowsUpdateFixtureDefinition(role),
      fixtureName: role,
      kind: 'update-e2e-fixture',
      pilot: false,
    });
    const identity = createWindowsPackageReleaseIdentity(mode, baseRelease);
    const release = Object.freeze({ ...baseRelease, ...identity });
    const packageOutputRoot = join(fixtureRoot, 'packages', role);
    const payloadRoot = join(packageOutputRoot, 'Eky-win32-x64');
    const inputRoot = join(fixtureRoot, 'inputs', role);
    const installerArtifactsRoot = join(fixtureRoot, 'installers', role);
    const fixtureDesktopPackagePath = join(inputRoot, 'package.json');
    const fixtureReleaseConfigPath = join(inputRoot, 'installer-release.json');

    await execFileAsync(
      process.execPath,
      [packageScriptPath, `--update-e2e-${role}`],
      { cwd: repositoryRoot, maxBuffer: 32 * 1024 * 1024 },
    );
    await mkdir(inputRoot, { recursive: true });
    await Promise.all([
      writeFile(
        fixtureDesktopPackagePath,
        `${JSON.stringify({ version: identity.appVersion }, null, 2)}\n`,
        'utf8',
      ),
      writeFile(
        fixtureReleaseConfigPath,
        `${JSON.stringify(release, null, 2)}\n`,
        'utf8',
      ),
    ]);

    const installer = await createWindowsInstallerRelease({
      buildInstaller: () =>
        buildWindowsInstaller({
          artifactsRoot: installerArtifactsRoot,
          desktopPackagePath: fixtureDesktopPackagePath,
          payloadRoot,
          releaseConfigPath: fixtureReleaseConfigPath,
        }),
      buildRevision,
    });

    packages[role] = createPackagedUpdateFixturePackage({
      applicationPath: payloadRoot,
      installer,
    });
  }

  const fixture = Object.freeze({
    buildRevision,
    fixtureFormatVersion: 1,
    packages: Object.freeze(packages),
  });
  const fixturePath = join(fixtureRoot, 'fixture.json');
  await writeFile(fixturePath, `${JSON.stringify(fixture, null, 2)}\n`, 'utf8');
  return Object.freeze({ fixture, fixturePath });
}

export function createPackagedUpdateFixturePackage({
  applicationPath,
  installer,
}) {
  const { manifest, release } = installer;
  if (
    manifest.appVersion !== release.appVersion ||
    manifest.msiProductVersion !== release.msiProductVersion
  ) {
    throw new Error('PACKAGED_UPDATE_E2E_RELEASE_IDENTITY_MISMATCH');
  }
  return Object.freeze({
    appVersion: release.appVersion,
    applicationPath,
    manifestPath: installer.manifestPath,
    msiPath: installer.installerPath,
    msiProductVersion: release.msiProductVersion,
    packageSha256: manifest.packageSha256,
    packageSize: manifest.packageSize,
    productCode: installer.productCode,
  });
}

if (
  process.argv[1] !== undefined &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  if (process.argv.length !== 2) {
    throw new Error('PACKAGED_UPDATE_E2E_ARGUMENTS_INVALID');
  }
  console.log(JSON.stringify(await preparePackagedUpdateE2eFixture()));
}
