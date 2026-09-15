import { resolve } from 'node:path';

import { validateWorkspaceFaultRequest } from './workspaceFaultContracts.mjs';
import { writeJsonAtomicExclusive } from './workspaceSuccessContracts.mjs';
import { captureWorkspaceProfileSnapshot, loadWorkspaceSuccessProfileSupport } from './workspaceSuccessProfileEvidence.mjs';

export const WORKSPACE_FAULT_CHECKPOINTS = Object.freeze(['sourceBaseline', 'faultTerminal']);

export async function loadWorkspaceFaultProfileSupport() {
  const support = await loadWorkspaceSuccessProfileSupport();
  const { assertW6b2PackagedFaultWorkspaceState } = await import(new URL(
    '../../e2e-dist/e2e/w6b2PackagedFaultWorkspaceProfile.js', import.meta.url));
  return Object.freeze({ ...support, assertW6b2PackagedFaultWorkspaceState });
}

export function workspaceFaultCheckpointPath(proofRoot, checkpoint) {
  if (!WORKSPACE_FAULT_CHECKPOINTS.includes(checkpoint)) throw new Error('profileEvidenceInvalid');
  return resolve(proofRoot, 'evidence', `workspace-fault-${checkpoint}.json`);
}

export async function captureWorkspaceFaultProfileEvidence(input) {
  try {
    const request = validateWorkspaceFaultRequest(input.request);
    if (!WORKSPACE_FAULT_CHECKPOINTS.includes(input.checkpoint)) throw new Error('profileEvidenceInvalid');
    const snapshot = await captureWorkspaceProfileSnapshot(input);
    // Fault and recovery-only launches do not claim desktop.started readiness.
    return { schemaVersion: 1, checkpoint: input.checkpoint, faultScenario: request.faultScenario,
      runNonce: request.runNonce, artifactDescriptorSha256: request.artifactDescriptorSha256, ...snapshot };
  } catch { throw new Error('profileEvidenceInvalid'); }
}

export async function writeWorkspaceFaultCheckpoint(input) {
  const evidence = await captureWorkspaceFaultProfileEvidence(input);
  await writeJsonAtomicExclusive(workspaceFaultCheckpointPath(input.proofRoot, input.checkpoint), evidence);
}
