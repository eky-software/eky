import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createRunnerFailureSink, RUNNER_FAILURE_LIMIT, runnerFailureBinding, validateRunnerFailureEvidence } from './runnerFailureEvidence.mjs';
import { observeNodeFailures } from './nodeFailureReporter.mjs';
import { projectExceptionChain, STARTUP_EXCEPTION_LIMITS } from '../apps/desktop/src/main/startupExceptionEvidence.ts';
import { executeCleanCommandPhase } from '../apps/desktop/installer/windows-acceptance-harness/cleanCommandPhase.mjs';
import { executeUpgradeCommandPhase } from '../apps/desktop/installer/windows-acceptance-harness/upgradeCommandPhase.mjs';
import { executeLegacyCommandPhase } from '../apps/desktop/installer/windows-acceptance-harness/legacyCommandPhase.mjs';
import { executeWorkspaceCommandPhase } from '../apps/desktop/installer/windows-acceptance-harness/workspaceCommandPhase.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const nodeReporter = new URL('./nodeFailureReporter.mjs', import.meta.url).href;
const vitestReporter = fileURLToPath(new URL('./vitestFailureReporter.mjs', import.meta.url));
const vitestCli = fileURLToPath(new URL('../node_modules/vitest/vitest.mjs', import.meta.url));
const secret = 'synthetic-reporter-known-secret';

async function fixture() {
  const parent = join(root, '.eky-local', 'reporter-fixtures');
  await mkdir(parent, { recursive: true });
  // Intentionally retained: a failed fixture must not erase the first evidence.
  return mkdtemp(join(parent, 'run-'));
}

async function evidence(directory, kind = 'runnerFailure') {
  const records = [];
  for (const name of await readdir(directory)) {
    if (!name.startsWith('eky-test-errors-')) continue;
    for (const file of await readdir(join(directory, name))) {
      assert.match(file, /^(?:[0-9]{3}-[a-f0-9-]{36}|[a-f0-9-]{36}\.summary)\.private\.json$/);
      const bytes = await readFile(join(directory, name, file));
      assert.ok(bytes.length <= STARTUP_EXCEPTION_LIMITS.fileBytes);
      const record = validateRunnerFailureEvidence(JSON.parse(bytes));
      assert.equal(name, 'eky-test-errors-' + record.invocationId);
      if (record.kind === 'runnerFailureSummary') assert.equal(file, record.invocationId + '.summary.private.json');
      if (record.kind === kind) records.push(record);
    }
  }
  return records;
}

async function runFixture(directory, name, args) {
  const env = { ...process.env, GITHUB_ACTIONS: 'false', TMP: directory, TEMP: directory, TMPDIR: directory,
    REPORTER_TEST_SECRET: secret, NO_COLOR: '1', CI: '1' };
  delete env.FORCE_COLOR;
  delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(process.execPath, args, { cwd: directory, env, encoding: 'utf8',
    timeout: 30_000, maxBuffer: 512 * 1024, windowsHide: true });
  await writeFile(join(directory, name + '.output.private.json'), JSON.stringify(result), { flag: 'wx', mode: 0o600 });
  assert.equal(result.error, undefined, 'fixture process must terminate normally');
  assert.equal(result.signal, null);
  return result;
}

