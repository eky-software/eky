import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { INSTALLER_UPGRADE_CODE } from '../installerIdentity.mjs';
import {
  createInstallerManifest,
  verifyInstallerManifestPackage,
  writeInstallerManifest,
} from '../installerManifest.mjs';
import { buildWindowsInstaller } from './buildWindowsInstaller.mjs';
import {
  W6B2_SYNTHETIC_WINDOWS_PACKAGE_PATHS,
  createW6b2SyntheticReleasePair,
  packageW6b2SyntheticApplications,
} from './w6b2SyntheticWindowsPackageFixture.mjs';

const desktopDirectory = resolve(
  W6B2_SYNTHETIC_WINDOWS_PACKAGE_PATHS.fixtureRoot,
  '../../..',
);
const canonicalDesktopPackagePath = join(desktopDirectory, 'package.json');
const canonicalReleaseConfigPath = join(
  desktopDirectory,
  'installer',
  'installer-release.json',
);

const defaultDependencies = Object.freeze({
  buildInstaller: buildWindowsInstaller,
  createManifest: createInstallerManifest,
  packageApplications: packageW6b2SyntheticApplications,
  verifyManifest: verifyInstallerManifestPackage,
  writeManifest: writeInstallerManifest,
});

export async function buildW6b2PackagedSuccessInstallers(options = {}) {
  const dependencies = options.dependencies ?? defaultDependencies;
  const paths = options.paths ?? W6B2_SYNTHETIC_WINDOWS_PACKAGE_PATHS;
  const canonicalPackagePath =
    options.canonicalPackagePath ?? canonicalDesktopPackagePath;
  const canonicalReleasePath =
    options.canonicalReleasePath ?? canonicalReleaseConfigPath;
  const canonicalPackageSource = await readFile(canonicalPackagePath, 'utf8');
  const canonicalReleaseSource = await readFile(canonicalReleasePath, 'utf8');
  const canonicalPackage = parseJson(canonicalPackageSource);
  const canonicalRelease = parseJson(canonicalReleaseSource);
  requireCanonicalW6b2Baseline(canonicalPackage, canonicalRelease);
  const releases = createW6b2SyntheticReleasePair(canonicalRelease);

  await rm(paths.fixtureRoot, { force: true, recursive: true });
  const packaged = await dependencies.packageApplications(canonicalRelease);
  requirePackagedApplicationPair({ packaged, releases });

  const source = await buildFixtureInstaller({
    buildRevision: packaged.source.buildInfo.buildRevision,
    dependencies,
    packaged: packaged.source,
    paths: paths.source,
    release: releases.source,
  });
  const target = await buildFixtureInstaller({
    buildRevision: packaged.target.buildInfo.buildRevision,
    dependencies,
    packaged: packaged.target,
    paths: paths.target,
    release: releases.target,
  });
  requireInstallerPair({ source, target });

  const canonicalPackageAfter = await readFile(canonicalPackagePath, 'utf8');
  const canonicalReleaseAfter = await readFile(canonicalReleasePath, 'utf8');
  if (
    canonicalPackageAfter !== canonicalPackageSource ||
    canonicalReleaseAfter !== canonicalReleaseSource
  ) {
    throw new Error('W6B2_CANONICAL_RELEASE_CHANGED');
  }

  return Object.freeze({
    buildRevision: source.buildRevision,
    source,
    target,
    upgradeCode: INSTALLER_UPGRADE_CODE,
  });
}

export function requireCanonicalW6b2Baseline(
  canonicalPackage,
  canonicalRelease,
) {
  if (
    !isRecord(canonicalPackage) ||
    canonicalPackage.version !== '0.2.6' ||
    !isRecord(canonicalRelease) ||
    canonicalRelease.appVersion !== '0.2.6' ||
    canonicalRelease.msiProductVersion !== '0.2.6'
  ) {
    throw new Error('W6B2_CANONICAL_RELEASE_INVALID');
  }
}

