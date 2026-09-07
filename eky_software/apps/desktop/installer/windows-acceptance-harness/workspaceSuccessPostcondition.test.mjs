import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { createWorkspaceSuccessEvidenceTestFixture } from './workspaceSuccessEvidenceTestFixture.mjs';
import { verifyWorkspaceSuccessCheckpoints, verifyWorkspaceSuccessSemanticPostcondition } from './workspaceSuccessPostcondition.mjs';
import { workspaceSuccessCheckpointPath } from './workspaceSuccessProfileEvidence.mjs';
import { writeWorkspaceSuccessSessionEvidence } from './workspaceSuccessSessionProof.mjs';

test('six bound checkpoints prove business continuity and distinct idempotent B startups', async () => {
  assert.deepEqual(verifyWorkspaceSuccessCheckpoints(await createWorkspaceSuccessEvidenceTestFixture()),
    { status: 'completed', resultCode: 'workspaceSemanticProofValidated' });
});

const mutations = {
  'missing checkpoint': (f) => f.checkpoints.pop(),
  'wrong order': (f) => f.checkpoints.reverse(),
  'foreign run': (f) => { f.checkpoints[3].runNonce = 'f'.repeat(64); },
  'different artifact': (f) => { f.checkpoints[2].artifactDescriptorSha256 = 'f'.repeat(64); },
  'unrecognized field': (f) => { f.checkpoints[0].secret = 'synthetic-secret'; },
  'changed business identity': (f) => { f.checkpoints[1].profileState.fixtures[0].business.customerId = 'other'; },
  'changed lineage': (f) => { f.checkpoints[2].registry.workspaces[0].lineageIdentity.profileId = 'f'.repeat(64); },
  'baseline registry foreign identity': (f) => { f.checkpoints[0].registry.workspaces[0].workspaceId = '11111111-1111-4111-8111-111111111111'; },
  'wrong active pointer': (f) => { f.checkpoints[3].registry.activeWorkspaceId = f.state.fixtures[0].workspaceId; },
  'C not recovery required': (f) => { f.checkpoints[5].registry.workspaces[2].lifecycleState = 'ready'; },
  'premature B migration': (f) => { f.checkpoints[1].profileState.fixtures[1].baseline.database.sha256 = 'f'.repeat(64); },
  'missing A migration': (f) => { f.checkpoints[1].profileState.fixtures[0].baseline.database = f.state.fixtures[0].baseline.database; },
  'missing B migration': (f) => { f.checkpoints[3].profileState.fixtures[1].baseline.database = f.state.fixtures[1].baseline.database; },
  'C database changed': (f) => { f.checkpoints[5].profileState.fixtures[2].baseline.database.sha256 = 'f'.repeat(64); },
  'B restart changes database again': (f) => { f.checkpoints[4].profileState.fixtures[1].baseline.database.sha256 = 'f'.repeat(64); },
  'changed A after return': (f) => { f.checkpoints[5].profileState.fixtures[0].baseline.database.sha256 = 'f'.repeat(64); },
  'business rows changed': (f) => { f.checkpoints[1].profileState.fixtures[0].baseline.businessRowsSha256 = 'f'.repeat(64); },
  'PDF changed': (f) => { f.checkpoints[1].profileState.fixtures[0].baseline.pdf.sha256 = 'f'.repeat(64); },
  'archive changed': (f) => { f.checkpoints[1].profileState.fixtures[0].baseline.archiveJournal.sha256 = 'f'.repeat(64); },
  'secret namespace changed': (f) => { f.checkpoints[1].profileState.fixtures[0].baseline.secretSentinel.sha256 = 'f'.repeat(64); },
  'recovery namespace changed': (f) => { f.checkpoints[1].profileState.fixtures[0].baseline.recoverySentinel.sha256 = 'f'.repeat(64); },
  'missing accepted journal': (f) => { f.checkpoints[1].journal = null; },
  'wrong journal package': (f) => { f.checkpoints[1].journal.candidatePackageIdentity.packageSha256 = 'f'.repeat(64); },
  'accepted metadata rewritten on switch': (f) => { f.checkpoints[2].accepted.acceptedAt = '2026-01-02T00:00:00.000Z'; },
  'installation journal changed on switch': (f) => { f.checkpoints[2].journal.revision += 1; },
  'missing new B runtime': (f) => { f.checkpoints[4].events = structuredClone(f.checkpoints[3].events); },
  'missing target readiness': (f) => { f.checkpoints[1].events = []; },
  'source and target share a runtime': (f) => {
    const id = f.checkpoints[1].events[0].runtimeInstanceId;
    for (const event of f.checkpoints[1].events.slice(2)) event.runtimeInstanceId = id;
  },
  'B runtime identity reused': (f) => { const id = f.checkpoints[3].events.at(-1).runtimeInstanceId;
    for (const event of f.checkpoints[4].events.slice(-2)) event.runtimeInstanceId = id; },
  'missing graceful shutdown': (f) => { f.checkpoints[4].events.pop(); },
  'shutdown without a matching startup': (f) => {
    f.checkpoints[5].events.push({ ...f.checkpoints[5].events.at(-1),
      eventId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      runtimeInstanceId: 'ffffffff-ffff-4fff-8fff-ffffffffffff' });
  },
  'shutdown reports a different version': (f) => {
    f.checkpoints[5].events.at(-1).appVersion = f.state.sourceVersion;
  },
  'bootstrap failed': (f) => { f.checkpoints[4].events.at(-1).eventName = 'desktop.bootstrapFailed'; },
  'duplicate lifecycle event': (f) => { f.checkpoints[4].events.push(f.checkpoints[4].events[0]); },
  'session secret in evidence': (f) => { f.checkpoints[4].events[0].session = 'synthetic-secret'; },
};
for (const [name, mutate] of Object.entries(mutations)) {
  test(`rejects ${name}`, async () => {
    const fixture = await createWorkspaceSuccessEvidenceTestFixture();
    mutate(fixture);
    assert.throws(() => verifyWorkspaceSuccessCheckpoints(fixture), /^Error: profileEvidenceInvalid$/);
  });
}

