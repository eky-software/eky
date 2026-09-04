import { constants } from 'node:fs';
import {
  copyFile,
  lstat,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { createInstallerProductCode } from '../installerIdentity.mjs';
import {
  createInstallerManifest,
  verifyInstallerManifestPackage,
  writeInstallerManifest,
} from '../installerManifest.mjs';
import { readInstallerReleaseGitState } from '../installerReleaseContext.mjs';
import {
  parseMsiProductVersion,
  validateInstallerReleaseConfig,
} from '../installerVersion.mjs';
import { buildWindowsInstaller } from '../scripts/buildWindowsInstaller.mjs';
import {
  createPackageLayout,
  packageWindowsApplication,
} from '../../scripts/packageWindowsApplication.mjs';
import { writeJsonAtomicExclusive } from './cleanInstallUninstallContracts.mjs';
import { detachWindowsInstallerBuildOutput } from './detachWindowsInstallerBuildOutput.mjs';
import { materializeImmutableInstallerFixture } from './localImmutableInstallerFixture.mjs';
import {
  UPGRADE_ROLLBACK_DESCRIPTOR_FILENAME,
  createUpgradeRollbackArtifactDescriptor,
  hashUpgradeRollbackArtifactFile,
  verifyUpgradeRollbackArtifact,
} from './upgradeRollbackArtifact.mjs';
import { parseAbsoluteWindowsAcceptancePath } from './windowsAcceptancePathArgument.mjs';

const DIRECTORY = dirname(fileURLToPath(import.meta.url));
const DESKTOP_ROOT = resolve(DIRECTORY, '..', '..');
const REPOSITORY_ROOT = resolve(DESKTOP_ROOT, '..', '..');
const CANONICAL_PACKAGE_PATH = resolve(DESKTOP_ROOT, 'package.json');
const CANONICAL_RELEASE_PATH = resolve(
  DESKTOP_ROOT,
  'installer',
  'installer-release.json',
);
const DEFAULT_STAGE_ROOT = resolve(
  DESKTOP_ROOT,
  '.stage',
  'windows-acceptance-v2-upgrade',
);

function isPathInside(parent, candidate) {
  const relation = relative(parent, candidate);
  return relation === '' || (!relation.startsWith('..') && !isAbsolute(relation));
}

export function parseUpgradeRollbackArtifactBuildArguments(arguments_) {
  if (
    arguments_.length !== 4 ||
    arguments_[0] !== '--artifact-root' ||
    arguments_[2] !== '--summary-path'
  ) {
    throw new Error('WINDOWS_ACCEPTANCE_UPGRADE_ARTIFACT_BUILD_ARGUMENTS_INVALID');
  }
  const artifactRoot = parseAbsoluteWindowsAcceptancePath(
    arguments_[1],
    'WINDOWS_ACCEPTANCE_UPGRADE_ARTIFACT_BUILD_ARGUMENTS_INVALID',
  );
  const summaryPath = parseAbsoluteWindowsAcceptancePath(
    arguments_[3],
    'WINDOWS_ACCEPTANCE_UPGRADE_ARTIFACT_BUILD_ARGUMENTS_INVALID',
  );
  if (isPathInside(artifactRoot, summaryPath)) {
    throw new Error('WINDOWS_ACCEPTANCE_UPGRADE_ARTIFACT_BUILD_ARGUMENTS_INVALID');
  }
  return Object.freeze({ artifactRoot, summaryPath });
}

export function createUpgradeRollbackReleasePair(canonicalRelease) {
  let source;
  try {
    source = validateInstallerReleaseConfig(
      canonicalRelease,
      canonicalRelease?.appVersion,
    );
  } catch {
    throw new Error('WINDOWS_ACCEPTANCE_UPGRADE_ARTIFACT_RELEASE_INVALID');
  }
  if (
    source.releaseChannel !== 'pilot' ||
    source.appVersion !== source.msiProductVersion
  ) {
    throw new Error('WINDOWS_ACCEPTANCE_UPGRADE_ARTIFACT_RELEASE_INVALID');
  }
  const parts = [...parseMsiProductVersion(source.msiProductVersion)];
  if (parts[2] >= 65_535) {
    throw new Error('WINDOWS_ACCEPTANCE_UPGRADE_ARTIFACT_RELEASE_INVALID');
  }
  parts[2] += 1;
  const targetVersion = parts.join('.');
  const target = validateInstallerReleaseConfig(
    {
      ...source,
      appVersion: targetVersion,
      msiProductVersion: targetVersion,
    },
    targetVersion,
  );
  return Object.freeze({ source, target });
}

function createRolePaths(stageRoot, roleName) {
  const root = resolve(stageRoot, roleName);
  return Object.freeze({
    artifactsRoot: resolve(root, 'installer-artifacts'),
    inputRoot: resolve(root, 'installer-input'),
    layout: createPackageLayout({
      outputDirectory: resolve(root, 'out'),
      stagingRoot: resolve(root, 'package-stage'),
    }),
    root,
  });
}

export async function copyClosedPayloadTree(sourceRoot, targetRoot) {
  try {
    await mkdir(dirname(targetRoot), { recursive: true });
    await mkdir(targetRoot, { recursive: false });
    const visit = async (sourceDirectory, targetDirectory) => {
      const entries = await readdir(sourceDirectory, { withFileTypes: true });
      for (const entry of entries) {
        const sourcePath = resolve(sourceDirectory, entry.name);
        const targetPath = resolve(targetDirectory, entry.name);
        const metadata = await lstat(sourcePath, { bigint: true });
        if (metadata.isSymbolicLink()) {
          throw new Error('WINDOWS_ACCEPTANCE_UPGRADE_ARTIFACT_PAYLOAD_INVALID');
        }
        if (metadata.isDirectory()) {
          await mkdir(targetPath, { recursive: false });
          await visit(sourcePath, targetPath);
        } else if (metadata.isFile()) {
          await copyFile(sourcePath, targetPath, constants.COPYFILE_EXCL);
          const copied = await lstat(targetPath, { bigint: true });
          if (
            !copied.isFile() ||
            copied.isSymbolicLink() ||
            copied.nlink !== 1n
          ) {
            throw new Error(
              'WINDOWS_ACCEPTANCE_UPGRADE_ARTIFACT_PAYLOAD_INVALID',
            );
          }
        } else {
          throw new Error(
            'WINDOWS_ACCEPTANCE_UPGRADE_ARTIFACT_PAYLOAD_INVALID',
          );
        }
      }
    };
    await visit(sourceRoot, targetRoot);
  } catch {
    throw new Error('WINDOWS_ACCEPTANCE_UPGRADE_ARTIFACT_PAYLOAD_INVALID');
  }
}

async function writeRoleInputs(paths, release) {
  await mkdir(paths.inputRoot, { recursive: true });
  const desktopPackagePath = resolve(paths.inputRoot, 'package.json');
  const releaseConfigPath = resolve(paths.inputRoot, 'installer-release.json');
  await writeFile(
    desktopPackagePath,
    `${JSON.stringify({ version: release.appVersion }, null, 2)}\n`,
    'utf8',
  );
  await writeFile(
    releaseConfigPath,
    `${JSON.stringify(release, null, 2)}\n`,
    'utf8',
  );
  return Object.freeze({ desktopPackagePath, releaseConfigPath });
}

async function buildRoleInstaller({
  buildRevision,
  buildInstaller,
  packagedPath,
  paths,
  release,
}) {
  const inputs = await writeRoleInputs(paths, release);
  const installer = await buildInstaller({
    artifactsRoot: paths.artifactsRoot,
    desktopPackagePath: inputs.desktopPackagePath,
    payloadRoot: packagedPath,
    releaseConfigPath: inputs.releaseConfigPath,
  });
  if (
    installer.release?.appVersion !== release.appVersion ||
    installer.release?.msiProductVersion !== release.msiProductVersion ||
    installer.inventory?.stage !== 'packagedApp'
  ) {
    throw new Error('WINDOWS_ACCEPTANCE_UPGRADE_ARTIFACT_INSTALLER_INVALID');
  }
  const manifestPath = resolve(paths.artifactsRoot, 'installer.manifest.json');
  const manifest = await createInstallerManifest({
    buildRevision,
    installerPath: installer.artifact,
    release,
  });
  await writeInstallerManifest(manifestPath, manifest);
  await detachWindowsInstallerBuildOutput(manifestPath);
  await verifyInstallerManifestPackage({
    expectedBuildRevision: buildRevision,
    expectedRelease: release,
    installerPath: installer.artifact,
    manifest,
  });
  return Object.freeze({
    manifestPath,
    payloadFileCount: installer.payloadFileCount,
  });
}

function requirePackagedApplication(packaged, release, buildRevision) {
  if (
    packaged?.appVersion !== release.appVersion ||
    packaged?.installerRelease?.appVersion !== release.appVersion ||
    packaged?.buildInfo?.appVersion !== release.appVersion ||
    packaged?.buildInfo?.buildDirty !== false ||
    typeof packaged?.buildInfo?.buildRevision !== 'string' ||
    !/^[0-9a-f]{7,40}$/.test(packaged.buildInfo.buildRevision) ||
    !buildRevision.startsWith(packaged.buildInfo.buildRevision) ||
    typeof packaged?.packagedPath !== 'string'
  ) {
    throw new Error('WINDOWS_ACCEPTANCE_UPGRADE_ARTIFACT_PACKAGE_INVALID');
  }
}

export async function buildStagedInstallerSet({
  buildInstaller = buildWindowsInstaller,
  packageApplication = packageWindowsApplication,
  readGitState = readInstallerReleaseGitState,
  removeTree = rm,
  stageRoot = DEFAULT_STAGE_ROOT,
} = {}) {
  const canonicalPackageSource = await readFile(CANONICAL_PACKAGE_PATH, 'utf8');
  const canonicalReleaseSource = await readFile(CANONICAL_RELEASE_PATH, 'utf8');
  let canonicalPackage;
  let canonicalRelease;
  try {
    canonicalPackage = JSON.parse(canonicalPackageSource);
    canonicalRelease = JSON.parse(canonicalReleaseSource);
  } catch {
    throw new Error('WINDOWS_ACCEPTANCE_UPGRADE_ARTIFACT_RELEASE_INVALID');
  }
  if (
    typeof canonicalPackage?.version !== 'string' ||
    canonicalPackage.version !== canonicalRelease?.appVersion
  ) {
    throw new Error('WINDOWS_ACCEPTANCE_UPGRADE_ARTIFACT_RELEASE_INVALID');
  }
  const releases = createUpgradeRollbackReleasePair(canonicalRelease);
  const buildRevision = await readGitState({ repositoryRoot: REPOSITORY_ROOT });
  if (!/^[0-9a-f]{40}$/.test(buildRevision)) {
    throw new Error('WINDOWS_ACCEPTANCE_UPGRADE_ARTIFACT_BUILD_IDENTITY_MISMATCH');
  }

  await removeTree(stageRoot, { force: true, recursive: true });
  await mkdir(stageRoot, { recursive: true });
  let completed = false;
  try {
    const sourcePaths = createRolePaths(stageRoot, 'source');
    const targetPaths = createRolePaths(stageRoot, 'target');
    const rollbackPaths = createRolePaths(stageRoot, 'windows-rollback');
    const sourcePackaged = await packageApplication({
      layout: sourcePaths.layout,
      pilotBuild: true,
      reportPackagedPath: false,
      releaseOverride: releases.source,
    });
    requirePackagedApplication(sourcePackaged, releases.source, buildRevision);
    const targetPackaged = await packageApplication({
      layout: targetPaths.layout,
      pilotBuild: true,
      reportPackagedPath: false,
      releaseOverride: releases.target,
    });
    requirePackagedApplication(targetPackaged, releases.target, buildRevision);

    const source = await buildRoleInstaller({
      buildRevision,
      buildInstaller,
      packagedPath: sourcePackaged.packagedPath,
      paths: sourcePaths,
      release: releases.source,
    });
    const target = await buildRoleInstaller({
      buildRevision,
      buildInstaller,
      packagedPath: targetPackaged.packagedPath,
      paths: targetPaths,
      release: releases.target,
    });

    const rollbackPayloadRoot = resolve(rollbackPaths.root, 'payload');
    await copyClosedPayloadTree(targetPackaged.packagedPath, rollbackPayloadRoot);
    const rollbackProbeRoot = resolve(
      rollbackPayloadRoot,
      'resources',
      'desktop-runtime',
      'installer-rollback-probe',
    );
    await mkdir(rollbackProbeRoot, { recursive: true });
    await writeFile(
      resolve(rollbackProbeRoot, 'probe.txt'),
      'Synthetic Windows Installer rollback probe.\n',
      'utf8',
    );
    const windowsRollback = await buildRoleInstaller({
      buildRevision,
      buildInstaller,
      packagedPath: rollbackPayloadRoot,
      paths: rollbackPaths,
      release: releases.target,
    });
    if (windowsRollback.payloadFileCount !== target.payloadFileCount + 1) {
      throw new Error('WINDOWS_ACCEPTANCE_UPGRADE_ARTIFACT_ROLLBACK_INVALID');
    }

    if (
      (await readFile(CANONICAL_PACKAGE_PATH, 'utf8')) !== canonicalPackageSource ||
      (await readFile(CANONICAL_RELEASE_PATH, 'utf8')) !== canonicalReleaseSource
    ) {
      throw new Error('WINDOWS_ACCEPTANCE_UPGRADE_ARTIFACT_CANONICAL_CHANGED');
    }
    const result = Object.freeze({
      buildRevision,
      roles: Object.freeze({ source, target, windowsRollback }),
      stageRoot,
    });
    completed = true;
    return result;
  } finally {
    if (!completed) {
      await removeTree(stageRoot, { force: true, recursive: true }).catch(
        () => undefined,
      );
    }
  }
}

async function materializeRole(stagedRole, artifactRoot, roleName) {
  const fixture = await materializeImmutableInstallerFixture(
    stagedRole.manifestPath,
    resolve(artifactRoot, roleName),
  );
  return Object.freeze({
    appVersion: fixture.manifest.appVersion,
    manifestPath: `${roleName}/installer.manifest.json`,
    manifestSha256: fixture.artifactDescriptorSha256,
    msiProductVersion: fixture.manifest.msiProductVersion,
    packageSha256: fixture.manifest.packageSha256,
    packageSize: fixture.manifest.packageSize,
    productCode: createInstallerProductCode(fixture.manifest.msiProductVersion),
  });
}

export async function buildUpgradeRollbackArtifact({
  artifactRoot: artifactRootInput,
  createStagedInstallerSet = buildStagedInstallerSet,
  removeTree = rm,
}) {
  const artifactRoot = resolve(artifactRootInput);
  let artifactCreated = false;
  let result = null;
  let staged = null;
  let primaryError = null;
  try {
    staged = await createStagedInstallerSet();
    const stagedRoot = resolve(staged.stageRoot);
    if (
      isPathInside(stagedRoot, artifactRoot) ||
      isPathInside(artifactRoot, stagedRoot)
    ) {
      throw new Error(
        'WINDOWS_ACCEPTANCE_UPGRADE_ARTIFACT_STAGE_OVERLAP_INVALID',
      );
    }
    await mkdir(artifactRoot, { recursive: false });
    artifactCreated = true;
    const roles = {};
    for (const roleName of ['source', 'target', 'windowsRollback']) {
      roles[roleName] = await materializeRole(
        staged.roles[roleName],
        artifactRoot,
        roleName,
      );
    }
    const descriptor = createUpgradeRollbackArtifactDescriptor({
      buildRevision: staged.buildRevision,
      roles,
    });
    const descriptorPath = resolve(
      artifactRoot,
      UPGRADE_ROLLBACK_DESCRIPTOR_FILENAME,
    );
    await writeJsonAtomicExclusive(descriptorPath, descriptor);
    const descriptorIdentity = await hashUpgradeRollbackArtifactFile(
      descriptorPath,
    );
    const verified = await verifyUpgradeRollbackArtifact({
      artifactRoot,
      expectedBuildRevision: staged.buildRevision,
      expectedDescriptorSha256: descriptorIdentity.sha256,
    });
    result = Object.freeze({
      schemaVersion: 1,
      status: 'completed',
      resultCode: 'upgradeRollbackArtifactBuilt',
      buildRevision: verified.buildRevision,
      descriptorSha256: verified.descriptorSha256,
      sourcePackageSha256: verified.roles.source.packageSha256,
      targetPackageSha256: verified.roles.target.packageSha256,
      windowsRollbackPackageSha256:
        verified.roles.windowsRollback.packageSha256,
    });
  } catch (error) {
    primaryError = error;
    if (artifactCreated) {
      await removeTree(artifactRoot, { force: true, recursive: true }).catch(
        () => undefined,
      );
    }
  }

  let stageCleanupFailed = false;
  if (staged !== null) {
    await removeTree(staged.stageRoot, { force: true, recursive: true }).catch(
      () => {
        stageCleanupFailed = true;
      },
    );
  }
  if (primaryError !== null) {
    throw primaryError;
  }
  if (stageCleanupFailed) {
    if (artifactCreated) {
      await removeTree(artifactRoot, { force: true, recursive: true }).catch(
        () => undefined,
      );
    }
    throw new Error(
      'WINDOWS_ACCEPTANCE_UPGRADE_ARTIFACT_STAGE_CLEANUP_FAILED',
    );
  }
  if (result === null) {
    throw new Error('WINDOWS_ACCEPTANCE_UPGRADE_ARTIFACT_BUILD_FAILED');
  }
  return result;
}

function safeErrorCode(error) {
  return (
    typeof error?.message === 'string' &&
    /^WINDOWS_ACCEPTANCE_UPGRADE_[A-Z0-9_]{2,95}$/.test(error.message)
  )
    ? error.message
    : 'WINDOWS_ACCEPTANCE_UPGRADE_ARTIFACT_BUILD_FAILED';
}

async function main() {
  let arguments_;
  let artifactBuilt = false;
  try {
    arguments_ = parseUpgradeRollbackArtifactBuildArguments(
      process.argv.slice(2),
    );
    const summary = await buildUpgradeRollbackArtifact(arguments_);
    artifactBuilt = true;
    await writeJsonAtomicExclusive(arguments_.summaryPath, summary);
    console.log(JSON.stringify(summary));
  } catch (error) {
    if (artifactBuilt && arguments_ !== undefined) {
      await rm(arguments_.artifactRoot, { force: true, recursive: true }).catch(
        () => undefined,
      );
    }
    console.error(
      JSON.stringify({
        schemaVersion: 1,
        status: 'failed',
        errorCode: safeErrorCode(error),
      }),
    );
    process.exitCode = 1;
  }
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  await main();
}
