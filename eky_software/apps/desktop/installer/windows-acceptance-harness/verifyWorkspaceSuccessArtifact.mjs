import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { verifyWorkspaceSuccessArtifact } from './workspaceSuccessArtifact.mjs';
import { parseAbsoluteWindowsAcceptancePath } from './windowsAcceptancePathArgument.mjs';

export function parseWorkspaceSuccessArtifactVerifyArguments(args) {
  if (
    args.length !== 6 || args[0] !== '--artifact-root' ||
    args[2] !== '--expected-descriptor-sha256' ||
    typeof args[3] !== 'string' || !/^[0-9a-f]{64}$/.test(args[3]) ||
    args[4] !== '--expected-build-revision' ||
    typeof args[5] !== 'string' || !/^[0-9a-f]{40}$/.test(args[5])
  ) {
    throw new Error('WINDOWS_ACCEPTANCE_WORKSPACE_ARTIFACT_ARGUMENTS_INVALID');
  }
  return Object.freeze({
    artifactRoot: parseAbsoluteWindowsAcceptancePath(
      args[1], 'WINDOWS_ACCEPTANCE_WORKSPACE_ARTIFACT_ARGUMENTS_INVALID',
    ),
    expectedDescriptorSha256: args[3], expectedBuildRevision: args[5],
  });
}

async function main() {
  try {
    const result = await verifyWorkspaceSuccessArtifact(
      parseWorkspaceSuccessArtifactVerifyArguments(process.argv.slice(2)),
    );
    console.log(JSON.stringify({
      schemaVersion: 1, status: 'completed',
      resultCode: result.resultCode, buildRevision: result.buildRevision,
      descriptorSha256: result.descriptorSha256,
      sourcePackageSha256: result.source.packageSha256,
      targetPackageSha256: result.target.packageSha256,
      sourcePayloadIdentity: result.source.payloadInventory.identity,
      targetPayloadIdentity: result.target.payloadInventory.identity,
    }));
  } catch {
    console.error(JSON.stringify({
      schemaVersion: 1, status: 'failed',
      errorCode: 'WINDOWS_ACCEPTANCE_WORKSPACE_ARTIFACT_VERIFICATION_FAILED',
    }));
    process.exitCode = 1;
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
