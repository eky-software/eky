import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { link, mkdir, mkdtemp, readFile, rm, symlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { gunzipSync } from 'node:zlib';
import { collectJobFailureEvidence, evidenceSourceKind, jobEvidenceBinding, jobEvidenceGit } from './ciFailureEvidence.mjs';
import { projectPlaywrightFailureReport } from './playwrightFailureReport.mjs';

const run = 'run-aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const fingerprint = 'A'.repeat(40);
const nativeId = 'a'.repeat(32);

test('only matching hosted Windows or Linux contexts select their native Git', () => {
  for (const [platform, runner, git] of [['win32', 'Windows', 'git.exe'], ['linux', 'Linux', 'git']]) {
    const env = { RUNNER_OS: runner, RUNNER_ENVIRONMENT: 'github-hosted', GITHUB_ACTIONS: 'true',
      GITHUB_EVENT_NAME: 'workflow_dispatch' };
    assert.equal(jobEvidenceGit(env, platform), git);
    for (const patch of [{ RUNNER_OS: 'macOS' }, { RUNNER_OS: runner === 'Linux' ? 'Windows' : 'Linux' },
      { RUNNER_ENVIRONMENT: 'self-hosted' }, { GITHUB_ACTIONS: 'false' },
      { GITHUB_EVENT_NAME: 'pull_request_target' }, { GITHUB_EVENT_NAME: '' }]) {
      assert.throws(() => jobEvidenceGit({ ...env, ...patch }, platform), /CI_FAILURE_EVIDENCE_UNVERIFIED/u);
    }
    assert.throws(() => jobEvidenceGit(env, 'darwin'), /CI_FAILURE_EVIDENCE_UNVERIFIED/u);
  }
});
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

test('Electron lifecycle collection admits only the named attempt file', () => {
  assert.equal(evidenceSourceKind('results', `${run}/test-attempt0/electron-lifecycle.json`), 'electronLifecycle');
  for (const area of ['reports', 'temporary']) {
    assert.equal(evidenceSourceKind(area, `${run}/test-attempt0/electron-lifecycle.json`), null);
  }
  for (const path of [`${run}/electron-lifecycle.json`, 'other/test/electron-lifecycle.json',
    `${run}/test/electron-lifecycle.private.json`, `${run}/test/electron-lifecycle.json.bak`,
    `${run}/test/attachments/electron-lifecycle.json`, `${run}/../electron-lifecycle.json`,
    `${run}/./electron-lifecycle.json`, `${run}/test/config.json`, `${run}/test/trace.zip`]) {
    assert.equal(evidenceSourceKind('results', path), null);
  }
});

test('Electron lifecycle collection preserves first failure, retry and ownership as separate evidence', async t => {
  const { checkout, env, put } = await fixture(t);
  const root = `eky_software/apps/e2e/test-results/${run}`;
  const common = { schemaVersion: 1, observationsTruncated: false,
    startupCapture: { status: 'notRequested' },
    ownership: { owner: { status: 'processTreeAbsent', firstFailure: null },
      bridge: 'closed', observerFailure: null, launchFailure: false, goSent: true, bridgeExit: 'matched' } };
  const first = { ...common, attempt: 0, launch: [{ generation: 2, phase: 'connected' }],
    publicCloseFailure: { startupGeneration: 2, reason: 'timedOut' },
    cleanup: { api: 'completed', runtime: 'unverified', port: 'released', runRoot: 'retained' } };
  const retry = { ...common, attempt: 1, launch: [{ generation: 1, phase: 'connected' }],
    cleanup: { api: 'completed', runtime: 'completed', port: 'released', runRoot: 'removed' } };
  const expected = new Map();
  for (const [directory, content] of [['test-attempt0', first], ['test-retry1', retry]]) {
    const source = `results/${run}/${directory}/electron-lifecycle.json`;
    const bytes = Buffer.from(JSON.stringify(content, null, 2) + '\n');
    expected.set(source, bytes);
    await put(checkout, `${root}/${directory}/electron-lifecycle.json`, bytes);
  }
  for (const file of ['test-attempt0/data.sqlite', 'test-attempt0/config.json',
    'test-attempt0/attachments/electron-lifecycle.json', 'profiles/electron-lifecycle.json']) {
    await put(checkout, `${root}/${file}`, 'EXCLUDED');
  }
  const collected = await collectJobFailureEvidence(env);
  const archive = JSON.parse(gunzipSync(await readFile(collected.archivePath)));
  assert.equal(archive.manifest.files.length, 2);
  assert.equal(archive.manifest.cleanup, 'notInferred');
  assert.equal(archive.manifest.unresolvedEvidenceHold, true);
  for (const entry of archive.manifest.files) {
    assert.equal(entry.kind, 'electronLifecycle');
    assert.equal(entry.status, 'retained');
    const bytes = Buffer.from(archive.files[entry.name], 'base64');
    assert.deepEqual(bytes, expected.get(entry.source));
    assert.equal(entry.bytes, bytes.length);
    assert.equal(entry.sha256, createHash('sha256').update(bytes).digest('hex'));
    expected.delete(entry.source);
  }
  assert.equal(expected.size, 0);
});

test('Electron lifecycle collection retains existing size and hardlink rejection', async t => {
  const { checkout, env, put } = await fixture(t);
  const root = `eky_software/apps/e2e/test-results/${run}`;
  await put(checkout, `${root}/large/electron-lifecycle.json`, Buffer.alloc(8 * 1024 * 1024 + 1));
  const original = await put(checkout, `${root}/linked/electron-lifecycle.json`, 'EXCLUDED-LINK');
  await link(original, join(checkout, 'alias.json'));
  const collected = await collectJobFailureEvidence(env);
  const archive = JSON.parse(gunzipSync(await readFile(collected.archivePath)));
  assert.equal(archive.manifest.files.length, 2);
  assert.equal(archive.manifest.files.find(file => file.source.includes('/large/')).status, 'tooLarge');
  assert.equal(archive.manifest.files.find(file => file.source.includes('/linked/')).status, 'unverified');
  assert.deepEqual(archive.files, {});
});

test('Electron lifecycle collection never follows an attempt directory outside the checkout', async t => {
  const { root, checkout, env, put } = await fixture(t);
  await put(root, 'outside/electron-lifecycle.json', 'EXCLUDED-OUTSIDE');
  const results = join(checkout, 'eky_software/apps/e2e/test-results', run);
  await mkdir(results, { recursive: true });
  await symlink(join(root, 'outside'), join(results, 'test-attempt0'), process.platform === 'win32' ? 'junction' : 'dir');
  const collected = await collectJobFailureEvidence(env);
  const archive = JSON.parse(gunzipSync(await readFile(collected.archivePath)));
  assert.equal(archive.manifest.files.length, 0);
  assert.equal(archive.manifest.sources.find(source => source.area === 'results').status, 'partial');
  assert.deepEqual(archive.files, {});
});

test('MSI policy evidence admits only its named files in the supervisor-owned root', () => {
  for (const name of ['policy-result.json', '1-source.log', '12-target.log', '23-uninstall.log']) {
    assert.equal(evidenceSourceKind('temporary', `eky supervisor abc/${name}`), 'msiPolicyEvidence');
    assert.equal(evidenceSourceKind('results', `eky supervisor abc/${name}`), null);
    assert.equal(evidenceSourceKind('temporary', `other/${name}`), null);
    assert.equal(evidenceSourceKind('temporary', `eky supervisor abc/profiles/${name}`), null);
  }
  for (const name of ['source.log', '0-source.log', '01-source.log', '1-source.log.bak',
    '1-files.json', '1-product.json', '1-arbitrary.log', 'descriptor.json', 'request.json',
    'policy-result.json.tmp', 'fixture/policy-result.json', '../1-source.log']) {
    assert.equal(evidenceSourceKind('temporary', `eky supervisor abc/${name}`), null);
  }
});

test('MSI failure evidence preserves log bytes and separate cleanup even without a worker result', async t => {
  const { temp, env, put } = await fixture(t);
  const source = Buffer.from('\uFEFFMSI synthetic source failure\r\n', 'utf16le');
  await put(temp, 'eky supervisor failed/1-source.log', source);
  await put(temp, 'eky supervisor failed/2-uninstall.log', 'synthetic cleanup completed');
  await put(temp, 'eky supervisor failed/policy-result.json', '{"result":{"status":"failed","cleanupStatus":"completed"}}');
  // A killed worker may leave only its in-progress log, not a terminal result.
  await put(temp, 'eky supervisor interrupted/1-source.log', 'partial synthetic log');
  await put(temp, 'eky supervisor failed/fixture/descriptor.json', 'EXCLUDED-DESCRIPTOR');
  await put(temp, 'eky supervisor failed/request.json', 'EXCLUDED-REQUEST');
  const collected = await collectJobFailureEvidence(env);
  const archive = JSON.parse(gunzipSync(await readFile(collected.archivePath)));
  assert.equal(archive.manifest.files.length, 4);
  assert.equal(archive.manifest.cleanup, 'notInferred');
  for (const entry of archive.manifest.files) {
    assert.equal(entry.status, 'retained');
    assert.equal(entry.kind, 'msiPolicyEvidence');
    const bytes = Buffer.from(archive.files[entry.name], 'base64');
    assert.equal(createHash('sha256').update(bytes).digest('hex'), entry.sha256);
    assert.equal(bytes.includes(Buffer.from('EXCLUDED')), false);
  }
  const entry = archive.manifest.files.find(file => file.source.endsWith('failed/1-source.log'));
  assert.deepEqual(Buffer.from(archive.files[entry.name], 'base64'), source);
  assert.ok(archive.manifest.files.some(file => file.source.endsWith('interrupted/1-source.log')));
});

test('MSI logs retain the existing size and hardlink rejection instead of expanding collection', async t => {
  const { temp, env, put } = await fixture(t);
  await put(temp, 'eky supervisor sample/1-source.log', Buffer.alloc(8 * 1024 * 1024 + 1));
  const linked = await put(temp, 'eky supervisor sample/2-target.log', 'not safe to copy');
  await link(linked, join(temp, 'eky supervisor sample/3-uninstall.log'));
  const { manifest } = await collectJobFailureEvidence(env);
  assert.equal(manifest.files.length, 3);
  assert.equal(manifest.files.find(file => file.source.endsWith('1-source.log')).status, 'tooLarge');
  assert.ok(manifest.files.filter(file => !file.source.endsWith('1-source.log'))
    .every(file => file.status === 'unverified'));
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

test('job CLI rejects untrusted context before publishing or staging evidence', { skip: !['win32', 'linux'].includes(process.platform) }, async t => {
  const { env, temp, root } = await fixture(t);
  const workspace = resolve(import.meta.dirname, '../../../../..');
  const head = spawnSync(process.platform === 'win32' ? 'git.exe' : 'git', ['rev-parse', 'HEAD'], { cwd: workspace, encoding: 'utf8', timeout: 10000 });
  assert.equal(head.status, 0);
  const revision = head.stdout.trim();
  const eventPath = join(root, 'event.json');
  const outputPath = join(root, 'output.txt');
  const event = JSON.stringify({ pull_request: { head: { repo: { full_name: 'synthetic/repo' } } } });
  for (const [payload, patch] of [
    [event, { RUNNER_ENVIRONMENT: 'self-hosted' }],
    [event, { RUNNER_OS: process.platform === 'win32' ? 'Linux' : 'Windows' }],
    [event, { GITHUB_EVENT_NAME: 'pull_request_target' }],
    ['{}', {}],
    [JSON.stringify({ pull_request: { head: { repo: { full_name: 'untrusted/fork' } } } }), {}],
    ['{malformed', {}],
    [' '.repeat(2 * 1024 * 1024 + 1), {}],
    [event, { GITHUB_SHA: revision[0] === 'a' ? 'b'.repeat(40) : 'a'.repeat(40) }],
    [event, { EKY_DIAGNOSTIC_VERIFIED_FINGERPRINT: '' }],
  ]) {
    await writeFile(eventPath, payload); await writeFile(outputPath, 'existing=value\n');
    const child = spawnSync(process.execPath, [resolve(import.meta.dirname, 'ciFailureEvidence.mjs')], {
      env: { ...process.env, ...env, GITHUB_ACTIONS: 'true', RUNNER_OS: process.platform === 'win32' ? 'Windows' : 'Linux', RUNNER_ENVIRONMENT: 'github-hosted',
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
