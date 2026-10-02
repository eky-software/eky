import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { link, mkdir, mkdtemp, readFile, rm, symlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { gunzipSync } from 'node:zlib';
import { collectJobFailureEvidence, evidenceSourceKind, jobEvidenceBinding } from './ciFailureEvidence.mjs';
import { projectPlaywrightFailureReport } from './playwrightFailureReport.mjs';

const run = 'run-aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const fingerprint = 'A'.repeat(40);
const nativeId = 'a'.repeat(32);
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'eky-evidence-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const temp = join(root, 'temporary');
  const checkout = join(root, 'checkout');
  await mkdir(temp); await mkdir(checkout);
  const env = { RUNNER_TEMP: temp, GITHUB_WORKSPACE: checkout,
    GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '1', GITHUB_JOB: 'electron',
    EKY_EVIDENCE_JOB_KEY: 'core-electron-0', GITHUB_SHA: 'a'.repeat(40),
    EKY_EVIDENCE_JOB_OUTCOME: 'failure',
    EKY_DIAGNOSTIC_PUBLIC_KEY: '-----BEGIN PGP PUBLIC KEY BLOCK-----\nTEST\n-----END PGP PUBLIC KEY BLOCK-----',
    EKY_DIAGNOSTIC_KEY_FINGERPRINT: fingerprint, EKY_DIAGNOSTIC_VERIFIED_FINGERPRINT: fingerprint };
  const put = async (base, path, content) => {
    const destination = join(base, ...path.split('/'));
    await mkdir(join(destination, '..'), { recursive: true });
    await writeFile(destination, content);
    return destination;
  };
  return { root, temp, checkout, env, put };
}

test('source allowlist excludes databases, requests, config, environment, traces and profiles', () => {
  for (const path of ['eky supervisor abc/result.json', `eky supervisor abc/temporary/eky-acceptance-command-${nativeId}/prepare/result.json`,
    `eky-workspace-caller-${nativeId}/result.json`, `eky-acceptance-command-${nativeId}/prepare/worker-result.json`,
    `eky-t-abc/eky-acceptance-command-${nativeId}/prepare/result.json`,
    `eky supervisor abc/temporary/eky-legacy-caller-${nativeId}/result.json`]) {
    assert.equal(evidenceSourceKind('temporary', path), 'nativeResult');
  }
  for (const path of ['other/result.json', 'eky supervisor abc/request.json', 'eky supervisor abc/runtime-config.json',
    'eky supervisor abc/data.sqlite', 'eky supervisor abc/profiles/result.json',
    'eky supervisor abc/../result.json', 'eky-pnpm-abc/node_modules/result.json',
    'eky supervisor abc/business/result.json', `eky-acceptance-command-${nativeId}/profile/result.json`,
    'eky-workspace-caller-a1/result.json', `eky-t-abc/arbitrary/eky-workspace-caller-${nativeId}/result.json`]) {
    assert.equal(evidenceSourceKind('temporary', path), null);
  }
  assert.equal(evidenceSourceKind('reports', `${run}/results.private.json`), 'playwrightReport');
  assert.equal(evidenceSourceKind('results', `${run}/test-retry1/trace.zip`), null);
  assert.equal(evidenceSourceKind('results', `${run}/test-retry1/data.sqlite`), null);
});

test('binding rejects missing attempts, invalid job names and unknown revisions', () => {
  const env = { GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '1', GITHUB_JOB: 'job',
    EKY_EVIDENCE_JOB_KEY: 'job-0', GITHUB_SHA: 'a'.repeat(40) };
  assert.equal(jobEvidenceBinding(env).attempt, '1');
  for (const [field, value] of [['GITHUB_RUN_ATTEMPT', '0'], ['GITHUB_SHA', 'unknown'],
    ['EKY_EVIDENCE_JOB_KEY', '../job'], ['GITHUB_JOB', 'job\nunsafe']]) {
    assert.throws(() => jobEvidenceBinding({ ...env, [field]: value }), /CI_FAILURE_EVIDENCE_UNVERIFIED/u);
  }
});

