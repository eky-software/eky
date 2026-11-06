import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { registerHooks } from 'node:module';
import { createServer } from 'node:net';
import test from 'node:test';
import { capturePackagedSmokeJobPhase, createPackagedSmokeJobRequest } from './packagedSmokeJobWorker.mjs';
import { createRunContext, createRequest, writeRequest, waitForMarker, releaseFixture,
  startForeignSentinel, isProcessAlive, startSupervisor, cleanupRunContext } from
  '../installer/windows-process-supervisor/tests/supervisorContractTestSupport.mjs';
import { readWindowsAcceptanceSupervisorResult } from
  '../installer/windows-process-supervisor/windowsAcceptanceSupervisorResult.mjs';
import { createRunnerFailureSink, RUNNER_FAILURE_ROOT_PREFIX, validateRunnerFailureEvidence } from '../../../test-reporters/runnerFailureEvidence.mjs';
import { runBoundedWindowsAdapterProcess } from '../installer/windows-acceptance-harness/boundedWindowsAdapterProcess.mjs';
import { observeSmokeOutput } from './packagedSmokeFailureEvidence.mjs';
import { readPackagedSmokeBackend, resolvePackagedSmokeTempPath } from '../dist/main/packagedSmoke.js';
import { WorkspaceRegistryStore } from '../dist/workspaces/registry/workspaceRegistryStore.js';
import { WORKSPACE_REGISTRY_FILE_NAME } from '../dist/workspaces/registry/workspaceRegistryPaths.js';
import { createWorkspaceDeletionJournalPaths } from '../dist/workspaces/deletion/workspaceDeletionJournalStore.js';
import { acquireWorkspaceProcessReservation, readWorkspaceProcessReservationIdentity } from '../dist/runtime/workspaceProcessReservation.js';
import { waitForLoopbackPortRelease } from '../../e2e/src/environment/waitForLoopbackPortRelease.ts';
import { createE2eFixtureLifetime } from '../../e2e/src/environment/e2eFixtureLifetime.ts';
import { packagedSmokeJobPublicationReserveMilliseconds } from './packagedSmokeLimits.mjs';

async function assertPreparationReservationBusy(state, acquire) {
  await assert.rejects(async () => { state.acquired = await acquire(); }, error => error.reason === 'busy');
}

async function cleanupPreparationFixture(context, state, passed, {
  readIdentity = readWorkspaceProcessReservationIdentity, removeRoot = rm, discardContext = cleanupRunContext,
} = {}) {
  let failure, original;
  const failed = error => { failure = { error: failure ? new AggregateError([failure.error, error],
    'PACKAGED_PREPARATION_FIXTURE_CLEANUP_FAILED', { cause: failure.error }) : error }; };
  try { await state.acquired?.release(); } catch (error) { failure = { error }; }
  // Keep the original through every cleanup boundary, including root removal.
  try { await cleanupRunContext(context, { preserveEvidence: true }); } catch (error) { failed(error); }
  try {
    original = (await readRecords(context.testRoot)).find(value => value.value.kind === 'runnerFailure' &&
      value.value.phase === (state.originalPhase ?? 'packagedPreparationOriginal'));
    if (!original && state.verified && passed === true) failed(new Error('PACKAGED_PREPARATION_FAILURE_EVIDENCE_UNAVAILABLE'));
  } catch (error) {
    console.error('PACKAGED_PREPARATION_FAILURE_EVIDENCE_UNAVAILABLE');
    if (state.verified && passed === true) failed(error);
  }
  if (!failure && state.verified && state.treeAbsent && passed === true) {
    try {
      assert.equal(await readIdentity(state.root), state.rootIdentity);
      await removeRoot(state.root, { recursive: true });
      await discardContext(context);
    } catch (error) { failed(error); }
  }
  if (failure || passed !== true) {
    try {
      if (original) {
        const environment = state.evidenceEnvironment ?? process.env;
        const sink = createRunnerFailureSink({ env: environment, tempRoot: environment.RUNNER_TEMP ?? tmpdir() });
        sink.record({ runner: 'node', phase: original.value.phase, attempt: 0, testName: state.testName,
          projectedException: original.value.exception });
        const delivery = await sink.flush();
        if (delivery.status !== 'recorded') console.error('PACKAGED_PREPARATION_FAILURE_EVIDENCE_UNAVAILABLE');
      }
    } catch { console.error('PACKAGED_PREPARATION_FAILURE_EVIDENCE_UNAVAILABLE'); }
  }
  if (failure) throw failure.error;
}

test('unexpected reservation acquisition is retained for release despite the failing busy assertion', async () => {
  const state = {}; let releases = 0;
  const owner = { async release() { releases++; } };
  try {
    await assert.rejects(assertPreparationReservationBusy(state, async () => owner), { code: 'ERR_ASSERTION' });
    assert.equal(state.acquired, owner);
  } finally { await state.acquired?.release(); }
  assert.equal(releases, 1);
});

for (const fault of ['identity', 'remove', 'context', 'contextPartial']) {
test(`preparation cleanup preserves and forwards original evidence on final root ${fault} failure`, async t => {
  const context = await createRunContext('preparation-cleanup-' + fault);
  const root = join(resolvePackagedSmokeTempPath(tmpdir()), 'eky-desktop-smoke', context.runNonce.slice(0, 32));
  const previous = process.env.RUNNER_TEMP;
  process.env.RUNNER_TEMP = context.testRoot;
  await mkdir(dirname(root), { recursive: true, mode: 0o700 }); await mkdir(root, { mode: 0o700 });
  const rootIdentity = await readWorkspaceProcessReservationIdentity(root);
  t.after(async () => {
    if (previous === undefined) delete process.env.RUNNER_TEMP; else process.env.RUNNER_TEMP = previous;
    await cleanupRunContext(context, { preserveEvidence: true });
    if (t.passed !== true) return;
    if (fault.startsWith('context')) await assert.rejects(lstat(root), { code: 'ENOENT' });
    else { assert.equal(await readWorkspaceProcessReservationIdentity(root), rootIdentity); await rm(root, { recursive: true }); }
    await cleanupRunContext(context);
  });
  const first = new Error('SYNTHETIC_PREPARATION_FIRST', { cause: new Error('SYNTHETIC_PREPARATION_CAUSE') });
  const sink = createRunnerFailureSink({ tempRoot: context.testRoot });
  sink.record({ runner: 'node', phase: 'packagedPreparationOriginal', attempt: 0, error: first });
  assert.equal((await sink.flush()).status, 'recorded');
  const before = (await readRecords(context.testRoot)).find(value => value.value.kind === 'runnerFailure');
  const close = new Error('SYNTHETIC_PREPARATION_ROOT_' + fault.toUpperCase());
  await assert.rejects(cleanupPreparationFixture(context, { root, rootIdentity, verified: true, treeAbsent: true }, true,
    fault === 'identity' ? { async readIdentity() { throw close; } } :
      fault === 'remove' ? { async removeRoot() { throw close; } } : { async discardContext() {
        if (fault === 'contextPartial') {
          for (const name of await readdir(context.testRoot)) {
            if (name.startsWith(RUNNER_FAILURE_ROOT_PREFIX)) await rm(join(context.testRoot, name), { recursive: true });
          }
        }
        throw close;
      } }),
    error => error === close);
  assert.equal((await lstat(context.testRoot)).isDirectory(), true);
  const records = (await readRecords(context.testRoot)).filter(value => value.value.kind === 'runnerFailure');
  assert.equal(records.length, fault === 'contextPartial' ? 1 : 2);
  for (const record of records) assert.deepEqual(record.value.exception, before.value.exception);
  if (fault.startsWith('context')) await assert.rejects(lstat(root), { code: 'ENOENT' });
  else assert.equal(await readWorkspaceProcessReservationIdentity(root), rootIdentity);
});
}

