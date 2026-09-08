import assert from 'node:assert/strict';
import { lstat, mkdir, readFile, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import test from 'node:test';

import { WORKSPACE_SUCCESS_PHASES } from './workspaceSuccessContracts.mjs';
import { WORKSPACE_FAULT_PLANS } from './workspaceFaultContracts.mjs';
import { runWorkspaceSuccess, parseWorkspaceFaultArguments, workspaceSuccessCommandFailureDetails } from './runWorkspaceSuccess.mjs';
import { runWorkspaceFault } from './runWorkspaceFault.mjs';

function products(present) {
  return { status: 'completed', resultCode: present ? 'targetProductPresent' : 'exactProductsAbsent',
    sourcePresent: false, targetPresent: present, installerRegistryPresent: present };
}

for (const fault of [false, true]) {
for (const mode of ['completed', 'preconditionFailed', 'prepareFailed', 'launchFailed', 'supervisorMissing',
  'deadline', 'treeUnverified', 'scenarioMissing', 'businessFailed', 'cleanupFailed', 'footprintFailed',
  'profileChanged', 'artifactChanged', 'fixtureRemovalFailed', ...(fault ? ['sessionFailed'] : [])]) {
  test(`${fault ? 'fault' : 'success'} workspace command preserves outcomes and exact cleanup: ${mode}`, async (t) => {
    let root, context;
    let started = 0, inspections = 0, cleanups = 0, removals = 0, profileReads = 0;
    t.after(async () => { if (root) await rm(root, { recursive: true, force: true }); });
    const artifact = { artifactRoot: '', descriptorSha256: 'b'.repeat(64), buildRevision: 'a'.repeat(40),
      source: { manifest: { packageFilename: 'Eky-0.2.7-x64.msi' }, packageSha256: 'd'.repeat(64) },
      target: { manifest: { packageFilename: 'Eky-0.2.8-x64.msi' }, packageSha256: 'e'.repeat(64) } };
    const options = {
      platform: 'win32', environment: { APPDATA: resolve('synthetic-appdata'), LOCALAPPDATA: resolve('synthetic-local-appdata') },
      checkSupervisor: async () => undefined,
      inventoryProfile: async () => ++profileReads === 2 && mode === 'profileChanged'
        ? [{ kind: 'file', relativePath: 'synthetic', size: 1, sha256: 'a'.repeat(64) }] : [],
      materializeFixture: async (_, destination) => { root = dirname(destination); await mkdir(destination);
        artifact.artifactRoot = destination; return artifact; },
      prepareFixture: async (value) => { context = value; if (mode === 'prepareFailed') throw new Error('artifactInvalid'); },
      verifyArtifact: async () => { if (mode === 'artifactChanged') throw new Error('private content'); },
      createProductRuntime: () => ({
        verifyExactProductStates: async () => products(mode === 'preconditionFailed' || inspections++ === 1),
        cleanupExactProducts: async () => { cleanups += 1;
          if (mode === 'cleanupFailed') throw new Error('private cleanup error');
          return { status: 'completed', resultCode: 'semanticCleanupCompleted' }; },
      }),
      startSupervisor: (path) => {
        started += 1;
        if (mode === 'launchFailed') throw new Error('supervisorStartFailed');
        return { child: { exitCode: 0, signalCode: null }, completion: readFile(path, 'utf8').then((source) => {
          const value = JSON.parse(source);
          assert.equal(value.timeoutMilliseconds, 720000);
          assert.equal(value.cleanupReserveMilliseconds, 30000);
          assert.match(value.arguments[0], fault ? /runWorkspaceFaultWorker.mjs$/ : /runWorkspaceSuccessWorker.mjs$/);
          assert.equal(value.scenario, fault ? 'packagedWorkspaceFaultRollback' : 'packagedWorkspaceSuccess');
          return 0;
        }) };
      },
      readSupervisor: async () => {
        if (mode === 'supervisorMissing') throw new Error('private path');
        return { status: ['deadline', 'treeUnverified'].includes(mode) ? 'failed' : 'completed',
          processResultCode: ['deadline', 'treeUnverified'].includes(mode) ? 'deadlineExceeded' : 'processCompleted',
          workerResultCode: 'workerResultValidated', cleanupResultCode: mode === 'treeUnverified' ? 'cleanupUnverified' : 'notRequired',
          processTreeAbsent: mode !== 'treeUnverified' };
      },
      readScenario: async () => {
        if (mode === 'scenarioMissing') throw new Error('private path');
        return { schemaVersion: 1, scenario: context.request.scenario, runNonce: context.request.runNonce,
          artifactDescriptorSha256: context.request.artifactDescriptorSha256, status: 'completed',
          ...(fault ? { faultScenario: 'acceptanceInterruption' } : {}),
          resultCode: fault ? 'workspaceFaultCompleted' : 'workspaceSuccessCompleted', errorCode: null, failedPhase: null,
          completedPhases: [...(fault ? WORKSPACE_FAULT_PLANS.acceptanceInterruption.phases : WORKSPACE_SUCCESS_PHASES)] };
      },
      verifySemantic: async () => {
        if (mode === 'businessFailed') throw new Error('private company');
        return { status: 'completed', resultCode: fault ? 'workspaceFaultSemanticProofValidated' : 'workspaceSemanticProofValidated' };
      },
      verifySessions: async () => {
        assert.equal(fault, true);
        if (mode === 'sessionFailed') throw new Error('private session');
        return { status: 'completed', resultCode: 'workspaceFaultSessionsValidated' };
      },
      verifyFootprint: async () => {
        if (mode === 'footprintFailed') throw new Error('private path');
        return { status: 'completed', resultCode: 'installerFootprintAbsent' };
      },
      removeRunRoot: async (path) => { removals += 1;
        if (mode === 'fixtureRemovalFailed') throw new Error('private path');
        await rm(path, { recursive: true, force: true }); },
    };
    const run = () => (fault ? runWorkspaceFault : runWorkspaceSuccess)(['--artifact-descriptor', resolve('workspace-success-artifact.json'),
      '--expected-descriptor-sha256', 'b'.repeat(64), '--expected-build-revision', 'a'.repeat(40),
      ...(fault ? ['--fault-scenario', 'acceptanceInterruption'] : [])], options);
    let outcome;
    if (mode === 'completed') {
      await assert.doesNotReject(async () => { outcome = await run(); });
      assert.equal(outcome.status, 'completed');
      assert.equal(outcome.semanticProofResultCode, fault ? 'workspaceFaultSemanticProofValidated' : 'workspaceSemanticProofValidated');
      if (fault) assert.equal(outcome.sessionProofResultCode, 'workspaceFaultSessionsValidated');
    } else {
      await assert.rejects(run, (error) => {
        outcome = workspaceSuccessCommandFailureDetails(error);
        assert.equal(outcome?.status, 'failed');
        assert.ok(outcome.errorCode);
        assert.doesNotMatch(JSON.stringify(outcome), /private|synthetic-appdata|\.msi|\\\\/);
        return true;
      });
    }
    const noStart = ['preconditionFailed', 'prepareFailed'].includes(mode);
    const noCleanup = noStart || ['launchFailed', 'supervisorMissing', 'treeUnverified'].includes(mode);
    const retained = ['launchFailed', 'supervisorMissing', 'treeUnverified', 'cleanupFailed',
      'footprintFailed', 'profileChanged', 'artifactChanged', 'fixtureRemovalFailed'].includes(mode);
    assert.equal(started, noStart ? 0 : 1);
    assert.equal(cleanups, noCleanup ? 0 : 1);
    assert.equal(removals, retained && mode !== 'fixtureRemovalFailed' ? 0 : 1);
    assert.equal(outcome.fixtureRemoved, !retained);
    if (retained) assert.equal((await lstat(root)).isDirectory(), true);
    else await assert.rejects(lstat(root), { code: 'ENOENT' });
    if (mode === 'cleanupFailed') assert.equal(outcome.semanticCleanupResultCode, 'semanticCleanupFailed');
    if (mode === 'deadline') assert.equal(outcome.errorCode, 'supervisorDeadlineExceeded');
    if (mode === 'supervisorMissing') assert.equal(outcome.semanticCleanupResultCode, 'blockedByOwnedProcessTree');
    if (mode === 'sessionFailed') {
      assert.equal(outcome.semanticProofResultCode, 'workspaceFaultSemanticProofValidated');
      assert.equal(outcome.sessionProofResultCode, 'workspaceFaultSessionsFailed');
      assert.equal(outcome.errorCode, 'sessionProofInvalid');
    }
  });
}
}

test('fault caller accepts only the five closed scenarios and exact immutable artifact arguments', async () => {
  const base = ['--artifact-descriptor', resolve('workspace-success-artifact.json'),
    '--expected-descriptor-sha256', 'b'.repeat(64), '--expected-build-revision', 'a'.repeat(40)];
  for (const faultScenario of Object.keys(WORKSPACE_FAULT_PLANS)) {
    assert.equal(parseWorkspaceFaultArguments([...base, '--fault-scenario', faultScenario]).faultScenario, faultScenario);
  }
  let starts = 0;
  for (const args of [base, [...base, '--fault-scenario', '__proto__'], [...base, '--fault-scenario', 'unknown'],
    [...base, '--fault-scenario', 'acceptanceInterruption', 'extra'], [...base, '--other', 'acceptanceInterruption']]) {
    await assert.rejects(runWorkspaceFault(args, { checkSupervisor: async () => { starts += 1; } }), { message: 'requestInvalid' });
  }
  assert.equal(starts, 0);
});
