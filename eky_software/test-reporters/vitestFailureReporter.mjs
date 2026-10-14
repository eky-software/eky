import { createRunnerFailureSink, RUNNER_FAILURE_LIMIT } from './runnerFailureEvidence.mjs';

export default class VitestFailureReporter {
  #sink = createRunnerFailureSink();

  onTestCaseResult(testCase) {
    const result = testCase.result();
    if (result.state === 'skipped' || (testCase.options.fails && result.state === 'passed')) return;
    const error = result.errors?.[0];
    if (!error) return;
    const diagnostic = testCase.diagnostic();
    this.#sink.record({ runner: 'vitest', phase: 'testFailure', testName: testCase.fullName,
      testId: testCase.id, file: testCase.module.moduleId, line: testCase.location?.line,
      column: testCase.location?.column, error, retryCount: diagnostic.retryCount,
      repeatCount: diagnostic.repeatCount,
      // Vitest aggregates retry errors; do not invent the attempt of its first error.
      attempt: diagnostic.retryCount === 0 && diagnostic.repeatCount === 0 ? 0 : undefined });
  }

  onTestSuiteResult(suite) { this.#recordSuite(suite, 'suiteFailure'); }
  onTestModuleEnd(module) { this.#recordSuite(module, 'moduleFailure'); }

  #recordSuite(suite, phase) {
    const error = suite.errors()[0];
    if (error) this.#sink.record({ runner: 'vitest', phase, testName: suite.fullName,
      testId: suite.id, file: suite.moduleId ?? suite.module.moduleId, error });
  }

  async onTestRunEnd(_modules, unhandledErrors) {
    for (const error of unhandledErrors.slice(0, RUNNER_FAILURE_LIMIT + 1)) {
      this.#sink.record({ runner: 'vitest', phase: 'unhandledFailure', error });
    }
    await this.#sink.flush();
  }
}