test('a verified preparation cannot discard its root after its original evidence disappears', async t => {
  const context = await createRunContext('missing-final-original'), root = join(context.testRoot, 'owned-root');
  await mkdir(root, { mode: 0o700 });
  const state = { root, rootIdentity: await readWorkspaceProcessReservationIdentity(root), verified: true, treeAbsent: true };
  t.after(() => cleanupRunContext(context, { preserveEvidence: t.passed !== true }));
  await assert.rejects(cleanupPreparationFixture(context, state, true),
    { message: 'PACKAGED_PREPARATION_FAILURE_EVIDENCE_UNAVAILABLE' });
  assert.equal((await lstat(root)).isDirectory(), true);
  assert.equal((await lstat(context.testRoot)).isDirectory(), true);
});

for (const encrypted of [false, true]) {
test(`unexpected preparation error survives its fixture wrapper and parent evidence forwarding${encrypted ? ' through OpenPGP' : ''}`, {
  skip: process.platform !== 'win32', timeout: encrypted ? 120_000 : 30_000,
}, async t => {
  let crypto;
  if (encrypted) {
    const { createOpenPgpTestFixture } = await import('../installer/windows-acceptance-harness/openPgpTestFixture.mjs');
    crypto = await createOpenPgpTestFixture(fileURLToPath(new URL('../../../', import.meta.url)));
  }
  const verify = async () => {
  const context = await createRunContext('preparation-original-error');
  t.after(() => cleanupRunContext(context, { preserveEvidence: t.passed !== true }));
  const environment = { ...process.env, EKY_E2E: '1', RUNNER_TEMP: context.testRoot,
    EKY_PREPARATION_FIXTURE_GUARD_FAILURE: '1' };
  let recipient;
  if (encrypted) {
    recipient = await crypto.generate('prep');
    await crypto.invokeGpg(recipient.home, ['--pinentry-mode', 'loopback', '--passphrase', '',
      '--quick-add-key', recipient.fingerprint, 'cv25519', 'encr', '1d']);
    const publicPath = await crypto.exportKey(recipient, 'preparation-public.asc');
    const checkout = join(context.testRoot, 'empty-checkout'); await mkdir(checkout);
    Object.assign(environment, { GITHUB_ACTIONS: 'true', GITHUB_RUN_ID: '98765', GITHUB_RUN_ATTEMPT: '1',
      GITHUB_JOB: 'packaged-preparation', EKY_EVIDENCE_JOB_KEY: 'packaged-preparation-0', GITHUB_SHA: 'a'.repeat(40),
      GITHUB_WORKSPACE: checkout, EKY_EVIDENCE_JOB_OUTCOME: 'failure',
      EKY_DIAGNOSTIC_KEY_FINGERPRINT: recipient.fingerprint, EKY_DIAGNOSTIC_VERIFIED_FINGERPRINT: recipient.fingerprint,
      EKY_DIAGNOSTIC_PUBLIC_KEY: await readFile(publicPath, 'utf8') });
  }
  await writeRequest(context, createRequest(context, 'packagedPreparationFailure'));
  const execution = startSupervisor(context, { captureOutput: false, observeEvidence() {}, environment });
  const completion = await execution.completion;
  const result = await readWindowsAcceptanceSupervisorResult(context.resultPath, { runNonce: context.runNonce,
    scenario: context.scenario, artifactDescriptorSha256: context.artifactDescriptorSha256, supervisorExitCode: completion.exitCode });
  assert.equal(result.processTreeAbsent, true); assert.equal(result.processResultCode, 'processExitFailed');
  assert.equal(result.childExitCode, 1);
  await cleanupPreparationFixture(context, { verified: false, treeAbsent: true, evidenceEnvironment: environment,
    testName: t.name }, false);
  const records = (await readRecords(context.testRoot)).filter(value => value.value.kind === 'runnerFailure');
  assert.equal(records.length, 2);
  for (const record of records) {
    assert.equal(record.value.exception.chain[0].message, 'SYNTHETIC_PREPARATION_GUARD_FIRST');
    assert.match(record.value.exception.chain[0].stack, /processTreeFixture\.mjs/u);
    assert.equal(record.value.exception.chain[1].message, 'SYNTHETIC_PREPARATION_GUARD_CAUSE');
  }
  if (encrypted) {
    const { collectJobFailureEvidence } = await import('../installer/windows-acceptance-harness/ciFailureEvidence.mjs');
    const { encryptArchive } = await import('../installer/windows-acceptance-harness/workspaceEncryptedEvidence.mjs');
    const all = await readRecords(context.testRoot);
    const collected = await collectJobFailureEvidence(environment, { nativeTemp: context.testRoot });
    assert.equal(collected.manifest.files.every(entry => entry.kind === 'runnerFailure'), true);
    await encryptArchive(collected.root, collected);
    const decrypted = await crypto.invokeGpg(recipient.home, ['--decrypt', join(collected.root, 'evidence.json.gz.gpg')]);
    const archive = JSON.parse(gunzipSync(decrypted.stdout));
    assertDecryptedRecords(archive, all, { phase: 'packagedPreparationOriginal',
      message: 'SYNTHETIC_PREPARATION_GUARD_FIRST', stack: /processTreeFixture\.mjs/u });
    const decoded = archive.manifest.files.map(entry =>
      validateRunnerFailureEvidence(JSON.parse(Buffer.from(archive.files[entry.name], 'base64'))));
    const original = decoded.filter(value => value.kind === 'runnerFailure');
    assert.equal(original.length, 2);
    for (const value of original) assert.deepEqual(value.exception, records[0].value.exception);
    assert.equal(archive.manifest.cleanup, 'notInferred');
    assert.equal(archive.manifest.files.some(entry => /user-data|supervisor-|request\.json/u.test(entry.source)), false);
  }
  };
  if (encrypted) await withCryptoFixture(crypto, verify); else await verify();
});
}

