import assert from 'node:assert/strict';
import { join } from 'node:path';
import test from 'node:test';
import {
  readWindowsAcceptanceSupervisorResult,
  validateWindowsAcceptanceSupervisorResult,
} from '../windowsAcceptanceSupervisorResult.mjs';

const EXPECTED = Object.freeze({
  artifactDescriptorSha256: 'b'.repeat(64),
  runNonce: 'a'.repeat(64),
  scenario: 'jobObjectFeasibility',
  supervisorExitCode: 0,
});
const COMPLETED_RESULT = Object.freeze({
  schemaVersion: 1,
  runNonce: EXPECTED.runNonce,
  scenario: EXPECTED.scenario,
  artifactDescriptorSha256: EXPECTED.artifactDescriptorSha256,
  status: 'completed',
  processResultCode: 'processCompleted',
  workerResultCode: 'workerResultValidated',
  cleanupResultCode: 'notRequired',
  cleanupWin32ErrorCode: null,
  processTreeAbsent: true,
  processWin32ErrorCode: null,
  durationMs: 123,
  childExitCode: 0,
});

test('accepts an exact terminal result bound to the current run', () => {
  assert.deepEqual(
    validateWindowsAcceptanceSupervisorResult(COMPLETED_RESULT, EXPECTED),
    COMPLETED_RESULT,
  );
});

test('rejects a stale run nonce', () => {
  assert.throws(
    () =>
      validateWindowsAcceptanceSupervisorResult(
        { ...COMPLETED_RESULT, runNonce: 'c'.repeat(64) },
        EXPECTED,
      ),
    /WINDOWS_ACCEPTANCE_SUPERVISOR_RESULT_BINDING_INVALID/,
  );
});

test('rejects a wrong artifact descriptor digest', () => {
  assert.throws(
    () =>
      validateWindowsAcceptanceSupervisorResult(
        {
          ...COMPLETED_RESULT,
          artifactDescriptorSha256: 'c'.repeat(64),
        },
        EXPECTED,
      ),
    /WINDOWS_ACCEPTANCE_SUPERVISOR_RESULT_BINDING_INVALID/,
  );
});

test('rejects a missing terminal result', async () => {
  await assert.rejects(
    readWindowsAcceptanceSupervisorResult(
      join(process.cwd(), 'definitely-missing-supervisor-result.json'),
      EXPECTED,
    ),
    /WINDOWS_ACCEPTANCE_SUPERVISOR_TERMINAL_RESULT_MISSING/,
  );
});

test('rejects unknown result keys and inconsistent success', () => {
  assert.throws(
    () =>
      validateWindowsAcceptanceSupervisorResult(
        { ...COMPLETED_RESULT, extra: true },
        EXPECTED,
      ),
    /WINDOWS_ACCEPTANCE_SUPERVISOR_RESULT_SCHEMA_INVALID/,
  );
  assert.throws(
    () =>
      validateWindowsAcceptanceSupervisorResult(
        { ...COMPLETED_RESULT, processTreeAbsent: false },
        EXPECTED,
      ),
    /WINDOWS_ACCEPTANCE_SUPERVISOR_RESULT_OUTCOME_INVALID/,
  );
});
