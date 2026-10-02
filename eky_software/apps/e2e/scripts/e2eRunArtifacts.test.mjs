import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync,
  rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { E2E_RUN_ARTIFACTS_ENV } from './e2eRunArtifacts.mjs';
import { REPORT_PREFIX } from './safeCiReporter.mjs';

const require = createRequire(import.meta.url);
const playwrightTest = require.resolve('@playwright/test');
const cli = require.resolve('@playwright/test/cli');
const selectorUrl = new URL('./e2eRunArtifacts.mjs', import.meta.url).href;
const reporterUrl = new URL('./safeCiReporter.mjs', import.meta.url).href;
const sentinel = 'synthetic-private-retention-evidence';
const oldRunId = 'run-00000000-0000-4000-8000-000000000000';
const workerKeys = ['TEST_WORKER_INDEX', 'TEST_PARALLEL_INDEX'];
let importIndex = 0;

async function selector(t, values = {}) {
  for (const key of [E2E_RUN_ARTIFACTS_ENV, ...workerKeys]) {
    const previous = process.env[key];
    t.after(() => {
      if (previous === undefined) delete process.env[key];
      else process.env[key] = previous;
    });
    if (values[key] === undefined) delete process.env[key];
    else process.env[key] = values[key];
  }
  return (await import(`${selectorUrl}?contract=${++importIndex}`)).getE2eRunArtifacts;
}

test('root selection ignores stale markers and stays identical across config consumers', async t => {
  const get = await selector(t, { [E2E_RUN_ARTIFACTS_ENV]: `1:${process.pid}:${oldRunId}` });
  const artifacts = get();
  assert.notEqual(artifacts.runId, oldRunId);
  assert.match(artifacts.runId, /^run-[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u);
  assert.deepEqual(artifacts, {
    runId: artifacts.runId,
    outputDir: `test-results/${artifacts.runId}`,
    htmlOutputFolder: `playwright-report/${artifacts.runId}`,
  });
  assert.deepEqual(get(), artifacts);
  assert.equal(Object.isFrozen(artifacts), true);
  assert.equal(process.env[E2E_RUN_ARTIFACTS_ENV], `1:${process.pid}:${artifacts.runId}`);
  assert.equal(existsSync(artifacts.outputDir), false, 'selection does not create a directory');
  assert.equal(existsSync(artifacts.htmlOutputFolder), false);
});

test('a malformed inherited root marker is replaced, never interpreted as a path', async t => {
  const get = await selector(t, { [E2E_RUN_ARTIFACTS_ENV]: '../' + sentinel });
  assert.equal(JSON.stringify(get()).includes(sentinel), false);
  assert.equal(process.env[E2E_RUN_ARTIFACTS_ENV].includes(sentinel), false);
});

test('workers and replacement workers inherit exactly the root selection without changing its marker', async t => {
  const marker = `1:${process.ppid}:${oldRunId}`;
  const get = await selector(t, { [E2E_RUN_ARTIFACTS_ENV]: marker,
    TEST_WORKER_INDEX: '0', TEST_PARALLEL_INDEX: '0' });
  const artifacts = get();
  process.env.TEST_WORKER_INDEX = '2';
  assert.deepEqual(get(), artifacts);
  assert.equal(artifacts.runId, oldRunId);
  assert.equal(process.env[E2E_RUN_ARTIFACTS_ENV], marker);
});

test('workers fail closed on missing, malformed, foreign or unbounded markers without leaking values', async t => {
  const get = await selector(t, { TEST_WORKER_INDEX: '0', TEST_PARALLEL_INDEX: '0' });
  for (const marker of [undefined, '', oldRunId, `1:${process.pid}:${oldRunId}`,
    `2:${process.ppid}:${oldRunId}`, `1:0:${oldRunId}`, `1:01:${oldRunId}`,
    `1:9007199254740992:${oldRunId}`, `1:${process.ppid}:${oldRunId}\n`,
    `1:${process.ppid}:../${sentinel}`, `1:${process.ppid}:C:\\${sentinel}`,
    `1:${process.ppid}:${oldRunId}/child`, sentinel.repeat(1000)]) {
    if (marker === undefined) delete process.env[E2E_RUN_ARTIFACTS_ENV];
    else process.env[E2E_RUN_ARTIFACTS_ENV] = marker;
    assert.throws(get, error => {
      assert.equal(error.message, 'EKY_E2E_RUN_ARTIFACTS_INVALID');
      assert.equal(error.stack, 'Error: EKY_E2E_RUN_ARTIFACTS_INVALID');
      return true;
    });
  }
});

test('partial and invalid worker indexes cannot silently allocate a second run', async t => {
  const get = await selector(t, { [E2E_RUN_ARTIFACTS_ENV]: `1:${process.ppid}:${oldRunId}` });
  for (const key of workerKeys) {
    for (const value of [undefined, '', '-1', '0.5', '00', '0\n', '9007199254740992', sentinel]) {
      process.env.TEST_WORKER_INDEX = '0';
      process.env.TEST_PARALLEL_INDEX = '0';
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
      assert.throws(get, { message: 'EKY_E2E_RUN_ARTIFACTS_INVALID',
        stack: 'Error: EKY_E2E_RUN_ARTIFACTS_INVALID' });
    }
  }
});

function runnerFixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'eky-run-artifacts-contract-'));
  const cwd = join(root, 'apps', 'e2e');
  let accepted = false;
  t.after(() => { if (accepted) rmSync(root, { recursive: true, force: true }); });
  mkdirSync(join(cwd, 'tests'), { recursive: true });
  writeFileSync(join(cwd, 'package.json'), JSON.stringify({ type: 'module' }));
  writeFileSync(join(cwd, 'base.config.ts'), `
import { writeFileSync } from 'node:fs';
import { getE2eRunArtifacts, E2E_RUN_ARTIFACTS_ENV } from ${JSON.stringify(selectorUrl)};
import { createE2eReporters } from ${JSON.stringify(reporterUrl)};
const artifacts = getE2eRunArtifacts();
if (!process.env.TEST_WORKER_INDEX) {
  writeFileSync(${JSON.stringify(join(cwd, 'invocation.private.json'))}, JSON.stringify({
    ...artifacts, marker: process.env[E2E_RUN_ARTIFACTS_ENV],
  }));
}
const reporter = createE2eReporters(undefined, undefined, artifacts);
export default { testDir: './tests', outputDir: artifacts.outputDir,
  reporter, workers: 2, fullyParallel: true, retries: 1, repeatEach: 2,
  failOnFlakyTests: true, timeout: 5000, globalTimeout: 30000 };
`);
  writeFileSync(join(cwd, 'playwright.config.ts'), `
import standard from './base.config.js';
export default { ...standard, projects: [{ name: 'system-api' }] };
`);
  writeFileSync(join(cwd, 'tests', 'retention.spec.ts'), `
import { test, expect } from ${JSON.stringify(new URL('./index.mjs', pathToFileURL(playwrightTest)).href)};
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getE2eRunArtifacts, E2E_RUN_ARTIFACTS_ENV } from ${JSON.stringify(selectorUrl)};
for (const name of ['failure', 'peer']) {
  test(name, async ({}, info) => {
    const root = JSON.parse(readFileSync(${JSON.stringify(join(cwd, 'invocation.private.json'))}, 'utf8'));
    const selected = getE2eRunArtifacts();
    expect(selected.runId).toBe(root.runId);
    expect(selected.outputDir).toBe(root.outputDir);
    expect(selected.htmlOutputFolder).toBe(root.htmlOutputFolder);
    expect(process.env[E2E_RUN_ARTIFACTS_ENV]).toBe(root.marker);
    expect(info.project.outputDir).toBe(resolve(process.env.EKY_RETENTION_CONTRACT_OUTPUT || root.outputDir));
    const path = info.outputPath('retention.json');
    writeFileSync(path, JSON.stringify({ runId: selected.runId, attempt: info.retry,
      repeatEachIndex: info.repeatEachIndex, workerIndex: info.workerIndex, name }));
    await info.attach('retention', { path, contentType: 'application/json' });
    console.log(${JSON.stringify(cwd)});
    if (name === 'failure' && process.env.EKY_RETENTION_CONTRACT_PASS !== '1') {
      throw new Error(${JSON.stringify(sentinel)});
    }
  });
}
`);
  return { root, cwd, accept() { accepted = true; } };
}

