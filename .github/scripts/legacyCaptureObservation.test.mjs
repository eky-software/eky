import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { readLegacyCaptureEnvironment, summarizeLegacyCapture } from './legacyCaptureObservation.mjs';

const success = Object.freeze({ enabled: true, testOutcome: 'success', artifactOutcome: 'success',
  startOutcome: 'success', stopOutcome: 'success', analysisOutcome: 'success' });

test('optional capture failures preserve test and artifact outcomes independently', () => {
  for (const testOutcome of ['success', 'failure', 'cancelled', 'unknown']) {
    for (const artifactOutcome of ['success', 'failure', 'skipped', 'unknown']) {
      for (const [fault, captureResult] of [
        [{ startOutcome: 'failure', analysisOutcome: 'skipped' }, 'startUnverified'],
        [{ stopOutcome: 'cancelled', analysisOutcome: 'skipped' }, 'stopUnverified'],
        [{ analysisOutcome: 'failure' }, 'analysisUnverified'],
        [{ analysisOutcome: 'unknown' }, 'analysisUnverified'],
        [{}, 'collected'],
      ]) {
        const input = { ...success, ...fault, testOutcome, artifactOutcome };
        const before = { ...input };
        const result = summarizeLegacyCapture(input);
        assert.equal(result.testOutcome, testOutcome);
        assert.equal(result.artifactOutcome, artifactOutcome);
        assert.equal(result.captureResult, captureResult);
        assert.deepEqual(input, before);
        assert.deepEqual(Object.keys(result), ['schemaVersion', 'operation', 'enabled', 'testOutcome',
          'artifactOutcome', 'startOutcome', 'stopOutcome', 'analysisOutcome', 'captureResult']);
        assert.equal(Object.hasOwn(result, 'processTreeAbsent'), false);
        assert.equal(Object.hasOwn(result, 'cleanupResult'), false);
      }
    }
  }
});

test('disabled capture and missing evidence never claim successful collection', () => {
  assert.equal(summarizeLegacyCapture({ ...success, enabled: false, startOutcome: 'skipped',
    stopOutcome: 'skipped', analysisOutcome: 'skipped' }).captureResult, 'disabled');
  assert.equal(summarizeLegacyCapture({ ...success, enabled: false }).captureResult, 'unexpectedCapture');
  const missing = readLegacyCaptureEnvironment({ LEGACY_CAPTURE_ENABLED: 'true' });
  assert.equal(missing.testOutcome, 'unknown');
  assert.equal(missing.stopOutcome, 'unknown');
  assert.equal(missing.captureResult, 'startUnverified');
  assert.throws(() => summarizeLegacyCapture({ ...success, extra: 'private' }), /LEGACY_CAPTURE_OBSERVATION_INVALID/);
  assert.throws(() => summarizeLegacyCapture({ ...success, startOutcome: 'private' }), /LEGACY_CAPTURE_OBSERVATION_INVALID/);
});

test('the reporting command exits after a failed test and capture without publishing private input', () => {
  const script = fileURLToPath(new URL('./legacyCaptureObservation.mjs', import.meta.url));
  const env = { ...process.env, LEGACY_CAPTURE_ENABLED: 'true', LEGACY_TEST_OUTCOME: 'failure',
    LEGACY_ARTIFACT_OUTCOME: 'success', LEGACY_CAPTURE_START_OUTCOME: 'success',
    LEGACY_CAPTURE_STOP_OUTCOME: 'success', LEGACY_CAPTURE_ANALYSIS_OUTCOME: 'failure',
    UNRELATED_PRIVATE_VALUE: 'must-not-be-published' };
  const result = spawnSync(process.execPath, [script], { env, encoding: 'utf8', timeout: 15_000 });
  assert.equal(result.error, undefined);
  assert.equal(result.signal, null);
  assert.equal(result.status, 0);
  const summary = JSON.parse(result.stdout);
  assert.equal(summary.testOutcome, 'failure');
  assert.equal(summary.analysisOutcome, 'failure');
  assert.equal(summary.captureResult, 'analysisUnverified');
  assert.equal(result.stderr, '');
  assert.doesNotMatch(result.stdout, /must-not-be-published|UNRELATED_PRIVATE_VALUE/);
  const invalid = spawnSync(process.execPath, [script], { env: { ...env, LEGACY_CAPTURE_STOP_OUTCOME: 'private-input' },
    encoding: 'utf8', timeout: 15_000 });
  assert.equal(invalid.error, undefined);
  assert.equal(invalid.signal, null);
  assert.equal(invalid.status, 1);
  assert.equal(invalid.stdout, '');
  assert.equal(invalid.stderr, 'LEGACY_CAPTURE_OBSERVATION_INVALID\n');
});