for (const mode of ['released', 'deadline']) {
test(`actual preparation retains exclusion until the owned process ends: ${mode}`, {
  skip: process.platform !== 'win32', timeout: 30_000,
}, async t => {
  const context = await createRunContext('packaged-preparation-retained-' + mode);
  const root = join(resolvePackagedSmokeTempPath(tmpdir()), 'eky-desktop-smoke', context.runNonce.slice(0, 32));
  const profile = join(root, 'user-data');
  const state = { root, verified: false, treeAbsent: false, testName: t.name };
  t.after(() => cleanupPreparationFixture(context, state, t.passed));
  await mkdir(dirname(root), { recursive: true, mode: 0o700 });
  await mkdir(root, { mode: 0o700 }); await mkdir(profile, { mode: 0o700 });
  state.rootIdentity = await readWorkspaceProcessReservationIdentity(root);
  const registryPath = join(profile, WORKSPACE_REGISTRY_FILE_NAME);
  await new WorkspaceRegistryStore({ installationRoot: profile, filePath: registryPath })
    .write({ formatVersion: 2, activeWorkspaceId: null, workspaces: [] });
  const originalRegistry = await readFile(registryPath), retained = Buffer.from('synthetic independent retained bytes');
  const retainedPath = join(root, 'retained-bytes.private.txt'); await writeFile(retainedPath, retained, { flag: 'wx', mode: 0o600 });
  const sentinel = await startForeignSentinel(context);
  await writeRequest(context, createRequest(context, 'packagedPreparationFailure'));
  const execution = startSupervisor(context, { environment: { ...process.env, EKY_E2E: '1', RUNNER_TEMP: context.testRoot } });
  execution.completion.catch(() => undefined);
  await waitForMarker(context, 'root');
  assert.deepEqual(JSON.parse(await readFile(join(context.runRoot, 'preparation-failure.private.json'), 'utf8')),
    { schemaVersion: 1, runNonce: context.runNonce, errorCode: 'PACKAGED_DELETION_PREPARATION_INVALID' });
  await assertPreparationReservationBusy(state, () => acquireWorkspaceProcessReservation({
    userDataRoot: profile, signal: new AbortController().signal }));
  assert.equal(execution.child.exitCode, null);
  if (mode === 'released') await releaseFixture(context, 'root');
  const completion = await execution.completion;
  const result = await readWindowsAcceptanceSupervisorResult(context.resultPath, { runNonce: context.runNonce,
    scenario: context.scenario, artifactDescriptorSha256: context.artifactDescriptorSha256, supervisorExitCode: completion.exitCode });
  assert.equal(result.processTreeAbsent, true); state.treeAbsent = true;
  assert.equal(result.processResultCode, mode === 'released' ? 'processExitFailed' : 'deadlineExceeded');
  if (mode === 'released') assert.equal(result.childExitCode, 23);
  else await assert.rejects(lstat(context.workerResultPath), { code: 'ENOENT' });
  assert.equal(isProcessAlive(sentinel.marker.processId), true);
  state.acquired = await acquireWorkspaceProcessReservation({ userDataRoot: profile, signal: new AbortController().signal });
  await state.acquired.assertOwned(); await state.acquired.release(); state.acquired = undefined;
  assert.deepEqual(await readFile(registryPath), originalRegistry); assert.deepEqual(await readFile(retainedPath), retained);
  const paths = createWorkspaceDeletionJournalPaths(profile);
  for (const path of [paths.currentPath, paths.nextPath, paths.backupPath]) await assert.rejects(lstat(path), { code: 'ENOENT' });
  const original = (await readRecords(context.testRoot)).find(value => value.value.kind === 'runnerFailure' &&
    value.value.phase === 'packagedPreparationOriginal');
  assert.equal(original.value.exception.chain[0].message, 'PACKAGED_DELETION_PREPARATION_INVALID');
  assert.match(original.value.exception.chain[0].stack, /packagedWorkspaceDeletionPreparation\.mjs/u);
  state.verified = true;
});
}

test('actual smoke port writer and retained stdout bind an independent socket check in a synthetic Node child', {
  timeout: 60_000,
}, async t => {
  const owner = new URL('../dist/main/packagedSmoke.js', import.meta.url).href;
  const child = spawn(process.execPath, ['--input-type=module', '-e', `
    import { createServer } from 'node:net';
    import { reportPackagedSmokeBackend } from ${JSON.stringify(owner)};
    const server = createServer();
    server.listen(0, '127.0.0.1', () => reportPackagedSmokeBackend({ enabled: true, phase: 'initial' }, server.address().port));
    process.stdin.once('end', () => server.close());
    process.stdin.resume();
  `], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  let closed = false;
  const completion = new Promise((accept, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => { closed = true; accept({ code, signal }); });
  });
  completion.catch(() => undefined);
  t.after(async () => { if (!closed) { child.stdin.destroy(); child.kill(); } await completion; });
  const read = observeSmokeOutput(child, 'shutdown');
  const port = await new Promise((accept, reject) => {
    const stop = () => { child.stdout.removeListener('data', inspect); child.removeListener('close', ended); child.removeListener('error', failed); };
    const inspect = () => {
      if (!read().stdout.text.includes('\n')) return;
      stop(); try { accept(readPackagedSmokeBackend(read().stdout.text, 'initial')); } catch (error) { reject(error); }
    };
    const ended = () => { stop(); reject(new Error('SYNTHETIC_PORT_OBSERVATION_MISSING')); };
    const failed = error => { stop(); reject(error); };
    child.stdout.on('data', inspect); child.once('close', ended); child.once('error', failed);
  });
  assert.ok(Number.isInteger(port));
  await assert.rejects(waitForLoopbackPortRelease(port, 100), { message: 'E2E_LOOPBACK_PORT_RELEASE_TIMEOUT' });
  child.stdin.end();
  assert.deepEqual(await completion, { code: 0, signal: null });
  const observed = read(); assert.equal(observed.stdout.partial, false); assert.equal(observed.stderr.partial, false);
  assert.equal(readPackagedSmokeBackend(observed.stdout.text, 'initial'), port);
  await waitForLoopbackPortRelease(port);
  const foreign = createServer(); let foreignClosed = false;
  t.after(async () => { if (!foreignClosed) await new Promise((accept, reject) => foreign.close(error => error ? reject(error) : accept())); });
  await new Promise((accept, reject) => { foreign.once('error', reject); foreign.listen(port, '127.0.0.1', accept); });
  await assert.rejects(waitForLoopbackPortRelease(port, 100), { message: 'E2E_LOOPBACK_PORT_RELEASE_TIMEOUT' });
  await new Promise((accept, reject) => foreign.close(error => error ? reject(error) : accept())); foreignClosed = true;
  await waitForLoopbackPortRelease(port);
});

