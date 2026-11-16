import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { gunzipSync } from 'node:zlib';
import { collectJobFailureEvidence, evidenceSourceKind } from './ciFailureEvidence.mjs';
import { encryptArchive } from './workspaceEncryptedEvidence.mjs';
import { createOpenPgpTestFixture } from './openPgpTestFixture.mjs';
import { MSI_RESOURCE_TIMING_MAX_BYTES, msiResourceTimingBinding, msiResourceTimingSource,
  publishMsiResourceTimingReport, validateMsiResourceTimingReport } from './msiResourceTimingEvidence.mjs';

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const request = { runNonce: 'b'.repeat(64), scenario: 'packagedWorkspaceSuccess', artifactDescriptorSha256: 'c'.repeat(64) };
function environment(patch = {}) {
  return { GITHUB_ACTIONS: 'true', GITHUB_EVENT_NAME: 'workflow_dispatch', RUNNER_OS: 'Windows',
    RUNNER_ENVIRONMENT: 'github-hosted', GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '1',
    GITHUB_JOB: 'job-object-feasibility', EKY_EVIDENCE_JOB_KEY: 'supervisor-contracts-0', GITHUB_SHA: 'a'.repeat(40),
    EKY_MSI_RESOURCE_TIMING_PROOF: '1', EKY_MSI_RESOURCE_TIMING_REPETITION: '1', EKY_EVIDENCE_JOB_OUTCOME: 'success',
    EKY_DIAGNOSTIC_PUBLIC_KEY: '-----BEGIN PGP PUBLIC KEY BLOCK-----\nTEST\n-----END PGP PUBLIC KEY BLOCK-----',
    EKY_DIAGNOSTIC_KEY_FINGERPRINT: 'A'.repeat(40), EKY_DIAGNOSTIC_VERIFIED_FINGERPRINT: 'A'.repeat(40), ...patch };
}
function native() {
  const empty = { captureEntryMs: null, afterQueryMs: null, captureReturnMs: null, entryState: null,
    afterQueryState: null, returnState: null, queryStatus: null, queryPhase: null, nativeCode: null,
    endSessionCode: null, holderPresent: null, holderLiveOwned: null };
  return { schemaVersion: 1, checks: { bothTreesAbsent: true, bytesPreservedA: true, bytesPreservedB: true, bytesPreservedC: true,
    timingBulkBytesPreserved: true },
    timing: { releaseDelayMs: 150, resourceCount: 2550, positiveControl: true, arms: [
      { kind: 'withoutQuery', ...empty, releaseRequestedMs: 151, exitObservedMs: 160, exitCode: 0, releaseSettled: true },
      { kind: 'withQuery', ...empty, releaseRequestedMs: 152, exitObservedMs: 200, exitCode: 0, releaseSettled: true,
        captureEntryMs: 0, afterQueryMs: 140, captureReturnMs: 180, entryState: 'live', afterQueryState: 'live',
        returnState: 'exited', queryStatus: 'observed', queryPhase: 'complete', nativeCode: 0, endSessionCode: 0,
        holderPresent: true, holderLiveOwned: false },
    ] } };
}
function report(patch = {}) {
  return { schemaVersion: 1, operation: 'msiResourceTimingExperiment', binding: msiResourceTimingBinding(environment()),
    ...request, timing: native().timing, cleanup: { nativeTreesAbsent: true, syntheticBytesPreserved: true,
      releaseThreadsSettled: true, outerRootCleanup: 'notInferred' }, ...patch };
}
const bytes = value => Buffer.from(JSON.stringify(value));
const validate = value => validateMsiResourceTimingReport(bytes(value), msiResourceTimingBinding(environment()));

async function fixture(t) {
  const directory = join(ROOT, '.eky-local');
  await mkdir(directory, { recursive: true });
  const root = await mkdtemp(join(directory, 'msi-timing-test-'));
  let complete = false;
  t.after(async () => { if (complete) await rm(root, { recursive: true }); });
  const temp = join(root, 'temporary');
  const checkout = join(root, 'checkout');
  await mkdir(temp); await mkdir(checkout);
  const env = environment({ RUNNER_TEMP: temp, GITHUB_WORKSPACE: checkout });
  return { root, temp, checkout, env, complete() { complete = true; } };
}