function run(fixture, label, { marker, pass = false, output } = {}) {
  const env = { ...process.env, CI: '1', FORCE_COLOR: '0', EKY_E2E: '1' };
  for (const name of Object.keys(env)) {
    if (/^(?:DEBUG|PWDEBUG|PWTEST_|PW_|PLAYWRIGHT_|TEST_WORKER_INDEX$|TEST_PARALLEL_INDEX$|EKY_RETENTION_CONTRACT_)/iu.test(name)) {
      delete env[name];
    }
  }
  delete env[E2E_RUN_ARTIFACTS_ENV];
  if (marker) env[E2E_RUN_ARTIFACTS_ENV] = marker;
  if (pass) env.EKY_RETENTION_CONTRACT_PASS = '1';
  if (output) env.EKY_RETENTION_CONTRACT_OUTPUT = output;
  const result = spawnSync(process.execPath, [cli, 'test', ...(output ? ['--output', output] : [])],
    { cwd: fixture.cwd, env, encoding: 'utf8', timeout: 60000, maxBuffer: 4 * 1024 * 1024, windowsHide: true });
  const text = (result.stdout ?? '') + (result.stderr ?? '');
  writeFileSync(join(fixture.root, `${label}.private.txt`), text);
  assert.ok(result.error === undefined, 'bounded Playwright command must terminate normally');
  assert.equal(result.signal, null);
  for (const privateValue of [sentinel, fixture.root, fixture.root.replaceAll('\\', '/')]) {
    assert.equal(text.includes(privateValue), false, 'private evidence must not reach public output');
  }
  const rows = text.split(/\r?\n/u).filter(line => line.startsWith(REPORT_PREFIX))
    .map(line => JSON.parse(line.slice(REPORT_PREFIX.length)));
  assert.equal(rows.at(-1)?.event, 'end');
  assert.equal(result.status, pass ? 0 : 1);
  assert.equal(rows.at(-1).status, pass ? 'passed' : 'failed');
  assert.equal(rows.at(-1).selected, 4);
  assert.equal(rows.at(-1).unexpected, pass ? 0 : 2);
  assert.equal(rows.at(-1).flaky, 0);
  const artifacts = JSON.parse(readFileSync(join(fixture.cwd, 'invocation.private.json'), 'utf8'));
  const results = join(fixture.cwd, output || artifacts.outputDir);
  const attempts = readdirSync(results, { recursive: true }).filter(file => file.endsWith('retention.json'))
    .map(file => JSON.parse(readFileSync(join(results, file), 'utf8')));
  assert.equal(attempts.length, pass ? 4 : 6);
  assert.ok(attempts.every(attempt => attempt.runId === artifacts.runId));
  assert.deepEqual([...new Set(attempts.map(attempt => attempt.repeatEachIndex))].sort(), [0, 1]);
  assert.ok(new Set(attempts.map(attempt => attempt.workerIndex)).size >= 2);
  assert.equal(attempts.filter(attempt => attempt.attempt === 1).length, pass ? 0 : 2);
  assert.ok(readFileSync(join(fixture.cwd, artifacts.htmlOutputFolder, 'index.html')).length > 0);
  const report = JSON.parse(readFileSync(join(fixture.cwd, artifacts.htmlOutputFolder, 'results.private.json'), 'utf8'));
  const reportedAttempts = report.suites.flatMap(suite => suite.specs.flatMap(spec =>
    spec.tests.flatMap(test => test.results)));
  assert.equal(reportedAttempts.length, attempts.length);
  assert.equal(reportedAttempts.filter(attempt => attempt.retry === 1).length, pass ? 0 : 2);
  assert.equal(JSON.stringify(report.errors).includes(sentinel), false);
  assert.equal(JSON.stringify(reportedAttempts).includes(sentinel), !pass);
  for (const attachment of reportedAttempts.flatMap(attempt => attempt.attachments)) {
    assert.equal(typeof attachment.path, 'string');
    assert.equal(attachment.body, undefined, 'path attachments must not embed file or database bytes');
  }
  return artifacts;
}

