import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

import { projectExceptionChain, STARTUP_EXCEPTION_LIMITS } from '../../apps/desktop/src/main/startupExceptionEvidence.ts';
import { captureWorkspaceDeletionFailure, selectWorkspaceDeletionPhaseObservation } from '../../apps/e2e/src/fixtures/captureWorkspaceDeletionFailure.ts';
import { createWorkspaceDeletionRawPhaseRecorder, WORKSPACE_DELETION_MAIN_PHASE_COVERAGE } from '../../apps/desktop/e2e/workspaceDeletionPhaseObservation.ts';
import { runElectronWorkspaceAdoptionAcceptanceProof, runElectronWorkspaceOriginalInspectionProof } from '../../apps/e2e/src/electron/electronMainCapabilities.ts';
import { createRunnerFailureSink, RUNNER_FAILURE_ROOT_PREFIX, validateRunnerFailureEvidence } from '../runnerFailureEvidence.mjs';
import { collectJobFailureEvidence } from '../../apps/desktop/installer/windows-acceptance-harness/ciFailureEvidence.mjs';
import { encryptArchive } from '../../apps/desktop/installer/windows-acceptance-harness/workspaceEncryptedEvidence.mjs';
import { createOpenPgpTestFixture } from '../../apps/desktop/installer/windows-acceptance-harness/openPgpTestFixture.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const publicationRootIdentity = '33333333-3333-4333-8333-333333333333';

test('publication fixture identity survives a synthetic secret-word collision', () => {
  const oldId = 'synthetic-task:w74-c-synthetic-root';
  const oldProjection = projectExceptionChain({ message: oldId }, ['root']).chain[0].message;
  assert.equal(oldProjection.endsWith(':w74-c-synthetic-root'), false);
  assert.equal(oldProjection.includes('[redacted]'), true);
  const id = `synthetic-task:${publicationRootIdentity}`;
  const current = projectExceptionChain({ message: id }, ['root']).chain[0].message;
  assert.equal(current === id, true, 'PUBLICATION_FIXTURE_COLLIDES_WITH_SYNTHETIC_SECRET');
});

function publicationIdentityDiagnostic(matches) {
  const id = matches[0]?.test.id;
  return 'W74_PUBLICATION_IDENTITY_INVALID ' + JSON.stringify({
    matchCount: matches.length,
    idLength: typeof id === 'string' ? id.length : null,
    atLimit: typeof id === 'string' && id.length === STARTUP_EXCEPTION_LIMITS.message,
    hasRedactionMarker: typeof id === 'string' && id.includes('[redacted'),
  });
}

function assertPublicationIdentity(matches) {
  const diagnostic = publicationIdentityDiagnostic(matches);
  assert.equal(matches.length, 1, diagnostic);
  const id = matches[0].test.id;
  assert.equal(typeof id === 'string' && id.endsWith(`:${publicationRootIdentity}`), true, diagnostic);
}

test('publication identity diagnostics reject changed or duplicate records without exposing IDs', () => {
  const record = id => ({ test: { id } });
  assertPublicationIdentity([record(`synthetic-task:${publicationRootIdentity}`)]);
  for (const [matches, expected] of [
    [[], { matchCount: 0, idLength: null, atLimit: false, hasRedactionMarker: false }],
    [[record(null)], { matchCount: 1, idLength: null, atLimit: false, hasRedactionMarker: false }],
    [[record('PRIVATE_UNEXPECTED_ID')], { matchCount: 1, idLength: 21, atLimit: false, hasRedactionMarker: false }],
    [[record('task:[redacted]')], { matchCount: 1, idLength: 15, atLimit: false, hasRedactionMarker: true }],
    [[record('x'.repeat(STARTUP_EXCEPTION_LIMITS.message))],
      { matchCount: 1, idLength: STARTUP_EXCEPTION_LIMITS.message, atLimit: true, hasRedactionMarker: false }],
    [[record(`first:${publicationRootIdentity}`), record(`second:${publicationRootIdentity}`)],
      { matchCount: 2, idLength: 42, atLimit: false, hasRedactionMarker: false }],
  ]) {
    assert.throws(() => assertPublicationIdentity(matches), error => {
      assert.equal(error.code, 'ERR_ASSERTION');
      const firstLine = error.message.split('\n')[0];
      assert.equal(firstLine, publicationIdentityDiagnostic(matches));
      const diagnostic = JSON.parse(firstLine.slice(firstLine.indexOf('{')));
      assert.deepEqual(diagnostic, expected);
      assert.equal(error.message.includes('PRIVATE_UNEXPECTED_ID'), false);
      assert.equal(error.message.includes(publicationRootIdentity), false);
      return true;
    });
  }
});

test('publication identity diagnostic survives the actual failed Node reporter and OpenPGP delivery', {
  skip: !['win32', 'linux'].includes(process.platform), timeout: 30_000,
}, async () => {
  const fixture = await createOpenPgpTestFixture(root);
  let completed = false;
  try {
    const temp = join(fixture.root, 'identity-temp'), checkout = join(fixture.root, 'identity-checkout');
    await mkdir(temp); await mkdir(checkout);
    const binding = { GITHUB_ACTIONS: 'true', GITHUB_RUN_ID: '98765', GITHUB_RUN_ATTEMPT: '1',
      GITHUB_JOB: 'w74-identity-proof', EKY_EVIDENCE_JOB_KEY: 'w74-identity-proof-0', GITHUB_SHA: 'a'.repeat(40) };
    const sink = createRunnerFailureSink({ tempRoot: temp, env: { ...binding,
      SYNTHETIC_TEST_SECRET: publicationRootIdentity } });
    sink.record({ runner: 'vitest', phase: 'publicationIdentityControl',
      testId: `synthetic-task:${publicationRootIdentity}`, error: new Error('SYNTHETIC_IDENTITY_ORIGINAL') });
    assert.equal((await sink.flush()).status, 'recorded');
    const [directory] = (await readdir(temp)).filter(name => name.startsWith(RUNNER_FAILURE_ROOT_PREFIX));
    const [name] = (await readdir(join(temp, directory))).filter(name => !name.includes('.summary.'));
    const redacted = validateRunnerFailureEvidence(JSON.parse(await readFile(join(temp, directory, name), 'utf8')));
    assert.equal(redacted.test.id, 'synthetic-task:[redacted]');
    assert.throws(() => assertPublicationIdentity([redacted]), error => {
      assert.equal(error.message.split('\n')[0], publicationIdentityDiagnostic([redacted]));
      return true;
    });
    const file = join(fixture.root, 'identity.test.mjs');
    await writeFile(file, `import assert from 'node:assert/strict';
import test from 'node:test';
const STARTUP_EXCEPTION_LIMITS = ${JSON.stringify({ message: STARTUP_EXCEPTION_LIMITS.message })};
const publicationRootIdentity = ${JSON.stringify(publicationRootIdentity)};
${publicationIdentityDiagnostic.toString()}
${assertPublicationIdentity.toString()}
test('synthetic publication identity failure', () => {
  assertPublicationIdentity([{ test: { id: 'synthetic-task:[redacted]' } }]);
});`, { flag: 'wx', mode: 0o600 });
    const env = { ...process.env, ...binding, TEMP: temp, TMP: temp, TMPDIR: temp, NO_COLOR: '1' };
    delete env.NODE_TEST_CONTEXT; delete env.FORCE_COLOR;
    const child = spawnSync(process.execPath, ['--test',
      '--test-reporter=' + new URL('../nodeFailureReporter.mjs', import.meta.url).href, file], {
      cwd: root, env, encoding: 'utf8', timeout: 10_000, maxBuffer: 128 * 1024, windowsHide: true,
    });
    await writeFile(join(fixture.root, 'identity-child.private.json'), JSON.stringify({ status: child.status,
      signal: child.signal, stdout: child.stdout, stderr: child.stderr, processError: child.error?.code ?? null }),
    { flag: 'wx', mode: 0o600 });
    assert.equal(child.error, undefined, 'IDENTITY_REPORTER_PROCESS_FAILED');
    assert.equal(child.signal, null);
    assert.equal(child.status, 1, 'IDENTITY_ASSERTION_MUST_FAIL');
    const publicOutput = (child.stdout ?? '') + (child.stderr ?? '');
    assert.equal(publicOutput.includes('synthetic-task'), false);
    assert.equal(publicOutput.includes(publicationRootIdentity), false);
    assert.equal(publicOutput.includes('SYNTHETIC_IDENTITY_ORIGINAL'), false);
    const originals = new Map();
    for (const directory of await readdir(temp)) {
      if (!directory.startsWith(RUNNER_FAILURE_ROOT_PREFIX)) continue;
      for (const name of await readdir(join(temp, directory))) {
        originals.set(`temporary/${directory}/${name}`, await readFile(join(temp, directory, name)));
      }
    }
    // Keep this test-key home short for socket-based GPG agents.
    const recipient = await fixture.generate('id');
    await fixture.invokeGpg(recipient.home, ['--pinentry-mode', 'loopback', '--passphrase', '',
      '--quick-add-key', recipient.fingerprint, 'cv25519', 'encr', '1d']);
    const publicPath = await fixture.exportKey(recipient, 'identity-public.asc');
    const collected = await collectJobFailureEvidence({ ...binding, RUNNER_TEMP: temp,
      GITHUB_WORKSPACE: checkout, EKY_EVIDENCE_JOB_OUTCOME: 'failure',
      EKY_DIAGNOSTIC_KEY_FINGERPRINT: recipient.fingerprint,
      EKY_DIAGNOSTIC_VERIFIED_FINGERPRINT: recipient.fingerprint,
      EKY_DIAGNOSTIC_PUBLIC_KEY: await readFile(publicPath, 'utf8') });
    await encryptArchive(collected.root, collected);
    const decrypted = await fixture.invokeGpg(recipient.home, ['--decrypt', join(collected.root, 'evidence.json.gz.gpg')]);
    const archive = JSON.parse(gunzipSync(decrypted.stdout));
    assert.equal(archive.manifest.jobOutcome, 'failure');
    assert.equal(archive.manifest.cleanup, 'notInferred');
    assert.equal(archive.manifest.files.length, originals.size);
    const records = archive.manifest.files.map(entry => {
      assert.equal(entry.status, 'retained');
      const bytes = Buffer.from(archive.files[entry.name], 'base64');
      assert.equal(bytes.length, entry.bytes);
      assert.equal(sha256(bytes), entry.sha256);
      assert.equal(bytes.equals(originals.get(entry.source) ?? Buffer.alloc(0)), true);
      originals.delete(entry.source);
      return validateRunnerFailureEvidence(JSON.parse(bytes));
    }).filter(record => record.kind === 'runnerFailure');
    assert.equal(originals.size, 0);
    const failures = records.filter(record => record.phase === 'testFailure');
    assert.equal(failures.length, 1);
    const failure = failures[0];
    assert.equal(failure.exception.chain[0].message.split('\n')[0], publicationIdentityDiagnostic([redacted]));
    assert.equal(failure.exception.chain[0].message.includes('false !== true'), true);
    assert.equal(failure.exception.chain.length, 2);
    assert.equal(failure.exception.chain[0].name, 'Error');
    assert.equal(failure.exception.chain[1].name, 'AssertionError');
    assert.equal(failure.exception.chain[1].message, failure.exception.chain[0].message);
    assert.equal(failure.exception.chain[1].stack.includes('identity.test.mjs'), true);
    assert.equal(failure.binding.jobKey, binding.EKY_EVIDENCE_JOB_KEY);
    completed = true;
  } finally { await fixture.finish({ completed, failed: !completed }); }
});

