import { mkdir, readFile, realpath, rm } from 'node:fs/promises';
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { inspectPackageArtifactInventory } from '../../scripts/package-artifact-inventory.mjs';
import { readInstallerReleaseGitState } from '../installerReleaseContext.mjs';
import { buildW6b2PackagedSuccessInstallers } from '../scripts/buildW6b2PackagedSuccessInstallers.mjs';
import { writeJsonAtomicExclusive } from './cleanInstallUninstallContracts.mjs';
import { detachWindowsInstallerBuildOutput } from './detachWindowsInstallerBuildOutput.mjs';
import { materializeImmutableInstallerFixture } from './localImmutableInstallerFixture.mjs';
import {
  hashWorkspaceSuccessArtifactFile,
  verifyWorkspaceSuccessArtifact,
} from './workspaceSuccessArtifact.mjs';
import {
  WORKSPACE_SUCCESS_DESCRIPTOR_FILENAME,
  WORKSPACE_SUCCESS_VERSIONS,
  createWorkspaceSuccessArtifactDescriptor,
} from './workspaceSuccessArtifactDescriptor.mjs';
import { parseAbsoluteWindowsAcceptancePath } from './windowsAcceptancePathArgument.mjs';

const DESKTOP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const REPOSITORY_ROOT = resolve(DESKTOP_ROOT, '../..');
const CANONICAL_INPUTS = [
  resolve(DESKTOP_ROOT, 'package.json'),
  resolve(DESKTOP_ROOT, 'installer/installer-release.json'),
];
const UNSAFE_ROOTS = [
  resolve(DESKTOP_ROOT, '.stage'),
  resolve(DESKTOP_ROOT, 'out'),
];
const SAFE_BUILD_FAILURES = new Set([
  'WINDOWS_ACCEPTANCE_WORKSPACE_ARTIFACT_ARGUMENTS_INVALID',
  'WINDOWS_ACCEPTANCE_WORKSPACE_ARTIFACT_ROOT_INVALID',
  'WINDOWS_ACCEPTANCE_WORKSPACE_ARTIFACT_STAGE_OVERLAP_INVALID',
  'WINDOWS_ACCEPTANCE_WORKSPACE_ARTIFACT_BUILD_IDENTITY_INVALID',
  'WINDOWS_ACCEPTANCE_WORKSPACE_ARTIFACT_STAGED_IDENTITY_INVALID',
  'WINDOWS_ACCEPTANCE_WORKSPACE_ARTIFACT_PAYLOAD_CHANGED',
  'WINDOWS_ACCEPTANCE_WORKSPACE_ARTIFACT_CANONICAL_CHANGED',
  'W6B2_CANONICAL_RELEASE_INVALID',
  'W6B2_CANONICAL_RELEASE_CHANGED',
  'W6B2_PACKAGED_APPLICATION_PAIR_INVALID',
  'W6B2_INSTALLER_PAIR_INVALID',
  'W6B2_INSTALLER_IDENTITY_INVALID',
]);
const SAFE_INVENTORY_REASONS = new Set([
  'STAGE', 'FILE_COUNT', 'LOGICAL_PATH', 'DIRECTORY_DEPTH', 'PROJECT_FILE_SIZE',
  'SIZE', 'SYMLINK', 'FILE_TYPE', 'UNAPPROVED_UPDATE_RUNTIME_ARTIFACT',
  'PRIVATE_KEY_ARTIFACT', 'SERVICE_ACCOUNT_ARTIFACT', 'DATABASE',
  'BUSINESS_OR_DIAGNOSTIC_ARTIFACT', 'ENVIRONMENT_FILE', 'SECRET_BLOB',
  'GENERATED_TEST_OR_SUPPORT_ARTIFACT', 'SOURCE_OR_TEST_ARTIFACT',
  'PROJECT_SOURCE_MAP', 'PROJECT_RUNTIME_OR_SENSITIVE_ARTIFACT',
  'VENDOR_SENSITIVE_ARTIFACT_REVIEW_REQUIRED', 'UNAPPROVED_SMOKE_HELPER',
]);
const SAFE_PLATFORM_FAILURES = new Set([
  'ENOENT', 'EEXIST', 'EACCES', 'EPERM', 'EBUSY', 'ENOSPC', 'EIO',
  'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN',
]);

