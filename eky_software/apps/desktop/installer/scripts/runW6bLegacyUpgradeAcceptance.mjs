import { randomBytes } from 'node:crypto';
import { access } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { INSTALLER_UPGRADE_CODE } from '../installerIdentity.mjs';
import { buildW6bSyntheticNextPatchInstaller } from './buildW6bSyntheticNextPatchInstaller.mjs';
import {
  runW6bLegacyAcceptanceProcess,
  W6B_LEGACY_ACCEPTANCE_CLEANUP_TIMEOUT_MILLISECONDS,
  W6B_LEGACY_ACCEPTANCE_HEARTBEAT_MILLISECONDS,
  W6B_LEGACY_ACCEPTANCE_TIMEOUT_MILLISECONDS,
} from './w6bLegacyAcceptanceProcess.mjs';
import {
  verifyExactLocalHistoricalWindowsInstallerFixture,
  withHistoricalSourceWindowsInstallerFixture,
} from './historicalWindowsInstallerFixtureBuilder.mjs';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const installerDirectory = resolve(scriptDirectory, '..');
const desktopDirectory = resolve(installerDirectory, '..');
const repositoryRoot = resolve(desktopDirectory, '..', '..');
const exactLocalBundleRoot = join(
  installerDirectory,
  'local-pilot-releases',
  'Eky-0.2.6-x64-local-unsigned-pilot',
);
const acceptanceScriptPath = join(
  scriptDirectory,
  'testW6bLegacyUpgradeAcceptance.ps1',
);
const fullHistoricalRevisionPattern = /^[0-9a-f]{40}$/u;
const historicalRuntimeRevisionPattern = /^[0-9a-f]{12}$/u;
const packagedRevisionPattern = /^[0-9a-f]{7,40}$/u;
const productCodePattern =
  /^\{?[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}\}?$/u;
const sha256Pattern = /^[0-9a-f]{64}$/u;
export const w6bLineageProfileIdPattern = '^[0-9a-f]{64}$';

export function isW6bLineageProfileId(value) {
  return (
    typeof value === 'string' &&
    new RegExp(w6bLineageProfileIdPattern, 'u').test(value)
  );
}

export async function runW6bLegacyUpgradeAcceptance(dependencies = {}) {
  const target = await (
    dependencies.buildTarget ?? buildW6bSyntheticNextPatchInstaller
  )();
  return withSelectedHistoricalFixture(
    async (source) => {
      const processProofToken = (
        dependencies.createProcessProofToken ?? createProcessProofToken
      )();
      const arguments_ = createW6bLegacyUpgradeAcceptanceArguments({
        processProofToken,
        source,
        target,
      });
      await (dependencies.runProcess ?? runProcess)(
        'powershell.exe',
        arguments_,
        { processProofToken },
      );
      return Object.freeze({
        sourceClassification: source.artifactClass,
        sourcePackageSha256: source.packageSha256,
        sourceVersion: source.appVersion,
        targetPackageSha256: target.packageSha256,
        targetVersion: target.appVersion,
      });
    },
    dependencies,
  );
}

export function createW6bLegacyUpgradeAcceptanceArguments({
  processProofToken,
  source,
  target,
}) {
  validateSourceFixture(source);
  validateTargetFixture(source, target);
  if (!sha256Pattern.test(processProofToken)) {
    throw new Error('W6B_LEGACY_PROCESS_PROOF_TOKEN_INVALID');
  }
  return Object.freeze([
    '-NoLogo',
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    acceptanceScriptPath,
    '-SourceMsiPath',
    source.installerPath,
    '-TargetMsiPath',
    target.installerPath,
    '-TargetPayloadRoot',
    target.packagedApplicationPath,
    '-SourceProductCode',
    source.productCode,
    '-TargetProductCode',
    target.productCode,
    '-SourceAppVersion',
    source.appVersion,
    '-TargetAppVersion',
    target.appVersion,
    '-SourceBuildRevision',
    source.buildRevision,
    '-SourceRuntimeBuildRevision',
    source.runtimeBuildRevision,
    '-TargetBuildRevision',
    target.buildRevision,
    '-TargetMsiProductVersion',
    target.msiProductVersion,
    '-TargetPackageVersion',
    target.packageVersion,
    '-TargetReleaseChannel',
    target.releaseChannel,
    '-TargetUpgradeCode',
    target.upgradeCode,
    '-SourcePackageSha256',
    source.packageSha256,
    '-TargetPackageSha256',
    target.packageSha256,
    '-SourceClassification',
    source.artifactClass,
    '-LineageProfileIdPattern',
    w6bLineageProfileIdPattern,
    '-ProcessProofToken',
    processProofToken,
  ]);
}

