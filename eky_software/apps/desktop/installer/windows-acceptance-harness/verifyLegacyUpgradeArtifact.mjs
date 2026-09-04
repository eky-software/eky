import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { verifyLegacyUpgradeArtifact } from './legacyUpgradeArtifact.mjs';
import { parseAbsoluteWindowsAcceptancePath } from './windowsAcceptancePathArgument.mjs';

const SHA_256_PATTERN = /^[0-9a-f]{64}$/;
const BUILD_REVISION_PATTERN = /^[0-9a-f]{40}$/;

export function parseLegacyUpgradeArtifactVerifierArguments(arguments_) {
  if (
    arguments_.length !== 6 ||
    arguments_[0] !== '--artifact-root' ||
    arguments_[2] !== '--expected-descriptor-sha256' ||
    arguments_[4] !== '--expected-build-revision' ||
    !SHA_256_PATTERN.test(arguments_[3] ?? '') ||
    !BUILD_REVISION_PATTERN.test(arguments_[5] ?? '')
  ) {
    throw new Error(
      'WINDOWS_ACCEPTANCE_LEGACY_ARTIFACT_VERIFY_ARGUMENTS_INVALID',
    );
  }
  return Object.freeze({
    artifactRoot: parseAbsoluteWindowsAcceptancePath(
      arguments_[1],
      'WINDOWS_ACCEPTANCE_LEGACY_ARTIFACT_VERIFY_ARGUMENTS_INVALID',
    ),
    expectedDescriptorSha256: arguments_[3],
    expectedBuildRevision: arguments_[5],
  });
}

async function main() {
  try {
    const result = await verifyLegacyUpgradeArtifact(
      parseLegacyUpgradeArtifactVerifierArguments(process.argv.slice(2)),
    );
    console.log(
      JSON.stringify({
        schemaVersion: 1,
        status: 'completed',
        resultCode: result.resultCode,
        buildRevision: result.buildRevision,
        descriptorSha256: result.descriptorSha256,
        sourceArtifactClass: result.source.artifactClass,
        sourcePackageSha256: result.source.packageSha256,
        targetPackageSha256: result.target.packageSha256,
        targetPayloadIdentity: result.target.payloadInventory.identity,
      }),
    );
  } catch (error) {
    const errorCode =
      typeof error?.message === 'string' &&
      /^WINDOWS_ACCEPTANCE_LEGACY_[A-Z0-9_]{2,95}$/.test(error.message)
        ? error.message
        : 'WINDOWS_ACCEPTANCE_LEGACY_ARTIFACT_VERIFICATION_FAILED';
    console.error(
      JSON.stringify({ schemaVersion: 1, status: 'failed', errorCode }),
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
