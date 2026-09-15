import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  UPGRADE_ROLLBACK_DESCRIPTOR_FILENAME,
  verifyUpgradeRollbackArtifact,
} from './upgradeRollbackArtifact.mjs';
import { parseAbsoluteWindowsAcceptancePath } from './windowsAcceptancePathArgument.mjs';

const SHA_256_PATTERN = /^[0-9a-f]{64}$/;
const BUILD_REVISION_PATTERN = /^[0-9a-f]{40}$/;

export function parseUpgradeRollbackArtifactVerifierArguments(arguments_) {
  if (
    arguments_.length !== 6 ||
    arguments_[0] !== '--artifact-root' ||
    arguments_[2] !== '--expected-descriptor-sha256' ||
    typeof arguments_[3] !== 'string' ||
    !SHA_256_PATTERN.test(arguments_[3]) ||
    arguments_[4] !== '--expected-build-revision' ||
    typeof arguments_[5] !== 'string' ||
    !BUILD_REVISION_PATTERN.test(arguments_[5])
  ) {
    throw new Error('WINDOWS_ACCEPTANCE_UPGRADE_ARTIFACT_ARGUMENTS_INVALID');
  }
  return Object.freeze({
    artifactRoot: parseAbsoluteWindowsAcceptancePath(
      arguments_[1],
      'WINDOWS_ACCEPTANCE_UPGRADE_ARTIFACT_ARGUMENTS_INVALID',
    ),
    expectedDescriptorSha256: arguments_[3],
    expectedBuildRevision: arguments_[5],
  });
}

function safeErrorCode(error) {
  return (
    typeof error?.message === 'string' &&
    /^WINDOWS_ACCEPTANCE_UPGRADE_[A-Z0-9_]{2,95}$/.test(error.message)
  )
    ? error.message
    : 'WINDOWS_ACCEPTANCE_UPGRADE_ARTIFACT_UNEXPECTED_FAILURE';
}

async function main() {
  try {
    const result = await verifyUpgradeRollbackArtifact(
      parseUpgradeRollbackArtifactVerifierArguments(process.argv.slice(2)),
    );
    console.log(
      JSON.stringify({
        schemaVersion: 1,
        status: 'completed',
        resultCode: result.resultCode,
        buildRevision: result.buildRevision,
        descriptorSha256: result.descriptorSha256,
        sourcePackageSha256: result.roles.source.packageSha256,
        targetPackageSha256: result.roles.target.packageSha256,
        windowsRollbackPackageSha256:
          result.roles.windowsRollback.packageSha256,
      }),
    );
  } catch (error) {
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

export function upgradeRollbackDescriptorPath(artifactRoot) {
  return resolve(artifactRoot, UPGRADE_ROLLBACK_DESCRIPTOR_FILENAME);
}