for (const [family, execute, code] of [
  ['clean', executeCleanCommandPhase, 'WINDOWS_ACCEPTANCE_LOCAL_FIXTURE_CHANGED'],
  ['upgrade', executeUpgradeCommandPhase, 'WINDOWS_ACCEPTANCE_UPGRADE_LOCAL_FIXTURE_CHANGED'],
  ['legacy', executeLegacyCommandPhase, 'WINDOWS_ACCEPTANCE_LEGACY_LOCAL_FIXTURE_CHANGED'],
  ['workspace', executeWorkspaceCommandPhase, 'artifactChanged'],
]) {
  test(`${family} locally caught phase failure preserves its original without changing safe state`, async () => {
    const original = new Error('synthetic phase original', { cause: new Error('synthetic cause') });
    const context = () => ({ phase: 'artifact', state: { safetyErrorCode: null, artifact: {} },
      commandArguments: ['--artifact-descriptor', join(root, 'synthetic-descriptor.json')],
      callerBinding: { artifactDescriptorSha256: 'a'.repeat(64), buildRevision: 'b'.repeat(40) } });
    const ports = { verifyArtifact: async () => { throw original; }, filesystem: async () => { throw original; } };
    const baseline = context();
    assert.equal(await execute(baseline, ports), 0);
    assert.equal(baseline.state.safetyErrorCode, code);
    for (const observerFails of [false, true]) {
      const observed = [];
      const actual = context();
      assert.equal(await execute(actual, { ...ports, observeFailure(error, phase) {
        observed.push({ error, phase });
        if (observerFails) throw new Error('synthetic observer failure');
      } }), 0);
      assert.deepEqual(observed, [{ error: original, phase: 'artifact' }]);
      assert.deepEqual(actual.state, baseline.state);
      assert.equal(JSON.stringify(actual.state).includes('synthetic phase original'), false);
    }
  });
  test(`${family} real command entrypoint retains a phase-request failure privately and exits failed`, async () => {
    const directory = await fixture();
    const entrypoint = fileURLToPath(new URL(`../apps/desktop/installer/windows-acceptance-harness/${family}CommandPhase.mjs`, import.meta.url));
    const result = await runFixture(directory, family, [entrypoint, '--phase-request', join(directory, 'missing.json')]);
    assert.equal(result.status, 1);
    const records = await evidence(directory);
    assert.equal(records.length, 1);
    assert.equal(records[0].runner, 'native');
    assert.equal(records[0].phase, 'phaseRequest');
    assert.ok(records[0].exception.chain[0].stack);
    assert.equal(result.stdout.trim(), '');
    assert.equal(result.stderr.includes(directory), false);
  });
}

test('shared projection remains bounded, redacts known secrets and does not invoke custom getters', () => {
  let touched = false;
  const error = new Error('primary ' + secret, { cause: new Error('password=synthetic-password') });
  Object.defineProperty(error, 'name', { get() { touched = true; throw new Error(); } });
  const projected = projectExceptionChain(error, [secret]);
  assert.equal(touched, false);
  assert.equal(projected.chain.length, 2);
  assert.equal(JSON.stringify(projected).includes(secret), false);
  assert.equal(JSON.stringify(projected).includes('synthetic-password'), false);
  const large = projectExceptionChain({ message: 'x'.repeat(20_000), stack: 'y'.repeat(20_000) });
  assert.equal(large.chain[0].message.length, STARTUP_EXCEPTION_LIMITS.message);
  assert.equal(large.chain[0].stack.length, STARTUP_EXCEPTION_LIMITS.stack);
  assert.equal(large.chain[0].truncated, true);
});

test('CI binding is explicit, local fallback is separate and invalid identity is rejected', () => {
  assert.deepEqual(runnerFailureBinding({}), { kind: 'local' });
  const env = { GITHUB_ACTIONS: 'true', GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '2',
    GITHUB_JOB: 'tests', GITHUB_SHA: 'a'.repeat(40), EKY_EVIDENCE_JOB_KEY: 'core-tests-0' };
  assert.deepEqual(runnerFailureBinding(env), { kind: 'github', runId: '123', attempt: '2',
    job: 'tests', jobKey: 'core-tests-0', jobKeySource: 'explicit', sourceRevision: 'a'.repeat(40) });
  assert.equal(runnerFailureBinding({ ...env, EKY_EVIDENCE_JOB_KEY: '' }).jobKeySource, 'githubJob');
  assert.throws(() => runnerFailureBinding({ ...env, GITHUB_JOB: '../bad' }));
});

