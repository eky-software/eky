import { randomUUID } from 'node:crypto';

export const E2E_RUN_ARTIFACTS_ENV = 'EKY_E2E_RUN_ARTIFACTS';
const markerVersion = '1';
const markerPattern = /^1:([1-9][0-9]{0,15}):(run-[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})$/u;
let rootRunId;

function rejectWorkerMarker() {
  const error = new Error('EKY_E2E_RUN_ARTIFACTS_INVALID');
  error.stack = 'Error: EKY_E2E_RUN_ARTIFACTS_INVALID';
  throw error;
}

function isWorkerIndex(value) {
  return typeof value === 'string' && value.length <= 16
    && /^(?:0|[1-9][0-9]*)$/u.test(value)
    && String(Number(value)) === value && Number.isSafeInteger(Number(value));
}

function readWorkerRunId() {
  const marker = process.env[E2E_RUN_ARTIFACTS_ENV];
  const match = typeof marker === 'string' && marker.length <= 59
    ? markerPattern.exec(marker) : null;
  if (!isWorkerIndex(process.env.TEST_WORKER_INDEX)
    || !isWorkerIndex(process.env.TEST_PARALLEL_INDEX)
    || !match || match[0] !== marker
    || !Number.isSafeInteger(Number(match[1])) || Number(match[1]) !== process.ppid) {
    rejectWorkerMarker();
  }
  return match[2];
}

// Config-time selection only: Playwright owns directory creation and cleanup.
// Its documented worker indexes exist before config evaluation in the pinned runner.
export function getE2eRunArtifacts() {
  let runId;
  if (process.env.TEST_WORKER_INDEX !== undefined || process.env.TEST_PARALLEL_INDEX !== undefined) {
    runId = readWorkerRunId();
  } else {
    // Never adopt an inherited marker in a new CLI process, even a valid one.
    rootRunId ??= `run-${randomUUID()}`;
    runId = rootRunId;
    process.env[E2E_RUN_ARTIFACTS_ENV] = `${markerVersion}:${process.pid}:${runId}`;
  }
  return Object.freeze({
    runId,
    outputDir: `test-results/${runId}`,
    htmlOutputFolder: `playwright-report/${runId}`,
  });
}
