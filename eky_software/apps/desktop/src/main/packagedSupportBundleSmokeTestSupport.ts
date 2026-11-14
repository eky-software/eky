import type { TestContext } from 'vitest';

import { createRunnerFailureSink } from '../../../../test-reporters/runnerFailureEvidence.mjs';

export function createSupportBundleSmokeFailureCapture(
  context: TestContext,
  sink?: ReturnType<typeof createRunnerFailureSink>,
): (error: unknown) => void {
  const observedFailures: unknown[] = [];
  context.onTestFailed(async () => {
    if (observedFailures.length === 0 || context.task.fails) return;
    try {
      const selectedSink = sink ?? createRunnerFailureSink();
      const task = context.task;
      const retryCount = task.result?.retryCount ?? 0, repeatCount = task.result?.repeatCount ?? 0;
      for (const [index, error] of observedFailures.entries()) {
        selectedSink.record({ runner: 'vitest', phase: index === 0 ? 'supportBundleSmokeCatch' : 'supportBundleSmokeCleanupCatch', error,
          testName: task.fullTestName, testId: task.id, file: task.file.filepath,
          ...(task.location === undefined ? {} : { line: task.location.line, column: task.location.column }),
          ...(retryCount === 0 && repeatCount === 0 ? { attempt: 0 } : {}), retryCount, repeatCount });
      }
      await selectedSink.flush();
    } catch { /* Private evidence must not replace the test's failure. */ }
  });
  return error => { if (observedFailures.length < 2) observedFailures.push(error); };
}