test('sink bounds invocations, persists partial counts and preserves first bytes without extra properties', async t => {
  const warnings = [];
  t.mock.method(process.stderr, 'write', text => { warnings.push(text); return true; });
  const tempRoot = await fixture();
  const sink = createRunnerFailureSink({ tempRoot, env: { TEST_SECRET: secret } });
  const error = Object.assign(new Error('primary ' + secret), { profile: 'EXCLUDED-PROFILE' });
  for (let i = 0; i < RUNNER_FAILURE_LIMIT + 1; i++) {
    sink.record({ runner: 'node', phase: 'testFailure', testName: 'case ' + secret,
      attempt: 0, error });
  }
  const delivery = await sink.flush();
  assert.equal(delivery.status, 'partial');
  assert.equal(delivery.limited, true);
  assert.equal(delivery.recorded, RUNNER_FAILURE_LIMIT);
  assert.equal(delivery.omitted, 1);
  assert.equal(warnings.length, 1);
  assert.ok(warnings[0].startsWith('EKY_TEST_FAILURE_EVIDENCE_PARTIAL '));
  assert.equal(warnings[0].includes(secret), false);
  assert.equal(await sink.flush(), delivery);
  assert.equal(warnings.length, 1);
  const [summary] = await evidence(tempRoot, 'runnerFailureSummary');
  assert.equal(summary.status, 'partial');
  assert.equal(summary.recordLimit, 128);
  assert.equal(summary.recorded, 128);
  assert.equal(summary.omitted, 1);
  const records = await evidence(tempRoot);
  assert.equal(records.length, RUNNER_FAILURE_LIMIT);
  assert.equal(new Set(records.map(record => record.sequence)).size, RUNNER_FAILURE_LIMIT);
  assert.equal(JSON.stringify(records).includes(secret), false);
  assert.equal(JSON.stringify(records).includes('EXCLUDED-PROFILE'), false);
  assert.deepEqual(records[0].binding, { kind: 'local' });
  const second = createRunnerFailureSink({ tempRoot, env: {} });
  second.record({ runner: 'native', phase: 'phaseFailure', error: new Error('second') });
  await second.flush();
  assert.equal(new Set((await evidence(tempRoot)).map(record => record.invocationId)).size, 2);
  assert.equal((await evidence(tempRoot, 'runnerFailureSummary')).find(record => record.status === 'recorded').recorded, 1);
});

test('unavailable storage and invalid binding produce safe partial counts without escaping to the reporter', async t => {
  const warnings = [];
  t.mock.method(process.stderr, 'write', text => { warnings.push(text); return true; });
  const directory = await fixture();
  for (const options of [
    { tempRoot: join(directory, 'missing'), env: {} },
    { tempRoot: directory, env: { GITHUB_ACTIONS: 'true' } },
  ]) {
    const sink = createRunnerFailureSink(options);
    assert.doesNotThrow(() => sink.record({ runner: 'node', phase: 'testFailure', error: new Error('private') }));
    assert.equal((await sink.flush()).status, 'partial');
  }
  assert.deepEqual(await evidence(directory), []);
  assert.equal(warnings.length, 2);
  for (const warning of warnings) {
    const counts = JSON.parse(warning.slice('EKY_TEST_FAILURE_EVIDENCE_PARTIAL '.length));
    assert.deepEqual(counts, { status: 'partial', observed: 1, recorded: 0, rejected: 1,
      limited: false, omitted: 0, recordLimit: 128 });
  }
});