test('RM timing binding is opt-in and limited to the two actual hosted contract repetitions', () => {
  for (const index of [0, 1]) {
    const binding = msiResourceTimingBinding(environment({ EKY_EVIDENCE_JOB_KEY: `supervisor-contracts-${index}`,
      EKY_MSI_RESOURCE_TIMING_REPETITION: String(index + 1) }));
    assert.equal(binding.repetition, index + 1);
    assert.equal(evidenceSourceKind('temporary', msiResourceTimingSource(binding)), 'msiResourceTiming');
  }
  for (const patch of [{ EKY_MSI_RESOURCE_TIMING_PROOF: '' }, { EKY_MSI_RESOURCE_TIMING_PROOF: 'true' },
    { GITHUB_ACTIONS: 'false' }, { GITHUB_EVENT_NAME: 'pull_request' }, { RUNNER_OS: 'Linux' },
    { RUNNER_ENVIRONMENT: 'self-hosted' }, { GITHUB_JOB: 'another-job' }, { EKY_EVIDENCE_JOB_KEY: 'supervisor-contracts-2' },
    { EKY_MSI_RESOURCE_TIMING_REPETITION: '2' }, { GITHUB_SHA: 'a'.repeat(39) }, { GITHUB_RUN_ID: '0' },
    { GITHUB_RUN_ATTEMPT: '0' }]) assert.throws(() => msiResourceTimingBinding(environment(patch)), /MSI_RESOURCE_TIMING_EVIDENCE_INVALID/);
});

test('RM timing schema accepts late, empty and incomplete queries without inventing a latency SLA', () => {
  assert.deepEqual(validate(report()), report());
  for (const queryStatus of ['limited', 'unavailable', 'cancelled']) {
    const value = report();
    Object.assign(value.timing.arms[1], { queryStatus, queryPhase: 'selection', afterQueryMs: null,
      afterQueryState: null, holderPresent: false, holderLiveOwned: false, nativeCode: null, endSessionCode: null,
      captureReturnMs: 11_000, returnState: 'exited' });
    assert.equal(validate(value).timing.arms[1].queryStatus, queryStatus);
  }
  const empty = report();
  Object.assign(empty.timing.arms[1], { afterQueryMs: 400, captureReturnMs: 500, afterQueryState: 'exited',
    holderPresent: false, holderLiveOwned: false });
  assert.equal(validate(empty).timing.arms[1].holderPresent, false);
});

test('RM timing schema rejects extra raw fields, missing values, invalid ordering and forged bindings', () => {
  for (const key of Object.keys(report())) { const value = report(); delete value[key]; assert.throws(() => validate(value)); }
  for (const scope of ['root', 'binding', 'timing', 'arm', 'cleanup']) {
    const value = report();
    const target = scope === 'root' ? value : scope === 'arm' ? value.timing.arms[1] : value[scope];
    target.rawPath = 'EXCLUDED';
    assert.throws(() => validate(value));
  }
  for (const key of Object.keys(report().timing.arms[1])) {
    const value = report(); delete value.timing.arms[1][key]; assert.throws(() => validate(value));
  }
  for (const patch of [{ releaseRequestedMs: 149 }, { exitObservedMs: 100 }, { captureReturnMs: -1 },
    { afterQueryMs: 200 }, { holderLiveOwned: true, holderPresent: false }, { nativeCode: 1 },
    { queryStatus: 'raw' }, { captureEntryMs: '0' }, { afterQueryState: 'raw' }, { exitCode: -1 }]) {
    const value = report(); Object.assign(value.timing.arms[1], patch); assert.throws(() => validate(value));
  }
  for (const key of Object.keys(report().binding)) {
    const value = report(); value.binding[key] = 'wrong'; assert.throws(() => validate(value));
  }
  for (const key of ['runNonce', 'artifactDescriptorSha256']) {
    const value = report(); value[key] = [value[key]]; assert.throws(() => validate(value));
    const newline = report(); newline[key] += '\n'; assert.throws(() => validate(newline));
  }
  assert.throws(() => validateMsiResourceTimingReport(Buffer.from('{"schemaVersion":1,"schemaVersion":1}'), report().binding));
  assert.throws(() => validateMsiResourceTimingReport(Buffer.alloc(MSI_RESOURCE_TIMING_MAX_BYTES + 1, 32), report().binding));
  const bounded = bytes(report());
  assert.deepEqual(validateMsiResourceTimingReport(Buffer.concat([bounded,
    Buffer.alloc(MSI_RESOURCE_TIMING_MAX_BYTES - bounded.length, 32)]), report().binding), report());
  assert.throws(() => validateMsiResourceTimingReport(bytes(report()), report().binding, '../msi-resource-contract.json'));
});