export function requirePackagedApplicationPair({ packaged, releases }) {
  if (
    !isRecord(packaged) ||
    !isRecord(packaged.source) ||
    !isRecord(packaged.target) ||
    !isRecord(packaged.source.buildInfo) ||
    !isRecord(packaged.target.buildInfo) ||
    packaged.source.appVersion !== releases.source.appVersion ||
    packaged.target.appVersion !== releases.target.appVersion ||
    packaged.source.installerRelease?.appVersion !==
      releases.source.appVersion ||
    packaged.target.installerRelease?.appVersion !==
      releases.target.appVersion ||
    packaged.source.buildInfo.appVersion !== releases.source.appVersion ||
    packaged.target.buildInfo.appVersion !== releases.target.appVersion ||
    packaged.source.buildInfo.buildDirty !== false ||
    packaged.target.buildInfo.buildDirty !== false ||
    !isBuildRevision(packaged.source.buildInfo.buildRevision) ||
    packaged.source.buildInfo.buildRevision !==
      packaged.target.buildInfo.buildRevision ||
    !isNonEmptyString(packaged.source.packagedPath) ||
    !isNonEmptyString(packaged.target.packagedPath)
  ) {
    throw new Error('W6B2_PACKAGED_APPLICATION_PAIR_INVALID');
  }
}

export function requireInstallerPair({ source, target }) {
  if (
    !isRecord(source) ||
    !isRecord(target) ||
    source.appVersion !== '0.2.7' ||
    target.appVersion !== '0.2.8' ||
    source.buildRevision !== target.buildRevision ||
    !isBuildRevision(source.buildRevision) ||
    !isNonEmptyString(source.installerPath) ||
    !isNonEmptyString(target.installerPath) ||
    source.installerPath === target.installerPath ||
    !isNonEmptyString(source.manifestPath) ||
    !isNonEmptyString(target.manifestPath) ||
    source.productCode === target.productCode ||
    !isSha256(source.packageSha256) ||
    !isSha256(target.packageSha256)
  ) {
    throw new Error('W6B2_INSTALLER_PAIR_INVALID');
  }
}

async function buildFixtureInstaller(input) {
  const desktopPackagePath = join(input.paths.inputRoot, 'package.json');
  const releaseConfigPath = join(
    input.paths.inputRoot,
    'installer-release.json',
  );
  const manifestPath = join(input.paths.artifactsRoot, 'manifest.json');
  await mkdir(input.paths.inputRoot, { recursive: true });
  await writeFile(
    desktopPackagePath,
    `${JSON.stringify({ version: input.release.appVersion }, null, 2)}\n`,
    'utf8',
  );
  await writeFile(
    releaseConfigPath,
    `${JSON.stringify(input.release, null, 2)}\n`,
    'utf8',
  );
  const installer = await input.dependencies.buildInstaller({
    artifactsRoot: input.paths.artifactsRoot,
    desktopPackagePath,
    payloadRoot: input.packaged.packagedPath,
    releaseConfigPath,
  });
  if (
    installer.release?.appVersion !== input.release.appVersion ||
    installer.release?.msiProductVersion !==
      input.release.msiProductVersion ||
    installer.inventory?.stage !== 'packagedApp'
  ) {
    throw new Error('W6B2_INSTALLER_IDENTITY_INVALID');
  }
  const manifest = await input.dependencies.createManifest({
    buildRevision: input.buildRevision,
    installerPath: installer.artifact,
    release: installer.release,
  });
  await input.dependencies.writeManifest(manifestPath, manifest);
  await input.dependencies.verifyManifest({
    expectedBuildRevision: input.buildRevision,
    expectedRelease: installer.release,
    installerPath: installer.artifact,
    manifest,
  });
  return Object.freeze({
    appVersion: input.release.appVersion,
    buildRevision: input.buildRevision,
    installerPath: installer.artifact,
    manifestPath,
    packageSha256: manifest.packageSha256,
    packageSize: manifest.packageSize,
    packagedApplicationPath: input.packaged.packagedPath,
    productCode: installer.productCode,
  });
}

function parseJson(source) {
  try {
    return JSON.parse(source);
  } catch {
    throw new Error('W6B2_CANONICAL_RELEASE_INVALID');
  }
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isBuildRevision(value) {
  return typeof value === 'string' && /^[0-9a-f]{7,40}$/u.test(value);
}

function isSha256(value) {
  return typeof value === 'string' && /^[0-9a-f]{64}$/u.test(value);
}

if (
  process.argv[1] !== undefined &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  const result = await buildW6b2PackagedSuccessInstallers();
  console.log(
    JSON.stringify({
      sourceVersion: result.source.appVersion,
      status: 'completed',
      targetVersion: result.target.appVersion,
    }),
  );
}
