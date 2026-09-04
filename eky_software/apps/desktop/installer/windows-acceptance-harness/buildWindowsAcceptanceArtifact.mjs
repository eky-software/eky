import { rm } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { readInstallerReleaseGitState } from '../installerReleaseContext.mjs';
import { createWindowsInstallerRelease } from '../scripts/releaseWindowsInstaller.mjs';
import { packageDefaultWindowsApplication } from '../../scripts/packageWindowsApplication.mjs';
import { writeJsonAtomicExclusive } from './cleanInstallUninstallContracts.mjs';
import { detachWindowsInstallerBuildOutput } from './detachWindowsInstallerBuildOutput.mjs';
import {
  materializeImmutableInstallerFixture,
  verifyLocalImmutableSourceFixture,
} from './localImmutableInstallerFixture.mjs';
import {
  parseAbsoluteWindowsAcceptancePath,
} from './windowsAcceptancePathArgument.mjs';
import { verifyWindowsAcceptanceArtifact } from './verifyWindowsAcceptanceArtifact.mjs';

const DIRECTORY = dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = resolve(DIRECTORY, '..', '..', '..', '..');

function isPathInside(parent, candidate) {
  const relation = relative(parent, candidate);
  return relation === '' || (!relation.startsWith('..') && !isAbsolute(relation));
}

export function parseWindowsAcceptanceArtifactBuildArguments(arguments_) {
  if (
    arguments_.length !== 4 ||
    arguments_[0] !== '--artifact-root' ||
    arguments_[2] !== '--summary-path'
  ) {
    throw new Error('WINDOWS_ACCEPTANCE_ARTIFACT_BUILD_ARGUMENTS_INVALID');
  }
  const artifactRoot = parseAbsoluteWindowsAcceptancePath(
    arguments_[1],
    'WINDOWS_ACCEPTANCE_ARTIFACT_BUILD_ARGUMENTS_INVALID',
  );
  const summaryPath = parseAbsoluteWindowsAcceptancePath(
    arguments_[3],
    'WINDOWS_ACCEPTANCE_ARTIFACT_BUILD_ARGUMENTS_INVALID',
  );
  if (isPathInside(artifactRoot, summaryPath)) {
    throw new Error('WINDOWS_ACCEPTANCE_ARTIFACT_BUILD_ARGUMENTS_INVALID');
  }
  return Object.freeze({
    artifactRoot,
    summaryPath,
  });
}

export async function buildWindowsAcceptanceArtifact({
  artifactRoot,
  createInstallerRelease = createWindowsInstallerRelease,
  packageApplication = packageDefaultWindowsApplication,
  readReleaseGitState = readInstallerReleaseGitState,
}) {
  let fixture = null;
  try {
    const buildRevision = await readReleaseGitState({
      repositoryRoot: REPOSITORY_ROOT,
    });
    const packagedApplication = await packageApplication({
      pilotBuild: true,
      reportPackagedPath: false,
    });
    if (
      typeof packagedApplication?.appVersion !== 'string' ||
      typeof packagedApplication?.buildInfo?.buildRevision !== 'string' ||
      !/^[0-9a-f]{7,40}$/.test(
        packagedApplication.buildInfo.buildRevision,
      ) ||
      !buildRevision.startsWith(packagedApplication.buildInfo.buildRevision)
    ) {
      throw new Error('WINDOWS_ACCEPTANCE_ARTIFACT_BUILD_IDENTITY_MISMATCH');
    }
    const release = await createInstallerRelease({ buildRevision });
    await detachWindowsInstallerBuildOutput(release.manifestPath);
    fixture = await materializeImmutableInstallerFixture(
      release.manifestPath,
      artifactRoot,
    );
    const verified = await verifyWindowsAcceptanceArtifact({
      artifactRoot,
      expectedDescriptorSha256: fixture.artifactDescriptorSha256,
      expectedBuildRevision: buildRevision,
    });
    if (verified.appVersion !== packagedApplication.appVersion) {
      throw new Error('WINDOWS_ACCEPTANCE_ARTIFACT_BUILD_IDENTITY_MISMATCH');
    }
    await verifyLocalImmutableSourceFixture(fixture);
    return Object.freeze({
      schemaVersion: 1,
      status: 'completed',
      resultCode: 'windowsAcceptanceArtifactBuilt',
      appVersion: verified.appVersion,
      buildRevision: verified.buildRevision,
      descriptorSha256: verified.descriptorSha256,
      packageSha256: verified.packageSha256,
    });
  } catch (error) {
    if (fixture !== null) {
      await rm(artifactRoot, { force: true, recursive: true }).catch(
        () => undefined,
      );
    }
    throw error;
  }
}

function safeErrorCode(error) {
  return (
    typeof error?.message === 'string' &&
    /^WINDOWS_ACCEPTANCE_[A-Z0-9_]{2,95}$/.test(error.message)
  )
    ? error.message
    : 'WINDOWS_ACCEPTANCE_ARTIFACT_BUILD_FAILED';
}

async function main() {
  let arguments_;
  let artifactBuilt = false;
  try {
    arguments_ = parseWindowsAcceptanceArtifactBuildArguments(
      process.argv.slice(2),
    );
    const summary = await buildWindowsAcceptanceArtifact(arguments_);
    artifactBuilt = true;
    await writeJsonAtomicExclusive(arguments_.summaryPath, summary);
    console.log(JSON.stringify(summary));
  } catch (error) {
    if (artifactBuilt) {
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

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