test('RM success collector takes exactly one projected report before original fixture removal and no other successful data', async t => {
  const f = await fixture(t);
  const original = join(f.root, 'original-fixture'); await mkdir(original);
  const nativePath = join(original, 'msi-resource-contract.json'); await writeFile(nativePath, bytes(native()));
  const preserved = await publishMsiResourceTimingReport(f.env, request, JSON.parse(await readFile(nativePath, 'utf8')));
  await rm(original, { recursive: true });
  assert.ok(preserved.bytes <= MSI_RESOURCE_TIMING_MAX_BYTES);
  await assert.rejects(publishMsiResourceTimingReport(f.env, request, native()));
  const extra = join(f.temp, 'eky supervisor other'); await mkdir(extra);
  await writeFile(join(extra, 'result.json'), 'EXCLUDED GENERAL SUCCESS DATA');
  const collected = await collectJobFailureEvidence(f.env);
  assert.equal(collected.manifest.scope, 'msiResourceTimingExperiment');
  assert.equal(collected.manifest.jobOutcome, 'success');
  assert.equal(collected.manifest.files.length, 1);
  assert.equal(collected.manifest.files[0].status, 'retained');
  const archive = JSON.parse(gunzipSync(await readFile(collected.archivePath)));
  assert.deepEqual(JSON.parse(Buffer.from(archive.files['0000.private'], 'base64')), report());
  assert.equal(JSON.stringify(archive).includes('EXCLUDED'), false);
  assert.equal(archive.manifest.cleanup, 'notInferred');
  f.complete();
});

test('RM success delivery rejects missing, changed, overlarge and linked reports rather than falling back', async t => {
  const f = await fixture(t);
  await assert.rejects(collectJobFailureEvidence(f.env));
  await assert.rejects(collectJobFailureEvidence({ ...f.env, EKY_MSI_RESOURCE_TIMING_PROOF: '' }));
  await publishMsiResourceTimingReport(f.env, request, native());
  const path = join(f.temp, msiResourceTimingSource(report().binding));
  const content = await readFile(path);
  const invalid = report({ rawPath: 'EXCLUDED UNAPPROVED CONTENT' });
  await writeFile(path, bytes(invalid));
  const rejected = await collectJobFailureEvidence({ ...f.env, EKY_EVIDENCE_JOB_OUTCOME: 'failure' });
  const rejectedArchive = JSON.parse(gunzipSync(await readFile(rejected.archivePath)));
  assert.equal(rejected.manifest.files[0].status, 'unverified');
  assert.deepEqual(Object.keys(rejectedArchive.files), []);
  assert.equal(JSON.stringify(rejectedArchive).includes('EXCLUDED UNAPPROVED CONTENT'), false);
  for (const value of [bytes(report({ runNonce: 'invalid' })), bytes(report({ binding: { ...report().binding, attempt: '2' } })),
    Buffer.alloc(MSI_RESOURCE_TIMING_MAX_BYTES + 1, 32)]) {
    await writeFile(path, value); await assert.rejects(collectJobFailureEvidence(f.env));
  }
  await rm(path);
  const external = join(f.root, 'foreign.json'); await writeFile(external, content);
  await symlink(external, path, 'file'); await assert.rejects(collectJobFailureEvidence(f.env));
  await rm(path); await writeFile(path, content);
  const failed = await collectJobFailureEvidence({ ...f.env, EKY_EVIDENCE_JOB_OUTCOME: 'failure' });
  assert.equal(failed.manifest.scope, 'ciFailureEvidence');
  assert.equal(failed.manifest.files.filter(value => value.kind === 'msiResourceTiming' && value.status === 'retained').length, 1);
  f.complete();
});

