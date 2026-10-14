import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSafeCiOutputRelay } from './safeCiOutputRelay.mjs';
import { projectElectronLifecycle, projectElectronEvidenceFailures } from './electronLifecycleProjection.mjs';
import { createRunnerFailureSink, RUNNER_FAILURE_LIMIT } from '../../../test-reporters/runnerFailureEvidence.mjs';

export const REPORT_PREFIX = 'EKY_E2E_REPORT ';
const testsRoot = fileURLToPath(new URL('../tests/', import.meta.url));
const projects = new Set([
  'system-api', 'web-chromium', 'electron-development', 'electron-endurance',
  'endurance-baseline', 'first-start-load-diagnostic', 'packaged-legacy-recovery',
]);
const statuses = new Set(['passed', 'failed', 'timedOut', 'skipped', 'interrupted']);
const runStatuses = new Set(['passed', 'failed', 'timedout', 'interrupted']);
const outcomes = new Set(['expected', 'unexpected', 'flaky', 'skipped']);
const integer = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
const status = value => statuses.has(value) ? value : 'unknown';

function sourceLocation(test) {
  const file = typeof test.location?.file === 'string'
    ? relative(testsRoot, test.location.file).split(sep).join('/') : '';
  // Only committed-style test source locations, never a runtime/attachment path.
  const allowed = /^(?:system|web|electron|electron-stress|stress|diagnostics|packaged)\/[A-Za-z0-9_/-]+\.spec\.ts$/u;
  return allowed.test(file) && !file.split('/').includes('..')
    ? { file, line: integer(test.location.line), column: integer(test.location.column) }
    : { file: 'withheld', line: null, column: null };
}

export function createE2eReporters(env = process.env, argv = process.argv, artifacts) {
  const ci = Boolean(env.CI);
  if (ci) {
    const forbidden = Object.entries(env).some(([name, value]) => value && (
      /^(?:DEBUG|DEBUG_FILE|DEBUG_GIT_COMMIT_INFO|PWDEBUG|PWDEBUGIMPL|PWTEST_WATCH|PW_RUNNER_DEBUG|PW_TEST_REPORTER|PW_TEST_DEBUG_REPORTERS|PW_TEST_HTML_REPORT_OPEN)$/iu.test(name)
      || /^PLAYWRIGHT_(?:HTML|JSON)_/iu.test(name)
    ));
    if (forbidden || argv.some(arg => /^--(?:reporter|debug|ui(?:-host|-port)?)(?:=|$)/u.test(arg))) {
      const error = new Error('EKY_E2E_CI_REPORTING_CONFIGURATION_REJECTED');
      error.stack = 'Error: EKY_E2E_CI_REPORTING_CONFIGURATION_REJECTED';
      throw error;
    }
  }
  return [
    ...(ci ? [[fileURLToPath(import.meta.url)]] : [['list'], [fileURLToPath(import.meta.url), { silent: true }]]),
    ['html', { open: 'never', outputFolder: artifacts?.htmlOutputFolder ?? 'playwright-report' }],
    ['json', { outputFile: join(artifacts?.htmlOutputFolder ?? 'playwright-report', 'results.private.json') }],
  ];
}

// Public Reporter API only. Private HTML/JSON reporters retain original errors.
export default class SafeCiReporter {
  #cases = new Map();
  #globalErrors = 0;
  #safeOutput = createSafeCiOutputRelay(line => process.stdout.write(line));
  #privateFailures;
  #silent;

  constructor({ failureSink, silent = false } = {}) {
    this.#privateFailures = failureSink ?? createRunnerFailureSink();
    this.#silent = silent;
  }

  printsToStdio() { return !this.#silent; }

  #emit(event, fields) {
    if (this.#silent) return;
    process.stdout.write(REPORT_PREFIX + JSON.stringify({ schemaVersion: 1, event, ...fields }) + '\n');
  }

  #case(test) {
    if (!this.#cases.has(test)) {
      const name = test.parent?.project()?.name;
      this.#cases.set(test, {
        caseIndex: this.#cases.size + 1,
        project: projects.has(name) ? name : 'withheld',
        ...sourceLocation(test),
        repeatEachIndex: integer(test.repeatEachIndex),
      });
    }
    return this.#cases.get(test);
  }

  onBegin(_config, suite) {
    for (const test of suite.allTests()) this.#case(test);
    this.#emit('begin', { selected: this.#cases.size });
  }

  onTestBegin(test, result) {
    this.#emit('testBegin', { ...this.#case(test), retry: integer(result.retry) });
  }

  onTestEnd(test, result) {
    const errorCount = Array.isArray(result.errors) ? result.errors.length : 0;
    if (result.status !== test.expectedStatus && result.status !== 'skipped') {
      for (const error of (result.errors ?? []).slice(0, RUNNER_FAILURE_LIMIT + 1)) {
        try { this.#privateFailures.record({ runner: 'playwright', phase: 'testFailure',
          testName: test.title, testId: test.id, file: test.location?.file,
          line: test.location?.line, column: test.location?.column,
          attempt: result.retry, repeatCount: test.repeatEachIndex, error }); } catch { /* Optional private evidence. */ }
      }
    }
    this.#emit('testEnd', {
      ...this.#case(test), retry: integer(result.retry), status: status(result.status),
      expectedStatus: status(test.expectedStatus), durationMs: integer(result.duration),
      errorCount,
      errorClass: result.status === 'timedOut' ? 'testTimeout'
        : errorCount > 0 ? 'testError' : 'none',
      electronLifecycle: projectElectronLifecycle(result),
      electronEvidenceFailures: projectElectronEvidenceFailures(result),
    });
  }

  onError(error) {
    try { this.#privateFailures.record({ runner: 'playwright', phase: 'runFailure', error }); } catch { /* Optional private evidence. */ }
    this.#globalErrors++;
    this.#emit('runError', { errorIndex: this.#globalErrors, errorClass: 'runError' });
  }

  onStdOut(chunk) { if (!this.#silent) this.#safeOutput(chunk); }
  onStdErr() {}

  onEnd(result) {
    const counts = { expected: 0, unexpected: 0, flaky: 0, skipped: 0, notRun: 0, unknown: 0 };
    for (const [test, identity] of this.#cases) {
      const value = test.outcome();
      const outcome = test.results.length === 0 ? 'notRun' : outcomes.has(value) ? value : 'unknown';
      counts[outcome]++;
      this.#emit('testOutcome', { ...identity, outcome, attempts: test.results.length });
    }
    this.#emit('end', {
      status: runStatuses.has(result.status) ? result.status : 'unknown', selected: this.#cases.size,
      globalErrors: this.#globalErrors, ...counts,
    });
    // Do not return a status override or mutate tests/results/errors.
    try { return this.#privateFailures.flush().then(() => undefined, () => undefined); }
    catch { /* Reporting never overrides the test result. */ }
  }
}
