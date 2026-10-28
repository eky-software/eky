export const RUNNER_FAILURE_DELIVERY_TIMEOUT_MS: number;

export function createRunnerFailureSink(options?: {
  env?: NodeJS.ProcessEnv;
  tempRoot?: string;
  secrets?: string[];
}): {
  record(input: {
    runner: 'node' | 'vitest' | 'playwright';
    phase: string;
    error: unknown;
    projectedException?: ReturnType<typeof import('../apps/desktop/src/main/startupExceptionEvidence.js').projectExceptionChain>;
    testName?: string;
    testId?: string;
    file?: string;
    line?: number;
    column?: number;
    attempt?: number;
    retryCount?: number;
    repeatCount?: number;
  }): void;
  flush(): Promise<unknown>;
};
