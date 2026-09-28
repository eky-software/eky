import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import SafeCiReporter, { createE2eReporters, REPORT_PREFIX } from './safeCiReporter.mjs';
import { encodeLinuxServiceDiagnostic, linuxServiceDiagnosticPrefix, projectLinuxServiceCause }
  from '../experiments/processOwnership/linuxServiceDiagnostic.mjs';

const reporterPath = fileURLToPath(new URL('./safeCiReporter.mjs', import.meta.url));
const require = createRequire(import.meta.url);
const playwrightTest = require.resolve('@playwright/test');
const cli = require.resolve('@playwright/test/cli');
const secret = 'ws://127.0.0.1:43210/synthetic-private-capability';
const events = output => output.split(/\r?\n/u)
  .filter(line => line.startsWith(REPORT_PREFIX)).map(line => JSON.parse(line.slice(REPORT_PREFIX.length)));
const linuxFailure = Object.freeze({ schemaVersion: 1, profile: 'backend', phase: 'prepare',
  causeReason: 'unverified', causeStage: 'unverified',
  startupFailure: 'preparationFailed', spawnObserved: false, processTree: 'stopped' });

test('only closed Linux failure records survive split, combined and oversized output', t => {
  let output = '';
  t.mock.method(process.stdout, 'write', chunk => { output += chunk; return true; });
  const reporter = new SafeCiReporter();
  const line = encodeLinuxServiceDiagnostic(linuxFailure);
  for (const field of Object.keys(linuxFailure)) {
    const value = { ...linuxFailure, [field]: secret };
    assert.throws(() => encodeLinuxServiceDiagnostic(value), /E2E_LINUX_SERVICE_DIAGNOSTIC_INVALID/u);
    reporter.onStdOut(linuxServiceDiagnosticPrefix + JSON.stringify(value) + '\n');
  }
  reporter.onStdOut(linuxServiceDiagnosticPrefix + JSON.stringify({ ...linuxFailure, extra: secret }) + '\n');
  reporter.onStdOut(linuxServiceDiagnosticPrefix + '{invalid}\n');
  reporter.onStdOut(secret + '\n' + 'x'.repeat(1024) + line + secret + '\n');
  assert.equal(output, '');
  for (const character of line) reporter.onStdOut(Buffer.from(character));
  reporter.onStdOut(line + secret + '\n' + line);
  reporter.onStdErr(line);
  reporter.onStdOut(line.slice(0, -1));
  assert.equal(output, line.repeat(3));
  assert.equal(output.includes(secret), false);
});

test('cause projection preserves only known reason and metadata stage without raw errors', () => {
  assert.deepEqual(projectLinuxServiceCause(Object.assign(new Error(secret), {
    reason: 'metadataInvalid', stage: 'tools', path: secret,
  })), { causeReason: 'metadataInvalid', causeStage: 'tools' });
  for (const error of [null, undefined, secret, { reason: secret, stage: secret },
    { get reason() { throw new Error(secret); }, get stage() { throw new Error(secret); } }]) {
    assert.deepEqual(projectLinuxServiceCause(error), { causeReason: 'unverified', causeStage: 'unverified' });
  }
});

function caseFixture(overrides = {}) {
  return {
    title: secret, id: secret, annotations: [{ type: 'private', description: secret }],
    parent: { project: () => ({ name: 'electron-development' }) },
    location: { file: fileURLToPath(new URL('../tests/electron/example.spec.ts', import.meta.url)), line: 12, column: 3 },
    repeatEachIndex: 0, expectedStatus: 'passed', results: [], outcome: () => 'unexpected',
    ...overrides,
  };
}

