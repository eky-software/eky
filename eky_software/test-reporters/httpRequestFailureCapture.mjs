import { createRunnerFailureSink } from './runnerFailureEvidence.mjs';

// Tests retain the first original value in memory until the runner declares failure.
export function createHttpRequestFailureCapture(context, sink = createRunnerFailureSink()) {
  let firstFailure;
  context.onTestFailed(async () => {
    const observed = firstFailure;
    firstFailure = undefined;
    if (observed === undefined || context.task.fails) return;
    try {
      const task = context.task;
      const retryCount = task.result?.retryCount ?? 0;
      const repeatCount = task.result?.repeatCount ?? 0;
      // Preserve a thrown string in the existing bounded message field, without inventing a stack.
      const error = typeof observed.error === 'string'
        ? { name: 'NonErrorThrow', message: observed.error }
        : observed.error;
      sink.record({
        runner: 'vitest', phase: 'httpHandlerCatch', error,
        testName: task.fullTestName, testId: task.id, file: task.file.filepath,
        line: task.location?.line, column: task.location?.column,
        retryCount, repeatCount,
        attempt: retryCount === 0 && repeatCount === 0 ? 0 : undefined,
      });
      await sink.flush();
    } catch { /* Evidence failure must not replace the assertion or cleanup. */ }
  });
  return {
    captureOriginalException(error) { firstFailure ??= { error }; },
  };
}
