import { constants } from 'node:fs';
import { copyFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import {
  createW6b2PackagedSuccessRunFixture, verifyW6b2PackagedSuccessRunFixture,
  w6b2PackagedProofDirectoryName, w6b2PackagedProofPathTokenLength,
} from '../scripts/w6b2PackagedSuccessRunFixture.mjs';
import { verifyWorkspaceSuccessArtifact } from './workspaceSuccessArtifact.mjs';
import { WORKSPACE_SUCCESS_DESCRIPTOR_FILENAME } from './workspaceSuccessArtifactDescriptor.mjs';

// Leave room for workspace UUIDs and snapshot staging under user-scoped TEMP.
export const WORKSPACE_SUCCESS_RUN_ROOT_PREFIX = 'eky-v26-';

export async function materializeWorkspaceSuccessArtifactFixture(input, fixtureRoot) {
  const source = await verifyWorkspaceSuccessArtifact(input);
  await mkdir(fixtureRoot, { recursive: false });
  await copyFile(source.descriptorPath, resolve(fixtureRoot, WORKSPACE_SUCCESS_DESCRIPTOR_FILENAME), constants.COPYFILE_EXCL);
  for (const role of ['source', 'target']) {
    const root = resolve(fixtureRoot, role);
    await mkdir(root);
    await copyFile(source[role].manifestPath, resolve(root, 'installer.manifest.json'), constants.COPYFILE_EXCL);
    await copyFile(source[role].installerPath, resolve(root, source[role].manifest.packageFilename), constants.COPYFILE_EXCL);
  }
  // The caller owns prelaunch fixture cleanup, including partial copies.
  const artifact = await verifyWorkspaceSuccessArtifact({ ...input, artifactRoot: fixtureRoot });
  await verifyWorkspaceSuccessArtifact(input);
  return artifact;
}

export function workspaceSuccessRunContext(requestPath, request, artifact) {
  const scenarioRoot = dirname(requestPath);
  if (resolve(scenarioRoot, '../fixture') !== request.fixtureRoot) throw new Error('requestInvalid');
  const temporaryRoot = resolve(scenarioRoot, 'proof');
  const proofRoot = resolve(temporaryRoot, w6b2PackagedProofDirectoryName,
    request.runNonce.slice(0, w6b2PackagedProofPathTokenLength));
  const runFixture = { proofRoot, token: request.runNonce };
  for (const role of ['source', 'target']) {
    runFixture[role] = {
      installerPath: resolve(proofRoot, 'packages', role, artifact[role].manifest.packageFilename),
      manifestPath: resolve(proofRoot, 'packages', role, 'manifest.json'),
      packageSha256: artifact[role].packageSha256, packageSize: artifact[role].packageSize,
      productCode: artifact[role].productCode,
    };
  }
  return { request, artifact, scenarioRoot, temporaryRoot, runFixture, proofRoot };
}

export async function prepareWorkspaceSuccessRunFixture(context) {
  await mkdir(context.temporaryRoot, { recursive: false });
  const actual = await createW6b2PackagedSuccessRunFixture({
    temporaryRoot: context.temporaryRoot, token: context.request.runNonce,
    installerPair: { buildRevision: context.request.buildRevision.slice(0, 12),
      source: context.artifact.source, target: context.artifact.target },
  });
  if (actual.proofRoot !== context.proofRoot) throw new Error('artifactInvalid');
  await verifyW6b2PackagedSuccessRunFixture({ ...context.runFixture, temporaryRoot: context.temporaryRoot });
}
