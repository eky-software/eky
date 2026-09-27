import type { ReporterDescription } from '@playwright/test';

export function createE2eReporters(
  env?: Record<string, string | undefined>,
  argv?: string[],
): ReporterDescription[];