async function fixture(t, extraEnvironment = {}) {
  const environment = { ...process.env, ...extraEnvironment, EKY_DESKTOP_SMOKE_TOKEN: randomBytes(16).toString('hex') };
  const input = { schemaVersion: 1, phase: 'initial', runNonce: randomBytes(32).toString('hex'),
    artifactDescriptorSha256: 'a'.repeat(64), startupException: false };
  const selected = capturePackagedSmokeJobPhase(input, environment);
  const context = await createRunContext('packaged-phase-admission');
  let verified = false;
  t.after(async () => {
    const succeeded = verified && t.passed === true;
    await cleanupRunContext(context, { preserveEvidence: !succeeded });
    if (succeeded) await rm(selected.root, { recursive: true });
  });
  await mkdir(selected.phaseRoot, { recursive: true, mode: 0o700 });
  Object.assign(context, selected.binding, { requestPath: join(selected.phaseRoot, 'request.json'),
    resultPath: join(selected.phaseRoot, 'result.json'), workerResultPath: join(selected.phaseRoot, 'worker-result.json') });
  const startupPath = join(selected.root, 'result', 'desktop-smoke-result.json');
  const request = createPackagedSmokeJobRequest(input, environment);
  await writeFile(startupPath, JSON.stringify({ stage: 'startup', status: 'started' }), { flag: 'wx', mode: 0o600 });
  return { input, selected, context, environment, request, startupPath,
    complete() { verified = true; },
    async execute(value = request) {
      context.artifactDescriptorSha256 = value.artifactDescriptorSha256;
      await writeFile(context.requestPath, JSON.stringify(value), { flag: 'wx', mode: 0o600 });
      // These are intentional worker failures. Require their one exact public
      // error line rather than applying the success-fixture's empty-stderr rule.
      const execution = startSupervisor(context, { environment, captureOutput: false, observeEvidence() {} });
      const completion = await execution.completion;
      const output = context.privateOutputCaptures.at(-1);
      assert.equal(output.closed, true); assert.equal(output.stderr.ended, true);
      assert.equal(output.stderr.truncated, false);
      assert.equal(output.stderr.bytes.toString('utf8'), 'PACKAGED_SMOKE_JOB_PHASE_FAILED\n');
      const result = await readWindowsAcceptanceSupervisorResult(context.resultPath, {
        ...selected.binding, artifactDescriptorSha256: value.artifactDescriptorSha256, supervisorExitCode: completion.exitCode,
      });
      assert.equal(completion.exitCode, 1); assert.equal(completion.signal, null);
      assert.equal(result.processResultCode, 'processExitFailed'); assert.equal(result.childExitCode, 1);
      assert.equal(result.processTreeAbsent, true);
      await assert.rejects(lstat(context.workerResultPath), { code: 'ENOENT' });
      await assert.rejects(lstat(join(selected.phaseRoot, 'phase-output.private.json')), { code: 'ENOENT' });
      await assert.rejects(lstat(join(selected.root, 'user-data')), { code: 'ENOENT' });
      return { completion, result };
    } };
}

async function readRecords(root) {
  const records = [];
  for (const directory of await readdir(root)) {
    if (!directory.startsWith(RUNNER_FAILURE_ROOT_PREFIX)) continue;
    for (const name of await readdir(join(root, directory))) {
      const bytes = await readFile(join(root, directory, name));
      records.push({ source: `temporary/${directory}/${name}`, bytes,
        value: validateRunnerFailureEvidence(JSON.parse(bytes)) });
    }
  }
  return records;
}

function assertDecryptedRecords(archive, records, expected = { message: 'commandPhaseInputInvalid',
  stack: /strictJsonObject\.mjs|acceptanceCommandPhaseInput\.mjs/u }) {
  assert.equal(archive.manifest.files.length, records.length);
  assert.deepEqual(archive.manifest.files.map(entry => entry.source).sort(), records.map(record => record.source).sort());
  const decoded = [];
  for (const entry of archive.manifest.files) {
    const source = records.find(record => record.source === entry.source);
    assert.ok(source); assert.equal(entry.status, 'retained');
    const bytes = Buffer.from(archive.files[entry.name], 'base64');
    assert.deepEqual(bytes, source.bytes); assert.equal(bytes.length, entry.bytes);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), entry.sha256);
    decoded.push(validateRunnerFailureEvidence(JSON.parse(bytes)));
  }
  const original = decoded.find(value => value.kind === 'runnerFailure' && (expected.phase === undefined || value.phase === expected.phase));
  assert.equal(original?.exception.chain[0].message, expected.message);
  assert.match(original.exception.chain[0].stack, expected.stack);
}

async function parentWithControlledInventory(t, input) {
  const target = new URL('./packagedSmokeJob.mjs', import.meta.url);
  target.searchParams.set('nativeNegative', input.runNonce);
  // Admission-only evidence: no accepted package is claimed or launched.
  const hooks = registerHooks({ resolve(specifier, context, nextResolve) {
    if (context.parentURL === target.href && specifier === './packagedPilotSeries.mjs') {
      return { url: 'data:text/javascript,export function requirePackagedSeriesPin(){return "' + 'a'.repeat(64) +
        '";} export async function inspectPackagedPilotSeries(){return {manifest:{inventoryIdentity:"' +
        input.artifactDescriptorSha256 + '"}};}', shortCircuit: true };
    }
    if (context.parentURL === target.href && specifier === './package-artifact-inventory.mjs') {
      return { url: 'data:text/javascript,export async function inspectPackageArtifactInventory() { return { identity: "' +
        input.artifactDescriptorSha256 + '" }; }', shortCircuit: true };
    }
    return nextResolve(specifier, context);
  } });
  t.after(() => hooks.deregister());
  return import(target.href);
}

