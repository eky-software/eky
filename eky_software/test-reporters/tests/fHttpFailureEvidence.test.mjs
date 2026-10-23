import assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { F_ORIGINAL_MARKER, runFWorker, assertFOriginalProof } from './fHttpFailureFixture.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

test('F HTTP evidence preserves the first exception and expected outcomes', { timeout: 300_000 }, async () => {
  const parent = join(ROOT, '.eky-local', 'reporter-fixtures');
  await mkdir(parent, { recursive: true });
  const root = await realpath(await mkdtemp(join(parent, 'f-http-')));
  const baseline = await runFWorker(root, 'without-observation', { observe: false });
  assert.equal(baseline.child.status, 1);
  assert.equal(JSON.stringify(baseline.records).includes(F_ORIGINAL_MARKER), false, 'F_CONTROL_RETAINED_ORIGINAL');
  assertFOriginalProof(await runFWorker(root, 'with-observation'));
  assertFOriginalProof(await runFWorker(root, 'unbuilt-workspace', { rejectWorkspacePackageExports: true }));
  assertFOriginalProof(await runFWorker(root, 'non-error', { mode: 'non-error' }), undefined, { nonError: true });
  const brokenObserver = await runFWorker(root, 'broken-observer', { mode: 'capture-throws' });
  assert.equal(brokenObserver.child.status, 1);
  assert.equal(brokenObserver.records.some(({ record }) => record.phase === 'httpHandlerCatch'), false);
  for (const mode of ['expected-rejection', 'expected-failure', 'success']) {
    const passing = await runFWorker(root, mode, { mode });
    assert.equal(passing.child.status, 0, 'F_EXPECTED_OUTCOME_CHANGED');
    assert.equal(passing.records.length, 0, 'F_PASSING_TEST_EMITTED_FAILURE_EVIDENCE');
  }
  const unavailable = await runFWorker(root, 'missing-storage', { missingStorage: true });
  assert.equal(unavailable.child.status, 1);
  assert.equal(unavailable.records.some(({ record }) => record.phase === 'httpHandlerCatch'), false);
  assert.equal(unavailable.publicOutput.includes('EKY_TEST_FAILURE_EVIDENCE_PARTIAL'), true, 'F_MISSING_STORAGE_NOT_REPORTED');
});
