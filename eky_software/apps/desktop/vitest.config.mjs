import { availableParallelism } from 'node:os';

const MAX_DESKTOP_TEST_WORKERS = 4;

export function desktopTestWorkers(parallelism) {
  // Preserve Vitest's normal run-mode default on smaller machines.
  return Math.min(MAX_DESKTOP_TEST_WORKERS, Math.max(parallelism - 1, 1));
}

export default {
  test: {
    maxWorkers: desktopTestWorkers(availableParallelism()),
  },
};