test('support smoke capture retains original and cleanup through OpenPGP delivery', {
  skip: !['win32', 'linux'].includes(process.platform), timeout: 30_000,
}, async () => {
  const fixture = await createOpenPgpTestFixture(root);
  let completed = false;
  try {
    const temp = join(fixture.root, 'support-smoke-temp'), checkout = join(fixture.root, 'support-smoke-checkout');
    const profile = join(temp, 'support-smoke-profile');
    const sentinel = join(profile, 'retained-directory', 'sentinel.bin');
    const sentinelBytes = Buffer.from('synthetic retained support smoke bytes\0');
    const profileBytes = Buffer.from('synthetic unrelated profile bytes\0');
    await mkdir(profile, { recursive: true }); await mkdir(checkout);
    await writeFile(join(profile, 'profile.bin'), profileBytes, { flag: 'wx', mode: 0o600 });
    const binding = { GITHUB_ACTIONS: 'true', GITHUB_RUN_ID: '98765', GITHUB_RUN_ATTEMPT: '1',
      GITHUB_JOB: 'w75-support-smoke-proof', EKY_EVIDENCE_JOB_KEY: 'w75-support-smoke-proof-0', GITHUB_SHA: 'a'.repeat(40) };
    const names = {
      success: 'support smoke successful v3 archive',
      expectedReject: 'support smoke expected bridge rejection',
      expectedAssertion: 'support smoke expected assertion failure',
      primary: 'support smoke unexpected bridge rejection',
      combined: 'support smoke unexpected bridge and cleanup rejection',
    };
    await runSupportSmokeFailureWorker(fixture.root, temp, binding, names, sentinelBytes);
    assert.equal((await readFile(sentinel)).equals(sentinelBytes), true, 'SUPPORT_SMOKE_SENTINEL_CHANGED');
    assert.equal((await readFile(join(profile, 'profile.bin'))).equals(profileBytes), true, 'SUPPORT_SMOKE_PROFILE_CHANGED');
    const originals = new Map();
    const directories = (await readdir(temp)).filter(name => name.startsWith(RUNNER_FAILURE_ROOT_PREFIX));
    assert.equal(directories.length, 3, 'SUPPORT_SMOKE_UNEXPECTED_CAPTURE_INVOCATIONS');
    for (const directory of directories) {
      for (const name of await readdir(join(temp, directory))) {
        const bytes = await readFile(join(temp, directory, name));
        originals.set(`temporary/${directory}/${name}`, { bytes, sha256: sha256(bytes) });
      }
    }
    // Two reporter assertions, one primary capture, two combined captures and three summaries.
    assert.equal(originals.size, 8, 'SUPPORT_SMOKE_REPORT_COUNT_INVALID');
    const recipient = await fixture.generate('sm');
    await fixture.invokeGpg(recipient.home, ['--pinentry-mode', 'loopback', '--passphrase', '',
      '--quick-add-key', recipient.fingerprint, 'cv25519', 'encr', '1d']);
    const publicPath = await fixture.exportKey(recipient, 'support-smoke-public.asc');
    const collected = await collectJobFailureEvidence({ ...binding, RUNNER_TEMP: temp,
      GITHUB_WORKSPACE: checkout, EKY_EVIDENCE_JOB_OUTCOME: 'failure',
      EKY_DIAGNOSTIC_KEY_FINGERPRINT: recipient.fingerprint,
      EKY_DIAGNOSTIC_VERIFIED_FINGERPRINT: recipient.fingerprint,
      EKY_DIAGNOSTIC_PUBLIC_KEY: await readFile(publicPath, 'utf8') });
    await encryptArchive(collected.root, collected);
    const decrypted = await fixture.invokeGpg(recipient.home, ['--decrypt', join(collected.root, 'evidence.json.gz.gpg')]);
    const archive = JSON.parse(gunzipSync(decrypted.stdout));
    const expectedBinding = { runId: binding.GITHUB_RUN_ID, attempt: binding.GITHUB_RUN_ATTEMPT,
      job: binding.GITHUB_JOB, jobKey: binding.EKY_EVIDENCE_JOB_KEY, sourceRevision: binding.GITHUB_SHA };
    assert.deepEqual(archive.manifest.binding, expectedBinding);
    assert.equal(archive.manifest.jobOutcome, 'failure');
    assert.equal(archive.manifest.cleanup, 'notInferred');
    assert.equal(archive.manifest.exclusions.includes('profiles'), true);
    assert.equal(archive.manifest.files.length, originals.size);
    assert.deepEqual(Object.keys(archive.files).sort(), archive.manifest.files.map(entry => entry.name).sort());
    const delivered = archive.manifest.files.map(entry => {
      assert.equal(entry.kind, 'runnerFailure'); assert.equal(entry.status, 'retained');
      assert.equal(entry.source.startsWith(`temporary/${RUNNER_FAILURE_ROOT_PREFIX}`), true);
      const original = originals.get(entry.source);
      assert.equal(original !== undefined, true, 'SUPPORT_SMOKE_UNEXPECTED_COLLECTED_SOURCE');
      const bytes = Buffer.from(archive.files[entry.name], 'base64');
      assert.equal(bytes.length, entry.bytes);
      assert.equal(sha256(bytes) === entry.sha256 && entry.sha256 === original.sha256, true, 'SUPPORT_SMOKE_HASH_CHANGED');
      assert.equal(bytes.equals(original.bytes), true, 'SUPPORT_SMOKE_REPORT_BYTES_CHANGED');
      assert.equal(bytes.includes(sentinelBytes) || bytes.includes(profileBytes), false, 'SUPPORT_SMOKE_PROFILE_COLLECTED');
      assert.equal(bytes.includes(Buffer.from('SYNTHETIC_W75_SMOKE_LATE_SECRET')), false, 'SUPPORT_SMOKE_LATE_SECRET_LEAKED');
      originals.delete(entry.source);
      const record = validateRunnerFailureEvidence(JSON.parse(bytes));
      assert.deepEqual(record.binding, { kind: 'github', ...expectedBinding, jobKeySource: 'explicit' });
      const [, directory, name] = entry.source.split('/');
      assert.equal(directory, RUNNER_FAILURE_ROOT_PREFIX + record.invocationId);
      if (record.kind === 'runnerFailureSummary') assert.equal(name, record.invocationId + '.summary.private.json');
      else assert.equal(name.startsWith(String(record.sequence).padStart(3, '0') + '-'), true);
      return record;
    });
    assert.equal(originals.size, 0);
    const records = delivered.filter(record => record.kind === 'runnerFailure');
    const summaries = delivered.filter(record => record.kind === 'runnerFailureSummary');
    assert.equal(records.length, 5); assert.equal(summaries.length, 3);
    assert.equal(new Set(summaries.map(record => record.invocationId)).size, 3);
    for (const summary of summaries) {
      const members = records.filter(record => record.invocationId === summary.invocationId);
      assert.equal(summary.status, 'recorded');
      assert.equal(summary.observed, members.length); assert.equal(summary.recorded, members.length);
      assert.equal(summary.rejected, 0); assert.equal(summary.omitted, 0); assert.equal(summary.limited, false);
    }
    assert.deepEqual(summaries.map(record => record.recorded).sort(), [1, 2, 2]);
    for (const record of records) {
      assert.equal(record.runner, 'vitest');
      assert.equal([names.primary, names.combined].includes(record.test.name), true, 'SUPPORT_SMOKE_CONTROL_REPORTED');
      assert.equal(typeof record.test.id === 'string' && record.test.id.length > 0, true);
      assert.equal(record.test.file.replaceAll('\\', '/').endsWith('/support-smoke.test.mjs'), true);
      assert.equal(Number.isInteger(record.test.line) && record.test.line > 0, true);
      assert.equal(record.test.attempt, 0); assert.equal(record.test.retryCount, 0); assert.equal(record.test.repeatCount, 0);
    }
    const assertions = records.filter(record => record.phase === 'testFailure');
    const primaries = records.filter(record => record.phase === 'supportBundleSmokeCatch');
    const cleanups = records.filter(record => record.phase === 'supportBundleSmokeCleanupCatch');
    assert.equal(assertions.length, 2); assert.equal(primaries.length, 2); assert.equal(cleanups.length, 1);
    assert.equal(new Set(assertions.map(record => record.test.id)).size, 2);
    for (const name of [names.primary, names.combined]) {
      const matchingAssertions = assertions.filter(record => record.test.name === name);
      const matchingPrimaries = primaries.filter(record => record.test.name === name);
      assert.equal(matchingAssertions.length, 1); assert.equal(matchingPrimaries.length, 1);
      const assertion = matchingAssertions[0], primary = matchingPrimaries[0];
      assert.equal(assertion.exception.chain[0].name, 'AssertionError');
      assert.equal(assertion.exception.chain[0].message.includes('SUPPORT_SMOKE_EXPECTED_SUCCESS'), true);
      assert.equal(JSON.stringify(assertion.exception).includes('SYNTHETIC_W75_SMOKE'), false);
      assert.deepEqual(primary.test, assertion.test);
      assert.notEqual(primary.invocationId, assertion.invocationId);
      assert.equal(primary.exception.incomplete, false); assert.equal(primary.exception.chain.length, 2);
      for (const [index, marker] of ['SYNTHETIC_W75_SMOKE_ORIGINAL', 'SYNTHETIC_W75_SMOKE_CAUSE'].entries()) {
        const part = primary.exception.chain[index];
        // Plain Error inherits its name; the projector reads only own data fields.
        assert.equal(part.name, null); assert.equal(part.message === marker, true, 'SUPPORT_SMOKE_ORIGINAL_CHANGED');
        assert.equal(part.stack.includes(marker) && part.stack.includes('support-smoke.test.mjs'), true, 'SUPPORT_SMOKE_STACK_MISSING');
        assert.equal(part.truncated, false);
      }
      assert.equal(JSON.stringify(primary.exception).includes('retained-directory'), false);
      if (name === names.primary) {
        assert.equal(primary.exception.chain[0].stack.includes('[redacted]'), true, 'SUPPORT_SMOKE_LATE_SECRET_NOT_REDACTED');
      }
    }
    const cleanup = cleanups[0], combined = primaries.find(record => record.test.name === names.combined);
    assert.deepEqual(cleanup.test, combined.test); assert.equal(cleanup.invocationId, combined.invocationId);
    assert.equal(combined.sequence, 1); assert.equal(cleanup.sequence, 2);
    assert.equal(cleanup.exception.incomplete, false); assert.equal(cleanup.exception.chain.length, 1);
    assert.equal(cleanup.exception.chain[0].message.includes('retained-directory'), true);
    assert.equal(cleanup.exception.chain[0].stack.includes('retained-directory'), true);
    assert.equal(JSON.stringify(cleanup.exception).includes('SYNTHETIC_W75_SMOKE'), false);
    assert.equal((await readFile(sentinel)).equals(sentinelBytes), true, 'SUPPORT_SMOKE_SENTINEL_CHANGED');
    assert.equal((await readFile(join(profile, 'profile.bin'))).equals(profileBytes), true, 'SUPPORT_SMOKE_PROFILE_CHANGED');
    completed = true;
  } finally { await fixture.finish({ completed, failed: !completed }); }
});

