import type { TestContext } from 'vitest';
import { createRunnerFailureSink } from './runnerFailureEvidence.mjs';

export function createHttpRequestFailureCapture(
  context: TestContext,
  sink?: ReturnType<typeof createRunnerFailureSink>,
): { captureOriginalException(error: unknown): void };