async function withCryptoFixture(crypto, task) {
  let value, failure;
  try { value = await task(); } catch (error) { failure = { error }; }
  try { await crypto.finish({ completed: failure === undefined, failed: failure !== undefined }); }
  catch (error) {
    if (failure) throw new AggregateError([failure.error, error], 'PACKAGED_SMOKE_ADMISSION_PROOF_FAILED', { cause: failure.error });
    throw error;
  }
  if (failure) throw failure.error;
  return value;
}

test('decryption proof rejects an empty or incomplete source set', () => {
  const records = [{ source: 'temporary/expected-original.private.json', bytes: Buffer.from('{}') }];
  assert.throws(() => assertDecryptedRecords({ manifest: { files: [] }, files: {} }, records));
  assert.throws(() => assertDecryptedRecords({ manifest: { files: [
    { source: 'temporary/another.private.json' },
  ] }, files: {} }, records));
  assert.throws(() => assertDecryptedRecords({ manifest: { files: [] }, files: {} }, []));
});

for (const first of [new Error('SYNTHETIC_CRYPTO_ASSERTION_FIRST'), undefined]) {
test(`crypto teardown preserves the first ${first === undefined ? 'undefined' : 'assertion'} failure`, async () => {
  const close = new Error('SYNTHETIC_CRYPTO_CLOSE_SECOND'); let outcome;
  await assert.rejects(withCryptoFixture({ async finish(value) { outcome = value; throw close; } }, async () => { throw first; }),
    error => error instanceof AggregateError && error.cause === first && error.errors[0] === first && error.errors[1] === close);
  assert.deepEqual(outcome, { completed: false, failed: true });
});
}

test('crypto teardown must finish before its caller may mark proof complete', async () => {
  const close = new Error('SYNTHETIC_CRYPTO_CLOSE_ONLY'); let complete = false;
  await assert.rejects((async () => {
    await withCryptoFixture({ async finish() { throw close; } }, async () => 'verified'); complete = true;
  })(), error => error === close);
  assert.equal(complete, false);
});

for (const kind of ['requestBinding', 'workingDirectory', 'oldSuccess']) {
test(`actual packaged Job worker refuses ${kind} before launching the application`, {
  skip: process.platform !== 'win32', timeout: 60_000,
}, async t => {
  const f = await fixture(t);
  const temporary = join(f.selected.phaseRoot, 'private-errors'); await mkdir(temporary);
  f.environment.RUNNER_TEMP = temporary;
  let request = f.request;
  if (kind === 'requestBinding') request = { ...request, artifactDescriptorSha256: 'b'.repeat(64) };
  if (kind === 'workingDirectory') request = { ...request, workingDirectory: f.selected.root };
  if (kind === 'oldSuccess') await writeFile(f.startupPath, JSON.stringify({ stage: 'shutdown', status: 'ok', electronVersion: '43.8.1' }));
  await f.execute(request);
  const original = (await readRecords(temporary)).find(record => record.value.kind === 'runnerFailure');
  assert.equal(original?.value.exception.chain[0].message, 'PACKAGED_SMOKE_JOB_INPUT_INVALID');
  assert.equal(original.value.phase, kind === 'workingDirectory' ? 'packagedPhaseArguments' : 'packagedPhase');
  assert.match(original.value.exception.chain[0].stack, /packagedSmokeJobWorker\.mjs/u);
  f.complete();
});
}

test('actual packaged CLI and Job preserve the original reader failure through OpenPGP decryption', {
  skip: process.platform !== 'win32', timeout: 120_000,
}, async t => {
  const { createOpenPgpTestFixture } = await import('../installer/windows-acceptance-harness/openPgpTestFixture.mjs');
  const { collectJobFailureEvidence } = await import('../installer/windows-acceptance-harness/ciFailureEvidence.mjs');
  const { encryptArchive } = await import('../installer/windows-acceptance-harness/workspaceEncryptedEvidence.mjs');
  const crypto = await createOpenPgpTestFixture(fileURLToPath(new URL('../../../', import.meta.url)));
  const verified = await withCryptoFixture(crypto, async () => {
    const recipient = await crypto.generate('phase-recipient');
    await crypto.invokeGpg(recipient.home, ['--pinentry-mode', 'loopback', '--passphrase', '',
      '--quick-add-key', recipient.fingerprint, 'cv25519', 'encr', '1d']);
    const publicPath = await crypto.exportKey(recipient, 'native-phase-public.asc');
    const temporary = join(crypto.root, 'runner-temp'), checkout = join(crypto.root, 'empty-checkout');
    await mkdir(temporary); await mkdir(checkout);
    const f = await fixture(t, { GITHUB_ACTIONS: 'true', GITHUB_RUN_ID: '98765', GITHUB_RUN_ATTEMPT: '1',
      GITHUB_JOB: 'packaged-native-phase', EKY_EVIDENCE_JOB_KEY: 'packaged-native-phase-0', GITHUB_SHA: 'a'.repeat(40),
      RUNNER_TEMP: temporary, GITHUB_WORKSPACE: checkout, EKY_EVIDENCE_JOB_OUTCOME: 'failure',
      EKY_DIAGNOSTIC_KEY_FINGERPRINT: recipient.fingerprint, EKY_DIAGNOSTIC_VERIFIED_FINGERPRINT: recipient.fingerprint,
      EKY_DIAGNOSTIC_PUBLIC_KEY: await readFile(publicPath, 'utf8') });
    await writeFile(f.startupPath, '{]');
    const retainedStartup = await readFile(f.startupPath);
    await f.execute();
    assert.deepEqual(await readFile(f.startupPath), retainedStartup);
    const records = await readRecords(temporary);
    const original = records.find(record => record.value.kind === 'runnerFailure');
    assert.equal(original?.value.exception.chain[0].message, 'commandPhaseInputInvalid');
    assert.match(original.value.exception.chain[0].stack, /strictJsonObject\.mjs|acceptanceCommandPhaseInput\.mjs/u);
    const collected = await collectJobFailureEvidence(f.environment, { nativeTemp: temporary });
    assert.equal(collected.manifest.files.every(entry => entry.kind === 'runnerFailure'), true);
    assert.equal(collected.manifest.files.length, records.length);
    await encryptArchive(collected.root, collected);
    const decrypted = await crypto.invokeGpg(recipient.home, ['--decrypt', join(collected.root, 'evidence.json.gz.gpg')]);
    const archive = JSON.parse(gunzipSync(decrypted.stdout));
    assertDecryptedRecords(archive, records);
    assert.equal(archive.manifest.cleanup, 'notInferred');
    assert.equal(archive.manifest.files.some(entry => /user-data|phase-output|desktop-smoke-result/u.test(entry.source)), false);
    return f;
  });
  verified.complete();
});