test('workspace main projections retain original causes and coverage through OpenPGP delivery', {
  skip: !['win32', 'linux'].includes(process.platform), timeout: 240_000,
}, async () => {
  const fixture = await createOpenPgpTestFixture(root);
  let completed = false;
  try {
    const recipient = await fixture.generate('w73-recipient');
    await fixture.invokeGpg(recipient.home, ['--pinentry-mode', 'loopback', '--passphrase', '',
      '--quick-add-key', recipient.fingerprint, 'cv25519', 'encr', '1d']);
    const publicPath = await fixture.exportKey(recipient, 'w73-public.asc');
    const temp = join(fixture.root, 'runner-temp');
    const checkout = join(fixture.root, 'empty-checkout');
    await mkdir(temp); await mkdir(checkout);
    const binding = { GITHUB_ACTIONS: 'true', GITHUB_RUN_ID: '98765', GITHUB_RUN_ATTEMPT: '1',
      GITHUB_JOB: 'w73-proof', EKY_EVIDENCE_JOB_KEY: 'w73-proof-0', GITHUB_SHA: 'a'.repeat(40) };
    const source = new Error('SYNTHETIC_W73_ORIGINAL', { cause: new Error('SYNTHETIC_W73_CAUSE') });
    let deep = new Error('SYNTHETIC_BOTTOM');
    for (let index = 0; index < STARTUP_EXCEPTION_LIMITS.depth + 1; index++) {
      deep = new Error('x'.repeat(STARTUP_EXCEPTION_LIMITS.message + 128), { cause: deep });
    }
    const projection = { request: projectExceptionChain(source), shutdown: projectExceptionChain(deep) };
    const testInfo = { title: 'W7.3 synthetic IPC boundary failure', testId: 'w73-proof',
      file: 'electron/workspaceDeletionPreparation.spec.ts', line: 1, column: 1,
      retry: 0, repeatEachIndex: 0, annotations: [] };
    await captureWorkspaceDeletionFailure({
      // This isolates delivery from the separately tested actual Electron boundary.
      application: { evaluate: async () => projection },
      runtimeInstanceId: '11111111-1111-4111-8111-111111111111', testInfo,
    }, createRunnerFailureSink({ env: binding, tempRoot: temp }));
    assert.equal(testInfo.annotations[0].description, 'partial');
    const adoptionInfo = { ...testInfo, title: 'W7.4 synthetic adoption boundary failure', testId: 'w74-proof', annotations: [] };
    await assert.rejects(runElectronWorkspaceAdoptionAcceptanceProof({ evaluate: async () => ({
      status: 'failed', runtimeInstanceId: '11111111-1111-4111-8111-111111111111',
      exception: projectExceptionChain(new Error('SYNTHETIC_W74_ADOPTION_ORIGINAL', {
        cause: new Error('SYNTHETIC_W74_ADOPTION_CAUSE'),
      })),
    }) }, adoptionInfo, createRunnerFailureSink({ env: binding, tempRoot: temp })),
    /^Error: WORKSPACE_ADOPTION_ACCEPTANCE_PROOF_FAILED$/);
    assert.equal(adoptionInfo.annotations[0].description, 'recorded');
    const originalInfo = { ...testInfo, title: 'W7.4 synthetic original-inspection boundary failure',
      testId: 'w74-original-proof', annotations: [] };
    await assert.rejects(runElectronWorkspaceOriginalInspectionProof({ evaluate: async () => ({
      status: 'failed', runtimeInstanceId: '11111111-1111-4111-8111-111111111111',
      exception: projectExceptionChain(new Error('SYNTHETIC_W74_ROLLBACK_ORIGINAL', {
        cause: new Error('SYNTHETIC_W74_ROLLBACK_CAUSE'),
      })),
    }) }, originalInfo, createRunnerFailureSink({ env: binding, tempRoot: temp })),
    /^Error: WORKSPACE_ORIGINAL_INSPECTION_PROOF_FAILED$/);
    assert.equal(originalInfo.annotations[0].description, 'recorded');
    await runInspectionFailureWorker(fixture.root, temp, binding);
    const originals = new Map();
    for (const directory of await readdir(temp)) {
      if (!directory.startsWith(RUNNER_FAILURE_ROOT_PREFIX)) continue;
      for (const file of await readdir(join(temp, directory))) {
        originals.set(`temporary/${directory}/${file}`, await readFile(join(temp, directory, file)));
      }
    }
    // Existing evidence plus each support entry's original, assertion and receipt.
    assert.equal(originals.size, 44);
    // Synthetic collector identity, not hosted admission or an artifact upload.
    const collected = await collectJobFailureEvidence({ ...binding,
      RUNNER_TEMP: temp, GITHUB_WORKSPACE: checkout, EKY_EVIDENCE_JOB_OUTCOME: 'failure',
      EKY_DIAGNOSTIC_KEY_FINGERPRINT: recipient.fingerprint,
      EKY_DIAGNOSTIC_VERIFIED_FINGERPRINT: recipient.fingerprint,
      EKY_DIAGNOSTIC_PUBLIC_KEY: await readFile(publicPath, 'utf8') });
    await encryptArchive(collected.root, collected);
    const decrypted = await fixture.invokeGpg(recipient.home, ['--decrypt', join(collected.root, 'evidence.json.gz.gpg')]);
    const archive = JSON.parse(gunzipSync(decrypted.stdout));
    assert.equal(archive.manifest.jobOutcome, 'failure');
    assert.equal(archive.manifest.cleanup, 'notInferred');
    assert.equal(archive.manifest.files.length, originals.size);
    const records = archive.manifest.files.map(entry => {
      assert.equal(entry.kind, 'runnerFailure'); assert.equal(entry.status, 'retained');
      const bytes = Buffer.from(archive.files[entry.name], 'base64');
      assert.equal(bytes.length, entry.bytes);
      assert.equal(sha256(bytes) === entry.sha256, true, 'W73_RESTORED_HASH_MISMATCH');
      assert.equal(bytes.equals(originals.get(entry.source) ?? Buffer.alloc(0)), true, 'W73_SOURCE_BYTES_CHANGED');
      originals.delete(entry.source);
      return validateRunnerFailureEvidence(JSON.parse(bytes));
    }).filter(record => record.kind === 'runnerFailure');
    assert.equal(originals.size, 0);
    const request = records.find(record => record.phase === 'workspaceDeletionIpc');
    assert.equal(request.exception.chain[0].message === 'SYNTHETIC_W73_ORIGINAL', true);
    assert.equal(request.exception.chain[1].message === 'SYNTHETIC_W73_CAUSE', true);
    assert.equal(request.exception.chain[0].stack.includes('workspaceDeletionFailureEvidenceOpenPgp'), true);
    const shutdown = records.find(record => record.phase === 'workspaceDeletionShutdown');
    assert.equal(shutdown.exception.incomplete, true);
    assert.equal(shutdown.exception.chain.every(part => part.truncated), true);
    const executions = records.filter(record => record.phase === 'workspaceDeletionExecution');
    assert.equal(executions.length, 3);
    const related = records.filter(record => record.phase === 'workspaceDeletionExecutionRelated');
    assert.equal(related.length, 6);
    for (const group of ['preparation', 'metadataPostClear', 'finalization']) {
      const id = `w74-execution-${group}:11111111-1111-4111-8111-111111111111`;
      const groupExecutions = executions.filter(record => record.test.id === id);
      assert.equal(groupExecutions.length, 1, 'EXECUTION_GROUP_NOT_UNIQUE');
      const execution = groupExecutions[0];
      assert.equal(execution.exception.chain[0].message, 'SYNTHETIC_W74_EXECUTION_ORIGINAL');
      assert.equal(execution.exception.chain[1].message, 'SYNTHETIC_W74_EXECUTION_CAUSE');
      assert.equal(execution.exception.chain[0].stack.includes('inspection.test.mjs'), true);
      const groupRelated = related.filter(record => record.test.id === id);
      assert.equal(groupRelated.length, 2, 'EXECUTION_GROUP_RELATED_CAUSES_MISSING');
      for (const suffix of ['READ', 'CLOSE']) {
        const matches = groupRelated.filter(record =>
          record.exception.chain[0].message === `SYNTHETIC_W74_EXECUTION_${suffix}`);
        assert.equal(matches.length, 1, 'EXECUTION_GROUP_RELATED_CAUSE_NOT_UNIQUE');
        assert.equal(matches[0].exception.chain[0].stack.includes('inspection.test.mjs'), true);
      }
    }
    const adoption = records.find(record => record.phase === 'workspaceAdoptionAcceptance');
    assert.equal(adoption.exception.chain[0].message === 'SYNTHETIC_W74_ADOPTION_ORIGINAL', true);
    assert.equal(adoption.exception.chain[1].message === 'SYNTHETIC_W74_ADOPTION_CAUSE', true);
    assert.equal(adoption.exception.chain[0].stack.includes('workspaceDeletionFailureEvidenceOpenPgp'), true);
    const original = records.find(record => record.phase === 'workspaceOriginalInspection');
    assert.equal(original.exception.chain[0].message === 'SYNTHETIC_W74_ROLLBACK_ORIGINAL', true);
    assert.equal(original.exception.chain[1].message === 'SYNTHETIC_W74_ROLLBACK_CAUSE', true);
    assert.equal(original.exception.chain[0].stack.includes('workspaceDeletionFailureEvidenceOpenPgp'), true);
    const inspection = records.find(record => record.phase === 'profileInspectionCatch');
    assert.equal(inspection.exception.chain[0].message === 'SYNTHETIC_W74_INSPECTION_ORIGINAL', true);
    assert.equal(inspection.exception.chain[1].message === 'SYNTHETIC_W74_INSPECTION_CAUSE', true);
    assert.equal(inspection.exception.chain[0].stack.includes('inspection.test.mjs'), true);
    const deletion = records.find(record => record.phase === 'workspaceDeletionProcess');
    assert.equal(deletion.exception.chain[0].message === 'SYNTHETIC_W74_DELETION_ORIGINAL', true);
    assert.equal(deletion.exception.chain[1].message === 'SYNTHETIC_W74_DELETION_CAUSE', true);
    assert.equal(deletion.exception.chain[0].stack.includes('workspaceDeletionProcess.fixture.mjs'), true);
    assert.equal(deletion.test.id.endsWith(':publish'), true);
    const publications = records.filter(record => record.phase === 'workspaceDeletionRoles_publicationComparison2');
    assert.equal(publications.length, 1, publicationIdentityDiagnostic(publications));
    const publication = publications[0];
    assert.equal(publication.exception.chain[0].message === 'SYNTHETIC_W74_PUBLICATION_ORIGINAL', true);
    assert.equal(publication.exception.chain[1].message === 'SYNTHETIC_W74_PUBLICATION_CAUSE', true);
    assert.equal(publication.exception.chain[0].stack.includes('inspection.test.mjs'), true);
    assertPublicationIdentity(publications);
    const cold = records.find(record => record.phase === 'workspaceDeletionColdResume');
    assert.equal(cold.exception.chain[0].message === 'WORKSPACE_DELETE_FAILED', true);
    assert.equal(cold.exception.chain.some(part => part.message === 'SYNTHETIC_W74_COLD_ORIGINAL'), true);
    assert.equal(cold.exception.chain.some(part => part.message === 'SYNTHETIC_W74_COLD_CAUSE'), true);
    assert.equal(cold.exception.chain.some(part => part.stack?.includes('inspection.test.mjs')), true);
    const payloadJournal = records.find(record => record.phase === 'workspaceDeletionPayloadJournal');
    assert.equal(records.filter(record => record.phase === 'workspaceDeletionPayloadJournal').length, 1);
    assert.equal(payloadJournal.exception.chain[0].message, 'SYNTHETIC_W74_PAYLOAD_JOURNAL_ORIGINAL');
    assert.equal(payloadJournal.exception.chain[1].message, 'SYNTHETIC_W74_PAYLOAD_JOURNAL_CAUSE');
    assert.equal(payloadJournal.exception.chain[0].stack.includes('inspection.test.mjs'), true);
    const support = records.filter(record => record.phase === 'supportBundleCreationCatch');
    assert.equal(support.length, 1, 'SUPPORT_ORIGINAL_CAPTURE_MISSING');
    assert.equal(support[0].exception.chain[0].message, 'SYNTHETIC_W75_SUPPORT_ORIGINAL');
    assert.equal(support[0].exception.chain[1].message, 'SYNTHETIC_W75_SUPPORT_CAUSE');
    assert.equal(support[0].exception.chain[0].stack.includes('inspection.test.mjs'), true);
    const nativeSupport = records.filter(record => record.phase === 'supportBundleNativeCreationCatch');
    assert.equal(nativeSupport.length, 1, 'NATIVE_SUPPORT_ORIGINAL_CAPTURE_MISSING');
    assert.equal(nativeSupport[0].exception.chain[0].message, 'SYNTHETIC_W75_NATIVE_SUPPORT_ORIGINAL');
    assert.equal(nativeSupport[0].exception.chain[1].message, 'SYNTHETIC_W75_NATIVE_SUPPORT_CAUSE');
    assert.equal(nativeSupport[0].exception.chain[0].stack.includes('inspection.test.mjs'), true);
    const capture = records.filter(record => record.phase === 'supportBundleRequestCapture');
    assert.equal(capture.length, 1, 'SUPPORT_REQUEST_CAPTURE_ORIGINAL_MISSING');
    assert.equal(capture[0].exception.chain[0].message, 'SYNTHETIC_W75_CAPTURE_ORIGINAL');
    assert.equal(capture[0].exception.chain[1].message, 'SYNTHETIC_W75_CAPTURE_CAUSE');
    assert.equal(capture[0].exception.chain[0].stack.includes('inspection.test.mjs'), true);
    const assertion = records.find(record => record.phase === 'testFailure');
    assert.equal(assertion.exception.chain[0].message.includes('W74_INSPECTION_EXPECTED_SUCCESS'), true);
    assert.equal(JSON.stringify(assertion.exception).includes('SYNTHETIC_W74_INSPECTION_ORIGINAL'), false);
    for (const marker of ['W74_INSPECTION_EXPECTED_SUCCESS', 'W74_DELETION_EXPECTED_SUCCESS',
      'W74_PUBLICATION_EXPECTED_SUCCESS', 'W74_COLD_EXPECTED_SUCCESS', 'W74_PAYLOAD_JOURNAL_EXPECTED_SUCCESS',
      'W75_SUPPORT_EXPECTED_SUCCESS', 'W75_NATIVE_SUPPORT_EXPECTED_SUCCESS', 'W75_CAPTURE_EXPECTED_SUCCESS']) {
      const expected = records.filter(record => record.phase === 'testFailure' &&
        record.exception.chain[0].name === 'AssertionError' && record.exception.chain[0].message?.startsWith(`${marker}: `));
      assert.equal(expected.length, 1, 'EXPECTED_SYNTHETIC_ASSERTION_NOT_RETAINED');
    }
    for (const record of records) {
      assert.equal(record.test.attempt, 0);
      assert.equal(record.binding.runId, binding.GITHUB_RUN_ID);
      assert.equal(record.binding.attempt, binding.GITHUB_RUN_ATTEMPT);
      assert.equal(record.binding.job, binding.GITHUB_JOB);
      assert.equal(record.binding.jobKey, binding.EKY_EVIDENCE_JOB_KEY);
      assert.equal(record.binding.sourceRevision, binding.GITHUB_SHA);
      if (!['testFailure', 'workspaceDeletionProcess', 'workspaceDeletionRoles_publicationComparison2'].includes(record.phase)) {
        assert.equal(record.test.id.endsWith(':11111111-1111-4111-8111-111111111111'), true);
      }
    }
    await verifyPhaseObservationDelivery(fixture, recipient, publicPath, binding);
    completed = true;
  } finally { await fixture.finish({ completed, failed: !completed }); }
});

