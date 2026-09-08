import assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';

import { WORKSPACE_FAULT_PLANS } from './workspaceFaultContracts.mjs';
import { createWorkspaceFaultEvidenceTestFixture } from './workspaceFaultEvidenceTestFixture.mjs';
import { workspaceFaultCheckpointPath } from './workspaceFaultProfileEvidence.mjs';
import { verifyWorkspaceFaultCheckpoints, verifyWorkspaceFaultSemanticPostcondition } from './workspaceFaultPostcondition.mjs';
import { createClosedDirectoryInventory } from './closedDirectoryInventory.mjs';

for (const scenario of Object.keys(WORKSPACE_FAULT_PLANS)) {
  test(`${scenario}: independent business proof requires the exact fault outcome`, async () => {
    const f = await createWorkspaceFaultEvidenceTestFixture(scenario);
    assert.deepEqual(verifyWorkspaceFaultCheckpoints(f), { status: 'completed', resultCode: 'workspaceFaultSemanticProofValidated' });
    const journal = f.checkpoints[1].journal;
    journal.state = journal.state === 'accepted' ? 'failedSafe' : 'accepted';
    journal.handoffAttemptCount = 1; journal.binaryRollbackAttemptCount = 0;
    journal.recoveryPointReference = '11111111-1111-4111-8111-111111111111';
    assert.throws(() => verifyWorkspaceFaultCheckpoints(f), { message: 'profileJournalMismatch' });
  });
}

const mutations = [
  ['missing checkpoint', (f) => f.checkpoints.pop(), 'profileEvidenceInvalid'],
  ['wrong phase order', (f) => f.checkpoints.reverse(), 'profileEvidenceInvalid'],
  ['different scenario', (f) => { f.checkpoints[1].faultScenario = 'binaryRollbackFailure'; }, 'profileEvidenceInvalid'],
  ['different run', (f) => { f.checkpoints[1].runNonce = 'f'.repeat(64); }, 'profileEvidenceInvalid'],
  ['different artifact', (f) => { f.checkpoints[1].artifactDescriptorSha256 = 'f'.repeat(64); }, 'profileEvidenceInvalid'],
  ['unknown private field', (f) => { f.checkpoints[0].session = 'synthetic-secret'; }, 'profileEvidenceInvalid'],
  ['invented startup evidence', (f) => { f.checkpoints[1].events = []; }, 'profileEvidenceInvalid'],
  ['different revision', (f) => { f.request = { ...f.request, buildRevision: 'f'.repeat(40) }; }, 'profileEvidenceInvalid'],
  ['different version', (f) => { f.artifact.source.appVersion = '0.2.6'; }, 'profileEvidenceInvalid'],
  ['rewritten baseline', (f) => { f.checkpoints[0].profileState.fixtures[0].baseline.database.sha256 = 'f'.repeat(64); }, 'profileEvidenceInvalid'],
  ['foreign business identity', (f) => { f.checkpoints[1].profileState.fixtures[0].business.customerId = 'foreign'; }, 'profileEvidenceInvalid'],
  ['wrong baseline active pointer', (f) => { f.checkpoints[0].registry.activeWorkspaceId = f.state.fixtures[1].workspaceId; }, 'profileRegistryMismatch'],
  ['wrong active pointer', (f) => { f.checkpoints[1].registry.activeWorkspaceId = f.state.fixtures[1].workspaceId; }, 'profileRegistryMismatch'],
  ['wrong lineage', (f) => { f.checkpoints[1].registry.workspaces[0].lineageIdentity.profileId = 'f'.repeat(64); }, 'profileRegistryMismatch'],
  ['registry creation changed', (f) => { f.checkpoints[1].registry.workspaces[0].createdAt = '2026-01-02T00:00:00.000Z'; }, 'profileRegistryMismatch'],
  ['wrong lifecycle', (f) => { f.checkpoints[1].registry.workspaces[2].lifecycleState = 'recoveryRequired'; }, 'profileRegistryMismatch'],
  ['missing business rollback', (f) => { f.checkpoints[1].profileState.fixtures[0].baseline.database.sha256 = 'f'.repeat(64); }, 'profileMigrationMismatch'],
  ['missing accepted build', (f) => { f.checkpoints[1].accepted = null; }, 'profileEvidenceInvalid'],
  ['wrong accepted build', (f) => { f.checkpoints[1].accepted.appVersion = '0.2.8'; }, 'profileAcceptedBuildMismatch'],
  ['wrong source package hash', (f) => { f.checkpoints[1].journal.currentPackageIdentity.packageSha256 = 'f'.repeat(64); }, 'profileJournalMismatch'],
  ['wrong target package size', (f) => { f.checkpoints[1].journal.candidatePackageIdentity.packageSize += 1; }, 'profileJournalMismatch'],
  ['missing journal', (f) => { f.checkpoints[1].journal = null; }, 'profileJournalMismatch'],
];
for (const field of ['pdf', 'archiveConfig', 'archiveJournal', 'archiveSentinel', 'secretSentinel', 'recoverySentinel']) {
  mutations.push([`changed ${field}`, (f) => { f.checkpoints[1].profileState.fixtures[0].baseline[field].sha256 = 'f'.repeat(64); }, 'profileBusinessContentChanged']);
}
mutations.push(['business rows changed', (f) => { f.checkpoints[1].profileState.fixtures[0].baseline.businessRowsSha256 = 'f'.repeat(64); }, 'profileBusinessContentChanged']);
for (const [name, mutate, error] of mutations) {
  test(`fault postcondition rejects ${name}`, async () => {
    const f = await createWorkspaceFaultEvidenceTestFixture();
    mutate(f);
    assert.throws(() => verifyWorkspaceFaultCheckpoints(f), { message: error });
  });
}

for (const mode of ['completed', 'changedCurrent', 'missingTerminal', 'missingState', 'readFailure']) {
  test(`fault verifier rereads bound checkpoints and current profile without writes: ${mode}`, async (t) => {
    const f = await createWorkspaceFaultEvidenceTestFixture();
    const proofRoot = await mkdtemp(resolve(await realpath(tmpdir()), 'eky-fault-evidence-'));
    t.after(() => rm(proofRoot, { recursive: true, force: true }));
    await mkdir(resolve(proofRoot, 'evidence'));
    if (mode !== 'missingState') await writeFile(resolve(proofRoot, 'evidence', 'w6b2-profile-state-v1.json'), JSON.stringify(f.state));
    for (const value of f.checkpoints) {
      if (mode === 'missingTerminal' && value.checkpoint === 'faultTerminal') continue;
      await writeFile(workspaceFaultCheckpointPath(proofRoot, value.checkpoint), JSON.stringify(value));
    }
    const before = await createClosedDirectoryInventory(proofRoot);
    let reads = 0;
    const verify = () => verifyWorkspaceFaultSemanticPostcondition({ ...f, proofRoot }, {
      captureCurrent: async () => {
        reads += 1;
        if (mode === 'readFailure') throw new Error('private failure');
        const result = structuredClone(f.checkpoints[1]);
        if (mode === 'changedCurrent') result.journal.revision += 1;
        return result;
      },
    });
    if (mode === 'completed') assert.deepEqual(await verify(), { status: 'completed', resultCode: 'workspaceFaultSemanticProofValidated' });
    else await assert.rejects(verify, { message: mode === 'changedCurrent' ? 'profileCurrentStateChanged' : 'profileEvidenceInvalid' });
    assert.equal(reads, ['missingTerminal', 'missingState'].includes(mode) ? 0 : 1);
    assert.deepEqual(await createClosedDirectoryInventory(proofRoot), before);
  });
}