test('shared validator rejects extra fields, nested values, getters and incorrect bounds or bindings', async () => {
  const tempRoot = await fixture();
  const sink = createRunnerFailureSink({ tempRoot, env: {} });
  sink.record({ runner: 'node', phase: 'testFailure', error: new Error('exact original') });
  await sink.flush();
  const [record] = await evidence(tempRoot);
  assert.equal(validateRunnerFailureEvidence(record), record);
  for (const mutate of [
    value => { value.extra = {}; },
    value => { value.binding.extra = 'unexpected'; },
    value => { value.sequence = 129; },
    value => { value.recordLimit = 16; },
    value => { value.test.name = {}; },
    value => { value.test.attempt = -1; },
    value => { value.exception.chain[0].message = 'x'.repeat(2049); },
    value => { value.exception.chain[0].stack = 'x'.repeat(8193); },
    value => { value.exception.chain = Array(5).fill(value.exception.chain[0]); },
    value => { value.exception.chain[0].cause = {}; },
    value => { Object.defineProperty(value.exception.chain[0], 'message', { get() { assert.fail('getter invoked'); } }); },
    value => { value.binding = { kind: 'github', runId: '1', attempt: '1', job: 'job', jobKey: 'other',
      jobKeySource: 'githubJob', sourceRevision: 'a'.repeat(40) }; },
  ]) {
    const changed = structuredClone(record);
    mutate(changed);
    assert.throws(() => validateRunnerFailureEvidence(changed), /TEST_FAILURE_EVIDENCE_INVALID/);
  }
  const [summary] = await evidence(tempRoot, 'runnerFailureSummary');
  assert.throws(() => validateRunnerFailureEvidence({ ...summary, omitted: 1 }), /TEST_FAILURE_EVIDENCE_INVALID/);
  assert.throws(() => validateRunnerFailureEvidence({ ...summary, recorded: 129 }), /TEST_FAILURE_EVIDENCE_INVALID/);
});

test('stalled private writes have one bounded flush and do not prevent successful cleanup or exit', async () => {
  const directory = await fixture();
  const file = join(directory, 'stalled-writer.mjs');
  const sinkUrl = new URL('./runnerFailureEvidence.mjs', import.meta.url).href;
  await writeFile(file, `import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
fs.writeFile = () => new Promise(() => {});
syncBuiltinESMExports();
const { createRunnerFailureSink } = await import(${JSON.stringify(sinkUrl)});
const sink = createRunnerFailureSink({ tempRoot: process.cwd(), env: {} });
sink.record({ runner: 'native', phase: 'originalFailure', error: new Error('PRIVATE-STALL') });
const delivery = sink.flush();
assert.equal(sink.flush(), delivery);
const result = await delivery;
assert.equal(result.status, 'timedOut');
assert.equal(await sink.flush(), result);
assert.equal(process.exitCode, undefined);
process.stdout.write('CLEANUP-COMPLETED');
`);
  const result = await runFixture(directory, 'adapter', [file]);
  assert.equal(result.status, 0);
  assert.equal(result.stdout, 'CLEANUP-COMPLETED');
  const warnings = result.stderr.split(/\r?\n/).filter(line => line.startsWith('EKY_TEST_FAILURE_EVIDENCE_PARTIAL '));
  assert.equal(warnings.length, 1);
  assert.equal(result.stderr.includes('PRIVATE-STALL'), false);
  assert.equal(JSON.parse(warnings[0].slice('EKY_TEST_FAILURE_EVIDENCE_PARTIAL '.length)).status, 'timedOut');
});

test('Node observation forwards the exact event objects and excludes expected todo and parent summaries', async () => {
  const events = [
    { type: 'test:pass', data: {} },
    { type: 'test:fail', data: { todo: true, details: { error: new Error('expected') } } },
    { type: 'test:fail', data: { details: { error: { failureType: 'subtestsFailed' } } } },
    { type: 'test:fail', data: { testNumber: 1, details: { error: new Error('original') } } },
  ];
  const recorded = [];
  let flushed = false;
  const output = [];
  for await (const event of observeNodeFailures(events, {
    record: entry => recorded.push(entry), flush: async () => { flushed = true; },
  })) output.push(event);
  assert.deepEqual(output, events);
  output.forEach((event, i) => assert.equal(event, events[i]));
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0].error, events[3].data.details.error);
  assert.equal(flushed, true);
});