async function withSelectedHistoricalFixture(task, dependencies) {
  const localBundleExists = await (
    dependencies.pathExists ?? pathExists
  )(exactLocalBundleRoot);
  if (localBundleExists) {
    const source = await (
      dependencies.verifyExactLocal ??
      verifyExactLocalHistoricalWindowsInstallerFixture
    )();
    return task(source);
  }
  return (
    dependencies.withHistoricalRebuild ??
    withHistoricalSourceWindowsInstallerFixture
  )(task);
}

function validateSourceFixture(source) {
  if (
    !isRecord(source) ||
    !['exact-local-release', 'historical-source-rebuild'].includes(
      source.artifactClass,
    ) ||
    source.appVersion !== '0.2.6' ||
    !fullHistoricalRevisionPattern.test(source.buildRevision) ||
    !historicalRuntimeRevisionPattern.test(source.runtimeBuildRevision) ||
    source.runtimeBuildRevision !== source.buildRevision.slice(0, 12) ||
    !isMsiPath(source.installerPath) ||
    !sha256Pattern.test(source.packageSha256) ||
    !productCodePattern.test(source.productCode)
  ) {
    throw new Error('W6B_LEGACY_SOURCE_IDENTITY_INVALID');
  }
}

function validateTargetFixture(source, target) {
  if (
    !isRecord(target) ||
    target.appVersion !== nextPatch(source.appVersion) ||
    target.msiProductVersion !== target.appVersion ||
    target.packageVersion !== target.appVersion ||
    target.releaseChannel !== 'pilot' ||
    target.upgradeCode !== INSTALLER_UPGRADE_CODE ||
    !packagedRevisionPattern.test(target.buildRevision) ||
    !isMsiPath(target.installerPath) ||
    !isAbsolute(target.packagedApplicationPath) ||
    !sha256Pattern.test(target.packageSha256) ||
    !isRecord(target.installerManifest) ||
    target.installerManifest.appVersion !== target.appVersion ||
    target.installerManifest.buildRevision !== target.buildRevision ||
    target.installerManifest.msiProductVersion !== target.msiProductVersion ||
    target.installerManifest.packageSha256 !== target.packageSha256 ||
    target.installerManifest.releaseChannel !== target.releaseChannel ||
    !productCodePattern.test(target.productCode) ||
    normalizeProductCode(target.productCode) ===
      normalizeProductCode(source.productCode)
  ) {
    throw new Error('W6B_LEGACY_TARGET_IDENTITY_INVALID');
  }
}

function nextPatch(version) {
  const parts = version.split('.').map((part) => Number.parseInt(part, 10));
  if (
    parts.length !== 3 ||
    parts.some((part) => !Number.isSafeInteger(part) || part < 0)
  ) {
    throw new Error('W6B_LEGACY_SOURCE_IDENTITY_INVALID');
  }
  return `${parts[0]}.${parts[1]}.${parts[2] + 1}`;
}

function normalizeProductCode(value) {
  return value.replaceAll(/[{}]/gu, '').toUpperCase();
}

function isMsiPath(value) {
  return (
    typeof value === 'string' &&
    !value.includes('\0') &&
    isAbsolute(value) &&
    value.toLowerCase().endsWith('.msi')
  );
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

function createProcessProofToken() {
  return randomBytes(32).toString('hex');
}

function runProcess(command, arguments_, context) {
  return runW6bLegacyAcceptanceProcess({
    arguments: arguments_,
    cleanupTimeoutMilliseconds:
      W6B_LEGACY_ACCEPTANCE_CLEANUP_TIMEOUT_MILLISECONDS,
    command,
    cwd: repositoryRoot,
    environment: process.env,
    heartbeatMilliseconds: W6B_LEGACY_ACCEPTANCE_HEARTBEAT_MILLISECONDS,
    proofToken: context.processProofToken,
    timeoutMilliseconds: W6B_LEGACY_ACCEPTANCE_TIMEOUT_MILLISECONDS,
  });
}

if (
  process.argv[1] !== undefined &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  const result = await runW6bLegacyUpgradeAcceptance();
  console.log(JSON.stringify({ ...result, status: 'completed' }));
}