async function verifyWholeWorkflowFailure(t, baseEnvironment = process.env, verifyRecords) {
  const context = await createRunContext('whole-workflow'), foreign = await createRunContext('whole-workflow-foreign');
  t.after(() => cleanupRunContext(foreign, { preserveEvidence: t.passed !== true }));
  const sentinel = await startForeignSentinel(foreign);
  const input = { schemaVersion: 1, phase: 'workspaceDeletion', runNonce: context.runNonce,
    artifactDescriptorSha256: context.artifactDescriptorSha256, startupException: false };
  const environment = { ...baseEnvironment, EKY_E2E: '1', EKY_PACKAGED_WORKFLOW_FIXTURE: '1',
    EKY_DESKTOP_SMOKE_TOKEN: randomBytes(16).toString('hex'), RUNNER_TEMP: context.testRoot,
    NODE_OPTIONS: `--import=${new URL('./packagedSmokeWorkflow.fixture.mjs', import.meta.url).href}` };
  const selected = capturePackagedSmokeJobPhase(input, environment), profile = join(selected.root, 'user-data');
  const parent = await parentWithControlledInventory(t, input);
  const state = { root: selected.root, verified: false, treeAbsent: false, testName: t.name,
    originalPhase: 'packagedWorkflowFixtureOriginal' };
  let pending, beforeRegistry;
  const retained = Buffer.from('independent whole-workflow retained bytes');
  t.after(async () => {
    let failure;
    if (state.rootIdentity !== undefined) {
      try { await writeFile(join(selected.phaseRoot, 'root.release'), '', { flag: 'wx' }); }
      catch (error) { if (error?.code !== 'EEXIST') failure = { error }; }
    }
    await pending?.catch(() => undefined);
    try { await cleanupPreparationFixture(context, state, t.passed === true && failure === undefined); }
    catch (error) { failure = { error: failure ? new AggregateError([failure.error, error],
      'PACKAGED_PREPARATION_FIXTURE_CLEANUP_FAILED', { cause: failure.error }) : error }; }
    if (failure) throw failure.error;
  });
  pending = parent.runOwnedPackagedSmokeWorkflow(input, { environment, lifetime: createE2eFixtureLifetime(10_000),
    async runProcess(command) {
      await mkdir(profile, { mode: 0o700 });
      const registryPath = join(profile, WORKSPACE_REGISTRY_FILE_NAME);
      await new WorkspaceRegistryStore({ installationRoot: profile, filePath: registryPath })
        .write({ formatVersion: 2, activeWorkspaceId: null, workspaces: [] });
      beforeRegistry = await readFile(registryPath);
      await writeFile(join(selected.root, 'retained.private.txt'), retained, { flag: 'wx', mode: 0o600 });
      state.rootIdentity = await readWorkspaceProcessReservationIdentity(selected.root);
      return runBoundedWindowsAdapterProcess({ ...command, spawnProcess(...args) {
        const child = command.spawnProcess(...args); context.supervisorProcesses.add(child);
        child.once('close', () => context.supervisorProcesses.delete(child)); return child;
      } });
    } });
  pending.catch(() => undefined);
  await waitForMarker({ ...context, runRoot: selected.phaseRoot }, 'root');
  // This fixture controls package admission; it must not invoke the distinct release-candidate gate.
  await assert.rejects(lstat(join(selected.phaseRoot, 'unexpected-release-preparation.json')), { code: 'ENOENT' });
  await assertPreparationReservationBusy(state, () => acquireWorkspaceProcessReservation({
    userDataRoot: profile, signal: new AbortController().signal }));
  const held = (await readRecords(context.testRoot)).find(record => record.value.phase === 'packagedWorkflowFixtureOriginal');
  assert.equal(held.value.exception.chain[0].message, 'PACKAGED_DELETION_PREPARATION_INVALID');
  assert.match(held.value.exception.chain[0].stack, /packagedWorkspaceDeletionPreparation\.mjs/u);
  await writeFile(join(selected.phaseRoot, 'root.release'), '', { flag: 'wx' });
  await assert.rejects(pending, error => {
    assert.equal(error.supervisorResult.processResultCode, 'processExitFailed');
    assert.equal(error.supervisorResult.childExitCode, 1); assert.equal(error.supervisorResult.processTreeAbsent, true);
    assert.equal(error.cleanup.status, 'notAttempted'); state.treeAbsent = true; return true;
  });
  assert.equal(isProcessAlive(sentinel.marker.processId), true);
  state.acquired = await acquireWorkspaceProcessReservation({ userDataRoot: profile, signal: new AbortController().signal });
  await state.acquired.assertOwned(); await state.acquired.release(); state.acquired = undefined;
  assert.deepEqual(await readFile(join(profile, WORKSPACE_REGISTRY_FILE_NAME)), beforeRegistry);
  assert.deepEqual(await readFile(join(selected.root, 'retained.private.txt')), retained);
  const original = (await readRecords(context.testRoot)).find(record => record.value.phase === 'packagedWorkflow');
  assert.deepEqual(original.value.exception, held.value.exception);
  const terminal = JSON.parse(await readFile(join(selected.phaseRoot, 'worker-result.json'), 'utf8'));
  assert.deepEqual(terminal, { ...selected.binding, status: 'failed', resultCode: 'packagedWorkflowFailed', errorCode: 'packagedSmokeWorkflowFailed' });
  await verifyRecords?.({ context, environment, records: await readRecords(context.testRoot) });
  state.verified = true;
}

test('the whole workflow CLI ends a real retained preparation and preserves its original failure under the existing Job', {
  skip: process.platform !== 'win32', timeout: 30_000,
}, async t => {
  await verifyWholeWorkflowFailure(t);
});