test('public hooks emit a closed projection and leave the original failure untouched', t => {
  let output = '';
  t.mock.method(process.stdout, 'write', chunk => { output += chunk; return true; });
  const reporter = new SafeCiReporter();
  const result = Object.freeze({ retry: 1, status: 'failed', duration: 123,
    errors: Object.freeze([Object.freeze({ message: secret, stack: secret, value: secret })]),
    stdout: Object.freeze([secret]), stderr: Object.freeze([secret]),
    attachments: Object.freeze([{ path: secret }]),
  });
  const fixture = Object.freeze(caseFixture({ results: Object.freeze([result]) }));
  assert.equal(reporter.printsToStdio(), true);
  reporter.onBegin({}, { allTests: () => [fixture] });
  reporter.onTestBegin(fixture, result);
  reporter.onStdOut(secret, fixture, result);
  reporter.onStdErr(secret, fixture, result);
  reporter.onTestEnd(fixture, result);
  reporter.onError({ message: secret });
  assert.equal(reporter.onEnd({ status: 'failed', extra: secret }), undefined);
  assert.equal(output.includes(secret), false);
  const rows = events(output);
  assert.deepEqual(rows.map(row => row.event), ['begin', 'testBegin', 'testEnd', 'runError', 'testOutcome', 'end']);
  assert.deepEqual(rows[2], { schemaVersion: 1, event: 'testEnd', caseIndex: 1,
    project: 'electron-development', file: 'electron/example.spec.ts', line: 12, column: 3,
    repeatEachIndex: 0, retry: 1, status: 'failed', expectedStatus: 'passed', durationMs: 123,
    errorCount: 1, errorClass: 'testError' });
  assert.equal(rows.at(-1).globalErrors, 1);
  assert.equal(rows.at(-1).unexpected, 1);
  assert.equal(result.errors[0].message, secret);
});

test('unknown metadata is withheld; timeout, not-run and flaky remain distinct', t => {
  let output = '';
  t.mock.method(process.stdout, 'write', chunk => { output += chunk; return true; });
  const reporter = new SafeCiReporter();
  const result = { retry: 0, status: 'timedOut', errors: [{ message: secret }], duration: 200 };
  const fixture = caseFixture({ parent: { project: () => ({ name: secret }) },
    location: { file: resolve('private-profile.spec.ts'), line: secret },
    results: [result], outcome: () => 'flaky', repeatEachIndex: -1 });
  const notRun = caseFixture();
  const unknown = caseFixture({ results: [{}], outcome: () => secret });
  reporter.onBegin({}, { allTests: () => [fixture, notRun, unknown] });
  reporter.onTestEnd(fixture, result);
  reporter.onEnd({ status: 'timedout' });
  assert.equal(output.includes(secret), false);
  const rows = events(output);
  assert.equal(rows[1].project, 'withheld');
  assert.equal(rows[1].file, 'withheld');
  assert.equal(rows[1].errorClass, 'testTimeout');
  assert.deepEqual(rows.at(-1), { schemaVersion: 1, event: 'end', status: 'timedout',
    selected: 3, globalErrors: 0, expected: 0, unexpected: 0, flaky: 1, skipped: 0, notRun: 1, unknown: 1 });
});

test('CI selects only safe console plus unchanged unpublished HTML; local list remains', () => {
  assert.deepEqual(createE2eReporters({}, []), [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]]);
  assert.deepEqual(createE2eReporters({ CI: 'true' }, []), [[reporterPath], ['html', { open: 'never', outputFolder: 'playwright-report' }]]);
  const config = readFileSync(new URL('../playwright.config.ts', import.meta.url), 'utf8');
  assert.match(config, /reporter: createE2eReporters\(\),/u);
  assert.match(config, /retries: isCi \? 1 : 0,/u);
  assert.match(config, /failOnFlakyTests: isCi,/u);
  assert.match(config, /trace: 'on-first-retry'/u);
});

for (const name of ['DEBUG', 'DEBUG_FILE', 'DEBUG_GIT_COMMIT_INFO', 'PWDEBUG', 'PWDEBUGIMPL', 'PWTEST_WATCH',
  'PW_RUNNER_DEBUG', 'PW_TEST_REPORTER', 'PW_TEST_DEBUG_REPORTERS', 'PW_TEST_HTML_REPORT_OPEN',
  'PLAYWRIGHT_HTML_OPEN', 'PLAYWRIGHT_HTML_OUTPUT_DIR', 'PLAYWRIGHT_HTML_REPORT', 'PLAYWRIGHT_HTML_TITLE']) {
  test(`CI refuses the ${name} escape without echoing its value`, () => {
    assert.throws(() => createE2eReporters({ CI: '1', [name]: secret }, []), error => {
      assert.equal(error.stack, 'Error: EKY_E2E_CI_REPORTING_CONFIGURATION_REJECTED');
      return true;
    });
  });
}
for (const argument of ['--reporter', '--reporter=list', '--debug', '--ui', '--ui-host=private', '--ui-port=43210']) {
  test(`CI refuses console-changing argument ${argument.split('=')[0]}`, () => {
    assert.throws(() => createE2eReporters({ CI: '1' }, [argument]), /EKY_E2E_CI_REPORTING_CONFIGURATION_REJECTED/u);
  });
}

