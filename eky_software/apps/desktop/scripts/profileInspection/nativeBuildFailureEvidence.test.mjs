import assert from 'node:assert/strict';
import { link, lstat, mkdir, mkdtemp, open, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { inspectionNativeFailureMaximumBytes, readInspectionNativeBuildFailure,
  validateNativePreparationEvidence, windowsNativeCompilationBinding } from './nativeBuildFailureEvidence.mjs';

const env = { GITHUB_ACTIONS: 'true', RUNNER_OS: 'Windows', RUNNER_ENVIRONMENT: 'github-hosted',
  GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_JOB: 'e2e-electron-windows-critical',
  EKY_EVIDENCE_JOB_KEY: 'core-electron-0', GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '1', GITHUB_SHA: 'a'.repeat(40) };
const invocationId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const binding = windowsNativeCompilationBinding(env, 'win32');
const recordFor = evidence => ({ schemaVersion: 1, operation: 'electronE2ePreparation', status: 'failed',
  phase: 'nativeCompilation', causeCode: 'PROFILE_INSPECTION_NATIVE_BUILD_FAILED',
  invocationId, binding, nativeCompilationEvidence: evidence });
async function fixture(t, bytes) {
  const root = await mkdtemp(join(await realpath(tmpdir()), 'eky-native-build-evidence-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const identity = await lstat(root, { bigint: true });
  const work = join(root, 'inspection-native-ABC123');
  await mkdir(work, { mode: 0o700 });
  const path = join(work, 'build.private.log');
  if (bytes) await writeFile(path, bytes, { flag: 'wx', mode: 0o600 });
  return { root, identity, path, work };
}

for (const size of [1, inspectionNativeFailureMaximumBytes, inspectionNativeFailureMaximumBytes + 41]) {
  test(`native preparation retains the bounded start/end of ${size} bytes`, async t => {
    const bytes = Buffer.alloc(size, 65);
    bytes[size - 1] = 90;
    const f = await fixture(t, bytes);
    const evidence = await readInspectionNativeBuildFailure(f.root, f.identity);
    validateNativePreparationEvidence(recordFor(evidence), binding, invocationId);
    assert.equal(evidence.status, 'retained');
    assert.equal(evidence.retainedBytes, Math.min(size, inspectionNativeFailureMaximumBytes));
    assert.equal(evidence.complete, size <= inspectionNativeFailureMaximumBytes);
    const prefix = Buffer.from(evidence.prefixBase64, 'base64');
    const suffix = Buffer.from(evidence.suffixBase64, 'base64');
    assert.deepEqual(prefix, bytes.subarray(0, prefix.length));
    assert.deepEqual(suffix, suffix.length ? bytes.subarray(size - suffix.length) : Buffer.alloc(0));
    assert.deepEqual(await readFile(f.path), bytes);
  });
}

for (const variant of ['missing', 'identity', 'extraAttempt', 'hardlink', 'changedDuringRead']) {
  test(`native evidence rejects ${variant} without following another attempt`, async t => {
    const f = await fixture(t, variant === 'missing' ? null : Buffer.from('synthetic compiler original'));
    let identity = f.identity;
    if (variant === 'identity') identity = { dev: identity.dev, ino: identity.ino + 1n };
    if (variant === 'extraAttempt') await mkdir(join(f.root, 'inspection-native-DEF456'), { mode: 0o700 });
    if (variant === 'hardlink') await link(f.path, join(f.work, 'alias.private'));
    if (variant === 'changedDuringRead') {
      const probe = await open(f.path, 'r');
      const prototype = Object.getPrototypeOf(probe);
      const originalRead = prototype.read;
      await probe.close();
      t.mock.method(prototype, 'read', async function (...args) {
        const result = await originalRead.apply(this, args);
        await writeFile(f.path, 'changed synthetic compiler output');
        return result;
      });
    }
    assert.deepEqual(await readInspectionNativeBuildFailure(f.root, identity), {
      status: variant === 'missing' ? 'missing' : 'unverified' });
  });
}

test('only the exact hosted Windows preparation context grants compilation evidence', () => {
  assert.deepEqual(binding, { runId: '123', attempt: '1', job: env.GITHUB_JOB,
    jobKey: env.EKY_EVIDENCE_JOB_KEY, sourceRevision: env.GITHUB_SHA });
  for (const patch of [{ GITHUB_ACTIONS: 'false' }, { RUNNER_OS: 'Linux' }, { RUNNER_ENVIRONMENT: 'self-hosted' },
    { GITHUB_EVENT_NAME: 'pull_request_target' }, { GITHUB_JOB: 'other' }, { EKY_EVIDENCE_JOB_KEY: 'other' },
    { GITHUB_RUN_ID: '0' }, { GITHUB_RUN_ATTEMPT: '' }, { GITHUB_SHA: 'not a revision' }]) {
    assert.equal(windowsNativeCompilationBinding({ ...env, ...patch }, 'win32'), null);
  }
  assert.equal(windowsNativeCompilationBinding(env, 'linux'), null);
  const beforeCollectorStep = { ...env };
  delete beforeCollectorStep.EKY_EVIDENCE_JOB_KEY;
  assert.deepEqual(windowsNativeCompilationBinding(beforeCollectorStep, 'win32'), binding);
});

test('prepared receipt rejects mismatched binding, generation, sizes and additional raw fields', () => {
  const record = recordFor({ status: 'retained', complete: true, sourceBytes: 1, retainedBytes: 1,
    prefixBase64: 'QQ==', suffixBase64: '' });
  assert.equal(validateNativePreparationEvidence(record, binding, invocationId), record);
  for (const patch of [{ invocationId: 'bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee' }, { extra: 'EXCLUDED' },
    { status: 'completed' }, { phase: 'other' }, { binding: { ...binding, attempt: '2' } },
    { nativeCompilationEvidence: { ...record.nativeCompilationEvidence, retainedBytes: 2 } },
    { nativeCompilationEvidence: { ...record.nativeCompilationEvidence, prefixBase64: 'QQ' } },
    { nativeCompilationEvidence: { status: 'missing', rawOutput: 'EXCLUDED' } }]) {
    assert.throws(() => validateNativePreparationEvidence({ ...record, ...patch }, binding, invocationId),
      /INSPECTION_NATIVE_EVIDENCE_UNVERIFIED/u);
  }
});
