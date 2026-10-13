import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRunnerFailureSink } from '../../../../test-reporters/runnerFailureEvidence.mjs';

// Only the actual worker or command phase records failures. Unit tests exercising expected
// rejection branches report their own unexpected failures through the test runner.
export function createNativeFailureEvidence(entrypointUrl, request) {
  const enabled = process.argv[1] !== undefined &&
    pathToFileURL(resolve(process.argv[1])).href === entrypointUrl;
  const sink = enabled ? createRunnerFailureSink() : undefined;
  const observe = (error, phase) => {
    try { sink?.record({ runner: 'native', phase, testName: request.scenario,
      testId: request.runNonce, error }); } catch { /* Preserve the scenario result. */ }
  };
  return Object.assign(observe, { async finish() {
    try { await sink?.flush(); } catch { /* Preserve the scenario result. */ }
  } });
}
