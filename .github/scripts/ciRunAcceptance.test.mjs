import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { classifyCiChanges } from './classifyCiChanges.mjs';
import { classifyCiRisk } from './ciRiskPolicy.mjs';
import { requiredCiJobs } from './ciJobCoverage.mjs';
import { CI_WORKFLOWS, evaluateCiRun } from './ciRunAcceptance.mjs';
import { summarizeLegacyCapture } from './legacyCaptureObservation.mjs';

const fast = 'eky_software/apps/web/src/features/customers/CustomerList.tsx';
const critical = 'eky_software/apps/desktop/src/profileBackup/restore/profileRestoreStartupRecovery.ts';
const planFor = (paths, eventName = 'pull_request') => classifyCiRisk({ eventName,
  ref: eventName === 'pull_request' ? 'refs/pull/1/merge' : 'refs/heads/main',
  changedPaths: paths, comparisonComplete: true });

function evidence(plan) {
  const selected = ['classification', 'cadence_contracts', 'core',
    ...(plan.gates.windowsContracts ? ['supervisor', 'clean', 'upgrade', 'workspace'] : []),
    ...(plan.gates.legacyUpgrade ? ['legacy'] : [])];
  const needs = Object.fromEntries(CI_WORKFLOWS.map((name) => [name, {
    result: selected.includes(name) ? 'success' : 'skipped', outputs: {},
  }]));
  const jobs = [];
  for (const [gate, members] of Object.entries(requiredCiJobs(plan))) {
    if (!plan.gates[gate]) continue;
    for (const member of members) {
      let job = jobs.find((value) => value.name === `caller / ${member.name}`);
      if (!job) {
        job = { id: jobs.length + 1, name: `caller / ${member.name}`, status: 'completed', conclusion: 'success', steps: [] };
        jobs.push(job);
      }
      for (const name of member.steps) if (!job.steps.some((step) => step.name === name)) {
        job.steps.push({ name, status: 'completed', conclusion: 'success' });
      }
    }
  }
  return { needs, jobs };
}

test('light, lifecycle, mixed and full-event changes select exact coverage and complete', () => {
  for (const [paths, event, count] of [
    [[fast], 'pull_request', 5], [[critical], 'pull_request', 24],
    [[fast, critical], 'pull_request', 24], [[fast], 'push', 34],
    [[fast], 'schedule', 34], [[fast], 'workflow_dispatch', 34],
  ]) {
    const plan = planFor(paths, event);
    const { needs, jobs } = evidence(plan);
    assert.equal(jobs.length, count);
    assert.equal(evaluateCiRun(plan, needs, jobs).status, 'completed');
  }
  const full = evidence(planFor([fast], 'push')).jobs.map((job) => job.name);
  for (const name of ['Verify clean lifecycle run 2', 'Verify upgrade and rollback run 2',
    'V2.5 packaged legacy phase run 2', 'Verify packaged workspace success run 2',
    'Verify packaged workspace fault recovery run 2']) assert.ok(full.includes(`caller / ${name}`));
});

test('legacy coverage requires every responsibility group and selected repetition before its producer', () => {
  for (const event of ['pull_request', 'push']) {
    const plan = planFor([critical], event);
    const expected = Array.from({ length: plan.repetitions }, (_, index) =>
      ['core', 'commands', 'legacy-entry', 'workspace-success-entry', 'workspace-fault-entry']
        .map((group) => `caller / V2.5 ${group} contracts run ${index + 1}`)).flat();
    const original = evidence(plan);
    assert.deepEqual(original.jobs.filter((job) => /V2\.5 .* contracts run/.test(job.name))
      .map((job) => job.name).sort(), expected.sort());
    for (const name of expected) {
      for (const outcome of ['missing', 'cancelled', 'skipped', 'failure']) {
        const { needs, jobs } = structuredClone(original);
        const index = jobs.findIndex((job) => job.name === name);
        if (outcome === 'missing') jobs.splice(index, 1);
        else jobs[index].conclusion = outcome;
        assert.equal(evaluateCiRun(plan, needs, jobs).resultCode, 'CI_REQUIRED_JOB_INCOMPLETE');
      }
      const group = name.match(/V2\.5 (.+) contracts run/)[1];
      for (const stepName of ['Prepare locked package manager', 'Build existing supervisor once', `Run legacy ${group} contracts`]) {
        const { needs, jobs } = structuredClone(original);
        const job = jobs.find((value) => value.name === name);
        job.steps = job.steps.filter((step) => step.name !== stepName);
        assert.equal(evaluateCiRun(plan, needs, jobs).resultCode, 'CI_REQUIRED_STEP_INCOMPLETE');
      }
    }
  }
});