test('real Node runner keeps public results and captures only an actual uncaught failure', async () => {
  const directory = await fixture();
  const file = join(directory, 'fixture.test.mjs');
  await writeFile(file, `import test from 'node:test';
import assert from 'node:assert/strict';
test('passing caught exception', () => assert.throws(() => { throw new Error('EXPECTED-CAUGHT'); }));
test('expected todo', { todo: true }, () => { throw new Error('EXPECTED-TODO'); });
test('original failure', () => { throw new Error('FIRST ' + process.env.REPORTER_TEST_SECRET, { cause: new Error('CAUSE') }); });
`);
  const baseline = await runFixture(directory, 'baseline', ['--test', file]);
  const actual = await runFixture(directory, 'adapter', ['--test', '--test-reporter=' + nodeReporter, file]);
  assert.equal(baseline.status, 1);
  assert.equal(actual.status, baseline.status);
  const summary = output => output.split(/\r?\n/).filter(line => /(?:tests|suites|pass|fail|cancelled|skipped|todo) \d+$/.test(line));
  assert.deepEqual(summary(actual.stdout), summary(baseline.stdout));
  assert.ok(summary(actual.stdout).length >= 6);
  assert.equal(actual.stdout.includes('runnerFailure'), false);
  const records = await evidence(directory);
  assert.equal(records.length, 1);
  assert.equal(records[0].runner, 'node');
  assert.equal(records[0].test.attempt, 0);
  const saved = JSON.stringify(records);
  assert.ok(saved.includes('FIRST'));
  assert.ok(saved.includes('CAUSE'));
  assert.ok(records[0].exception.chain.some(part => part.message === 'FIRST [redacted]'));
  assert.ok(records[0].exception.chain.some(part => part.message === 'CAUSE'));
  assert.equal(saved.includes(secret), false);
  assert.equal(saved.includes('EXPECTED-CAUGHT'), false);
  assert.equal(saved.includes('EXPECTED-TODO'), false);
});

test('real Vitest runner captures test, suite, collection and recovered-retry errors without changing outcomes', async () => {
  const directory = await fixture();
  await writeFile(join(directory, 'vitest.config.mjs'), `export default { test: { include: ['*.test.mjs'], maxWorkers: 1 } };`);
  await writeFile(join(directory, 'fixture.test.mjs'), `import { test, expect, describe, beforeAll } from 'vitest';
test('caught', () => expect(() => { throw new Error('EXPECTED-CAUGHT'); }).toThrow());
test.fails('expected failure', () => { throw new Error('EXPECTED-FAILS'); });
test('original failure', () => { throw new Error('FIRST ' + process.env.REPORTER_TEST_SECRET, { cause: new Error('CAUSE') }); });
let attempt = 0;
test('recovered retry', { retry: 1 }, () => { if (attempt++ === 0) throw new Error('FIRST-RETRY'); });
describe('suite', () => { beforeAll(() => { throw new Error('HOOK-FAILURE'); }); test('blocked', () => {}); });
`);
  await writeFile(join(directory, 'collection.test.mjs'), `throw new Error('COLLECTION-FAILURE');`);
  const args = [vitestCli, 'run', '--config', join(directory, 'vitest.config.mjs')];
  const baseline = await runFixture(directory, 'baseline', args);
  const actual = await runFixture(directory, 'adapter', [...args, '--reporter=default', '--reporter=' + vitestReporter]);
  assert.equal(baseline.status, 1);
  assert.equal(actual.status, baseline.status);
  assert.ok(actual.stdout.includes('recovered retry'));
  const records = await evidence(directory);
  const saved = JSON.stringify(records);
  for (const sentinel of ['FIRST', 'CAUSE', 'FIRST-RETRY', 'HOOK-FAILURE', 'COLLECTION-FAILURE']) assert.ok(saved.includes(sentinel), sentinel);
  for (const excluded of [secret, 'EXPECTED-CAUGHT', 'EXPECTED-FAILS']) assert.equal(saved.includes(excluded), false, excluded);
  assert.ok(records.every(record => record.runner === 'vitest'));
  const retry = records.find(record => record.test.name?.includes('recovered retry'));
  assert.equal(retry.exception.chain[0].message, 'FIRST-RETRY');
  const original = records.find(record => record.test.name?.includes('original failure'));
  assert.equal(original.exception.chain[0].message, 'FIRST [redacted]');
  assert.equal(original.exception.chain[1].message, 'CAUSE');
  assert.equal(retry.test.retryCount, 1);
  assert.equal(retry.test.attempt, null);
});
