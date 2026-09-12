import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { evaluateCiRun } from './ciRunAcceptance.mjs';

const MAX_BYTES = 2 * 1024 * 1024;

async function readPage(response) {
  if (!response.ok || !response.body) throw new Error('CI_JOB_QUERY_FAILED');
  const chunks = [];
  let bytes = 0;
  const reader = response.body.getReader();
  try {
    while (true) {
      const item = await reader.read();
      if (item.done) break;
      bytes += item.value.byteLength;
      if (bytes > MAX_BYTES) throw new Error('CI_JOB_QUERY_TOO_LARGE');
      chunks.push(Buffer.from(item.value));
    }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
}

export async function readCiRunJobs(environment, fetchPage = fetch) {
  const { GITHUB_REPOSITORY: repository, GITHUB_RUN_ID: run, GITHUB_RUN_ATTEMPT: attempt, GH_TOKEN: token } = environment;
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository ?? '') ||
    !/^[1-9][0-9]{0,15}$/.test(run ?? '') || !/^[1-9][0-9]{0,5}$/.test(attempt ?? '') ||
    typeof token !== 'string' || token.length === 0) throw new Error('CI_JOB_QUERY_INPUT_INVALID');
  const jobs = [];
  const signal = AbortSignal.timeout(30_000);
  let total;
  for (let page = 1; page <= 10; page++) {
    const data = await readPage(await fetchPage(`https://api.github.com/repos/${repository}/actions/runs/${run}/attempts/${attempt}/jobs?per_page=100&page=${page}`, {
      method: 'GET', redirect: 'error', signal,
      headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28' },
    }));
    if (!Number.isSafeInteger(data.total_count) || data.total_count < 1 || data.total_count > 1000 ||
      (total !== undefined && total !== data.total_count) || !Array.isArray(data.jobs) ||
      data.jobs.length === 0 || data.jobs.length > 100 || data.jobs.some((job) => String(job.run_id) !== run)) {
      throw new Error('CI_JOB_QUERY_INCOMPLETE');
    }
    total = data.total_count;
    jobs.push(...data.jobs);
    if (jobs.length === total) return jobs;
    if (jobs.length > total || data.jobs.length < 100) throw new Error('CI_JOB_QUERY_INCOMPLETE');
  }
  throw new Error('CI_JOB_QUERY_INCOMPLETE');
}

export async function verifyCiRun(environment, fetchPage = fetch) {
  try {
    const needs = JSON.parse(environment.CI_NEEDS);
    const plan = JSON.parse(needs.classification?.outputs?.plan ?? 'null');
    const preflight = evaluateCiRun(plan, needs, []);
    if (!['CI_JOB_EVIDENCE_INVALID', 'CI_REQUIRED_JOB_INCOMPLETE'].includes(preflight.resultCode)) return preflight;
    return evaluateCiRun(plan, needs, await readCiRunJobs(environment, fetchPage));
  } catch { return { schemaVersion: 1, status: 'failed', resultCode: 'ciEvidenceUnavailable' }; }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const result = process.argv.length === 2 ? await verifyCiRun(process.env)
    : { schemaVersion: 1, status: 'failed', resultCode: 'ciArgumentsInvalid' };
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exitCode = result.status === 'completed' ? 0 : 1;
}