test('deleted and moved critical paths flow from Git diff into required consumers', () => {
  const environment = { GITHUB_EVENT_NAME: 'pull_request', GITHUB_REF: 'refs/pull/1/merge',
    CI_BASE_SHA: 'a'.repeat(40), CI_HEAD_SHA: 'b'.repeat(40) };
  for (const paths of [[critical], [critical, fast]]) {
    const plan = classifyCiChanges(environment, { git: () => ({ status: 0,
      stdout: Buffer.from(`${paths.join('\0')}\0`) }) });
    const { needs, jobs } = evidence(plan);
    assert.ok(plan.gates.legacyUpgrade && plan.gates.workspaceFault);
    assert.equal(evaluateCiRun(plan, needs, jobs).status, 'completed');
    needs.legacy.result = 'skipped';
    assert.equal(evaluateCiRun(plan, needs, jobs).status, 'failed');
  }
  const full = classifyCiChanges(environment, { git: () => ({ status: 1 }) });
  assert.equal(full.repetitions, 2);
  const { needs, jobs } = evidence(full);
  needs.classification.result = 'failure';
  assert.equal(evaluateCiRun(full, needs, jobs).resultCode, 'classificationNotSuccessful');
});

test('optional legacy capture cannot replace either consumer or its mandatory results', () => {
  const plan = planFor([critical], 'push');
  for (const captureOutcome of ['success', 'failure', 'cancelled', 'skipped']) {
    const { needs, jobs } = evidence(plan);
    const consumer = jobs.find((job) => job.name.endsWith('legacy phase run 1'));
    const observation = summarizeLegacyCapture({ enabled: true, testOutcome: 'success',
      artifactOutcome: 'success', startOutcome: captureOutcome, stopOutcome: captureOutcome,
      analysisOutcome: captureOutcome });
    consumer.steps.push({ name: 'Optional inspector capture', status: 'completed',
      conclusion: 'success', outcome: captureOutcome });
    assert.equal(observation.testOutcome, 'success');
    assert.equal(evaluateCiRun(plan, needs, jobs).status, 'completed');
    jobs.splice(jobs.findIndex((job) => job.name.endsWith('legacy phase run 2')), 1);
    assert.equal(evaluateCiRun(plan, needs, jobs).resultCode, 'CI_REQUIRED_JOB_INCOMPLETE');
  }

  for (const stepName of ['Run existing supervised legacy lifecycle once',
    'Reverify phase artifact bytes after lifecycle']) {
    for (const outcome of ['failure', 'cancelled', 'skipped', 'missing']) {
      const { needs, jobs } = evidence(plan);
      const consumer = jobs.find((job) => job.name.endsWith('legacy phase run 1'));
      consumer.steps.push({ name: 'Optional inspector capture', status: 'completed', conclusion: 'success' });
      const index = consumer.steps.findIndex((step) => step.name === stepName);
      assert.ok(index >= 0);
      if (outcome === 'missing') consumer.steps.splice(index, 1);
      else consumer.steps[index].conclusion = outcome;
      assert.equal(evaluateCiRun(plan, needs, jobs).resultCode, 'CI_REQUIRED_STEP_INCOMPLETE');
    }
  }
});

test('every selected job is mandatory even when reusable workflow result claims success', () => {
  const plan = planFor([critical], 'push');
  const original = evidence(plan);
  for (let index = 0; index < original.jobs.length; index++) {
    for (const conclusion of ['missing', 'failure', 'cancelled', 'skipped', 'timed_out']) {
      const { needs, jobs } = structuredClone(original);
      if (conclusion === 'missing') jobs.splice(index, 1);
      else jobs[index].conclusion = conclusion;
      assert.equal(evaluateCiRun(plan, needs, jobs).status, 'failed', `${index}:${conclusion}`);
    }
  }
});

test('clean producer requires bundle verification and exact artifact delivery even when its job claims success', () => {
  const plan = planFor([critical], 'push');
  const original = evidence(plan);
  const producerName = 'caller / Build Windows acceptance artifact once';
  const requiredSteps = ['Build acceptance artifact once', 'Verify produced artifact bytes',
    'Upload exact acceptance artifact'];
  assert.deepEqual(original.jobs.find((job) => job.name === producerName).steps.map((step) => step.name),
    requiredSteps);
  assert.equal(evaluateCiRun(plan, original.needs, original.jobs).status, 'completed');
  for (const stepName of requiredSteps) {
    for (const outcome of ['missing', 'failure', 'cancelled', 'skipped']) {
      const { needs, jobs } = structuredClone(original);
      const producer = jobs.find((job) => job.name === producerName);
      const index = producer.steps.findIndex((step) => step.name === stepName);
      if (outcome === 'missing') producer.steps.splice(index, 1);
      else producer.steps[index].conclusion = outcome;
      assert.equal(evaluateCiRun(plan, needs, jobs).resultCode, 'CI_REQUIRED_STEP_INCOMPLETE',
        `${stepName}:${outcome}`);
    }
  }
});