test('the whole workflow CLI original survives its actual Job through OpenPGP decryption', {
  skip: process.platform !== 'win32', timeout: 120_000,
}, async t => {
  const { createOpenPgpTestFixture } = await import('../installer/windows-acceptance-harness/openPgpTestFixture.mjs');
  const { collectJobFailureEvidence } = await import('../installer/windows-acceptance-harness/ciFailureEvidence.mjs');
  const { encryptArchive } = await import('../installer/windows-acceptance-harness/workspaceEncryptedEvidence.mjs');
  const crypto = await createOpenPgpTestFixture(fileURLToPath(new URL('../../../', import.meta.url)));
  await withCryptoFixture(crypto, async () => {
    const recipient = await crypto.generate('whole');
    await crypto.invokeGpg(recipient.home, ['--pinentry-mode', 'loopback', '--passphrase', '',
      '--quick-add-key', recipient.fingerprint, 'cv25519', 'encr', '1d']);
    const publicPath = await crypto.exportKey(recipient, 'whole-public.asc');
    const checkout = join(crypto.root, 'empty-checkout'); await mkdir(checkout);
    const env = { ...process.env, GITHUB_ACTIONS: 'true', GITHUB_RUN_ID: '98765', GITHUB_RUN_ATTEMPT: '1',
      GITHUB_JOB: 'packaged-whole', EKY_EVIDENCE_JOB_KEY: 'packaged-whole-0', GITHUB_SHA: 'a'.repeat(40),
      GITHUB_WORKSPACE: checkout, EKY_EVIDENCE_JOB_OUTCOME: 'failure',
      EKY_DIAGNOSTIC_KEY_FINGERPRINT: recipient.fingerprint, EKY_DIAGNOSTIC_VERIFIED_FINGERPRINT: recipient.fingerprint,
      EKY_DIAGNOSTIC_PUBLIC_KEY: await readFile(publicPath, 'utf8') };
    await verifyWholeWorkflowFailure(t, env, async ({ context, environment, records }) => {
      const collected = await collectJobFailureEvidence(environment, { nativeTemp: context.testRoot });
      assert.equal(collected.manifest.files.every(entry => entry.kind === 'runnerFailure'), true);
      await encryptArchive(collected.root, collected);
      const decrypted = await crypto.invokeGpg(recipient.home, ['--decrypt', join(collected.root, 'evidence.json.gz.gpg')]);
      const archive = JSON.parse(gunzipSync(decrypted.stdout));
      assertDecryptedRecords(archive, records, { phase: 'packagedWorkflow',
        message: 'PACKAGED_DELETION_PREPARATION_INVALID', stack: /packagedWorkspaceDeletionPreparation\.mjs/u });
      const decoded = archive.manifest.files.map(entry => validateRunnerFailureEvidence(
        JSON.parse(Buffer.from(archive.files[entry.name], 'base64'))));
      const original = decoded.find(value => value.phase === 'packagedWorkflow');
      const first = decoded.find(value => value.phase === 'packagedWorkflowFixtureOriginal');
      assert.deepEqual(original.exception, first.exception);
      assert.equal(archive.manifest.cleanup, 'notInferred');
      assert.equal(archive.manifest.files.some(entry => /user-data|workflow-jobs|request\.json/u.test(entry.source)), false);
    });
  });
});

test('the parent adapter preserves a real failed worker and verified Job absence', {
  skip: process.platform !== 'win32', timeout: 60_000,
}, async t => {
  const f = await fixture(t);
  const temporary = join(f.selected.phaseRoot, 'parent-private-errors'); await mkdir(temporary);
  f.environment.RUNNER_TEMP = temporary;
  const input = { ...f.input, runNonce: randomBytes(32).toString('hex') };
  const selected = capturePackagedSmokeJobPhase(input, f.environment);
  const parent = await parentWithControlledInventory(t, input);
  let calls = 0;
  await assert.rejects(parent.runOwnedPackagedSmokePhase(input, { environment: f.environment, signal: t.signal,
    async runProcess(command) {
      calls++;
      const path = command.arguments[2];
      const request = JSON.parse(await readFile(path, 'utf8'));
      // Drive the actual worker's parser failure, without opening Eky.exe.
      await writeFile(path, JSON.stringify({ ...request, arguments: [...request.arguments, '--unknown'] }));
      return runBoundedWindowsAdapterProcess({ ...command, spawnProcess(...args) {
        const child = command.spawnProcess(...args);
        f.context.supervisorProcesses.add(child);
        child.once('close', () => f.context.supervisorProcesses.delete(child));
        return child;
      } });
    } }), error => error.supervisorResult.processResultCode === 'processExitFailed' &&
      error.supervisorResult.childExitCode === 1 && error.supervisorResult.processTreeAbsent === true &&
      error.supervisorResult.runNonce === selected.binding.runNonce);
  assert.equal(calls, 1); assert.equal(f.context.supervisorProcesses.size, 0);
  const original = (await readRecords(temporary)).find(record => record.value.phase === 'packagedPhaseArguments');
  assert.ok(original); assert.match(original.value.exception.chain[0].message, /unknown/u);
  await assert.rejects(lstat(join(selected.phaseRoot, 'worker-result.json')), { code: 'ENOENT' });
  await assert.rejects(lstat(join(selected.root, 'user-data')), { code: 'ENOENT' });
  f.complete();
});