async function verifyPhaseObservationDelivery(fixture, recipient, publicPath, binding) {
  const temp = join(fixture.root, 'phase-temporary'), checkout = join(fixture.root, 'phase-checkout');
  const requestedRun = join(checkout, 'eky_software/apps/e2e/test-results/run-33333333-3333-4333-8333-333333333333');
  await mkdir(temp); await mkdir(requestedRun, { recursive: true });
  const runDirectory = await realpath(requestedRun), attempt = join(runDirectory, 'synthetic-retry1');
  await mkdir(attempt);
  const environment = { ...binding, RUNNER_TEMP: temp, GITHUB_WORKSPACE: checkout,
    EKY_EVIDENCE_JOB_OUTCOME: 'failure', EKY_DIAGNOSTIC_KEY_FINGERPRINT: recipient.fingerprint,
    EKY_DIAGNOSTIC_VERIFIED_FINGERPRINT: recipient.fingerprint, EKY_DIAGNOSTIC_PUBLIC_KEY: await readFile(publicPath, 'utf8') };
  const saved = Object.fromEntries(Object.keys(binding).map(key => [key, process.env[key]]));
  const runtime = '11111111-1111-4111-8111-111111111111';
  const raw = createWorkspaceDeletionRawPhaseRecorder(runtime, () => 1, WORKSPACE_DELETION_MAIN_PHASE_COVERAGE);
  raw.observePhase(runtime, { phase: 'preparation', event: 'entered', callId: 1 });
  raw.observePhase(runtime, { phase: 'preparation', event: 'fulfilled', callId: 1 });
  for (let callId = 1; callId <= 40; callId++) {
    raw.observePhase(runtime, { phase: 'reservation', event: 'entered', callId });
    raw.observePhase(runtime, { phase: 'reservation', event: 'fulfilled', callId });
  }
  const terminalPhases = ['finalization', 'inventoryRetirement', 'terminalJournalClear', 'postClearVerification'];
  for (const phase of terminalPhases) {
    raw.observePhase(runtime, { phase, event: 'entered', callId: 1 });
    raw.observePhase(runtime, { phase, event: 'fulfilled', callId: 1 });
  }
  assert.equal(raw.snapshot().schemaVersion, 2);
  const application = { evaluate: async () => raw.snapshot() };
  let observer;
  try {
    Object.assign(process.env, binding);
    observer = selectWorkspaceDeletionPhaseObservation({ application, runtimeInstanceId: runtime,
      scenarioId: 'DESK-DELETE-RECOVERY-001', testInfo: { retry: 1, repeatEachIndex: 0,
        project: { outputDir: runDirectory }, outputPath: name => join(attempt, name) } });
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
  observer.beginClose(application, runtime);
  await Promise.resolve();
  observer.finishClose(application, runtime);
  assert.equal(await observer.reportFailure(true), 'recorded');
  const path = join(attempt, 'failure.private.json'), original = await readFile(path);
  const report = JSON.parse(original);
  assert.equal(report.schemaVersion, 2);
  assert.equal(report.availability, 'captured'); assert.equal(report.snapshot.omissions.missingCoverage, true);
  assert.equal(report.snapshot.omissions.eventLimit, true);
  assert.equal(report.snapshot.events.length, 64);
  for (const phase of terminalPhases) {
    assert.deepEqual(report.snapshot.phases[phase], { entered: 1, fulfilled: 1, rejected: 0 });
    assert.equal(report.snapshot.events.some(event => event.phase === phase), false);
  }
  const collector = join(fixture.root, 'phase-collector.mjs');
  await writeFile(collector, `import { writeFile } from 'node:fs/promises';
import { collectJobFailureEvidence } from ${JSON.stringify(new URL('../../apps/desktop/installer/windows-acceptance-harness/ciFailureEvidence.mjs', import.meta.url).href)};
const result = await collectJobFailureEvidence(process.env);
await writeFile(process.argv[2], JSON.stringify({ root: result.root, archivePath: result.archivePath, fingerprint: result.fingerprint }), { flag: 'wx', mode: 0o600 });`, { flag: 'wx', mode: 0o600 });
  for (const wrongAttempt of [false, true]) {
    const resultPath = join(fixture.root, `phase-collection-${wrongAttempt}.private.json`);
    const child = await fixture.run(process.execPath, [collector, resultPath], 30_000, {
      cwd: root, env: { ...environment, ...(wrongAttempt ? { GITHUB_RUN_ATTEMPT: '2' } : {}) } });
    assert.equal(child.error, undefined); assert.equal(child.signal, null); assert.equal(child.status, 0);
    const collected = JSON.parse(await readFile(resultPath, 'utf8'));
    const archiveBytes = await readFile(collected.archivePath);
    await encryptArchive(collected.root, collected);
    const decrypted = await fixture.invokeGpg(recipient.home, ['--decrypt', join(collected.root, 'evidence.json.gz.gpg')]);
    assert.deepEqual(decrypted.stdout, archiveBytes);
    const archive = JSON.parse(gunzipSync(decrypted.stdout));
    assert.equal(archive.manifest.files.length, 1);
    const entry = archive.manifest.files[0]; assert.equal(entry.kind, 'workspaceDeletionPhaseObservation');
    assert.equal(entry.status, wrongAttempt ? 'unverified' : 'retained');
    if (wrongAttempt) assert.equal(Object.hasOwn(archive.files, entry.name), false);
    else {
      const recovered = Buffer.from(archive.files[entry.name], 'base64');
      assert.deepEqual(recovered, original); assert.equal(recovered.length, entry.bytes); assert.equal(sha256(recovered), entry.sha256);
    }
    assert.deepEqual(await readFile(path), original);
  }
}

async function runSupportSmokeFailureWorker(parent, temp, binding, names, sentinelBytes) {
  const directory = join(parent, 'support-smoke-worker');
  await mkdir(directory);
  const moduleUrl = path => new URL(path, import.meta.url).href;
  const file = join(directory, 'support-smoke.test.mjs'), config = join(directory, 'vitest.config.mjs');
  const receiptPath = join(directory, 'worker.private.json');
  await writeFile(config, `export default { resolve: { alias: {
    vitest: ${JSON.stringify(fileURLToPath(new URL('../../node_modules/vitest/dist/index.js', import.meta.url)))}
  } }, test: { include: ['support-smoke.test.mjs'],
    maxWorkers: 1, fileParallelism: false, retry: 0, testTimeout: 5000,
    hookTimeout: 2000, includeTaskLocation: true } };`, { flag: 'wx', mode: 0o600 });
  await writeFile(file, `import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { inspect } from 'node:util';
import { gunzipSync } from 'node:zlib';
import { afterAll, test, expect, vi } from 'vitest';
import { runPackagedSupportBundleSmoke } from ${JSON.stringify(moduleUrl('../../apps/desktop/src/main/packagedSupportBundleSmoke.ts'))};
import { createSupportBundleSmokeFailureCapture } from ${JSON.stringify(moduleUrl('../../apps/desktop/src/main/packagedSupportBundleSmokeTestSupport.ts'))};
import { createDesktopOnlySupportBundleArchive } from ${JSON.stringify(moduleUrl('../../apps/desktop/src/supportBundle/supportBundleArchive.ts'))};

const names = ${JSON.stringify(names)};
const profile = join(process.env.TMPDIR, 'support-smoke-profile');
const sentinelBytes = Buffer.from(${JSON.stringify(sentinelBytes.toString('base64'))}, 'base64');
const system = { appVersion: '0.2.81', buildRevision: 'a'.repeat(40),
  architecture: 'x64', electronVersion: '43.8.1', platform: 'win32' };
const completed = { success: false, expectedReject: false, expectedAssertion: false, primary: false, combined: false };
afterAll(async () => {
  delete process.env.SYNTHETIC_SUPPORT_SMOKE_SECRET;
  await writeFile(${JSON.stringify(receiptPath)}, JSON.stringify(completed), { flag: 'wx', mode: 0o600 });
});

// Keep raw markers away from assertion code frames, including the intentional failures.
function createSmokeBridgeError() {
  return new Error('SYNTHETIC_W75_SMOKE_ORIGINAL', { cause: new Error('SYNTHETIC_W75_SMOKE_CAUSE') });
}

function smokeFixture(context, targetName, bridge) {
  const observeFailure = vi.fn(createSupportBundleSmokeFailureCapture(context));
  const execute = vi.fn(bridge);
  const target = join(profile, targetName);
  return { target, execute, observeFailure, options: { kind: 'desktopOnly', system,
    mainWindow: { webContents: { executeJavaScript: execute } }, observeFailure, supportBundlePath: target } };
}

function rejectedBridgeFixture(context, targetName) {
  const original = createSmokeBridgeError();
  return { ...smokeFixture(context, targetName, async () => { throw original; }), original };
}

function assertOriginalObserved(fixture) {
  expect(fixture.execute).toHaveBeenCalledExactlyOnceWith('window.ekyDesktop.createSupportBundle()', true);
  expect(fixture.observeFailure.mock.calls[0]?.[0] === fixture.original).toBe(true);
}

function assertSafePrimary(error, original) {
  expect(error).toBeInstanceOf(Error);
  expect(error === original).toBe(false);
  expect(error.message).toBe('DESKTOP_SMOKE_SUPPORT_BUNDLE_INVALID');
  expect(error.cause === undefined).toBe(true);
  expect(inspect(error).includes(original.message)).toBe(false);
  expect(inspect(error).includes(original.cause.message)).toBe(false);
}

test(names.success, async context => {
  const archive = createDesktopOnlySupportBundleArchive({
    createdAt: new Date('2026-07-27T12:30:00.000Z'),
    creationCorrelationId: '22222222-2222-4222-8222-222222222222',
    desktopData: { system, availability: { backend: 'exitUnconfirmed', database: 'notInspected',
      diagnosticHistory: 'notCollected', incidentHistory: 'notCollected' },
      observation: { scope: 'currentOperation', status: 'unavailable' } },
  });
  const fixture = smokeFixture(context, 'success.json.gz', async () => {
    await writeFile(fixture.target, archive.compressed, { flag: 'wx', mode: 0o600 });
    const bytes = await readFile(fixture.target);
    expect(bytes.equals(archive.compressed)).toBe(true);
    expect(JSON.parse(gunzipSync(bytes)).manifest.supportBundleFormatVersion).toBe(3);
    return 'created';
  });
  await runPackagedSupportBundleSmoke(fixture.options);
  expect(fixture.execute).toHaveBeenCalledExactlyOnceWith('window.ekyDesktop.createSupportBundle()', true);
  expect(fixture.observeFailure).not.toHaveBeenCalled();
  await expect(readFile(fixture.target)).rejects.toMatchObject({ code: 'ENOENT' });
  completed.success = true;
});

test(names.expectedReject, async context => {
  const fixture = rejectedBridgeFixture(context, 'expected.json.gz');
  await expect(runPackagedSupportBundleSmoke(fixture.options)).rejects.toThrow('DESKTOP_SMOKE_SUPPORT_BUNDLE_INVALID');
  assertOriginalObserved(fixture);
  expect(fixture.observeFailure).toHaveBeenCalledOnce();
  await expect(readFile(fixture.target)).rejects.toMatchObject({ code: 'ENOENT' });
  completed.expectedReject = true;
});

test.fails(names.expectedAssertion, async context => {
  const fixture = rejectedBridgeFixture(context, 'expected-assertion.json.gz');
  await expect(runPackagedSupportBundleSmoke(fixture.options)).rejects.toThrow('DESKTOP_SMOKE_SUPPORT_BUNDLE_INVALID');
  assertOriginalObserved(fixture);
  expect(fixture.observeFailure).toHaveBeenCalledOnce();
  await expect(readFile(fixture.target)).rejects.toMatchObject({ code: 'ENOENT' });
  completed.expectedAssertion = true;
  expect(false, 'SUPPORT_SMOKE_EXPECTED_FAILURE_CONTROL').toBe(true);
});

test(names.primary, async context => {
  const fixture = rejectedBridgeFixture(context, 'primary.json.gz');
  process.env.SYNTHETIC_SUPPORT_SMOKE_SECRET = 'SYNTHETIC_W75_SMOKE_LATE_SECRET';
  fixture.original.stack += '\\n' + process.env.SYNTHETIC_SUPPORT_SMOKE_SECRET;
  const failure = await runPackagedSupportBundleSmoke(fixture.options).catch(error => error);
  assertOriginalObserved(fixture); assertSafePrimary(failure, fixture.original);
  expect(fixture.observeFailure).toHaveBeenCalledOnce();
  await expect(readFile(fixture.target)).rejects.toMatchObject({ code: 'ENOENT' });
  completed.primary = true;
  expect(false, 'SUPPORT_SMOKE_EXPECTED_SUCCESS').toBe(true);
});

test(names.combined, async context => {
  const fixture = rejectedBridgeFixture(context, 'retained-directory');
  await mkdir(fixture.target);
  const sentinel = join(fixture.target, 'sentinel.bin');
  await writeFile(sentinel, sentinelBytes, { flag: 'wx', mode: 0o600 });
  const failure = await runPackagedSupportBundleSmoke(fixture.options).catch(error => error);
  assertOriginalObserved(fixture);
  expect(fixture.observeFailure).toHaveBeenCalledTimes(2);
  const cleanup = fixture.observeFailure.mock.calls[1]?.[0];
  expect(cleanup).toBeInstanceOf(Error);
  expect(cleanup === fixture.original).toBe(false);
  expect(cleanup.message.includes('retained-directory')).toBe(true);
  expect(cleanup.stack.includes('retained-directory')).toBe(true);
  expect(failure).toBeInstanceOf(AggregateError);
  expect(failure.message).toBe('DESKTOP_SMOKE_SUPPORT_BUNDLE_INVALID');
  expect(failure.errors).toHaveLength(2);
  expect(failure.cause === failure.errors[0]).toBe(true);
  assertSafePrimary(failure.errors[0], fixture.original);
  expect(failure.errors[1].message).toBe('DESKTOP_SMOKE_SUPPORT_BUNDLE_CLEANUP_FAILED');
  expect(failure.errors[1] === cleanup).toBe(false);
  expect(failure.errors[1].cause === undefined).toBe(true);
  const publicFailure = inspect(failure);
  expect(publicFailure.includes(fixture.original.message)).toBe(false);
  expect(publicFailure.includes(fixture.original.cause.message)).toBe(false);
  expect(publicFailure.includes('retained-directory')).toBe(false);
  expect((await readFile(sentinel)).equals(sentinelBytes)).toBe(true);
  completed.combined = true;
  expect(false, 'SUPPORT_SMOKE_EXPECTED_SUCCESS').toBe(true);
});`, { flag: 'wx', mode: 0o600 });
  const env = { ...process.env, ...binding, CI: '1', NO_COLOR: '1', TEMP: temp, TMP: temp, TMPDIR: temp };
  delete env.NODE_TEST_CONTEXT; delete env.FORCE_COLOR;
  const child = spawnSync(process.execPath, [join(root, 'node_modules/vitest/vitest.mjs'),
    'run', '--config', config,
    '--reporter=' + fileURLToPath(new URL('../vitestFailureReporter.mjs', import.meta.url))], {
    cwd: directory, env, encoding: 'utf8', timeout: 10_000, maxBuffer: 128 * 1024, windowsHide: true,
  });
  await writeFile(join(directory, 'output.private.json'), JSON.stringify({ status: child.status,
    signal: child.signal, stdout: child.stdout, stderr: child.stderr, processError: child.error?.code ?? null }),
  { flag: 'wx', mode: 0o600 });
  assert.equal(child.error, undefined, 'SUPPORT_SMOKE_WORKER_PROCESS_FAILED');
  assert.equal(child.signal, null); assert.equal(child.status, 1, 'SUPPORT_SMOKE_ASSERTIONS_MUST_FAIL');
  const output = (child.stdout ?? '') + (child.stderr ?? '');
  for (const marker of ['SYNTHETIC_W75_SMOKE_ORIGINAL', 'SYNTHETIC_W75_SMOKE_CAUSE',
    'SYNTHETIC_W75_SMOKE_LATE_SECRET', 'retained-directory']) {
    assert.equal(output.includes(marker), false, 'SUPPORT_SMOKE_ORIGINAL_LEAKED_TO_PUBLIC_OUTPUT');
  }
  assert.deepEqual(JSON.parse(await readFile(receiptPath, 'utf8')),
    { success: true, expectedReject: true, expectedAssertion: true, primary: true, combined: true },
    'SUPPORT_SMOKE_CONTROL_NOT_COMPLETED');
}

async function runInspectionFailureWorker(parent, temp, binding) {
  const directory = join(parent, 'inspection-worker');
  await mkdir(directory);
  const moduleUrl = path => new URL(path, import.meta.url).href;
  const file = join(directory, 'inspection.test.mjs');
  const config = join(directory, 'vitest.config.mjs');
  await writeFile(config, `export default { resolve: { alias: {
    vitest: ${JSON.stringify(fileURLToPath(new URL('../../node_modules/vitest/dist/index.js', import.meta.url)))}
  } }, test: { include: ['inspection.test.mjs'],
    maxWorkers: 1, fileParallelism: false, retry: 0, testTimeout: 5000,
    hookTimeout: 2000, includeTaskLocation: true } };`, { flag: 'wx', mode: 0o600 });
  await writeFile(file, `import { resolve, join } from 'node:path';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { test, expect, vi } from 'vitest';
import { runProfileSnapshotInspection } from ${JSON.stringify(moduleUrl('../../apps/desktop/src/profileBackup/runProfileSnapshotInspection.ts'))};
import { createRunnerFailureSink } from ${JSON.stringify(moduleUrl('../runnerFailureEvidence.mjs'))};
import { deletionProcessFixture } from ${JSON.stringify(moduleUrl('../../apps/desktop/src/workspaces/deletion/workspaceDeletionProcessTestSupport.ts'))};
import { observeDeletionCommandFailures } from ${JSON.stringify(moduleUrl('../../apps/desktop/src/workspaces/deletion/workspaceDeletionCommandEvidenceTestSupport.ts'))};
import { createWorkspaceDeletionCommand } from ${JSON.stringify(moduleUrl('../../apps/desktop/src/workspaces/deletion/workspaceDeletionCommand.ts'))};
import * as publication from ${JSON.stringify(moduleUrl('../../apps/desktop/src/workspaces/deletion/workspaceDeletionPublication.ts'))};
import { WorkspaceDeletionInventoryStore, createWorkspaceDeletionInventoryPaths } from ${JSON.stringify(moduleUrl('../../apps/desktop/src/workspaces/deletion/workspaceDeletionInventoryStore.ts'))};
import { assertWorkspaceDeletionInventoryRetired, retireWorkspaceDeletionInventory } from ${JSON.stringify(moduleUrl('../../apps/desktop/src/workspaces/deletion/workspaceDeletionInventoryRetirement.ts'))};
import { deletionInventoryRetirementFixture } from ${JSON.stringify(moduleUrl('../../apps/desktop/src/workspaces/deletion/workspaceDeletionInventoryStoreTestSupport.ts'))};
import * as terminalFiles from ${JSON.stringify(moduleUrl('../../apps/desktop/src/workspaces/deletion/workspaceDeletionInventoryFile.ts'))};
import { deletionTestJournal, deletionTestRecords } from ${JSON.stringify(moduleUrl('../../apps/desktop/src/workspaces/deletion/workspaceDeletionDataTestSupport.ts'))};
import { WorkspaceManagementService } from ${JSON.stringify(moduleUrl('../../apps/desktop/src/workspaces/management/workspaceManagementService.ts'))};
import { InMemoryWorkspaceMaintenanceLease } from ${JSON.stringify(moduleUrl('../../apps/desktop/src/workspaces/maintenance/workspaceMaintenanceLease.ts'))};
import { projectWorkspaceDeletionExecutionFailure } from ${JSON.stringify(moduleUrl('../../apps/desktop/e2e/workspaceDeletionExecutionProof.ts'))};
import { captureWorkspaceDeletionFailure } from ${JSON.stringify(moduleUrl('../../apps/e2e/src/fixtures/captureWorkspaceDeletionFailure.ts'))};
import { workspaceInspectionRemnantReads } from ${JSON.stringify(moduleUrl('../../apps/desktop/src/workspaces/deletion/workspaceInspectionRemnantAbsence.ts'))};
import { captureWorkspaceDeletionOriginalPayloadAbsence } from ${JSON.stringify(moduleUrl('../../apps/desktop/src/workspaces/deletion/workspaceDeletionOriginalPayloadAbsence.ts'))};
import * as originalPayload from ${JSON.stringify(moduleUrl('../../apps/desktop/src/workspaces/deletion/workspaceDeletionOriginalPayloadAbsence.ts'))};
import { createWorkspaceDeletionFinalizer } from ${JSON.stringify(moduleUrl('../../apps/desktop/src/workspaces/deletion/workspaceDeletionFinalization.ts'))};
import { createWorkspaceDeletionFinalizationTestFixture, captureWorkspaceDeletionMetadataPostClearTestFailure, captureWorkspaceDeletionPurgedInventoryTestFailure, captureWorkspaceDeletionTerminalPrefixTestFailure, captureWorkspaceDeletionPublicationPrefixTestFailure, captureWorkspaceDeletionRetirementReadTestFailure } from ${JSON.stringify(moduleUrl('../../apps/desktop/src/workspaces/deletion/workspaceDeletionFinalizationTestSupport.ts'))};
import { captureWorkspaceDeletionPayloadJournalTestFailure } from ${JSON.stringify(moduleUrl('../../apps/desktop/src/workspaces/deletion/workspaceDeletionJournalReadTestSupport.ts'))};
import { remnantBindingFixture } from ${JSON.stringify(moduleUrl('../../apps/desktop/src/workspaces/deletion/workspaceRemnantBindingTestSupport.ts'))};
import { prepareWorkspaceDeletion, WorkspaceDeletionPreparationFailure } from ${JSON.stringify(moduleUrl('../../apps/desktop/src/workspaces/management/workspaceDeletionPreparation.ts'))};
import { WorkspaceRegistryStore } from ${JSON.stringify(moduleUrl('../../apps/desktop/src/workspaces/registry/workspaceRegistryStore.ts'))};
import { createWorkspaceDeletionRegistryPublisher } from ${JSON.stringify(moduleUrl('../../apps/desktop/src/workspaces/deletion/workspaceDeletionRegistryPublication.ts'))};
import { EventEmitter } from 'node:events';
import { inspect } from 'node:util';
import { createSupportBundleCapability, createDesktopOnlySupportBundleExport, createDesktopOnlySupportBundleCapability } from ${JSON.stringify(moduleUrl('../../apps/desktop/src/supportBundle/supportBundleCapability.ts'))};
import * as registryPhases from ${JSON.stringify(moduleUrl('../../apps/desktop/src/workspaces/deletion/workspaceDeletionPhaseSelection.ts'))};
import { WORKSPACE_REGISTRY_FILE_NAME } from ${JSON.stringify(moduleUrl('../../apps/desktop/src/workspaces/registry/workspaceRegistryPaths.ts'))};
import { deriveWorkspaceRoot } from ${JSON.stringify(moduleUrl('../../apps/desktop/src/workspaces/registry/deriveWorkspaceRoot.ts'))};
import { createSwitchRegistry, TEST_TARGET_WORKSPACE_ID } from ${JSON.stringify(moduleUrl('../../apps/desktop/src/workspaces/switch/workspaceSwitchTestSupport.ts'))};
const absenceIo = vi.hoisted(() => ({ result: undefined, calls: 0 }));
const terminalIo = vi.hoisted(() => ({ enabled: false, ownerCurrent: true, parentPath: '',
  directoryPath: '', parentIdentity: '', error: undefined, calls: 0 }));
vi.mock(${JSON.stringify(moduleUrl('../../apps/desktop/src/workspaces/deletion/workspaceDeletionInventoryFile.ts'))}, async importOriginal => {
  const actual = await importOriginal();
  return { ...actual, workspaceDeletionInventoryDirectoryReads: {
    ...actual.workspaceDeletionInventoryDirectoryReads,
    identity(path, assertCurrent) {
      if (!terminalIo.enabled) return actual.workspaceDeletionInventoryDirectoryReads.identity(path, assertCurrent);
      assertCurrent(); terminalIo.calls++;
      if (path === terminalIo.parentPath) return Promise.resolve(terminalIo.parentIdentity);
      if (path === terminalIo.directoryPath) {
        const rejected = Promise.reject(terminalIo.error);
        terminalIo.ownerCurrent = false;
        return rejected;
      }
      throw new Error('UNEXPECTED_TERMINAL_EVIDENCE_READ');
    },
  } };
});
vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal();
  return { ...actual, lstat(path, ...args) {
    if (path === 'synthetic-absence-evidence') {
      absenceIo.calls++;
      if (absenceIo.result === undefined) throw new Error('UNEXPECTED_ABSENCE_EVIDENCE_READ');
      return absenceIo.result;
    }
    return actual.lstat(path, ...args);
  } };
});
vi.mock('electron', () => ({ utilityProcess: { fork: vi.fn(() => { throw new Error('UNEXPECTED_INSPECTION_FORK'); }) } }));
function createExecutionFailure() {
  return Object.assign(new Error('SYNTHETIC_W74_EXECUTION_ORIGINAL',
    { cause: new AggregateError([new Error('SYNTHETIC_W74_EXECUTION_READ'),
      new Error('SYNTHETIC_W74_EXECUTION_CLOSE')], 'SYNTHETIC_W74_EXECUTION_CAUSE') }), { code: 'EIO' });
}
async function deliverExecutionFailure(failure, group) {
  const projection = projectWorkspaceDeletionExecutionFailure(failure, 'synthetic-secret');
  const testInfo = { title: 'Synthetic execution aggregate: ' + group, testId: 'w74-execution-' + group,
    file: 'electron/workspaceDeletionExecution.spec.ts', line: 1, column: 1,
    retry: 0, repeatEachIndex: 0, annotations: [] };
  await captureWorkspaceDeletionFailure({ application: { evaluate: async () => projection },
    runtimeInstanceId: '11111111-1111-4111-8111-111111111111', testInfo });
  expect(testInfo.annotations[0]?.description === 'recorded').toBe(true);
}
test('execution adapters and preparation keep original causes through projection and delivery', async context => {
  const original = createExecutionFailure();
  let rejectRead, ownerCurrent = true;
  absenceIo.result = new Promise((_resolve, reject) => { rejectRead = reject; });
  void absenceIo.result.catch(() => undefined);
  let failure, outcome;
  try {
    outcome = workspaceInspectionRemnantReads.assertAbsent('synthetic-absence-evidence', () => {
      context.signal.throwIfAborted();
      if (!ownerCurrent) throw new Error('SYNTHETIC_W74_EXECUTION_OWNER_LOST');
    }).then(() => undefined, error => error);
    // Reject first, then revoke before the actual reader's catch resumes.
    rejectRead(original); ownerCurrent = false;
    failure = await outcome;
  } finally {
    ownerCurrent = false; rejectRead(original);
    await outcome;
    absenceIo.result = undefined;
  }
  expect(absenceIo.calls).toBe(1);
  expect(failure === original).toBe(true);
  // Exercise the actual terminal catch too; its identity-read response is controlled, not native IO.
  const terminalRoot = resolve('unused-terminal-evidence-root');
  const terminalJournal = { ...deletionTestJournal(), phase: 'registryPublished' };
  const terminalPaths = createWorkspaceDeletionInventoryPaths(terminalRoot, terminalJournal.target.operationId);
  Object.assign(terminalIo, { enabled: true, ownerCurrent: true, parentPath: terminalPaths.parentPath,
    directoryPath: terminalPaths.directoryPath, parentIdentity: terminalJournal.operationParentIdentity, error: original, calls: 0 });
  try {
    failure = await assertWorkspaceDeletionInventoryRetired(terminalRoot, terminalJournal, {
      assertAuthority() {
        context.signal.throwIfAborted();
        if (!terminalIo.ownerCurrent) throw new Error('SYNTHETIC_W74_TERMINAL_OWNER_LOST');
      },
      async assertExternalSelection() {},
    }).then(() => undefined, error => error);
  } finally { terminalIo.enabled = false; }
  expect(terminalIo.calls).toBe(2);
  expect(failure === original).toBe(true);
  // Enter the actual native removal adapter, whose mapping must not erase the
  // retirement owner's original guard error. Identity response is controlled.
  const native = await deletionInventoryRetirementFixture(context);
  const beforeNative = await native.snapshot();
  const removeNative = native.fileSystem.removeSlot.bind(native.fileSystem);
  let inNativeRemoval = false, nativeGuardReached = false;
  native.fileSystem.removeSlot = async (...args) => {
    inNativeRemoval = true;
    try { return await removeNative(...args); } finally { inNativeRemoval = false; }
  };
  const identitySpy = vi.spyOn(terminalFiles.workspaceDeletionInventoryDirectoryReads, 'identity').mockImplementation(async (path, current) => {
    if (inNativeRemoval && path === native.paths.directoryPath) { nativeGuardReached = true; throw original; }
    return terminalFiles.readDeletionInventoryDirectoryIdentity(path, current);
  });
  try {
    failure = await retireWorkspaceDeletionInventory(native.root, native.expected, native.authority,
      { inventory: native.fileSystem }).then(() => undefined, error => error);
  } finally { identitySpy.mockRestore(); }
  expect(nativeGuardReached).toBe(true); expect(failure === original).toBe(true);
  expect(await native.snapshot()).toEqual(beforeNative);
  // The finite original-root reader must deliver the same first cause after
  // its read-only owner port rejects and the outer authority is revoked.
  const originalRoot = await remnantBindingFixture(context, 'workspaceImport');
  let originalReadEnabled = false, originalOwnerCurrent = true, originalReadReached = false;
  const assertOriginalCurrent = () => {
    context.signal.throwIfAborted();
    if (!originalOwnerCurrent) throw new Error('SYNTHETIC_W74_ORIGINAL_READ_OWNER_LOST');
    originalRoot.authority.assertAuthority();
  };
  const originalAbsence = await captureWorkspaceDeletionOriginalPayloadAbsence(originalRoot.root, originalRoot.binding, {
    assertAuthority: assertOriginalCurrent,
    async assertExternalSelection() { assertOriginalCurrent(); },
    async assertWritersAbsent() { assertOriginalCurrent(); },
    async assertReadSelection() {
      if (originalReadEnabled) { originalReadReached = true; originalOwnerCurrent = false; throw original; }
      assertOriginalCurrent();
    },
  });
  originalReadEnabled = true;
  failure = await originalAbsence.assertAbsent().then(() => undefined, error => error);
  expect(originalReadReached).toBe(true); expect(failure === original).toBe(true);
  // Exercise the actual finalizer's new original-read callback before the same
  // projection. A different cleanup failure must not replace its first cause.
  const finalized = await createWorkspaceDeletionFinalizationTestFixture(context, true, true);
  const captureOriginal = originalPayload.captureWorkspaceDeletionOriginalPayloadAbsence;
  let finalizerReadArmed = false, finalizerFirstCaught = false;
  const finalizerSpy = vi.spyOn(originalPayload, 'captureWorkspaceDeletionOriginalPayloadAbsence').mockImplementation(async (...args) => {
    const authority = args[2], read = authority.assertReadSelection;
    expect(typeof read).toBe('function');
    try {
      return await captureOriginal(args[0], args[1], { ...authority,
        async assertReadSelection() { finalizerReadArmed = true; await read(); },
      });
    } catch (error) {
      finalizerFirstCaught = error === original; finalized.revoke();
      throw new Error('SYNTHETIC_W74_FINALIZER_CLEANUP');
    }
  });
  const finalize = createWorkspaceDeletionFinalizer({ userDataRoot: finalized.root, registry: finalized.registry,
    async assertWritersAbsent() {
      finalized.authority.assertCurrent(); if (finalizerReadArmed) throw original;
    } });
  try {
    failure = await finalized.track(finalize(finalized.header.operationId, finalized.authority))
      .then(() => undefined, error => error);
  } finally { finalizerSpy.mockRestore(); }
  expect(finalizerReadArmed).toBe(true); expect(finalizerFirstCaught).toBe(true);
  expect(failure === original).toBe(true); await finalized.preserved();
  // Feed the actual preparation read failure through the same projection and
  // encrypted records. Its independent stop failure must not become the cause.
  const preparationRoot = await fs.mkdtemp(join(tmpdir(), 'eky-preparation-evidence-'));
  context.onTestFinished(async () => {
    if (context.task.result?.state === 'pass') await fs.rm(preparationRoot, { recursive: true, force: true });
  });
  const registryPath = join(preparationRoot, WORKSPACE_REGISTRY_FILE_NAME);
  const registry = new WorkspaceRegistryStore({ installationRoot: preparationRoot, filePath: registryPath });
  const initial = { ...createSwitchRegistry(), formatVersion: 2, activeWorkspaceId: null };
  await registry.write(initial);
  const targetEntry = initial.workspaces.find(entry => entry.workspaceId === TEST_TARGET_WORKSPACE_ID);
  const workspaceRoot = deriveWorkspaceRoot(preparationRoot, TEST_TARGET_WORKSPACE_ID, 1).workspaceRoot;
  await fs.mkdir(workspaceRoot, { recursive: true });
  const sentinel = join(workspaceRoot, 'retained'); await fs.writeFile(sentinel, 'synthetic company');
  const registryBytes = await fs.readFile(registryPath);
  const stopFailure = new Error('SYNTHETIC_W74_PREPARATION_STOP_FAILURE');
  let readArmed = false, stopped = false, preparationReadReached = false;
  const preparationFailure = await prepareWorkspaceDeletion({
    operationId: '11111111-1111-4111-8111-111111111111',
    runtimeGeneration: '22222222-2222-4222-8222-222222222222',
    installationRoot: preparationRoot, registry,
    request: { formatVersion: 1, workspaceId: TEST_TARGET_WORKSPACE_ID,
      typedLabel: targetEntry.workspaceLabel, backupChoice: 'explicitDataLoss' },
    lifetime: { assertCurrent() { context.signal.throwIfAborted(); }, closeAdmissionForOwnStop() {} },
    assertLease() { context.signal.throwIfAborted(); }, assertMainReservationCurrent() {},
    async assertMainReservation() { if (readArmed) { preparationReadReached = true; throw original; } },
    closeServiceAdmission() {}, async confirmDataLoss() { return true; },
    async confirmDeletion() { return true; }, async confirmReturn() { throw new Error('UNEXPECTED_RETURN'); }, setReturnGuard() {},
    runtime: { kind: 'selector', lifecycle: {
      async quiesceWrites() {}, async stopAndProveHandlesClosed() { if (readArmed) throw stopFailure; stopped = true; },
      assertStoppedCurrent() { expect(stopped).toBe(true); }, async assertNoActiveWorkspaceRuntime() { expect(stopped).toBe(true); },
      async ensurePreviousWorkspaceRunning() { throw new Error('UNEXPECTED_RESTART'); },
    } },
    async publish(_guard, _selection, _target, _context, _full, read) {
      expect(typeof read).toBe('function'); readArmed = true; await read();
      throw new Error('UNEXPECTED_PREPARATION_SUCCESS');
    },
  }).then(() => undefined, error => error);
  expect(preparationReadReached).toBe(true);
  expect(preparationFailure).toBeInstanceOf(WorkspaceDeletionPreparationFailure);
  expect(preparationFailure.firstFailure === original).toBe(true);
  expect(preparationFailure.cleanupFailure === stopFailure).toBe(true);
  expect(await fs.readFile(registryPath)).toEqual(registryBytes);
  expect(await fs.readFile(sentinel, 'utf8')).toBe('synthetic company');
  failure = preparationFailure.firstFailure;
  // Exercise the registry publisher's real inventory read and joined file close.
  // Phase selection is controlled here; its native checks have separate regressions.
  const registryRead = await deletionInventoryRetirementFixture(context, 'purged');
  const registryReadBefore = await registryRead.snapshot();
  const journalSlots = (await registryRead.journal.inspect(registryRead.authority.assertAuthority)).slots;
  const phaseSpy = vi.spyOn(registryPhases, 'captureWorkspaceDeletionPhaseSelection').mockResolvedValue({
    journal: registryRead.expected, journalSlots,
    registrySlots: { current: undefined, next: undefined, backup: undefined },
    registryState: 'before', registryNeedsRecovery: false, afterRegistry: initial,
    assertCurrent: registryRead.authority.assertAuthority,
    async assertSelected() {}, async assertExternalSelection() {},
    async assertJournalSelected() {}, async assertJournalReadOwned() {}, revoke() {},
  });
  const openRegistryInventory = terminalFiles.openWorkspaceDeletionInventoryFile;
  const registryClose = new Error('SYNTHETIC_W74_REGISTRY_CLOSE');
  let registryClosed = 0;
  const readSpy = vi.spyOn(terminalFiles, 'openWorkspaceDeletionInventoryFile').mockImplementation(async (...args) => {
    expect(args[0]).toBe(registryRead.paths.currentPath); expect(args[1]).toBe('r');
    const file = await openRegistryInventory(...args);
    return { ...file, async read() { throw original; }, async close() {
      await file.close(); registryClosed++; throw registryClose;
    } };
  });
  const neverRegistry = async () => { throw new Error('UNEXPECTED_REGISTRY_PUBLICATION'); };
  const publishRegistry = createWorkspaceDeletionRegistryPublisher({ userDataRoot: registryRead.root,
    registry: { inspectSlots: neverRegistry, writeSelected: neverRegistry, recoverSelected: neverRegistry },
    async assertWritersAbsent() { registryRead.authority.assertAuthority(); } });
  let registryFailure;
  try {
    registryFailure = await publishRegistry(registryRead.expected.target.operationId, {
      assertCurrent: registryRead.authority.assertAuthority,
      async assertOwned() { registryRead.authority.assertAuthority(); },
    }).then(() => undefined, error => error);
  } finally { readSpy.mockRestore(); phaseSpy.mockRestore(); }
  expect(registryClosed).toBe(1);
  expect(registryFailure).toBeInstanceOf(AggregateError);
  expect(registryFailure.errors[0] === original).toBe(true);
  expect(registryFailure.errors[1] === registryClose).toBe(true);
  expect(await registryRead.snapshot()).toEqual(registryReadBefore);
  await deliverExecutionFailure(failure, 'preparation');
});
test('metadata post-clear keeps original causes through projection and delivery', async context => {
  const original = createExecutionFailure();
  // The actual post-read/outer-close chain reuses the existing sibling projection.
  // Its close object is the same one checked in the unchanged decrypted records.
  const postClose = original.cause.errors[1];
  const metadataFailure = await captureWorkspaceDeletionMetadataPostClearTestFailure(context, original, postClose);
  expect(metadataFailure.errors[0] === original).toBe(true);
  expect(metadataFailure.errors[1] === postClose).toBe(true);
  await deliverExecutionFailure(metadataFailure.errors[0], 'metadataPostClear');
});
test('terminal cleanup keeps original causes through projection and delivery', async context => {
  const original = createExecutionFailure(), postClose = original.cause.errors[1];
  const purgedFailure = await captureWorkspaceDeletionPurgedInventoryTestFailure(context, original, postClose);
  expect(purgedFailure.errors[0] === original).toBe(true);
  expect(purgedFailure.errors[1] === postClose).toBe(true);
  let failure = await captureWorkspaceDeletionTerminalPrefixTestFailure(context, original);
  expect(failure === original).toBe(true);
  const retirementFailure = await captureWorkspaceDeletionRetirementReadTestFailure(context, original, postClose);
  expect(retirementFailure.errors[0] === original).toBe(true);
  expect(retirementFailure.errors[1] === postClose).toBe(true);
  failure = retirementFailure.errors[0];
  await deliverExecutionFailure(failure, 'finalization');
});
test('inspection original exception before safe conversion', async context => {
  const original = new Error('SYNTHETIC_W74_INSPECTION_ORIGINAL', { cause: new Error('SYNTHETIC_W74_INSPECTION_CAUSE') });
  let first;
  const sink = createRunnerFailureSink();
  context.onTestFailed(async () => {
    if (first === undefined) return;
    const task = context.task;
    sink.record({ runner: 'vitest', phase: 'profileInspectionCatch', error: first,
      testName: task.fullTestName, testId: task.id + ':11111111-1111-4111-8111-111111111111',
      file: task.file.filepath, line: task.location?.line, column: task.location?.column,
      attempt: 0, retryCount: 0, repeatCount: 0 });
    await sink.flush();
  });
  const result = await runProfileSnapshotInspection({
    operationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', target: { kind: 'unbound' },
    kind: 'inspect', migrationPolicy: 'restoreCompatible', runnerPath: resolve('unused-runner'),
    deployment: { backendRoot: resolve('unused-backend'), migrationsDirectory: resolve('unused-migrations'),
      nativeResourceRoot: resolve('unused-native') },
    reservation: { assertMainOwned: async () => {}, invalidate() {}, bind() { throw new Error('UNEXPECTED_BIND'); } },
    readActiveContext: async () => { throw original; }, assertAuthority() {}, signal: new AbortController().signal,
    observeException(error) { first ??= error; },
  }).catch(error => error);
  expect(first === original).toBe(true);
  expect(result.message === 'PROFILE_SNAPSHOT_VALIDATION_FAILED' && result.causeCode === 'unknown' && result.cause === undefined).toBe(true);
  expect(false, 'W74_INSPECTION_EXPECTED_SUCCESS').toBe(true);
});
test('deletion command original exception before safe child result', { timeout: 60000 }, async context => {
  const fixture = await deletionProcessFixture(context);
  const child = fixture.start('publish', 'originalFailure');
  await expect(child.message('completed')).rejects.toThrow('DELETION_PROCESS_PHASE_NOT_REACHED');
  expect(await child.finish()).toEqual({ stdout: '', stderr: '', closed: true });
  expect(false, 'W74_DELETION_EXPECTED_SUCCESS').toBe(true);
});
test('publication comparison original exception through the command observer', async context => {
  const original = new Error('SYNTHETIC_W74_PUBLICATION_ORIGINAL', { cause: new Error('SYNTHETIC_W74_PUBLICATION_CAUSE') });
  const prefixFailure = await captureWorkspaceDeletionPublicationPrefixTestFailure(context, original);
  expect(prefixFailure === original).toBe(true);
  const journal = deletionTestJournal(), root = resolve('unused-deletion-root');
  const selected = { target: journal.target, inventory: journal.inventory,
    inventoryFileIdentity: journal.inventoryFileIdentity, operationRootIdentity: journal.operationRootIdentity,
    operationParentIdentity: journal.operationParentIdentity };
  let comparisons = 0;
  vi.spyOn(WorkspaceDeletionInventoryStore.prototype, 'assertRecords').mockImplementation(async () => {
    if (++comparisons === 2) throw original;
  });
  vi.spyOn(publication, 'createWorkspaceDeletionPublisher').mockReturnValue(async () => {
    const store = new WorkspaceDeletionInventoryStore(root, journal.target.operationId);
    const authority = { assertAuthority() {}, async assertExternalSelection() {} };
    await store.assertRecords(selected, deletionTestRecords(), authority);
    await store.assertRecords(selected, deletionTestRecords(), authority);
    throw new Error('UNEXPECTED_PUBLICATION_SUCCESS');
  });
  const observed = observeDeletionCommandFailures(context);
  observed.preparedRoot(${JSON.stringify(publicationRootIdentity)});
  const never = async () => { throw new Error('UNEXPECTED_PUBLICATION_PORT'); };
  const command = createWorkspaceDeletionCommand({ userDataRoot: root,
    registry: { inspectSlots: never, writeSelected: never, recoverSelected: never }, assertWritersAbsent: never });
  const target = { workspaceId: journal.target.workspaceId, workspaceLabel: 'Synthetic company',
    profileId: journal.target.lineageIdentity.profileId, lifecycleState: 'ready',
    previousActiveWorkspaceId: journal.previousActiveWorkspaceId, registrySha256: journal.registryBeforeSha256,
    registryEntrySha256: journal.target.registryEntrySha256, rootIdentity: journal.inventoryFileIdentity };
  const result = await command.publish(() => {}, async () => {}, target,
    { operationId: journal.target.operationId, target, backupDisposition: 'explicitDataLoss' }, async () => {})
    .catch(error => { observed.record(error); return error; });
  expect(result === original).toBe(true);
  expect(observed.phase()).toBe('publicationComparison2');
  expect(false, 'W74_PUBLICATION_EXPECTED_SUCCESS').toBe(true);
});
test('payload journal original exception before native mapping', { timeout: 30000 }, async context => {
  const original = new Error('SYNTHETIC_W74_PAYLOAD_JOURNAL_ORIGINAL', { cause: new Error('SYNTHETIC_W74_PAYLOAD_JOURNAL_CAUSE') });
  const result = await captureWorkspaceDeletionPayloadJournalTestFailure(context, original);
  const sink = createRunnerFailureSink();
  context.onTestFailed(async () => {
    sink.record({ runner: 'vitest', phase: 'workspaceDeletionPayloadJournal', error: result,
      testName: context.task.fullTestName, testId: context.task.id + ':11111111-1111-4111-8111-111111111111',
      file: context.task.file.filepath, line: context.task.location?.line, column: context.task.location?.column,
      attempt: 0, retryCount: 0, repeatCount: 0 });
    await sink.flush();
  });
  expect(result === original).toBe(true);
  expect(false, 'W74_PAYLOAD_JOURNAL_EXPECTED_SUCCESS').toBe(true);
});
test('cold service original exception after safe management mapping', async context => {
  const original = new Error('SYNTHETIC_W74_COLD_ORIGINAL', { cause: new Error('SYNTHETIC_W74_COLD_CAUSE') });
  const cleanup = new Error('SYNTHETIC_W74_COLD_CLEANUP');
  const journal = deletionTestJournal(), lease = new InMemoryWorkspaceMaintenanceLease(), sink = createRunnerFailureSink();
  const receipt = () => ({ journal, async assertSelected() {}, revoke() {} });
  const result = await WorkspaceManagementService.recoverDeletionBeforeRuntime({
    selection: receipt(), maintenanceLease: lease, async captureSelection() { return receipt(); },
    async captureAuthority() { return { assertCurrent() {}, async assertOwned() {},
      recordRemoved() { throw new Error('SYNTHETIC_UNEXPECTED_REMOVAL'); }, async close() { throw cleanup; } }; },
    async resumeSelected() { throw original; }, assertCurrent() {}, isStopping: () => false, onUncertain() {},
  }).catch(error => error);
  context.onTestFailed(async () => {
    sink.record({ runner: 'vitest', phase: 'workspaceDeletionColdResume', error: result,
      testName: context.task.fullTestName, testId: context.task.id + ':11111111-1111-4111-8111-111111111111',
      file: context.task.file.filepath, line: context.task.location?.line, column: context.task.location?.column,
      attempt: 0, retryCount: 0, repeatCount: 0 });
    await sink.flush();
  });
  expect(result.code).toBe('WORKSPACE_DELETE_FAILED');
  expect(result.cause.errors[0] === original && result.cause.errors[1] === cleanup).toBe(true);
  expect(false, 'W74_COLD_EXPECTED_SUCCESS').toBe(true);
});
test('support export original cause before safe IPC projection', async context => {
  const original = new Error('SYNTHETIC_W75_SUPPORT_ORIGINAL', { cause: new Error('SYNTHETIC_W75_SUPPORT_CAUSE') });
  const sink = createRunnerFailureSink();
  let first, invoke;
  const webContents = Object.assign(new EventEmitter(), { mainFrame: {}, isDestroyed: () => false });
  const mainWindow = Object.assign(new EventEmitter(), { webContents, isDestroyed: () => false });
  const capability = createSupportBundleCapability({
    appVersion: '0.2.81', architecture: 'x64', platform: 'win32', runtimeRoot: process.env.TMPDIR,
    ipcMain: { handle(_channel, handler) { invoke = handler; }, removeHandler() {} }, mainWindow,
    async confirmCreation() { return true; }, async selectTargetPath() { return join(process.env.TMPDIR, 'not-written.json.gz'); },
    async loadBackendData() { throw original; },
    observeFailure(error) { first ??= { error }; },
    operationalIdentity: { appVersion: '0.2.81', buildRevision: 'a'.repeat(40),
      runtimeInstanceId: '11111111-1111-4111-8111-111111111111' },
    operationalLogger: { write() { throw new Error('SYNTHETIC_W75_SUPPORT_LOG_FAILED'); } },
    showSafeError() { throw new Error('SYNTHETIC_W75_SUPPORT_NOTICE_FAILED'); },
    writeArchive() { throw new Error('SUPPORT_MUST_NOT_WRITE'); },
  });
  context.onTestFailed(async () => {
    if (first === undefined) return;
    sink.record({ runner: 'vitest', phase: 'supportBundleCreationCatch', error: first.error,
      testName: context.task.fullTestName, testId: context.task.id + ':11111111-1111-4111-8111-111111111111',
      file: context.task.file.filepath, line: context.task.location?.line, column: context.task.location?.column,
      attempt: 0, retryCount: 0, repeatCount: 0 });
    await sink.flush();
  });
  let result;
  try { result = await invoke({ sender: webContents, senderFrame: webContents.mainFrame }).catch(error => error); }
  finally { capability.dispose(); }
  expect(result.message).toBe('SUPPORT_BUNDLE_CREATION_FAILED');
  expect(result.cause).toBeUndefined();
  expect(first?.error === original).toBe(true);
  expect(inspect(result).includes('SYNTHETIC_W75_SUPPORT')).toBe(false);
  expect(false, 'W75_SUPPORT_EXPECTED_SUCCESS').toBe(true);
});
test('window support capture original cause before any native dialog', async context => {
  const original = new Error('SYNTHETIC_W75_CAPTURE_ORIGINAL', { cause: new Error('SYNTHETIC_W75_CAPTURE_CAUSE') });
  const sink = createRunnerFailureSink();
  let first, invoke;
  const webContents = Object.assign(new EventEmitter(), { mainFrame: {}, isDestroyed: () => false });
  const mainWindow = Object.assign(new EventEmitter(), { webContents, isDestroyed: () => false });
  const confirmCreation = vi.fn(async () => true);
  const selectTargetPath = vi.fn(async () => null);
  const writeArchive = vi.fn();
  const capability = createDesktopOnlySupportBundleCapability({
    runtimeRoot: process.env.TMPDIR, mainWindow,
    ipcMain: { handle(_channel, handler) { invoke = handler; }, removeHandler() {} },
    captureRequest() { throw original; }, confirmCreation, selectTargetPath, writeArchive,
    observeFailure(error) { first ??= { error }; }, showSafeError() { throw new Error('CAPTURE_MUST_NOT_SHOW_NOTICE'); },
    operationalIdentity: { appVersion: '0.2.81', buildRevision: 'a'.repeat(40),
      runtimeInstanceId: '11111111-1111-4111-8111-111111111111' },
    operationalLogger: { write() {} },
  });
  context.onTestFailed(async () => {
    if (first === undefined) return;
    sink.record({ runner: 'vitest', phase: 'supportBundleRequestCapture', error: first.error,
      testName: context.task.fullTestName, testId: context.task.id + ':11111111-1111-4111-8111-111111111111',
      file: context.task.file.filepath, line: context.task.location?.line, column: context.task.location?.column,
      attempt: 0, retryCount: 0, repeatCount: 0 });
    await sink.flush();
  });
  let result;
  try { result = await invoke({ sender: webContents, senderFrame: webContents.mainFrame }).catch(error => error); }
  finally { capability.dispose(); }
  expect(result.message).toBe('SUPPORT_BUNDLE_FORBIDDEN');
  expect(result.cause).toBeUndefined();
  expect(first?.error === original).toBe(true);
  expect(confirmCreation).not.toHaveBeenCalled(); expect(selectTargetPath).not.toHaveBeenCalled();
  expect(writeArchive).not.toHaveBeenCalled();
  expect(inspect(result).includes('SYNTHETIC_W75_CAPTURE')).toBe(false);
  expect(false, 'W75_CAPTURE_EXPECTED_SUCCESS').toBe(true);
});
test('native support export original cause before the safe result', async context => {
  const original = new Error('SYNTHETIC_W75_NATIVE_SUPPORT_ORIGINAL', { cause: new Error('SYNTHETIC_W75_NATIVE_SUPPORT_CAUSE') });
  const sink = createRunnerFailureSink();
  let first;
  const capability = createDesktopOnlySupportBundleExport({
    assertCurrent() {}, runtimeRoot: process.env.TMPDIR,
    async confirmCreation() { return true; }, async selectTargetPath() { return join(process.env.TMPDIR, 'native-not-written.json.gz'); },
    loadDesktopData() { throw original; }, observeFailure(error) { first ??= { error }; },
    operationalIdentity: { appVersion: '0.2.81', buildRevision: 'a'.repeat(40),
      runtimeInstanceId: '11111111-1111-4111-8111-111111111111' },
    operationalLogger: { write() { throw new Error('SYNTHETIC_W75_NATIVE_SUPPORT_LOG_FAILED'); } },
    showSafeError() { throw new Error('SYNTHETIC_W75_NATIVE_SUPPORT_NOTICE_FAILED'); },
    writeArchive() { throw new Error('NATIVE_SUPPORT_MUST_NOT_WRITE'); },
  });
  context.onTestFailed(async () => {
    if (first === undefined) return;
    sink.record({ runner: 'vitest', phase: 'supportBundleNativeCreationCatch', error: first.error,
      testName: context.task.fullTestName, testId: context.task.id + ':11111111-1111-4111-8111-111111111111',
      file: context.task.file.filepath, line: context.task.location?.line, column: context.task.location?.column,
      attempt: 0, retryCount: 0, repeatCount: 0 });
    await sink.flush();
  });
  let result;
  try { result = await capability.create().catch(error => error); }
  finally { capability.dispose(); }
  expect(result.message).toBe('SUPPORT_BUNDLE_CREATION_FAILED');
  expect(result.cause).toBeUndefined();
  expect(first?.error === original).toBe(true);
  expect(inspect(result).includes('SYNTHETIC_W75_NATIVE_SUPPORT')).toBe(false);
  expect(false, 'W75_NATIVE_SUPPORT_EXPECTED_SUCCESS').toBe(true);
});`, { flag: 'wx', mode: 0o600 });
  const env = { ...process.env, ...binding, CI: '1', NO_COLOR: '1', TEMP: temp, TMP: temp, TMPDIR: temp,
    SYNTHETIC_PUBLICATION_FIXTURE_SECRET: 'root' };
  delete env.NODE_TEST_CONTEXT; delete env.FORCE_COLOR;
  const child = spawnSync(process.execPath, [join(root, 'node_modules/vitest/vitest.mjs'),
    'run', '--config', config, '--reporter=default',
    '--reporter=' + fileURLToPath(new URL('../vitestFailureReporter.mjs', import.meta.url))], {
    cwd: directory, env, encoding: 'utf8', timeout: 90_000, maxBuffer: 512 * 1024, windowsHide: true,
  });
  await writeFile(join(directory, 'output.private.json'), JSON.stringify({ status: child.status,
    signal: child.signal, stdout: child.stdout, stderr: child.stderr, processError: child.error?.code ?? null }),
  { flag: 'wx', mode: 0o600 });
  assert.equal(child.error === undefined && child.signal === null, true, 'INSPECTION_WORKER_INTERRUPTED');
  assert.equal(child.status, 1, 'INSPECTION_EXPECTED_ASSERTION_DID_NOT_FAIL');
  const output = (child.stdout ?? '') + (child.stderr ?? '');
  assert.equal(/(?:Test|Hook) timed out|Unhandled (?:Error|Rejection)|uncaughtException/u.test(output), false,
    'SYNTHETIC_WORKER_UNEXPECTED_FAILURE');
  const processRoots = (await readdir(temp)).filter(name => /^eky-delete-process-[A-Za-z0-9]{6}$/u.test(name));
  assert.equal(processRoots.length, 1, 'SYNTHETIC_CHILD_FIXTURE_NOT_UNIQUE');
  const closed = JSON.parse(await readFile(join(temp, processRoots[0], 'children.private.json'), 'utf8'));
  assert.equal(closed.length, 1, 'SYNTHETIC_CHILD_RECEIPT_INVALID');
  assert.equal(closed[0].status === 'fulfilled' && closed[0].value?.closed === true, true,
    'SYNTHETIC_CHILD_CLOSE_UNVERIFIED');
  for (const marker of ['SYNTHETIC_W74_INSPECTION_ORIGINAL', 'SYNTHETIC_W74_INSPECTION_CAUSE',
    'SYNTHETIC_W74_EXECUTION_ORIGINAL', 'SYNTHETIC_W74_EXECUTION_CAUSE',
    'SYNTHETIC_W74_EXECUTION_READ', 'SYNTHETIC_W74_EXECUTION_CLOSE', 'SYNTHETIC_W74_EXECUTION_OWNER_LOST',
    'SYNTHETIC_W74_TERMINAL_OWNER_LOST',
    'SYNTHETIC_W74_ORIGINAL_READ_OWNER_LOST',
    'SYNTHETIC_W74_DELETION_ORIGINAL', 'SYNTHETIC_W74_DELETION_CAUSE',
    'SYNTHETIC_W74_PUBLICATION_ORIGINAL', 'SYNTHETIC_W74_PUBLICATION_CAUSE',
    'SYNTHETIC_W74_PAYLOAD_JOURNAL_ORIGINAL', 'SYNTHETIC_W74_PAYLOAD_JOURNAL_CAUSE',
    'SYNTHETIC_W74_COLD_ORIGINAL', 'SYNTHETIC_W74_COLD_CAUSE', 'SYNTHETIC_W74_COLD_CLEANUP',
    'SYNTHETIC_W75_SUPPORT_ORIGINAL', 'SYNTHETIC_W75_SUPPORT_CAUSE',
    'SYNTHETIC_W75_SUPPORT_LOG_FAILED', 'SYNTHETIC_W75_SUPPORT_NOTICE_FAILED',
    'SYNTHETIC_W75_CAPTURE_ORIGINAL', 'SYNTHETIC_W75_CAPTURE_CAUSE',
    'SYNTHETIC_W75_NATIVE_SUPPORT_ORIGINAL', 'SYNTHETIC_W75_NATIVE_SUPPORT_CAUSE',
    'SYNTHETIC_W75_NATIVE_SUPPORT_LOG_FAILED', 'SYNTHETIC_W75_NATIVE_SUPPORT_NOTICE_FAILED']) {
    assert.equal(output.includes(marker), false, 'INSPECTION_ORIGINAL_LEAKED_TO_PUBLIC_OUTPUT');
  }
}
