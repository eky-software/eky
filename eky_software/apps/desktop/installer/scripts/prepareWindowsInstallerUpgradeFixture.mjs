import { execFile } from 'node:child_process';
import { link, lstat, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import { createInstallerProductCode } from '../installerIdentity.mjs';
import { readInstallerManifest } from '../installerManifest.mjs';
import { readInstallerReleaseGitState } from '../installerReleaseContext.mjs';
import {
  parseNumericAppVersion,
  parseMsiProductVersion,
  readInstallerReleaseConfig,
} from '../installerVersion.mjs';
import { buildWindowsInstaller } from './buildWindowsInstaller.mjs';
import { createInstallerSidecarPath } from './releaseWindowsInstaller.mjs';
import { verifyWindowsInstallerRelease } from './verifyWindowsInstallerRelease.mjs';

const installerDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const desktopDirectory = resolve(installerDirectory, '..');
const repositoryRoot = resolve(desktopDirectory, '..', '..');
const currentReleaseConfigPath = join(
  installerDirectory,
  'installer-release.json',
);
const currentDesktopPackagePath = join(desktopDirectory, 'package.json');
const payloadRoot = join(desktopDirectory, 'out', 'Eky-win32-x64');
const fixtureRoot = join(installerDirectory, 'artifacts', 'upgrade-fixture');
const releaseArtifactsRoot = join(installerDirectory, 'artifacts');
const execFileAsync = promisify(execFile);
const fullRevisionPattern = /^[0-9a-f]{40}$/;

export function createUpgradeFixtureAppVersion(currentVersion) {
  try {
    parseNumericAppVersion(currentVersion);
  } catch {
    throw new Error('INSTALLER_UPGRADE_FIXTURE_APP_VERSION_INVALID');
  }
  const parts = currentVersion.split('.');
  parts[2] = (BigInt(parts[2]) + 1n).toString();
  return parts.join('.');
}

export function createUpgradeFixtureMsiVersion(currentVersion) {
  const parts = [...parseMsiProductVersion(currentVersion)];
  if (parts[2] >= 65_535) {
    throw new Error('INSTALLER_UPGRADE_FIXTURE_MSI_VERSION_EXHAUSTED');
  }
  parts[2] += 1;
  return parts.join('.');
}

export function validateUpgradeFixtureReleaseRevision({
  artifactRevision,
  currentRevision,
  isAncestor,
}) {
  if (
    !fullRevisionPattern.test(artifactRevision) ||
    !fullRevisionPattern.test(currentRevision) ||
    isAncestor !== true
  ) {
    throw new Error('INSTALLER_UPGRADE_FIXTURE_RELEASE_REVISION_INVALID');
  }
  return artifactRevision;
}

async function readUpgradeFixtureReleaseRevision({
  currentRevision,
  manifestPath,
}) {
  const manifest = await readInstallerManifest(manifestPath);
  let isAncestor = false;
  try {
    await execFileAsync(
      'git',
      ['merge-base', '--is-ancestor', manifest.buildRevision, currentRevision],
      {
        cwd: repositoryRoot,
        encoding: 'utf8',
        windowsHide: true,
      },
    );
    isAncestor = true;
  } catch (error) {
    if (error?.code !== 1) {
      throw new Error('INSTALLER_UPGRADE_FIXTURE_RELEASE_REVISION_CHECK_FAILED');
    }
  }
  return validateUpgradeFixtureReleaseRevision({
    artifactRevision: manifest.buildRevision,
    currentRevision,
    isAncestor,
  });
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

  const currentMsiPath = join(
    releaseArtifactsRoot,
    `Eky-${currentRelease.appVersion}-x64.msi`,
  );
  const currentManifestPath = createInstallerSidecarPath(currentMsiPath);
  const currentRevision = await readInstallerReleaseGitState({ repositoryRoot });
  const releaseBuildRevision = await readUpgradeFixtureReleaseRevision({
    currentRevision,
    manifestPath: currentManifestPath,
  });
  const currentReleaseArtifact = await verifyWindowsInstallerRelease({
    buildRevision: releaseBuildRevision,
    installerPath: currentMsiPath,
    manifestPath: currentManifestPath,
    release: currentRelease,
  });
  const nextBuild = await buildWindowsInstaller({
    artifactsRoot: nextArtifactsRoot,
    desktopPackagePath: nextDesktopPackagePath,
    releaseConfigPath: nextReleaseConfigPath,
  });
  if (nextBuild.inventory.stage !== 'packagedApp') {
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
  if (rollbackBuild.payloadFileCount !== nextBuild.payloadFileCount + 1) {
    throw new Error('INSTALLER_UPGRADE_ROLLBACK_FIXTURE_PAYLOAD_INVALID');
  }

  const fixture = Object.freeze({
    current: Object.freeze({
      appVersion: currentRelease.appVersion,
      msiPath: currentReleaseArtifact.installerPath,
      msiProductVersion: currentRelease.msiProductVersion,
      packageSha256: currentReleaseArtifact.manifest.packageSha256,
      productCode: createInstallerProductCode(currentRelease.msiProductVersion),
      source: 'release',
    }),
    fixtureFormatVersion: 2,
    next: Object.freeze({
      appVersion: nextBuild.release.appVersion,
      msiPath: nextBuild.artifact,
      msiProductVersion: nextBuild.release.msiProductVersion,
      productCode: nextBuild.productCode,
      source: 'synthetic-upgrade',
    }),
    payloadFileCount: nextBuild.payloadFileCount,
    payloadRoot,
    rollback: Object.freeze({
      msiPath: rollbackBuild.artifact,
      payloadFileCount: rollbackBuild.payloadFileCount,
      productCode: rollbackBuild.productCode,
      source: 'synthetic-rollback',
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
