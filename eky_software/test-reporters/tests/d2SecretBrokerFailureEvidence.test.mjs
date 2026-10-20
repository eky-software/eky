import assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { D2_ORIGINAL_MARKER, D2_FAILURE_PHASE, runD2Worker, assertOriginalProof } from './d2SecretBrokerFailureFixture.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

test('D2 broker evidence: no-native boundary, outcome and missing-storage proof', { timeout: 300_000 }, async () => {
  const parent = join(ROOT, '.eky-local', 'reporter-fixtures');
  await mkdir(parent, { recursive: true });
  // Retain first-failure evidence outside builds, following the existing reporter regressions.
  const root = await realpath(await mkdtemp(join(parent, 'd2-')));
  const baseline = await runD2Worker(root, 'without-observation', { observe: false });
  assert.equal(baseline.child.status, 1);
  assert.equal(baseline.records.some(({ record }) => record.phase === 'testFailure' &&
    record.exception.chain.some(part => part.message?.includes('D2_BROKER_EXPECTED_SUCCESS'))), true, 'D2_BASELINE_ASSERTION_MISSING');
  assert.equal(baseline.records.some(({ record }) => record.phase === D2_FAILURE_PHASE), false);
  assert.equal(JSON.stringify(baseline.records.map(({ record }) => record)).includes(D2_ORIGINAL_MARKER), false);
  const observed = await runD2Worker(root, 'with-observation');
  assertOriginalProof(observed);
  assert.equal(observed.child.status, baseline.child.status);
  const brokenPublicObserver = await runD2Worker(root, 'public-observer-throws', { mode: 'public-observer-throws' });
  assertOriginalProof(brokenPublicObserver);
  for (const mode of ['capture-throws', 'unregistered-source']) {
    const uncaptured = await runD2Worker(root, mode, { mode });
    assert.equal(uncaptured.child.status, baseline.child.status);
    assert.equal(uncaptured.records.some(({ record }) => record.phase === D2_FAILURE_PHASE), false);
    assert.equal(JSON.stringify(uncaptured.records.map(({ record }) => record)).includes(D2_ORIGINAL_MARKER), false);
    assert.equal(uncaptured.records.some(({ record }) => record.phase === 'testFailure' &&
      record.exception.chain.some(part => part.message?.includes('D2_BROKER_EXPECTED_SUCCESS'))), true, 'D2_OBSERVER_CHANGED_OUTCOME');
  }
  for (const mode of ['expected-rejection', 'expected-failure', 'success']) {
    const passing = await runD2Worker(root, mode, { mode });
    assert.equal(passing.child.status, 0, 'D2_EXPECTED_OR_SUCCESS_PATH_CHANGED');
    assert.equal(passing.records.length, 0, 'D2_PASSING_TEST_EMITTED_FAILURE_EVIDENCE');
  }
  const unavailable = await runD2Worker(root, 'missing-storage', { missingStorage: true });
  assert.equal(unavailable.child.status, baseline.child.status);
  assert.equal(unavailable.records.some(({ record }) => record.phase === D2_FAILURE_PHASE), false);
  assert.equal(unavailable.publicOutput.includes('EKY_TEST_FAILURE_EVIDENCE_PARTIAL'), true);
  assert.equal(unavailable.records.some(({ record }) => record.phase === 'testFailure' &&
    record.exception.chain.some(part => part.message?.includes('D2_BROKER_EXPECTED_SUCCESS'))), true, 'D2_CAPTURE_FAILURE_MASKED_ASSERTION');
});