test('RM success restriction preserves the existing named MSI policy success report only in its original hosted context', async t => {
  const f = await fixture(t);
  const directory = join(f.temp, 'eky supervisor policy'); await mkdir(directory);
  await writeFile(join(directory, 'policy-result.json'), '{"result":{"status":"passed","cleanupStatus":"completed"}}');
  const env = { ...f.env, EKY_MSI_RESOURCE_TIMING_PROOF: '', GITHUB_JOB: 'msi-file-version-policy',
    EKY_EVIDENCE_JOB_KEY: 'msi-policy-0' };
  const collected = await collectJobFailureEvidence(env);
  assert.equal(collected.manifest.scope, 'ciFailureEvidence');
  assert.equal(collected.manifest.jobOutcome, 'success');
  assert.equal(collected.manifest.files.length, 1);
  assert.equal(collected.manifest.files[0].kind, 'msiPolicyEvidence');
  assert.equal(collected.manifest.files[0].status, 'retained');
  for (const patch of [{ GITHUB_JOB: 'another-job' }, { EKY_EVIDENCE_JOB_KEY: 'msi-policy-1' },
    { GITHUB_EVENT_NAME: 'pull_request' }, { RUNNER_ENVIRONMENT: 'self-hosted' }, { RUNNER_OS: 'Linux' }])
    await assert.rejects(collectJobFailureEvidence({ ...env, ...patch }));
  f.complete();
});

test('RM timing projection survives real existing OpenPGP encryption and byte-exact decryption', { timeout: 120_000 }, async t => {
  const f = await fixture(t);
  const crypto = await createOpenPgpTestFixture(ROOT);
  let completed = false;
  let firstFailure;
  try {
    const recipient = await crypto.generate('recipient');
    await crypto.invokeGpg(recipient.home, ['--pinentry-mode', 'loopback', '--passphrase', '',
      '--quick-add-key', recipient.fingerprint, 'cv25519', 'encr', '1d']);
    const publicPath = await crypto.exportKey(recipient, 'public.asc');
    const env = { ...f.env, EKY_DIAGNOSTIC_PUBLIC_KEY: await readFile(publicPath, 'utf8'),
      EKY_DIAGNOSTIC_KEY_FINGERPRINT: recipient.fingerprint, EKY_DIAGNOSTIC_VERIFIED_FINGERPRINT: recipient.fingerprint };
    await publishMsiResourceTimingReport(env, request, native());
    const expected = await readFile(join(f.temp, msiResourceTimingSource(report().binding)));
    const collected = await collectJobFailureEvidence(env);
    await encryptArchive(collected.root, collected);
    const decrypted = await crypto.invokeGpg(recipient.home, ['--decrypt', join(collected.root, 'evidence.json.gz.gpg')]);
    const archive = JSON.parse(gunzipSync(decrypted.stdout));
    assert.equal(archive.manifest.files.length, 1);
    const retained = Buffer.from(archive.files[archive.manifest.files[0].name], 'base64');
    assert.deepEqual(retained, expected);
    assert.deepEqual(validateMsiResourceTimingReport(retained, msiResourceTimingBinding(env)), report());
    completed = true; f.complete();
  } catch (error) { firstFailure = error; throw error; }
  finally {
    try { await crypto.finish({ completed, failed: !completed }); }
    catch (error) {
      if (!firstFailure) throw error;
      t.diagnostic('RM_TIMING_CRYPTO_CLEANUP_UNVERIFIED');
    }
  }
});