test('first-failure bytes from different families and attempts survive collection without DB content', async t => {
  const { temp, checkout, env, put } = await fixture(t);
  await put(temp, `eky supervisor abc/temporary/eky-acceptance-command-${nativeId}/prepare/result.json`, '{"cleanupWin32ErrorCode":5}');
  await put(temp, 'eky supervisor abc/data.sqlite', 'DO-NOT-COLLECT-DATABASE');
  await put(temp, 'eky-pnpm-abc/bootstrap-failure.private.json', '{"stderr":"EXCLUDED-DEPENDENCY-TOOL"}');
  await put(checkout, `eky_software/apps/e2e/playwright-report/${run}/results.private.json`,
    JSON.stringify({ config: { webServer: { env: { PASSWORD: 'EXCLUDED-CONFIG' } } }, errors: [],
      suites: [{ specs: [{ tests: [{ results: [{ retry: 0, error: { message: 'first failure' } },
        { retry: 1, status: 'passed' }] }] }] }] }));
  const collected = await collectJobFailureEvidence(env);
  const decoded = JSON.parse(gunzipSync(await readFile(collected.archivePath)));
  assert.equal(decoded.manifest.jobOutcome, 'failure');
  assert.equal(decoded.manifest.cleanup, 'notInferred');
  assert.equal(decoded.manifest.unresolvedEvidenceHold, true);
  assert.equal(decoded.manifest.files.length, 2);
  for (const entry of decoded.manifest.files) {
    assert.equal(entry.status, 'retained');
    const bytes = Buffer.from(decoded.files[entry.name], 'base64');
    assert.equal(bytes.length, entry.bytes);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), entry.sha256);
    assert.equal(bytes.includes(Buffer.from('DO-NOT-COLLECT')), false);
    assert.equal(bytes.includes(Buffer.from('EXCLUDED-DEPENDENCY-TOOL')), false);
    assert.equal(bytes.includes(Buffer.from('EXCLUDED-CONFIG')), false);
  }
  const reportFile = decoded.manifest.files.find(file => file.kind === 'playwrightReport');
  const report = JSON.parse(Buffer.from(decoded.files[reportFile.name], 'base64'));
  assert.deepEqual(report.suites[0].specs[0].tests[0].results.map(result => result.retry), [0, 1]);
  assert.equal(report.suites[0].specs[0].tests[0].results[0].error.message, 'first failure');
  const again = await collectJobFailureEvidence({ ...env, GITHUB_RUN_ATTEMPT: '2' });
  assert.notEqual(collected.root, again.root);
  assert.equal(JSON.parse(gunzipSync(await readFile(collected.archivePath))).manifest.binding.attempt, '1');
});

test('report projection retains original failure fields but excludes configuration and inline attachments', () => {
  const error = { message: 'first failure', stack: 'synthetic stack', snippet: 'assert(false)' };
  const result = { retry: 0, error, errors: [error], stderr: [{ text: 'synthetic stderr' }],
    status: 'failed', steps: [{ title: 'nested', error }],
    attachments: [{ name: 'unreviewed', contentType: 'binary', path: '/synthetic/file', body: 'EXCLUDED-BODY' }] };
  const projected = projectPlaywrightFailureReport({ config: { env: { secret: 'EXCLUDED-CONFIG' } },
    metadata: 'EXCLUDED-METADATA', errors: [error],
    suites: [{ specs: [{ tests: [{ results: [result] }] }] }] });
  const saved = projected.suites[0].specs[0].tests[0].results[0];
  assert.deepEqual(saved.error, error);
  assert.deepEqual(saved.stderr, result.stderr);
  assert.deepEqual(saved.steps, result.steps);
  assert.equal(saved.attachments[0].body, undefined);
  assert.equal(JSON.stringify(projected).includes('EXCLUDED'), false);
  assert.throws(() => projectPlaywrightFailureReport({}), /REPORT_INVALID/u);
});

test('missing data is explicit, not a successful test or verified cleanup', async t => {
  const { env } = await fixture(t);
  const { manifest } = await collectJobFailureEvidence(env);
  assert.equal(manifest.files.length, 0);
  assert.equal(manifest.sources.find(source => source.area === 'reports').status, 'missing');
  assert.equal(manifest.cleanup, 'notInferred');
  assert.equal(manifest.publicCommandLog, 'githubWorkflowLog');
});