for (const phase of ['initial', 'workspaceDeletion']) {
test(`the real parent lets a delayed native deadline clean its reserved process and publish: ${phase}`, {
  skip: process.platform !== 'win32', timeout: 60_000,
}, async t => {
  const context = await createRunContext('packaged-parent-deadline-' + phase);
  const environment = { ...process.env, EKY_E2E: '1', RUNNER_TEMP: context.testRoot,
    EKY_DESKTOP_SMOKE_TOKEN: context.runNonce.slice(0, 32) };
  const input = { schemaVersion: 1, phase, runNonce: context.runNonce,
    artifactDescriptorSha256: context.artifactDescriptorSha256, startupException: false };
  const selected = capturePackagedSmokeJobPhase(input, environment);
  const profile = join(selected.root, 'user-data');
  let rootIdentity, completed = false, acquired, killed = false, pending;
  t.after(async () => {
    await pending?.catch(() => undefined);
    await acquired?.release();
    await cleanupRunContext(context, { preserveEvidence: !completed || t.passed !== true });
    if (completed && t.passed === true) {
      assert.equal(await readWorkspaceProcessReservationIdentity(selected.root), rootIdentity);
      await rm(selected.root, { recursive: true });
    }
  });
  if (phase === 'initial') await mkdir(join(selected.root, 'result'), { recursive: true, mode: 0o700 });
  const parent = await parentWithControlledInventory(t, input);
  let nativeRequest, commandBudget;
  const controller = new AbortController();
  const first = new Error('SYNTHETIC_PARENT_FIXTURE_STOP');
  const invoke = parent[phase === 'initial' ? 'runOwnedPackagedSmokePhase' : 'runOwnedPackagedSmokeWorkflow'];
  pending = invoke(input, { environment, signal: controller.signal,
    lifetime: createE2eFixtureLifetime(20_000),
    async runProcess(command) {
      rootIdentity = await readWorkspaceProcessReservationIdentity(selected.root);
      await mkdir(profile, { mode: 0o700 });
      await new WorkspaceRegistryStore({ installationRoot: profile,
        filePath: join(profile, WORKSPACE_REGISTRY_FILE_NAME) })
        .write({ formatVersion: 2, activeWorkspaceId: null, workspaces: [] });
      const path = command.arguments[2];
      nativeRequest = JSON.parse(await readFile(path, 'utf8'));
      commandBudget = command.timeoutMilliseconds;
      const fixtureRequest = createRequest(context, 'packagedPreparationFailure');
      await writeFile(path, JSON.stringify({ ...nativeRequest, arguments: fixtureRequest.arguments }));
      // Controlled startup cost consumes this same parent timer, not a new allowance.
      return runBoundedWindowsAdapterProcess({ ...command, spawnProcess(executable, args, options) {
        const child = command.spawnProcess(executable, [...args, '--caller-admission'],
          { ...options, stdio: ['pipe', 'ignore', 'ignore'] });
        context.supervisorProcesses.add(child);
        const timer = setTimeout(() => child.stdin.end(Buffer.from([1])), 1_000);
        child.stdin.on('error', () => {});
        const kill = child.kill.bind(child);
        child.kill = (...values) => { killed = true; return kill(...values); };
        child.once('close', () => { clearTimeout(timer); context.supervisorProcesses.delete(child); });
        return child;
      } });
    } });
  pending.catch(() => undefined);
  try {
    await waitForMarker(context, 'root');
    await assert.rejects(async () => { acquired = await acquireWorkspaceProcessReservation({ userDataRoot: profile, signal: t.signal }); },
      error => error.reason === 'busy');
    await assert.rejects(pending, error => {
      assert.equal(error.supervisorResult.processResultCode, 'deadlineExceeded');
      assert.equal(error.supervisorResult.processTreeAbsent, true);
      assert.equal(error.supervisorResult.cleanupResultCode, 'processTreeAbsent');
      assert.equal(error.directProcessResult.directProcessAbsent, true);
      assert.equal(error.directProcessResult.resultCode, 'processCompleted');
      return true;
    });
    assert.equal(killed, false);
    assert.ok(commandBudget > nativeRequest.timeoutMilliseconds + packagedSmokeJobPublicationReserveMilliseconds);
    assert.equal(context.supervisorProcesses.size, 0);
    acquired = await acquireWorkspaceProcessReservation({ userDataRoot: profile, signal: t.signal });
    await acquired.assertOwned(); await acquired.release(); acquired = undefined;
    const original = (await readRecords(context.testRoot)).find(value => value.value.phase === 'packagedPreparationOriginal');
    assert.equal(original.value.exception.chain[0].message, 'PACKAGED_DELETION_PREPARATION_INVALID');
    completed = true;
  } finally { controller.abort(first); }
});
}

test('the parent adapter original OS spawn failure survives real OpenPGP decryption', {
  skip: process.platform !== 'win32', timeout: 120_000,
}, async t => {
  const { createOpenPgpTestFixture } = await import('../installer/windows-acceptance-harness/openPgpTestFixture.mjs');
  const { collectJobFailureEvidence } = await import('../installer/windows-acceptance-harness/ciFailureEvidence.mjs');
  const { encryptArchive } = await import('../installer/windows-acceptance-harness/workspaceEncryptedEvidence.mjs');
  const crypto = await createOpenPgpTestFixture(fileURLToPath(new URL('../../../', import.meta.url)));
  const verified = await withCryptoFixture(crypto, async () => {
    const recipient = await crypto.generate('phase-recipient');
    await crypto.invokeGpg(recipient.home, ['--pinentry-mode', 'loopback', '--passphrase', '',
      '--quick-add-key', recipient.fingerprint, 'cv25519', 'encr', '1d']);
    const publicPath = await crypto.exportKey(recipient, 'parent-phase-public.asc');
    const temporary = join(crypto.root, 'runner-temp'), checkout = join(crypto.root, 'empty-checkout');
    await mkdir(temporary); await mkdir(checkout);
    const f = await fixture(t, { GITHUB_ACTIONS: 'true', GITHUB_RUN_ID: '98765', GITHUB_RUN_ATTEMPT: '1',
      GITHUB_JOB: 'packaged-parent-phase', EKY_EVIDENCE_JOB_KEY: 'packaged-parent-phase-0', GITHUB_SHA: 'a'.repeat(40),
      RUNNER_TEMP: temporary, GITHUB_WORKSPACE: checkout, EKY_EVIDENCE_JOB_OUTCOME: 'failure',
      EKY_DIAGNOSTIC_KEY_FINGERPRINT: recipient.fingerprint, EKY_DIAGNOSTIC_VERIFIED_FINGERPRINT: recipient.fingerprint,
      EKY_DIAGNOSTIC_PUBLIC_KEY: await readFile(publicPath, 'utf8') });
    f.environment.EKY_DOTNET_EXE = join(f.selected.phaseRoot, 'deliberately-absent', 'dotnet.exe');
    const input = { ...f.input, runNonce: randomBytes(32).toString('hex') };
    const parent = await parentWithControlledInventory(t, input);
    await assert.rejects(parent.runOwnedPackagedSmokePhase(input, { environment: f.environment, signal: t.signal }),
      error => error.directProcessResult.resultCode === 'startFailed' && error.directProcessResult.directProcessAbsent === true);
    const records = await readRecords(temporary);
    const original = records.find(record => record.value.phase === 'packagedJobOriginal');
    assert.ok(original); assert.match(original.value.exception.chain[0].message, /ENOENT/u);
    const collected = await collectJobFailureEvidence(f.environment, { nativeTemp: temporary });
    assert.equal(collected.manifest.files.every(entry => entry.kind === 'runnerFailure'), true);
    await encryptArchive(collected.root, collected);
    const decrypted = await crypto.invokeGpg(recipient.home, ['--decrypt', join(collected.root, 'evidence.json.gz.gpg')]);
    const archive = JSON.parse(gunzipSync(decrypted.stdout));
    assertDecryptedRecords(archive, records, { phase: 'packagedJobOriginal',
      message: original.value.exception.chain[0].message, stack: /node:internal\/child_process/u });
    assert.equal(archive.manifest.cleanup, 'notInferred');
    await assert.rejects(lstat(join(f.selected.root, 'user-data')), { code: 'ENOENT' });
    return f;
  });
  verified.complete();
});
