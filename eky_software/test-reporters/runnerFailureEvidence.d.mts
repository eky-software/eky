export function createRunnerFailureSink(options?: {
  env?: NodeJS.ProcessEnv;
  tempRoot?: string;
  secrets?: string[];
}): {
  record(input: {
    runner: 'node' | 'vitest' | 'playwright';
    phase: string;
    error: unknown;
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