function runnerFixture(t, body, { grep, setup, extraArgs = [] } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'eky-reporter-contract-'));
  let accepted = false;
  t.after(() => { if (accepted) rmSync(root, { recursive: true, force: true }); });
  const rawReport = join(root, 'private-results.json');
  mkdirSync(join(root, 'tests'));
  writeFileSync(join(root, 'tests', 'projection.spec.cjs'),
    `const { test, expect } = require(${JSON.stringify(playwrightTest)});\n${body}`);
  if (setup) writeFileSync(join(root, 'setup.cjs'), setup === 'hang'
    ? 'module.exports = () => new Promise(() => {});'
    : `module.exports = () => { throw new Error(${JSON.stringify(secret)}); };`);
  writeFileSync(join(root, 'playwright.config.mjs'), [
    `import { createE2eReporters } from ${JSON.stringify(pathToFileURL(reporterPath).href)};`,
    'const reporter = createE2eReporters();',
    // The extra JSON sink is private test evidence, never selected by real CI config.
    `reporter.push(['json', { outputFile: ${JSON.stringify(rawReport)} }]);`,
    'export default { testDir: "./tests", workers: 1, retries: 1, failOnFlakyTests: true,',
    `timeout: 1000, globalTimeout: ${setup === 'hang' ? 1000 : 30000}, reporter,`,
    'projects: [{ name: "electron-development" }],',
    setup ? 'globalSetup: "./setup.cjs",' : '',
    '};',
  ].join('\n'));
  const env = { ...process.env, CI: '1', FORCE_COLOR: '0' };
  for (const name of Object.keys(env)) {
    if (/^(?:DEBUG|PWDEBUG|PWTEST_|PW_|PLAYWRIGHT_)/iu.test(name)) delete env[name];
  }
  const result = spawnSync(process.execPath, [cli, 'test', ...(grep ? ['--grep', grep] : []), ...extraArgs],
    { cwd: root, env, encoding: 'utf8', timeout: 60000, maxBuffer: 4 * 1024 * 1024, windowsHide: true });
  writeFileSync(join(root, 'runner-output.private.txt'), (result.stdout ?? '') + (result.stderr ?? ''));
  assert.equal(result.error, undefined, 'the bounded reporter runner must terminate normally');
  assert.equal(result.signal, null);
  const output = result.stdout + result.stderr;
  assert.equal(output.includes(secret), false, 'private sentinel must not appear on public stdout/stderr');
  return { code: result.status, output, rows: events(output), rawReport, root, accept: () => { accepted = true; } };
}

const cases = `
test('passing', async () => {});
test.skip('skipped', async () => {});
test('expected failure', async () => { test.fail(); throw new Error(${JSON.stringify(secret)}); });
test('unexpected pass', async () => { test.fail(); });
test('failing ${secret}', async ({}, info) => {
  console.log(${JSON.stringify(secret)}); console.error(${JSON.stringify(secret)});
  await info.attach('private', { body: ${JSON.stringify(secret)}, contentType: 'text/plain' });
  throw new Error(${JSON.stringify(secret)});
});
test('flaky', async ({}, info) => { if (info.retry === 0) throw new Error(${JSON.stringify(secret)}); });
test('timeout', async () => { test.setTimeout(50); await new Promise(() => {}); });
`;

