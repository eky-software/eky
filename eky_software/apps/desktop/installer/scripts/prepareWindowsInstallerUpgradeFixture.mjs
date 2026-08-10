import { link, lstat, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { createInstallerProductCode } from '../installerIdentity.mjs';
import {
  parseMsiProductVersion,
  readInstallerReleaseConfig,
} from '../installerVersion.mjs';
import { buildWindowsInstaller } from './buildWindowsInstaller.mjs';

const installerDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const desktopDirectory = resolve(installerDirectory, '..');
const currentReleaseConfigPath = join(
  installerDirectory,
  'installer-release.json',
);
const currentDesktopPackagePath = join(desktopDirectory, 'package.json');
const payloadRoot = join(desktopDirectory, 'out', 'Eky-win32-x64');
const fixtureRoot = join(installerDirectory, 'artifacts', 'upgrade-fixture');

export function createUpgradeFixtureAppVersion(currentVersion) {
  if (typeof currentVersion !== 'string' || currentVersion.includes('+')) {
    throw new Error('INSTALLER_UPGRADE_FIXTURE_APP_VERSION_INVALID');
  }
  return currentVersion.includes('-')
    ? `${currentVersion}.installer-upgrade.1`
    : `${currentVersion}-installer-upgrade.1`;
}

export function createUpgradeFixtureMsiVersion(currentVersion) {
  const parts = [...parseMsiProductVersion(currentVersion)];
  if (parts[2] >= 65_535) {
    throw new Error('INSTALLER_UPGRADE_FIXTURE_MSI_VERSION_EXHAUSTED');
  }
  parts[2] += 1;
  return parts.join('.');
}

export async function prepareWindowsInstallerUpgradeFixture() {
  const currentRelease = await readInstallerReleaseConfig(
    currentReleaseConfigPath,
    currentDesktopPackagePath,
  );
  const nextRelease = Object.freeze({
    ...currentRelease,
    appVersion: createUpgradeFixtureAppVersion(currentRelease.appVersion),
    msiProductVersion: createUpgradeFixtureMsiVersion(
      currentRelease.msiProductVersion,
    ),
  });
  const currentArtifactsRoot = join(fixtureRoot, 'current');
  const nextArtifactsRoot = join(fixtureRoot, 'next');
  const inputRoot = join(fixtureRoot, 'input');
  const rollbackPayloadRoot = join(fixtureRoot, 'rollback-payload');
  const nextDesktopPackagePath = join(inputRoot, 'package.json');
  const nextReleaseConfigPath = join(inputRoot, 'installer-release.json');

  await rm(fixtureRoot, { force: true, recursive: true });
  await mkdir(inputRoot, { recursive: true });
  await writeFile(
    nextDesktopPackagePath,
    `${JSON.stringify({ version: nextRelease.appVersion }, null, 2)}\n`,
    'utf8',
  );
  await writeFile(
    nextReleaseConfigPath,
    `${JSON.stringify(nextRelease, null, 2)}\n`,
    'utf8',
  );

  const currentBuild = await buildWindowsInstaller({
    artifactsRoot: currentArtifactsRoot,
  });
  const nextBuild = await buildWindowsInstaller({
    artifactsRoot: nextArtifactsRoot,
    desktopPackagePath: nextDesktopPackagePath,
    releaseConfigPath: nextReleaseConfigPath,
  });
  if (
    currentBuild.payloadFileCount !== nextBuild.payloadFileCount ||
    currentBuild.inventory.fileCount !== nextBuild.inventory.fileCount ||
    currentBuild.inventory.identity !== nextBuild.inventory.identity ||
    currentBuild.inventory.stage !== nextBuild.inventory.stage ||
    currentBuild.inventory.totalByteSize !== nextBuild.inventory.totalByteSize
  ) {
    throw new Error('INSTALLER_UPGRADE_FIXTURE_PAYLOAD_MISMATCH');
  }
  await cloneDirectoryWithHardLinks(payloadRoot, rollbackPayloadRoot);
  const rollbackProbeDirectory = join(
    rollbackPayloadRoot,
    'resources',
    'desktop-runtime',
    'installer-rollback-probe',
  );
  await mkdir(rollbackProbeDirectory, { recursive: true });
  await writeFile(
    join(rollbackProbeDirectory, 'probe.txt'),
    'Synthetic MSI rollback probe.\n',
    'utf8',
  );
  const rollbackBuild = await buildWindowsInstaller({
    artifactsRoot: join(fixtureRoot, 'rollback'),
    desktopPackagePath: nextDesktopPackagePath,
    payloadRoot: rollbackPayloadRoot,
    releaseConfigPath: nextReleaseConfigPath,
  });
  if (rollbackBuild.payloadFileCount !== currentBuild.payloadFileCount + 1) {
    throw new Error('INSTALLER_UPGRADE_ROLLBACK_FIXTURE_PAYLOAD_INVALID');
  }

  const fixture = Object.freeze({
    current: Object.freeze({
      appVersion: currentBuild.release.appVersion,
      msiPath: currentBuild.artifact,
      msiProductVersion: currentBuild.release.msiProductVersion,
      productCode: currentBuild.productCode,
    }),
    fixtureFormatVersion: 1,
    next: Object.freeze({
      appVersion: nextBuild.release.appVersion,
      msiPath: nextBuild.artifact,
      msiProductVersion: nextBuild.release.msiProductVersion,
      productCode: nextBuild.productCode,
    }),
    payloadFileCount: currentBuild.payloadFileCount,
    payloadRoot,
    rollback: Object.freeze({
      msiPath: rollbackBuild.artifact,
      payloadFileCount: rollbackBuild.payloadFileCount,
      productCode: rollbackBuild.productCode,
    }),
  });
  const fixturePath = join(fixtureRoot, 'fixture.json');
  await writeFile(fixturePath, `${JSON.stringify(fixture, null, 2)}\n`, 'utf8');
  return Object.freeze({ fixture, fixturePath });
}

async function cloneDirectoryWithHardLinks(sourceRoot, targetRoot) {
  await mkdir(targetRoot, { recursive: true });
  const visit = async (sourceDirectory, targetDirectory) => {
    const entries = await readdir(sourceDirectory, { withFileTypes: true });
    for (const entry of entries) {
      const sourcePath = join(sourceDirectory, entry.name);
      const targetPath = join(targetDirectory, entry.name);
      const metadata = await lstat(sourcePath);
      if (metadata.isSymbolicLink()) {
        throw new Error('INSTALLER_UPGRADE_FIXTURE_SYMLINK_FORBIDDEN');
      }
      if (metadata.isDirectory()) {
        await mkdir(targetPath);
        await visit(sourcePath, targetPath);
      } else if (metadata.isFile()) {
        await link(sourcePath, targetPath);
      } else {
        throw new Error('INSTALLER_UPGRADE_FIXTURE_FILE_TYPE_FORBIDDEN');
      }
    }
  };
  await visit(sourceRoot, targetRoot);
}

if (
  process.argv[1] !== undefined &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  console.log(JSON.stringify(await prepareWindowsInstallerUpgradeFixture()));
}