test('OS-native temporary roots are collected separately from runner staging', async t => {
  const { root, temp, env, put } = await fixture(t);
  const nativeTemp = join(root, 'native');
  await mkdir(nativeTemp);
  await put(temp, 'eky supervisor abc/result.json', '{"location":"runner"}');
  await put(nativeTemp, `eky-t-def/eky-workspace-caller-${nativeId}/result.json`, '{"location":"native"}');
  await put(nativeTemp, 'eky-t-def/profile/result.json', 'EXCLUDED-PROFILE');
  const { manifest } = await collectJobFailureEvidence(env, { nativeTemp });
  assert.equal(manifest.files.length, 2);
  assert.deepEqual(manifest.files.map(file => file.location).sort(), ['nativeTemp', 'runnerTemp']);
  assert.ok(manifest.files.every(file => file.status === 'retained'));
  assert.equal(manifest.sources.find(source => source.location === 'nativeTemp').status, 'complete');
});

test('older native results cannot evict reports or the latest failed native root', async t => {
  const { env, temp, checkout, put } = await fixture(t);
  for (let index = 0; index < 256; index++) {
    await put(temp, `eky supervisor old${index}/result.json`, '{"earlier":true}');
    await utimes(join(temp, `eky supervisor old${index}`), new Date(0), new Date(0));
  }
  await put(temp, 'eky supervisor latest/result.json', '{"firstFailure":"newest"}');
  await put(checkout, `eky_software/apps/e2e/playwright-report/${run}/results.private.json`, '{"suites":[],"errors":[]}');
  await put(checkout, `eky_software/apps/e2e/test-results/${run}/failed-attempt0/process-output.private.json`, '{"stderr":"first failure"}');
  const { manifest } = await collectJobFailureEvidence(env);
  assert.ok(manifest.files.some(file => file.kind === 'playwrightReport' && file.status === 'retained'));
  assert.ok(manifest.files.some(file => file.kind === 'processOutput' && file.status === 'retained'));
  assert.ok(manifest.files.some(file => file.source.endsWith('latest/result.json') && file.status === 'retained'));
  assert.equal(manifest.sources.find(source => source.area === 'temporary').status, 'limited');
  assert.ok(manifest.files.length <= 256);
});

test('unrelated temporary names do not consume the eligible evidence search budget', async t => {
  const { env, temp, put } = await fixture(t);
  for (let index = 0; index < 4100; index++) await writeFile(join(temp, `unrelated-${index}`), 'excluded');
  await put(temp, 'eky supervisor latest/result.json', '{"firstFailure":true}');
  const { manifest } = await collectJobFailureEvidence(env);
  assert.equal(manifest.files.length, 1);
  assert.equal(manifest.files[0].status, 'retained');
  assert.ok(manifest.sources.find(source => source.area === 'temporary').examinedEntries < 10);
});

test('oversized and hardlinked evidence is rejected without copying unrelated files', async t => {
  const { env, temp, put } = await fixture(t);
  const large = await put(temp, 'eky supervisor abc/result.json', Buffer.alloc(8 * 1024 * 1024 + 1));
  await link(large, join(temp, 'eky supervisor abc/worker-result.json'));
  const { manifest } = await collectJobFailureEvidence(env);
  assert.equal(manifest.files.length, 2);
  assert.ok(manifest.files.every(entry => entry.status === 'unverified'));
  await put(temp, 'eky supervisor def/result.json', Buffer.alloc(8 * 1024 * 1024 + 1));
  const another = await collectJobFailureEvidence(env);
  assert.ok(another.manifest.files.some(entry => entry.status === 'tooLarge'));
});

test('symlink source cannot import a file outside its declared root', async t => {
  const { root, temp, env, put } = await fixture(t);
  const outside = await put(root, 'outside.json', 'PRIVATE-OUTSIDE');
  await mkdir(join(temp, 'eky supervisor abc'));
  try { await symlink(outside, join(temp, 'eky supervisor abc/result.json')); }
  catch (error) { if (error.code === 'EPERM') { t.skip('Symlink creation not available'); return; } throw error; }
  const collected = await collectJobFailureEvidence(env);
  assert.equal(collected.manifest.files[0].status, 'unverified');
  const decoded = gunzipSync(await readFile(collected.archivePath)).toString();
  assert.equal(decoded.includes(Buffer.from('PRIVATE-OUTSIDE').toString('base64')), false);
});

test('a redirected native directory is not traversed or reported as complete', async t => {
  const { root, temp, env, put } = await fixture(t);
  await put(root, 'outside/result.json', 'EXCLUDED-JUNCTION');
  await symlink(join(root, 'outside'), join(temp, 'eky supervisor alias'), process.platform === 'win32' ? 'junction' : 'dir');
  const { manifest } = await collectJobFailureEvidence(env);
  assert.equal(manifest.files.length, 0);
  assert.equal(manifest.sources.find(source => source.area === 'temporary').status, 'partial');
});