function classifyBuildFailure(error) {
  if (SAFE_BUILD_FAILURES.has(error?.message)) return error.message;
  const prefix = 'PACKAGE_ARTIFACT_INVENTORY_INVALID:';
  if (typeof error?.message === 'string' && error.message.startsWith(prefix) &&
      SAFE_INVENTORY_REASONS.has(error.message.slice(prefix.length))) return error.message;
  if (SAFE_PLATFORM_FAILURES.has(error?.code)) return error.code;
  return 'unclassifiedBuildFailure';
}

export function workspaceArtifactBuildFailureSummary(error) {
  const cleanupFailed = error instanceof AggregateError &&
    error.message === 'WINDOWS_ACCEPTANCE_WORKSPACE_ARTIFACT_BUILD_CLEANUP_FAILED' &&
    error.errors.length === 2;
  return Object.freeze({
    schemaVersion: 1, status: 'failed',
    errorCode: 'WINDOWS_ACCEPTANCE_WORKSPACE_ARTIFACT_BUILD_FAILED',
    failureCode: classifyBuildFailure(cleanupFailed ? error.errors[0] : error),
    cleanupFailureCode: cleanupFailed ? classifyBuildFailure(error.errors[1]) : null,
  });
}

function contains(parent, candidate) {
  const path = relative(parent, candidate);
  return path === '' || (!path.startsWith('..') && !isAbsolute(path));
}

function requireArtifactRoot(input) {
  const root = parseAbsoluteWindowsAcceptancePath(
    input, 'WINDOWS_ACCEPTANCE_WORKSPACE_ARTIFACT_ROOT_INVALID',
  );
  if (UNSAFE_ROOTS.some((other) => contains(root, other) || contains(other, root))) {
    throw new Error('WINDOWS_ACCEPTANCE_WORKSPACE_ARTIFACT_STAGE_OVERLAP_INVALID');
  }
  return root;
}

export function parseWorkspaceSuccessArtifactBuildArguments(args) {
  if (args.length !== 4 || args[0] !== '--artifact-root' || args[2] !== '--summary-path') {
    throw new Error('WINDOWS_ACCEPTANCE_WORKSPACE_ARTIFACT_ARGUMENTS_INVALID');
  }
  const artifactRoot = requireArtifactRoot(args[1]);
  const summaryPath = parseAbsoluteWindowsAcceptancePath(
    args[3], 'WINDOWS_ACCEPTANCE_WORKSPACE_ARTIFACT_ARGUMENTS_INVALID',
  );
  if (contains(artifactRoot, summaryPath)) {
    throw new Error('WINDOWS_ACCEPTANCE_WORKSPACE_ARTIFACT_ARGUMENTS_INVALID');
  }
  return Object.freeze({ artifactRoot, summaryPath });
}

async function materializeRole(roleName, staged, artifactRoot, buildRevision) {
  if (
    staged?.appVersion !== WORKSPACE_SUCCESS_VERSIONS[roleName] ||
    staged.buildRevision !== buildRevision.slice(0, 12) ||
    typeof staged.packagedApplicationPath !== 'string' ||
    typeof staged.manifestPath !== 'string'
  ) {
    throw new Error('WINDOWS_ACCEPTANCE_WORKSPACE_ARTIFACT_STAGED_IDENTITY_INVALID');
  }
  for (const path of [staged.packagedApplicationPath, staged.manifestPath]) {
    const canonical = await realpath(path);
    if (contains(artifactRoot, canonical) || contains(canonical, artifactRoot)) {
      throw new Error('WINDOWS_ACCEPTANCE_WORKSPACE_ARTIFACT_STAGE_OVERLAP_INVALID');
    }
  }
  const payloadInventory = await inspectPackageArtifactInventory({
    root: staged.packagedApplicationPath, stage: 'packagedApp',
  });
  await detachWindowsInstallerBuildOutput(staged.manifestPath);
  const fixture = await materializeImmutableInstallerFixture(
    staged.manifestPath, resolve(artifactRoot, roleName),
  );
  for (const key of ['appVersion', 'buildRevision', 'packageSha256', 'packageSize']) {
    if (fixture.manifest[key] !== staged[key]) {
      throw new Error('WINDOWS_ACCEPTANCE_WORKSPACE_ARTIFACT_STAGED_IDENTITY_INVALID');
    }
  }
  const inventoryAfter = await inspectPackageArtifactInventory({
    root: staged.packagedApplicationPath, stage: 'packagedApp',
  });
  if (JSON.stringify(payloadInventory) !== JSON.stringify(inventoryAfter)) {
    throw new Error('WINDOWS_ACCEPTANCE_WORKSPACE_ARTIFACT_PAYLOAD_CHANGED');
  }
  return Object.freeze({
    appVersion: fixture.manifest.appVersion,
    buildRevision: fixture.manifest.buildRevision,
    msiProductVersion: fixture.manifest.msiProductVersion,
    productCode: staged.productCode,
    manifestPath: `${roleName}/installer.manifest.json`,
    manifestSha256: fixture.artifactDescriptorSha256,
    packageSha256: fixture.packageSha256,
    packageSize: fixture.manifest.packageSize,
    payloadInventory,
  });
}