test('preparation, all five fault results and artifact revalidation are mandatory within each consumer', () => {
  const plan = planFor([critical], 'push');
  const original = evidence(plan);
  const index = original.jobs.findIndex((job) => job.name.endsWith('fault recovery run 2'));
  assert.equal(original.jobs[index].steps.length, 7);
  for (let step = 0; step < 7; step++) {
    for (const conclusion of ['missing', 'failure', 'cancelled', 'skipped']) {
      const { needs, jobs } = structuredClone(original);
      if (conclusion === 'missing') jobs[index].steps.splice(step, 1);
      else jobs[index].steps[step].conclusion = conclusion;
      assert.equal(evaluateCiRun(plan, needs, jobs).resultCode, 'CI_REQUIRED_STEP_INCOMPLETE');
    }
  }
});

test('success consumers cannot pass with missing or unsuccessful reader preparation', () => {
  const plan = planFor([critical], 'push');
  for (const repetition of [1, 2]) {
    for (const conclusion of ['missing', 'failure', 'cancelled', 'skipped']) {
      const { needs, jobs } = evidence(plan);
      const job = jobs.find((value) => value.name.endsWith(`workspace success run ${repetition}`));
      const step = job.steps.findIndex((value) => value.name === 'Prepare existing supervisor and proof readers once');
      assert.ok(step >= 0);
      if (conclusion === 'missing') job.steps.splice(step, 1);
      else job.steps[step].conclusion = conclusion;
      assert.equal(evaluateCiRun(plan, needs, jobs).resultCode, 'CI_REQUIRED_STEP_INCOMPLETE');
    }
  }
});

test('workflow failures, malformed plans and duplicate or extra matrix members fail closed', () => {
  const plan = planFor([critical]);
  const original = evidence(plan);
  for (const key of CI_WORKFLOWS) {
    for (const result of ['failure', 'cancelled', 'skipped']) {
      const { needs, jobs } = structuredClone(original);
      needs[key].result = result;
      assert.equal(evaluateCiRun(plan, needs, jobs).status, 'failed');
    }
  }
  const { needs, jobs } = structuredClone(original);
  jobs.push({ ...jobs[0], id: 100 });
  assert.equal(evaluateCiRun(plan, needs, jobs).status, 'failed');
  jobs.at(-1).name = 'caller / Verify clean lifecycle run 2';
  assert.equal(evaluateCiRun(plan, needs, jobs).resultCode, 'CI_UNEXPECTED_MATRIX_MEMBER');
  assert.equal(evaluateCiRun({ ...plan, repetitions: 0 }, needs, jobs).resultCode, 'riskPlanInvalid');
  delete needs.core;
  assert.equal(evaluateCiRun(plan, needs, jobs).resultCode, 'workflowResultsInvalid');
});

test('workflow bindings preserve one producer and exact result checks with dynamic consumer counts', async () => {
  const directory = new URL('../workflows/', import.meta.url);
  const entry = await readFile(new URL('ci-cadence-contracts.yml', directory), 'utf8');
  assert.doesNotMatch(entry.split('permissions:')[0], /paths:|branches:.*codex/);
  assert.match(entry, /needs: \[classification, cadence_contracts, core, supervisor, clean, upgrade, legacy, workspace\]/);
  for (const [owner, gate, file] of [
    ['clean', 'cleanLifecycle', 'clean'], ['upgrade', 'upgradeRollback', 'upgrade'],
    ['legacy', 'legacyUpgrade', 'legacy-diagnostic'], ['workspace', 'workspaceSuccess', 'workspace'],
  ]) {
    const block = entry.split(`\n  ${owner}:`)[1].split('\n\n')[0];
    assert.ok(block.includes(`if: fromJSON(needs.classification.outputs.plan).gates.${gate}`));
    assert.ok(block.includes('risk_plan: ${{ needs.classification.outputs.plan }}'));
    const child = await readFile(new URL(`windows-acceptance-v2-${file}.yml`, directory), 'utf8');
    assert.match(child, /workflow_call:\s+inputs:\s+risk_plan:\s+type: string\s+required: true/);
    assert.doesNotMatch(child.split('permissions:')[0], /push:|pull_request:/);
    assert.ok(child.includes("fromJSON(inputs.risk_plan).repetitions == 1 && '[1]' || '[1, 2]'"));
    assert.match(child, /artifact-ids: \$\{\{ needs\.[a-z_]+\.outputs\.artifact_id \}\}/);
  }
  const core = await readFile(new URL('ci.yml', directory), 'utf8');
  const contracts = core.split('\n  windows-contracts:')[1].split('\n  installer-windows:')[0];
  assert.match(contracts, /persist-credentials: false\s+fetch-depth: 0/);
  assert.match(contracts, /Run deterministic installer tests/);
  for (const owner of ['installer-windows', 'installer-w6b-legacy-windows',
    'installer-w6b2-success-windows-run', 'installer-w6b2-success-windows',
    'installer-w6b2-fault-rollback-windows-run', 'installer-w6b2-fault-rollback-windows']) {
    assert.ok(core.split(`\n  ${owner}:`)[1].split('runs-on:')[0].includes("inputs.risk_plan == ''"));
  }
});
