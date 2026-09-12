import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { readCiRunJobs, verifyCiRun } from './verifyCiRun.mjs';
import { classifyCiRisk } from './ciRiskPolicy.mjs';

const environment = { GITHUB_REPOSITORY: 'synthetic/repository', GITHUB_RUN_ID: '123',
  GITHUB_RUN_ATTEMPT: '2', GH_TOKEN: 'synthetic-not-a-secret' };
const job = (id) => ({ id, run_id: 123 });

test('complete light-run workflow and API evidence returns success, missing security result does not', async () => {
  const plan = classifyCiRisk({ eventName: 'pull_request', ref: 'refs/pull/1/merge',
    changedPaths: ['eky_software/docs/product/glossary.md'], comparisonComplete: true });
  const needs = Object.fromEntries(['classification', 'cadence_contracts', 'core', 'supervisor',
    'clean', 'upgrade', 'legacy', 'workspace'].map((name) => [name, {
      result: ['classification', 'cadence_contracts', 'core'].includes(name) ? 'success' : 'skipped',
      outputs: name === 'classification' ? { plan: JSON.stringify(plan) } : {},
    }]));
  const jobs = [
    ['V2 cadence contracts (ubuntu-latest)', ['Verify risk and result contracts']],
    ['V2 cadence contracts (windows-latest)', ['Verify risk and result contracts']],
    ['core / Test, typecheck and build', ['Run tests', 'Run typecheck', 'Build backend', 'Build web', 'Build desktop']],
    ['core / System security E2E', ['Run isolated system security E2E tests']],
    ['core / Web critical E2E', ['Run critical web E2E journeys']],
  ].map(([name, steps], index) => ({ ...job(index + 1), name, status: 'completed', conclusion: 'success',
    steps: steps.map((name) => ({ name, status: 'completed', conclusion: 'success' })) }));
  const env = { ...environment, CI_NEEDS: JSON.stringify(needs) };
  const fetchPage = async () => Response.json({ total_count: jobs.length, jobs });
  assert.equal((await verifyCiRun(env, fetchPage)).status, 'completed');
  jobs.pop();
  assert.equal((await verifyCiRun(env, fetchPage)).resultCode, 'CI_REQUIRED_JOB_INCOMPLETE');
  needs.classification.result = 'cancelled';
  assert.equal((await verifyCiRun({ ...env, CI_NEEDS: JSON.stringify(needs) }, () => assert.fail())).resultCode,
    'classificationNotSuccessful');
});

test('read-only query binds repository, run and attempt and consumes every page under one deadline', async () => {
  const requests = [];
  const jobs = await readCiRunJobs(environment, async (url, options) => {
    requests.push({ url, options });
    return Response.json({ total_count: 101, jobs: requests.length === 1
      ? Array.from({ length: 100 }, (_, index) => job(index + 1)) : [job(101)] });
  });
  assert.equal(jobs.length, 101);
  assert.equal(requests.length, 2);
  requests.forEach(({ url, options }, index) => {
    assert.equal(url, `https://api.github.com/repos/synthetic/repository/actions/runs/123/attempts/2/jobs?per_page=100&page=${index + 1}`);
    assert.equal(options.method, 'GET');
    assert.equal(options.redirect, 'error');
    assert.equal(options.signal, requests[0].options.signal);
    assert.equal(options.headers.Authorization, `Bearer ${environment.GH_TOKEN}`);
  });
});

test('incomplete, cross-run, oversized and failed job queries cannot become successful evidence', async () => {
  for (const data of [
    { total_count: 2, jobs: [job(1)] }, { total_count: 1, jobs: [{ ...job(1), run_id: 456 }] },
    { total_count: 0, jobs: [] }, { total_count: 1001, jobs: [job(1)] },
  ]) await assert.rejects(readCiRunJobs(environment, async () => Response.json(data)), /CI_JOB_QUERY_INCOMPLETE/);
  await assert.rejects(readCiRunJobs(environment, async () => new Response('', { status: 403 })), /CI_JOB_QUERY_FAILED/);
  await assert.rejects(readCiRunJobs(environment, async () => new Response('x'.repeat(2 * 1024 * 1024 + 1))), /CI_JOB_QUERY_TOO_LARGE/);
  await assert.rejects(readCiRunJobs({ ...environment, GITHUB_REPOSITORY: 'https://foreign/' }, () => assert.fail()), /CI_JOB_QUERY_INPUT_INVALID/);
});

test('classification failure short circuits the API without exposing raw data', async () => {
  const result = await verifyCiRun({ ...environment, CI_NEEDS: '{raw-invalid-synthetic-input' }, () => assert.fail());
  assert.deepEqual(result, { schemaVersion: 1, status: 'failed', resultCode: 'ciEvidenceUnavailable' });
});

test('CLI failure returns one closed terminal result and a failed exit without raw environment', () => {
  const cli = fileURLToPath(new URL('./verifyCiRun.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [cli], { timeout: 10_000, encoding: 'utf8',
    env: { ...process.env, ...environment, CI_NEEDS: 'invalid synthetic private diagnostic' } });
  assert.equal(result.status, 1);
  assert.equal(result.stderr, '');
  assert.equal(result.stdout, `${JSON.stringify({ schemaVersion: 1, status: 'failed', resultCode: 'ciEvidenceUnavailable' })}\n`);
});
