import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { classifyCiChanges } from './classifyCiChanges.mjs';
import { classifyCiRisk } from './ciRiskPolicy.mjs';
import { requiredCiJobs } from './ciJobCoverage.mjs';
import { CI_WORKFLOWS, evaluateCiRun } from './ciRunAcceptance.mjs';

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
    [[fast], 'pull_request', 5], [[critical], 'pull_request', 20],
    [[fast, critical], 'pull_request', 20], [[fast], 'push', 26],
    [[fast], 'schedule', 26], [[fast], 'workflow_dispatch', 26],
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
