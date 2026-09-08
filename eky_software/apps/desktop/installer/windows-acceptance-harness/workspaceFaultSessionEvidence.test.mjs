import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';

import { WORKSPACE_FAULT_PLANS } from './workspaceFaultContracts.mjs';
import { createWorkspaceFaultEvidenceTestFixture } from './workspaceFaultEvidenceTestFixture.mjs';
import { validateWorkspaceFaultSessionEvidence, writeWorkspaceFaultSessionEvidence,
  verifyWorkspaceFaultSessionEvidence } from './workspaceFaultSessionEvidence.mjs';

function evidence(f) {
  return { schemaVersion: 1, faultScenario: f.request.faultScenario, runNonce: f.request.runNonce,
    artifactDescriptorSha256: f.request.artifactDescriptorSha256, proofs: f.proofs };
}

test('each closed fault sequence validates independently without desktop.started events', async () => {
  for (const scenario of Object.keys(WORKSPACE_FAULT_PLANS)) {
    const f = await createWorkspaceFaultEvidenceTestFixture(scenario);
    assert.deepEqual(await validateWorkspaceFaultSessionEvidence(evidence(f), f.request), evidence(f));
  }
});

const mutations = {
  missing: (v) => v.proofs.pop(),
  extra: (v) => v.proofs.push(v.proofs[0]),
  order: (v) => v.proofs.reverse(),
  foreignRun: (v) => { v.runNonce = 'f'.repeat(64); },
  foreignArtifact: (v) => { v.artifactDescriptorSha256 = 'f'.repeat(64); },
  foreignScenario: (v) => { v.faultScenario = 'binaryRollbackFailure'; },
  invalidRuntime: (v) => { v.proofs[0].runtimeInstanceId = 'invalid'; },
  reusedRuntime: (v) => { v.proofs[1].runtimeInstanceId = v.proofs[0].runtimeInstanceId; },
  missingOldRejection: (v) => { v.proofs[1].priorSessionsRejected = 0; },
  secret: (v) => { v.proofs[0].session = 'synthetic-secret'; },
  port: (v) => { v.proofs[0].port = 1234; },
  inventedEvents: (v) => { v.events = ['desktop.started']; },
};
for (const [name, mutate] of Object.entries(mutations)) {
  test(`fault session evidence rejects ${name}`, async () => {
    const f = await createWorkspaceFaultEvidenceTestFixture();
    const value = evidence(f); mutate(value);
    await assert.rejects(validateWorkspaceFaultSessionEvidence(value, f.request), { message: 'sessionProofInvalid' });
  });
}

test('fault session writer validates before publishing, writes once, and verifier requires the file', async (t) => {
  const f = await createWorkspaceFaultEvidenceTestFixture();
  const proofRoot = await mkdtemp(resolve(await realpath(tmpdir()), 'eky-fault-sessions-'));
  t.after(() => rm(proofRoot, { recursive: true, force: true }));
  await mkdir(resolve(proofRoot, 'evidence'));
  const input = { proofRoot, request: f.request };
  await assert.rejects(verifyWorkspaceFaultSessionEvidence(input), { message: 'sessionProofInvalid' });
  await assert.rejects(writeWorkspaceFaultSessionEvidence(input, { evidence: () => [{ session: 'synthetic-secret' }] }), { message: 'sessionProofInvalid' });
  const proof = { evidence: () => f.proofs };
  await writeWorkspaceFaultSessionEvidence(input, proof);
  const path = resolve(proofRoot, 'evidence', 'workspace-fault-sessions.json');
  const before = await readFile(path);
  assert.deepEqual(await verifyWorkspaceFaultSessionEvidence(input), { status: 'completed', resultCode: 'workspaceFaultSessionsValidated' });
  await assert.rejects(writeWorkspaceFaultSessionEvidence(input, proof));
  assert.deepEqual(await readFile(path), before);
  assert.deepEqual(JSON.parse(before), evidence(f));
});
