import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyCiRisk, CI_GATES } from './ciRiskPolicy.mjs';
import { evaluateCiAcceptance } from './ciAcceptanceResult.mjs';

const plan = (file) => classifyCiRisk({ eventName: 'pull_request', ref: 'refs/pull/1/merge',
  changedPaths: [file], comparisonComplete: true });
const full = plan('unknown');
const fast = plan('eky_software/apps/web/src/app.css');
const successful = (value) => ({ classification: 'success',
  ...Object.fromEntries(CI_GATES.map((gate) => [gate, value.gates[gate] ? 'success' : 'skipped'])),
});

test('all selected gates succeed and only deliberately unselected gates may be skipped', () => {
  for (const value of [fast, full]) assert.equal(evaluateCiAcceptance(value, successful(value)).status, 'completed');
  assert.equal(evaluateCiAcceptance(fast, successful(full)).status, 'completed');
});

for (const status of ['failure', 'cancelled', 'skipped']) {
  test(`every selected gate rejects ${status}`, () => {
    for (const gate of CI_GATES) {
      const result = evaluateCiAcceptance(full, { ...successful(full), [gate]: status });
      assert.equal(result.status, 'failed');
      assert.deepEqual(result.failedGates, [gate]);
    }
  });
}

test('a failed or skipped classifier cannot yield green even when all tests passed', () => {
  for (const classification of ['failure', 'cancelled', 'skipped']) {
    assert.equal(evaluateCiAcceptance(full, { ...successful(full), classification }).resultCode, 'classificationNotSuccessful');
  }
});

test('missing, pending, unknown and extra job results cannot be accepted', () => {
  const missing = successful(full);
  delete missing.workspaceFault;
  for (const results of [missing, null, { ...successful(full), extra: 'success' },
    ...['pending', 'neutral', 'timed_out', '', true, null].map((verify) => ({ ...successful(full), verify }))]) {
    assert.equal(evaluateCiAcceptance(full, results).resultCode, 'jobResultsInvalid');
  }
});

test('an unexpected failed optional job is not hidden by its risk classification', () => {
  const result = evaluateCiAcceptance(fast, { ...successful(fast), legacyUpgrade: 'failure' });
  assert.equal(result.status, 'failed');
  assert.deepEqual(result.failedGates, ['legacyUpgrade']);
});

test('invalid plans fail before evaluation and evidence contains only closed gate names', () => {
  assert.equal(evaluateCiAcceptance({ ...full, extra: 'private' }, successful(full)).resultCode, 'riskPlanInvalid');
  const result = evaluateCiAcceptance(full, { ...successful(full), verify: 'failure', workspaceFault: 'cancelled' });
  assert.deepEqual(result, { schemaVersion: 1, status: 'failed', resultCode: 'requiredJobsNotSuccessful',
    failedGates: ['verify', 'workspaceFault'] });
});
