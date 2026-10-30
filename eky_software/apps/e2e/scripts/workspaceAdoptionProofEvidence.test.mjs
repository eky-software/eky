import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { runElectronWorkspaceAdoptionAcceptanceProof } from '../src/electron/electronMainCapabilities.ts';
import { createRunnerFailureSink, validateRunnerFailureEvidence } from '../../../test-reporters/runnerFailureEvidence.mjs';
import { projectExceptionChain } from '../../desktop/src/main/startupExceptionEvidence.ts';

const runtimeInstanceId = '11111111-1111-4111-8111-111111111111';
const context = () => ({ title: 'DESK-WORKSPACE-ADOPTION-001 synthetic failure', testId: 'synthetic-adoption',
  file: 'electron/desktopCapabilities.spec.ts', line: 1, column: 1, retry: 1, repeatEachIndex: 0, annotations: [] });
const reply = () => ({ status: 'failed', runtimeInstanceId,
  exception: projectExceptionChain(new Error('SYNTHETIC_ADOPTION_ORIGINAL', { cause: new Error('SYNTHETIC_ADOPTION_CAUSE') })) });

test('successful native proof does not create a failure record', async () => {
  const result = { backendStarts: 2 };
  assert.equal(await runElectronWorkspaceAdoptionAcceptanceProof({ evaluate: async () => ({ status: 'completed', result }) },
    context(), { record() { assert.fail(); }, flush() { assert.fail(); } }), result);
});

test('the named main reader preserves original causes in the existing sink with test attempt and runtime binding', async t => {
  const root = await mkdtemp(join(tmpdir(), 'eky-adoption-evidence-'));
  let completed = false;
  t.after(() => completed ? rm(root, { recursive: true, force: true }) : undefined);
  const old = globalThis.__EKY_ELECTRON_E2E__;
  globalThis.__EKY_ELECTRON_E2E__ = { runWorkspaceAdoptionAcceptanceProof: async () => reply() };
  t.after(() => { if (old === undefined) delete globalThis.__EKY_ELECTRON_E2E__; else globalThis.__EKY_ELECTRON_E2E__ = old; });
  const testInfo = context();
  await assert.rejects(runElectronWorkspaceAdoptionAcceptanceProof({ evaluate: async callback => callback() },
    testInfo, createRunnerFailureSink({ env: {}, tempRoot: root })), /^Error: WORKSPACE_ADOPTION_ACCEPTANCE_PROOF_FAILED$/);
  assert.equal(testInfo.annotations[0].description, 'recorded');
  const [directory] = await readdir(root);
  const file = (await readdir(join(root, directory))).find(name => !name.includes('summary'));
  const record = validateRunnerFailureEvidence(JSON.parse(await readFile(join(root, directory, file), 'utf8')));
  assert.equal(record.phase, 'workspaceAdoptionAcceptance');
  assert.equal(record.test.id, `${testInfo.testId}:${runtimeInstanceId}`);
  assert.equal(record.test.attempt, 1);
  assert.equal(record.exception.chain[0].message, 'SYNTHETIC_ADOPTION_ORIGINAL');
  assert.equal(record.exception.chain[1].message, 'SYNTHETIC_ADOPTION_CAUSE');
  assert.equal(record.exception.chain[0].stack.includes('workspaceAdoptionProofEvidence'), true);
  completed = true;
});

for (const failure of ['record', 'flush', 'annotations']) {
  test(`a ${failure} failure cannot replace the native proof failure`, async () => {
    const testInfo = context();
    if (failure === 'annotations') testInfo.annotations = { push() { throw new Error('SYNTHETIC_REPORTING'); } };
    await assert.rejects(runElectronWorkspaceAdoptionAcceptanceProof({ evaluate: async () => reply() }, testInfo, {
      record() { if (failure === 'record') throw new Error('SYNTHETIC_REPORTING'); },
      async flush() { if (failure === 'flush') throw new Error('SYNTHETIC_REPORTING'); return { status: 'recorded' }; },
    }), /^Error: WORKSPACE_ADOPTION_ACCEPTANCE_PROOF_FAILED$/);
  });
}

test('partial source capture remains explicitly partial after successful delivery', async () => {
  const value = reply();
  value.exception.incomplete = true;
  const testInfo = context();
  await assert.rejects(runElectronWorkspaceAdoptionAcceptanceProof({ evaluate: async () => value }, testInfo, {
    record() {}, async flush() { return { status: 'recorded' }; },
  }));
  assert.equal(testInfo.annotations[0].description, 'partial');
});