test('real runner preserves failures, expected failures, retries, skips and raw evidence', t => {
  const run = runnerFixture(t, cases);
  assert.equal(run.code, 1);
  const end = run.rows.at(-1);
  assert.deepEqual(end, { schemaVersion: 1, event: 'end', status: 'failed', selected: 7,
    globalErrors: 0, expected: 2, unexpected: 3, flaky: 1, skipped: 1, notRun: 0, unknown: 0 });
  const attemptRows = run.rows.filter(row => row.event === 'testEnd');
  assert.equal(attemptRows.length, 11);
  assert.equal(attemptRows.filter(row => row.retry === 1).length, 4);
  assert.equal(attemptRows.filter(row => row.errorClass === 'testTimeout').length, 2);
  assert.ok(readFileSync(run.rawReport, 'utf8').includes(secret), 'original private failure remains available');
  assert.ok(readFileSync(join(run.root, 'playwright-report', 'index.html')).length > 0);
  run.accept();
});

test('real startup failure reaches safe CI output without replacing the test error', t => {
  const session = new URL('../experiments/processOwnership/linuxServiceSession.mjs', import.meta.url).href;
  const run = runnerFixture(t, `
test('startup failure', async () => {
  process.stdout.write(${JSON.stringify(secret.repeat(30))});
  const { startLinuxService } = await import(${JSON.stringify(session)});
  await startLinuxService('backend', {}, {
    prepare() { throw new Error(${JSON.stringify(secret)}); }
  });
});`);
  assert.equal(run.code, 1);
  assert.equal(run.rows.at(-1).unexpected, 1);
  assert.equal(run.rows.filter(row => row.event === 'testEnd').length, 2);
  const diagnostics = run.output.split(/\r?\n/u).filter(line => line.startsWith(linuxServiceDiagnosticPrefix));
  assert.deepEqual(diagnostics, Array(2).fill(encodeLinuxServiceDiagnostic(linuxFailure).trimEnd()));
  const raw = readFileSync(run.rawReport, 'utf8');
  assert.ok(raw.includes('E2E_BACKEND_OWNER_START_FAILED'));
  assert.ok(raw.includes(secret));
  run.accept();
});

test('real runner still rejects flaky-only runs and accepts an ordinary pass', t => {
  const flaky = runnerFixture(t, cases, { grep: 'flaky' });
  assert.equal(flaky.code, 1);
  assert.equal(flaky.rows.at(-1).flaky, 1);
  const passing = runnerFixture(t, cases, { grep: 'passing' });
  assert.equal(passing.code, 0);
  assert.equal(passing.rows.at(-1).status, 'passed');
  flaky.accept();
  passing.accept();
});

test('real runner retains setup errors privately and emits only a closed run error', t => {
  const run = runnerFixture(t, cases, { setup: true });
  assert.equal(run.code, 1);
  assert.equal(run.rows.filter(row => row.event === 'runError').length, 1);
  assert.equal(run.rows.at(-1).status, 'failed');
  assert.ok(readFileSync(run.rawReport, 'utf8').includes(secret));
  run.accept();
});

test('real CLI reporter override fails before tests and cannot echo raw test errors', t => {
  const run = runnerFixture(t, cases, { extraArgs: ['--reporter=list'] });
  assert.equal(run.code, 1);
  assert.ok(run.output.includes('EKY_E2E_CI_REPORTING_CONFIGURATION_REJECTED'));
  assert.equal(run.rows.length, 0);
  run.accept();
});

test('real runner global timeout retains its distinct full-run status', t => {
  const run = runnerFixture(t, cases, { setup: 'hang' });
  assert.equal(run.code, 1);
  assert.equal(run.rows.at(-1).status, 'timedout');
  assert.ok(run.rows.at(-1).globalErrors > 0);
  const rawErrors = JSON.parse(readFileSync(run.rawReport, 'utf8')).errors;
  assert.match(rawErrors[0].message, /^Timed out waiting 1s for the global setup to run$/u);
  // The expired global budget can also report a teardown timeout; retain both.
  assert.equal(rawErrors.length, run.rows.at(-1).globalErrors);
  assert.deepEqual(run.rows.filter(row => row.event === 'runError').map(row => row.errorIndex),
    rawErrors.map((_, index) => index + 1));
  run.accept();
});