function snapshot(root) {
  return readdirSync(root, { recursive: true, withFileTypes: true }).filter(entry => entry.isFile())
    .map(entry => {
      const path = join(entry.parentPath, entry.name);
      return [path, readFileSync(path)];
    });
}

function assertUnchanged(files) {
  for (const [path, bytes] of files) {
    assert.ok(existsSync(path), 'original evidence must still exist');
    assert.ok(readFileSync(path).equals(bytes), 'original evidence bytes must remain unchanged');
  }
}

function cleanSyntheticBuilds(fixture) {
  // Run the existing cleanup scripts on independent synthetic directories only.
  for (const app of ['backend', 'desktop']) {
    for (const directory of ['dist', 'e2e-dist']) {
      const script = join(fixture.root, 'apps', app, 'scripts', `clean-${directory}.mjs`);
      mkdirSync(dirname(script), { recursive: true });
      copyFileSync(new URL(`../../${app}/scripts/clean-${directory}.mjs`, import.meta.url), script);
      const output = resolve(dirname(script), '..', directory);
      mkdirSync(output, { recursive: true });
      writeFileSync(join(output, 'synthetic-build.txt'), 'synthetic');
      const result = spawnSync(process.execPath, [script], { cwd: fixture.root, encoding: 'utf8',
        timeout: 10000, maxBuffer: 1024 * 1024, windowsHide: true });
      writeFileSync(join(fixture.root, `${app}-${directory}-cleanup.private.txt`),
        (result.stdout ?? '') + (result.stderr ?? ''));
      assert.ok(result.error === undefined, 'bounded build cleanup must terminate normally');
      assert.equal(result.status, 0);
      assert.equal(existsSync(output), false);
    }
  }
}

test('two real CLI invocations retain first failure and HTML across build cleanup and fresh workers', t => {
  const fixture = runnerFixture(t);
  const first = run(fixture, 'first');
  const evidence = [...snapshot(join(fixture.cwd, first.outputDir)),
    ...snapshot(join(fixture.cwd, first.htmlOutputFolder))];
  assert.ok(evidence.length > 0);
  cleanSyntheticBuilds(fixture);
  assertUnchanged(evidence);
  const second = run(fixture, 'second', { marker: first.marker, pass: true });
  assert.notEqual(second.runId, first.runId);
  assertUnchanged(evidence);
  assert.equal(readdirSync(join(fixture.cwd, 'test-results')).length, 2);
  assert.equal(readdirSync(join(fixture.cwd, 'playwright-report')).length, 2);
  fixture.accept();
});

test('real CLI --output overrides only results while HTML stays run-scoped', t => {
  const fixture = runnerFixture(t);
  const artifacts = run(fixture, 'override', { pass: true, output: 'explicit-results' });
  assert.equal(existsSync(join(fixture.cwd, artifacts.outputDir)), false);
  fixture.accept();
});