export async function buildWorkspaceSuccessArtifact({
  artifactRoot: inputRoot,
  createInstallerPair = buildW6b2PackagedSuccessInstallers,
  readGitState = readInstallerReleaseGitState,
}) {
  const requestedRoot = requireArtifactRoot(inputRoot);
  const artifactRoot = requireArtifactRoot(resolve(
    await realpath(dirname(requestedRoot)), basename(requestedRoot),
  ));
  const canonicalBefore = [];
  for (const path of CANONICAL_INPUTS) canonicalBefore.push(await readFile(path));
  const buildRevision = await readGitState({ repositoryRoot: REPOSITORY_ROOT });
  if (typeof buildRevision !== 'string' || !/^[0-9a-f]{40}$/.test(buildRevision)) {
    throw new Error('WINDOWS_ACCEPTANCE_WORKSPACE_ARTIFACT_BUILD_IDENTITY_INVALID');
  }
  // Exclusive creation precedes the build: an existing artifact is never replaced.
  await mkdir(artifactRoot, { recursive: false });
  try {
    const pair = await createInstallerPair();
    if (pair?.buildRevision !== buildRevision.slice(0, 12)) {
      throw new Error('WINDOWS_ACCEPTANCE_WORKSPACE_ARTIFACT_STAGED_IDENTITY_INVALID');
    }
    const source = await materializeRole('source', pair.source, artifactRoot, buildRevision);
    const target = await materializeRole('target', pair.target, artifactRoot, buildRevision);
    const descriptor = createWorkspaceSuccessArtifactDescriptor({ buildRevision, source, target });
    if (pair.upgradeCode !== descriptor.upgradeCode) {
      throw new Error('WINDOWS_ACCEPTANCE_WORKSPACE_ARTIFACT_STAGED_IDENTITY_INVALID');
    }
    for (const [index, path] of CANONICAL_INPUTS.entries()) {
      if (!canonicalBefore[index].equals(await readFile(path))) {
        throw new Error('WINDOWS_ACCEPTANCE_WORKSPACE_ARTIFACT_CANONICAL_CHANGED');
      }
    }
    if (await readGitState({ repositoryRoot: REPOSITORY_ROOT }) !== buildRevision) {
      throw new Error('WINDOWS_ACCEPTANCE_WORKSPACE_ARTIFACT_BUILD_IDENTITY_INVALID');
    }
    const descriptorPath = resolve(artifactRoot, WORKSPACE_SUCCESS_DESCRIPTOR_FILENAME);
    await writeJsonAtomicExclusive(descriptorPath, descriptor);
    const identity = await hashWorkspaceSuccessArtifactFile(descriptorPath);
    const verified = await verifyWorkspaceSuccessArtifact({
      artifactRoot, expectedBuildRevision: buildRevision,
      expectedDescriptorSha256: identity.sha256,
    });
    return Object.freeze({
      schemaVersion: 1, status: 'completed', resultCode: 'workspaceSuccessArtifactBuilt',
      buildRevision, descriptorSha256: verified.descriptorSha256,
      sourcePackageSha256: source.packageSha256,
      targetPackageSha256: target.packageSha256,
      sourcePayloadIdentity: source.payloadInventory.identity,
      targetPayloadIdentity: target.payloadInventory.identity,
    });
  } catch (error) {
    // This producer has not installed or started an application.
    try {
      await rm(artifactRoot, { recursive: true, force: true });
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        'WINDOWS_ACCEPTANCE_WORKSPACE_ARTIFACT_BUILD_CLEANUP_FAILED',
      );
    }
    throw error;
  }
}

async function main() {
  try {
    const args = parseWorkspaceSuccessArtifactBuildArguments(process.argv.slice(2));
    const result = await buildWorkspaceSuccessArtifact(args);
    await writeJsonAtomicExclusive(args.summaryPath, result);
    console.log(JSON.stringify(result));
  } catch (error) {
    process.exitCode = 1;
    try {
      console.error(JSON.stringify(workspaceArtifactBuildFailureSummary(error)));
    } catch {
      // Failure evidence cannot replace the build's unsuccessful exit.
    }
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