for (const mode of ['completed', 'currentChanged', 'missingCheckpoint', 'foreignCheckpoint', 'readFailure', 'missingSessions']) {
  test(`independent final verifier rereads persisted evidence and current profile: ${mode}`, async (t) => {
    const fixture = await createWorkspaceSuccessEvidenceTestFixture();
    const proofRoot = await mkdtemp(resolve(await realpath(tmpdir()), 'eky-v26-postcondition-'));
    t.after(() => rm(proofRoot, { recursive: true, force: true }));
    await mkdir(resolve(proofRoot, 'evidence'));
    if (mode !== 'missingSessions') {
      const phases = ['sourceHandoff', 'targetFirstStart', 'switchToB', 'verifyBRestart', 'verifyBRestart', 'switchToA', 'rejectC'];
      await writeWorkspaceSuccessSessionEvidence({ ...fixture, proofRoot }, {
        evidence: () => fixture.checkpoints.at(-1).events.filter((event) => event.eventName === 'desktop.started')
          .map((event, index) => ({ phase: phases[index], runtimeInstanceId: event.runtimeInstanceId, priorSessionsRejected: index })),
      });
    }
    await writeFile(resolve(proofRoot, 'evidence', 'w6b2-profile-state-v1.json'), JSON.stringify(fixture.state));
    for (const checkpoint of fixture.checkpoints) {
      if (mode === 'missingCheckpoint' && checkpoint.checkpoint === 'firstBStartup') continue;
      const value = structuredClone(checkpoint);
      if (mode === 'foreignCheckpoint') value.runNonce = 'f'.repeat(64);
      await writeFile(workspaceSuccessCheckpointPath(proofRoot, value.checkpoint), JSON.stringify(value));
    }
    let reads = 0;
    const verify = () => verifyWorkspaceSuccessSemanticPostcondition({ ...fixture, proofRoot }, {
      captureCurrent: async () => {
        reads += 1;
        if (mode === 'readFailure') throw new Error('private read failure');
        const current = structuredClone(fixture.checkpoints.at(-1));
        if (mode === 'currentChanged') current.profileState.fixtures[0].baseline.database.sha256 = 'f'.repeat(64);
        return current;
      },
    });
    if (mode === 'completed') assert.deepEqual(await verify(), { status: 'completed', resultCode: 'workspaceSemanticProofValidated' });
    else await assert.rejects(verify, /^Error: profileEvidenceInvalid$/);
    assert.equal(reads, ['missingCheckpoint', 'foreignCheckpoint', 'missingSessions'].includes(mode) ? 0 : 1);
  });
}