test('an unconfirmed encryption recipient prevents even plaintext staging', async t => {
  const { env } = await fixture(t);
  await assert.rejects(collectJobFailureEvidence({ ...env, EKY_DIAGNOSTIC_VERIFIED_FINGERPRINT: '' }),
    /WORKSPACE_ENCRYPTED_EVIDENCE_UNVERIFIED/u);
});

test('hosted proof entrypoint produces a real first failure, not only a fabricated result', async t => {
  const { env, temp, root } = await fixture(t);
  const output = join(root, 'github-output');
  await writeFile(output, '');
  const child = spawnSync(process.execPath, [resolve(import.meta.dirname, '../../../../../.github/scripts/ciFailureEvidenceProbe.mjs')], {
    env: { ...process.env, ...env, GITHUB_ACTIONS: 'true', RUNNER_ENVIRONMENT: 'github-hosted',
      GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_OUTPUT: output, TMP: temp, TEMP: temp, TMPDIR: temp },
    encoding: 'utf8', timeout: 10000, maxBuffer: 4096, windowsHide: true,
  });
  assert.equal(child.error, undefined);
  assert.equal(child.signal, null);
  assert.equal(child.status, 19);
  assert.equal(child.stdout.trim(), 'CI_FAILURE_EVIDENCE_PROBE_EXPECTED_FAILURE');
  assert.equal(child.stderr, '');
  assert.equal(await readFile(output, 'utf8'), 'probe_verified=true\n');
  const collected = await collectJobFailureEvidence(env);
  const archive = JSON.parse(gunzipSync(await readFile(collected.archivePath)));
  assert.equal(archive.manifest.files.length, 2);
  const entry = archive.manifest.files.find(file => file.source.endsWith('/ci-step.stderr.private'));
  assert.equal(Buffer.from(archive.files[entry.name], 'base64').toString(), 'SYNTHETIC_FIRST_FAILURE_PRIVATE\n');
});

test('job CLI rejects untrusted context before publishing or staging evidence', { skip: process.platform !== 'win32' }, async t => {
  const { env, temp, root } = await fixture(t);
  const workspace = resolve(import.meta.dirname, '../../../../..');
  const head = spawnSync('git.exe', ['rev-parse', 'HEAD'], { cwd: workspace, encoding: 'utf8', timeout: 10000 });
  assert.equal(head.status, 0);
  const revision = head.stdout.trim();
  const eventPath = join(root, 'event.json');
  const outputPath = join(root, 'output.txt');
  for (const [event, patch] of [
    ['{}', { RUNNER_ENVIRONMENT: 'self-hosted' }],
    [JSON.stringify({ pull_request: { head: { repo: { full_name: 'untrusted/fork' } } } }), {}],
    ['{malformed', {}],
    [' '.repeat(2 * 1024 * 1024 + 1), {}],
    ['{}', { GITHUB_SHA: revision[0] === 'a' ? 'b'.repeat(40) : 'a'.repeat(40) }],
    ['{}', { EKY_DIAGNOSTIC_VERIFIED_FINGERPRINT: '' }],
  ]) {
    await writeFile(eventPath, event); await writeFile(outputPath, 'existing=value\n');
    const child = spawnSync(process.execPath, [resolve(import.meta.dirname, 'ciFailureEvidence.mjs')], {
      env: { ...process.env, ...env, GITHUB_ACTIONS: 'true', RUNNER_OS: 'Windows', RUNNER_ENVIRONMENT: 'github-hosted',
        GITHUB_EVENT_NAME: 'pull_request', GITHUB_REPOSITORY: 'synthetic/repo', GITHUB_SHA: revision,
        GITHUB_WORKSPACE: workspace, GITHUB_OUTPUT: outputPath, GITHUB_EVENT_PATH: eventPath, ...patch },
      encoding: 'utf8', timeout: 15000, maxBuffer: 4096, windowsHide: true,
    });
    assert.equal(child.error, undefined);
    assert.equal(child.status, 1);
    assert.equal(child.stdout, '');
    assert.equal(child.stderr.trim(), 'CI_FAILURE_EVIDENCE_UNVERIFIED');
    assert.equal(await readFile(outputPath, 'utf8'), 'existing=value\n');
  }
  const { readdir } = await import('node:fs/promises');
  assert.deepEqual(await readdir(temp), []);
});
