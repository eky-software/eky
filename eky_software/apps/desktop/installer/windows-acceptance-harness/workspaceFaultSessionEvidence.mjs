import { resolve } from 'node:path';

import { validateWorkspaceFaultRequest } from './workspaceFaultContracts.mjs';
import { hasWorkspaceSuccessExactKeys, readWorkspaceSuccessObject, writeJsonAtomicExclusive } from './workspaceSuccessContracts.mjs';
import { loadWorkspaceFaultSessionPhases } from './workspaceSuccessSessionProof.mjs';

const FILE_NAME = 'workspace-fault-sessions.json';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export async function validateWorkspaceFaultSessionEvidence(value, expected) {
  try {
    const request = validateWorkspaceFaultRequest(expected);
    const phases = await loadWorkspaceFaultSessionPhases(request.faultScenario);
    if (!hasWorkspaceSuccessExactKeys(value, ['schemaVersion', 'faultScenario', 'runNonce',
      'artifactDescriptorSha256', 'proofs']) || value.schemaVersion !== 1 ||
      value.faultScenario !== request.faultScenario || value.runNonce !== request.runNonce ||
      value.artifactDescriptorSha256 !== request.artifactDescriptorSha256 ||
      !Array.isArray(value.proofs) || value.proofs.length !== phases.length ||
      Array.from(value.proofs).some((proof, index) =>
        !hasWorkspaceSuccessExactKeys(proof, ['phase', 'runtimeInstanceId', 'priorSessionsRejected']) ||
        proof.phase !== phases[index] || typeof proof.runtimeInstanceId !== 'string' ||
        !UUID.test(proof.runtimeInstanceId) || proof.priorSessionsRejected !== index) ||
      new Set(value.proofs.map((proof) => proof.runtimeInstanceId)).size !== phases.length) {
      throw new Error('sessionProofInvalid');
    }
    return value;
  } catch { throw new Error('sessionProofInvalid'); }
}

export async function writeWorkspaceFaultSessionEvidence({ proofRoot, request }, proof) {
  const value = await validateWorkspaceFaultSessionEvidence({
    schemaVersion: 1, faultScenario: request.faultScenario, runNonce: request.runNonce,
    artifactDescriptorSha256: request.artifactDescriptorSha256, proofs: proof.evidence(),
  }, request);
  await writeJsonAtomicExclusive(resolve(proofRoot, 'evidence', FILE_NAME), value);
}

export async function verifyWorkspaceFaultSessionEvidence({ proofRoot, request }) {
  await validateWorkspaceFaultSessionEvidence(await readWorkspaceSuccessObject(
    resolve(proofRoot, 'evidence', FILE_NAME), 'sessionProofInvalid'), request);
  return Object.freeze({ status: 'completed', resultCode: 'workspaceFaultSessionsValidated' });
}
