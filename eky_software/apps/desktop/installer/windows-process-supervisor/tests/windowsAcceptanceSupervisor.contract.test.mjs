import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { EventEmitter, once } from 'node:events';
import { access, mkdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { createOpenPgpTestFixture } from '../../windows-acceptance-harness/openPgpTestFixture.mjs';
import { collectJobFailureEvidence } from '../../windows-acceptance-harness/ciFailureEvidence.mjs';
import { encryptArchive } from '../../windows-acceptance-harness/workspaceEncryptedEvidence.mjs';
import { publishWorkspaceMsiResourceSelection } from '../../windows-acceptance-harness/workspaceMsiResourceSelection.mjs';
import { captureContractOutput, CONTRACT_OUTPUT_LIMIT } from './supervisorContractPrivateEvidence.mjs';
import {
  cleanupRunContext,
  cleanupActiveSupervisors,
  createRequest,
  createRunContext,
  createTestRunContext as contextFor,
  isProcessAlive,
  readCompletedMarker,
  readControlledDeadlineProof,
  readDeadlineWriterFailureProof,
  readDeadlineProofPublicationFailure,
  registerSupervisorProcess,
  releaseFixture,
  runSupervisor,
  startForeignSentinel,
  startProgramFailureFixture,
  startSupervisor,
  SUPERVISOR_DLL,
  verifyDeadlineRun,
  verifyControlledDeadlineRun,
  verifyDeadlineFixture,
  waitForMarker,
  waitForProcessAbsent,
  writeRequest,
} from './supervisorContractTestSupport.mjs';
import {
  readWindowsAcceptanceSupervisorResult,
} from '../windowsAcceptanceSupervisorResult.mjs';

const WINDOWS_ONLY = {
  skip: process.platform !== 'win32',
  timeout: 120_000,
};
const repetitions = Number.parseInt(
  process.env.EKY_SUPERVISOR_TIMEOUT_REPETITIONS || '1',
  10,
);
if (!Number.isInteger(repetitions) || repetitions < 1 || repetitions > 50) {
  throw new Error('WINDOWS_ACCEPTANCE_SUPERVISOR_REPETITIONS_INVALID');
}

test.afterEach(async () => cleanupActiveSupervisors());

test('MSI resources: scoped identity, cancellation and real OpenPGP delivery', WINDOWS_ONLY, async t => {
  const context = await contextFor(t, 'msi-resource-contracts');
  const temporary = join(context.testRoot, 'temporary');
  const checkout = join(context.testRoot, 'checkout');
  const scenarioRoot = join(temporary, 'eky-acceptance-command-' + 'b'.repeat(32), 'scenario');
  await mkdir(scenarioRoot, { recursive: true });
  await mkdir(checkout);
  const foreign = join(context.testRoot, 'foreign');
  await mkdir(foreign);
  await writeFile(join(foreign, 'foreign.bin'), 'EXCLUDED FOREIGN CONTENT');
  await mkdir(join(scenarioRoot, 'payload'));
  await symlink(foreign, join(scenarioRoot, 'payload', 'junction'), 'junction');
  context.scenario = 'packagedWorkspaceSuccess';
  context.requestPath = join(scenarioRoot, 'request.json');
  context.resultPath = join(scenarioRoot, 'result.json');
  await writeRequest(context, { ...createRequest(context, 'exitZero'), workingDirectory: scenarioRoot });
  await publishWorkspaceMsiResourceSelection({ directory: scenarioRoot, root: join(scenarioRoot, 'payload'), request: context,
    scenario: context.scenario, inventory: { identity: 'a'.repeat(64) }, files: ['unused.bin'] });
  const crypto = await createOpenPgpTestFixture(fileURLToPath(new URL('../../../../../', import.meta.url)));
  let completed = false;
  try {
    const recipient = await crypto.generate('recipient');
    await crypto.invokeGpg(recipient.home, ['--pinentry-mode', 'loopback', '--passphrase', '',
      '--quick-add-key', recipient.fingerprint, 'cv25519', 'encr', '1d']);
    const publicPath = await crypto.exportKey(recipient, 'public.asc');
    const env = { ...process.env, GITHUB_ACTIONS: 'true', GITHUB_RUN_ID: '98765', GITHUB_RUN_ATTEMPT: '1',
      GITHUB_JOB: 'tests', EKY_EVIDENCE_JOB_KEY: 'tests-0', GITHUB_SHA: 'a'.repeat(40),
      EKY_EVIDENCE_JOB_OUTCOME: 'failure', RUNNER_TEMP: temporary, GITHUB_WORKSPACE: checkout,
      EKY_DIAGNOSTIC_KEY_FINGERPRINT: recipient.fingerprint,
      EKY_DIAGNOSTIC_VERIFIED_FINGERPRINT: recipient.fingerprint,
      EKY_DIAGNOSTIC_PUBLIC_KEY: await readFile(publicPath, 'utf8') };
    const execution = startProgramFailureFixture(context, 'msiResourceContracts', { environment: env });
    const result = await execution.completion;
    assert.equal(result.exitCode, 0);
    assert.doesNotMatch(result.standardOutput, /SYNTHETIC RM|foreign\.bin|startTimeLow|ownedJob/);
    const proof = JSON.parse(await readFile(join(scenarioRoot, 'msi-resource-contract.json'), 'utf8'));
    assert.equal(proof.junctionRejected, true);
    assert.equal(proof.nodePublishedSelectionAdmitted, true);
    assert.equal(proof.cleanupDoesNotAwaitResourceRead, true);
    assert.equal(proof.bothTreesAbsent, true);
    assert.ok(Object.keys(proof).length >= 30);
    assert.ok(Object.values(proof).every(value => value === true));
    const collected = await collectJobFailureEvidence(env, { nativeTemp: temporary });
    await encryptArchive(collected.root, collected);
    const decrypted = await crypto.invokeGpg(recipient.home, ['--decrypt', join(collected.root, 'evidence.json.gz.gpg')]);
    const archive = JSON.parse(gunzipSync(decrypted.stdout));
    const entries = archive.manifest.files.filter(value => value.kind === 'msiWindowObservation' && value.status === 'retained');
    assert.equal(entries.length, 1);
    const record = JSON.parse(Buffer.from(archive.files[entries[0].name], 'base64'));
    assert.equal(record.schemaVersion, 3);
    assert.equal(record.resources.status, 'observed');
    assert.equal(record.resources.phase, 'complete');
    assert.equal(record.resources.nativeCode, 0);
    assert.equal(record.resources.endSessionCode, 0);
    assert.equal(record.resources.selectionIdentity, 'a'.repeat(64));
    assert.ok(record.resources.processes.some(value => value.membership === 'ownedJob' && value.processId > 0 &&
      (value.startTimeLow !== 0 || value.startTimeHigh !== 0)));
    assert.equal(JSON.stringify(archive).includes('EXCLUDED FOREIGN CONTENT'), false);
    assert.equal(archive.manifest.files.some(value => value.source.includes('msi-resource-selection')), false);
    assert.equal(await readFile(join(foreign, 'foreign.bin'), 'utf8'), 'EXCLUDED FOREIGN CONTENT');
    completed = true;
  } finally { await crypto.finish({ completed, failed: !completed }); }
});

test('MSI windows: owned visible captions, bounded reads and interrupted immutable publication', WINDOWS_ONLY, async t => {
  const context = await contextFor(t, 'msi-window-contracts');
  context.scenario = 'packagedWorkspaceSuccess';
  await writeRequest(context, createRequest(context, 'exitZero'));
  const execution = startProgramFailureFixture(context, 'msiWindowContracts');
  const result = await execution.completion;
  assert.equal(result.exitCode, 0);
  assert.doesNotMatch(result.standardOutput + result.standardError, /SYNTHETIC MSI|EXCLUDED INPUT/);
  const { checks: proof, preparation } = JSON.parse(await readFile(join(context.testRoot, 'msi-window-contract.json'), 'utf8'));
  assert.equal(proof.firstSampleIsolatedFromOtherCases, true);
  assert.equal(proof.coldSampleRetained, true);
  assert.equal(proof.preparedSampleComplete, true);
  assert.equal(proof.preparationAllowsExactBudgetExpiry, true);
  assert.equal(proof.preparationRejectsOtherFailures, true);
  assert.equal(proof.preparationRejectsUnknownExit, true);
  assert.equal(proof.coldExitQueryFailureRetainsSample, true);
  assert.equal(proof.preparationRejectsFailedOwnershipQuery, true);
  assert.equal(preparation.childExitedAfterCapture, false);
  assert.equal(preparation.membershipAfterCapture, 'Owned');
  if (preparation.status === 'partial') {
    assert.deepEqual(preparation.listFailure, { Stage: 'listProcessId', Reason: 'budgetExpired', HResult: null });
  } else {
    assert.equal(preparation.status, 'observed');
    assert.equal(preparation.listFailure, null);
  }
  assert.equal(proof.firstListFailureRetained, true);
  assert.equal(proof.deniedListSkipsProvider, true);
  assert.equal(proof.unresponsiveListCauseRetained, true);
  assert.equal(proof.nativeExceptionCodeRetained, true);
  assert.ok(Object.keys(proof).length >= 25);
  assert.ok(Object.values(proof).every(value => value === true));
});

test('MSI windows: native observation survives exit and interrupted publication through real OpenPGP delivery', WINDOWS_ONLY, async t => {
  const context = await contextFor(t, 'msi-window-encrypted');
  const temporary = join(context.testRoot, 'temporary');
  const checkout = join(context.testRoot, 'checkout');
  const scenarioRoot = join(temporary, 'eky-acceptance-command-' + 'a'.repeat(32), 'scenario');
  await mkdir(scenarioRoot, { recursive: true });
  await mkdir(checkout);
  context.scenario = 'packagedWorkspaceSuccess';
  context.requestPath = join(scenarioRoot, 'request.json');
  context.resultPath = join(scenarioRoot, 'result.json');
  await writeRequest(context, { ...createRequest(context, 'exitZero'), workingDirectory: scenarioRoot });
  const crypto = await createOpenPgpTestFixture(fileURLToPath(new URL('../../../../../', import.meta.url)));
  let completed = false;
  try {
    const recipient = await crypto.generate('recipient');
    await crypto.invokeGpg(recipient.home, ['--pinentry-mode', 'loopback', '--passphrase', '',
      '--quick-add-key', recipient.fingerprint, 'cv25519', 'encr', '1d']);
    const publicPath = await crypto.exportKey(recipient, 'public.asc');
    const env = { ...process.env, GITHUB_ACTIONS: 'true', GITHUB_RUN_ID: '98765', GITHUB_RUN_ATTEMPT: '1',
      GITHUB_JOB: 'tests', EKY_EVIDENCE_JOB_KEY: 'tests-0', GITHUB_SHA: 'a'.repeat(40),
      EKY_EVIDENCE_JOB_OUTCOME: 'failure', RUNNER_TEMP: temporary, GITHUB_WORKSPACE: checkout,
      EKY_DIAGNOSTIC_KEY_FINGERPRINT: recipient.fingerprint,
      EKY_DIAGNOSTIC_VERIFIED_FINGERPRINT: recipient.fingerprint,
      EKY_DIAGNOSTIC_PUBLIC_KEY: await readFile(publicPath, 'utf8') };
    const execution = startProgramFailureFixture(context, 'msiWindowContracts', { environment: env });
    const result = await execution.completion;
    assert.equal(result.exitCode, 0);
    assert.doesNotMatch(result.standardOutput + result.standardError, /SYNTHETIC MSI|EXCLUDED INPUT/);
    const { checks: proof, preparation } = JSON.parse(await readFile(join(scenarioRoot, 'msi-window-contract.json'), 'utf8'));
    assert.equal(proof.firstSampleIsolatedFromOtherCases, true);
    assert.equal(proof.cleanupVerified, true);
    assert.equal(proof.cancelBeforePublicationRetainsPending, true);
    const failedContext = { ...context, testRoot: join(temporary, 'eky supervisor receipt'),
      privateOutputCaptures: [], privateOutputRetention: undefined };
    await mkdir(failedContext.testRoot);
    try {
      const failed = startProgramFailureFixture(failedContext, 'msiWindowFailureReceipt', { environment: env });
      await assert.rejects(failed.completion, { message: 'WINDOWS_ACCEPTANCE_SUPERVISOR_STDERR_NOT_EMPTY' });
      assert.equal(Number.isInteger(failed.child.exitCode), true);
      assert.notEqual(failed.child.exitCode, 0);
    } finally { await cleanupRunContext(failedContext, { preserveEvidence: true }); }
    const collected = await collectJobFailureEvidence(env, { nativeTemp: temporary });
    await encryptArchive(collected.root, collected);
    const decrypted = await crypto.invokeGpg(recipient.home, ['--decrypt', join(collected.root, 'evidence.json.gz.gpg')]);
    const archive = JSON.parse(gunzipSync(decrypted.stdout));
    const entries = archive.manifest.files.filter(value => value.kind === 'msiWindowObservation' && value.status === 'retained');
    assert.equal(entries.length, 1);
    const record = JSON.parse(Buffer.from(archive.files[entries[0].name], 'base64'));
    assert.equal(record.runNonce, context.runNonce);
    assert.equal(record.artifactDescriptorSha256, context.artifactDescriptorSha256);
    assert.equal(record.sequence, 1);
    assert.equal(record.clients.length, 3);
    assert.equal(record.clients[0].status, preparation.status);
    assert.equal(record.clients[0].processId, record.clients[1].processId);
    assert.equal(record.clients[1].status, 'observed');
    assert.equal(record.clients[1].windows.some(row => row.role === 'application' &&
      row.text === 'SYNTHETIC OWNED APPLICATION'), true);
    assert.equal(record.clients.some(client => client.windows.some(row => row.role === 'application' &&
      row.text === 'SYNTHETIC OWNED APPLICATION')), true);
    assert.equal(record.clients.some(client => client.status === 'partial'), true);
    const failureReceipts = archive.manifest.files
      .filter(value => value.kind === 'nativeResult' && value.status === 'retained')
      .map(value => Buffer.from(archive.files[value.name], 'base64').toString('utf8'))
      .filter(value => value.includes('msiWindowContractFailed:titleCaptured:'));
    assert.equal(failureReceipts.length, 1);
    const receipt = failureReceipts[0].match(/msiWindowContractFailed:titleCaptured:(\{[^\r\n]+\})/);
    assert.ok(receipt);
    assert.deepEqual(JSON.parse(receipt[1]), { sample: { status: 'partial', titleCaptured: false,
      messageCaptured: false, buttonCaptured: false, applicationCaptured: false,
      elapsedMilliseconds: 0, childExitedAfterCapture: null, membershipAfterCapture: 'Unknown',
      listFailure: { Stage: 'admission', Reason: 'outputLimit', HResult: null } },
      preparation: { status: 'partial', titleCaptured: false, messageCaptured: false,
        buttonCaptured: false, applicationCaptured: false, elapsedMilliseconds: 1000,
        childExitedAfterCapture: false, membershipAfterCapture: 'Owned',
        listFailure: { Stage: 'listProcessId', Reason: 'budgetExpired', HResult: null } } });
    assert.ok(/MsiWindowObservationContract\.RunFailureReceipt/.test(failureReceipts[0]),
      'MSI_WINDOW_FAILURE_NATIVE_FRAME_MISSING');
    assert.doesNotMatch(JSON.stringify(archive), /EXCLUDED INPUT|window-child-|\.pending/);
    assert.equal(archive.manifest.jobOutcome, 'failure');
    assert.equal(archive.manifest.cleanup, 'notInferred');
    completed = true;
  } finally { await crypto.finish({ completed, failed: !completed }); }
});

test('MSI observation: held handles, bounded samples and late completion preserve the optional contract', WINDOWS_ONLY, async t => {
  const context = await contextFor(t, 'msi-observation-contracts');
  context.scenario = 'packagedWorkspaceFaultRollback';
  await writeRequest(context, createRequest(context, 'exitZero'));
  const execution = startProgramFailureFixture(context, 'msiObservationContracts');
  assert.equal((await execution.completion).exitCode, 0);
  const proof = JSON.parse(await readFile(join(context.testRoot, 'msi-observation-contract.json'), 'utf8'));
  assert.ok(Object.keys(proof).length >= 30);
  assert.ok(Object.values(proof).every(value => value === true));
});

for (const mode of ['msiObservationBlocked', 'msiObservationThrows']) {
  for (const terminal of ['success', 'deadline']) {
    test(`MSI observation: ${mode} cannot replace ${terminal} or delay owned cleanup`, WINDOWS_ONLY, async t => {
      const context = await contextFor(t, `${mode}-${terminal}`);
      context.scenario = 'packagedWorkspaceFaultRollback';
      await writeRequest(context, createRequest(context, 'hold'));
      const execution = startProgramFailureFixture(context, mode);
      const root = await waitForMarker(context, 'root');
      await waitForMarker(context, 'observation');
      if (terminal === 'success') await releaseFixture(context, 'root');
      const { completion, result } = await readCompletedExecution(context, execution);
      assert.equal(completion.exitCode, terminal === 'success' ? 0 : 1);
      assert.equal(result.processResultCode, terminal === 'success' ? 'processCompleted' : 'deadlineExceeded');
      assert.equal(result.processTreeAbsent, true);
      assert.ok(['notRequired', 'processTreeAbsent'].includes(result.cleanupResultCode));
      const observations = completion.evidence.filter(value => value.phase === 'msiClientMembership');
      assert.deepEqual(observations.map(value => value.resultCode),
        [mode === 'msiObservationBlocked' ? 'observationPending' : 'observationUnknown']);
      assert.ok(completion.evidence.findIndex(value => value.phase === 'msiClientMembership') <
        completion.evidence.findIndex(value => value.phase === 'processTreeAbsent'));
      assert.equal(completion.standardOutput.includes('synthetic private failure'), false);
      await waitForProcessAbsent(root.processId);
    });
  }
}

test('MSI observation: interrupted command retains first output while its owned tree exits', WINDOWS_ONLY, async t => {
  const context = await contextFor(t, 'msi-observation-interrupted');
  context.scenario = 'packagedWorkspaceFaultRollback';
  await writeRequest(context, createRequest(context, 'hold'));
  const execution = startProgramFailureFixture(context, 'msiObservationBlocked');
  const root = await waitForMarker(context, 'root');
  await waitForMarker(context, 'observation');
  assert.equal(execution.child.kill(), true);
  await execution.completion;
  await waitForProcessAbsent(root.processId);
  await cleanupRunContext(context, { preserveEvidence: true });
  const preserved = await readFile(join(context.testRoot, 'supervisor-1.stdout.private'), 'utf8');
  assert.match(preserved, /"phase":"waitStarted"/);
  assert.doesNotMatch(preserved, /"phase":"resultWritten"/);
});

async function readCompletedExecution(context, execution) {
  const completion = await execution.completion;
  const result = await readWindowsAcceptanceSupervisorResult(
    context.resultPath,
    {
      artifactDescriptorSha256: context.artifactDescriptorSha256,
      runNonce: context.runNonce,
      scenario: context.scenario,
      supervisorExitCode: completion.exitCode,
    },
  );
  return { completion, result };
}

async function diagnosticContext(t) {
  const context = await createRunContext('deadline-diagnostics');
  // These unit fixtures never launch processes; real handle cleanup has its own test.
  t.after(() => t.passed === true ? rm(context.testRoot, { force: true, recursive: true }) : undefined);
  await mkdir(context.runRoot);
  return context;
}

function deadlineExecution(context, overrides = {}) {
  return {
    exitCode: 1,
    result: {
      schemaVersion: 1,
      runNonce: context.runNonce,
      scenario: context.scenario,
      artifactDescriptorSha256: context.artifactDescriptorSha256,
      status: 'failed',
      processResultCode: 'deadlineExceeded',
      workerResultCode: 'notChecked',
      cleanupResultCode: 'processTreeAbsent',
      cleanupWin32ErrorCode: null,
      processTreeAbsent: true,
      processWin32ErrorCode: null,
      durationMs: 1,
      childExitCode: null,
      ...overrides,
    },
  };
}

function fixtureMarker(context, role) {
  return { schemaVersion: 1, runNonce: context.runNonce, role, processId: 12345 };
}

function mockAbsentProcesses(t) {
  t.mock.method(process, 'kill', () => {
    throw Object.assign(new Error('synthetic absent process'), { code: 'ESRCH' });
  });
}

function controlledProof(context, contract = 'bothLive') {
  const member = value => ({ ready: value, member: value, aliveBeforeDeadline: value, exitedAfterCleanup: value });
  return {
    schemaVersion: 1, clockKind: 'controlled', runNonce: context.runNonce,
    scenario: context.scenario, artifactDescriptorSha256: context.artifactDescriptorSha256,
    contract, root: member(true), grandchild: member(contract === 'bothLive'),
    sentinel: { outsideJob: true, aliveBeforeDeadline: true, aliveAfterCleanup: true },
    creationWithheld: contract === 'rootBeforeGrandchild', deadlineTriggered: true, setupFailure: null,
  };
}

function writerFailureProof(context) {
  return {
    schemaVersion: 1, runNonce: context.runNonce, scenario: context.scenario,
    artifactDescriptorSha256: context.artifactDescriptorSha256, resultCode: 'resultWriteFailed',
    writePhase: 'publish', lastCompletedPhase: 'close', processResultCode: 'deadlineExceeded',
    cleanupResultCode: 'processTreeAbsent', processTreeAbsent: true,
  };
}

function proofPublicationFailure(context) {
  return {
    schemaVersion: 1, runNonce: context.runNonce, scenario: context.scenario,
    artifactDescriptorSha256: context.artifactDescriptorSha256,
    resultCode: 'proofWriteFailed', writePhase: 'publish',
  };
}

test('private evidence: bounded streams are retained after cleanup without replacing existing results', async (t) => {
  const context = await diagnosticContext(t);
  const output = captureContractOutput(context, 'observed');
  const result = '{"syntheticResult":true}';
  await writeFile(context.resultPath, result, { flag: 'wx' });
  await writeFile(join(context.testRoot, 'ci-step.stdout.private'), 'first ci output', { flag: 'wx' });
  await writeFile(join(context.testRoot, 'ci-step.stderr.private'), 'first ci error', { flag: 'wx' });
  output.append('stdout', 'x'.repeat(CONTRACT_OUTPUT_LIMIT + 10));
  output.append('stdout', 'later output');
  output.append('stderr', 'synthetic error');
  output.end('stdout');
  output.end('stderr');
  output.close();
  await assert.rejects(access(join(context.testRoot, 'supervisor-1.stdout.private')), { code: 'ENOENT' });
  await cleanupRunContext(context, { preserveEvidence: true });
  assert.equal((await readFile(join(context.testRoot, 'supervisor-1.stdout.private'))).length, CONTRACT_OUTPUT_LIMIT);
  assert.equal(await readFile(join(context.testRoot, 'supervisor-1.stderr.private'), 'utf8'), 'synthetic error');
  assert.equal(await readFile(context.resultPath, 'utf8'), result);
  assert.equal(await readFile(join(context.testRoot, 'ci-step.stdout.private'), 'utf8'), 'first ci output');
  assert.equal(await readFile(join(context.testRoot, 'ci-step.stderr.private'), 'utf8'), 'first ci error');
  const metadata = JSON.parse(await readFile(join(context.testRoot, 'supervisor-output.private.json'), 'utf8'));
  assert.deepEqual(metadata.captures[0], { invocation: 1, mode: 'observed', closed: true,
    stdout: { status: 'retained', bytes: CONTRACT_OUTPUT_LIMIT, truncated: true, ended: true },
    stderr: { status: 'retained', bytes: 15, truncated: false, ended: true } });
  await cleanupRunContext(context, { preserveEvidence: true });
  assert.equal(await readFile(join(context.testRoot, 'supervisor-1.stderr.private'), 'utf8'), 'synthetic error');
});

test('private evidence: cleanup failure preserves partial output and continues through owned handles', async (t) => {
  const context = await diagnosticContext(t);
  const output = captureContractOutput(context, 'observed');
  const cleanupError = new Error('synthetic cleanup failure');
  const failed = Object.assign(new EventEmitter(), { exitCode: null, signalCode: null });
  failed.kill = () => {
    failed.exitCode = 1;
    queueMicrotask(() => failed.emit('close'));
    throw cleanupError;
  };
  const remaining = Object.assign(new EventEmitter(), { exitCode: null, signalCode: null });
  remaining.kill = () => {
    output.append('stderr', 'last cleanup output');
    remaining.exitCode = 0;
    queueMicrotask(() => remaining.emit('close'));
    return true;
  };
  context.supervisorProcesses.add(failed);
  context.fixtureProcesses.add(remaining);
  await writeFile(context.resultPath, 'first result', { flag: 'wx' });
  await assert.rejects(cleanupRunContext(context), error => error === cleanupError);
  assert.equal(remaining.exitCode, 0);
  assert.equal(await readFile(context.resultPath, 'utf8'), 'first result');
  assert.equal(await readFile(join(context.testRoot, 'supervisor-1.stderr.private'), 'utf8'), 'last cleanup output');
  const metadata = JSON.parse(await readFile(join(context.testRoot, 'supervisor-output.private.json'), 'utf8'));
  assert.equal(metadata.captures[0].closed, false);
  assert.equal(metadata.captures[0].stderr.ended, false);
});

test('private evidence: an unavailable destination does not replace the first cleanup failure', async (t) => {
  const context = await diagnosticContext(t);
  const output = captureContractOutput(context, 'observed');
  output.append('stdout', 'new output');
  output.append('stderr', 'retained error');
  await writeFile(join(context.testRoot, 'supervisor-1.stdout.private'), 'first output', { flag: 'wx' });
  await mkdir(join(context.runRoot, 'root.ready.json'));
  await assert.rejects(cleanupRunContext(context), { message: 'WINDOWS_ACCEPTANCE_FIXTURE_MARKER_READ_FAILED' });
  assert.equal(await readFile(join(context.testRoot, 'supervisor-1.stdout.private'), 'utf8'), 'first output');
  assert.equal(await readFile(join(context.testRoot, 'supervisor-1.stderr.private'), 'utf8'), 'retained error');
  const metadata = JSON.parse(await readFile(join(context.testRoot, 'supervisor-output.private.json'), 'utf8'));
  assert.equal(metadata.captures[0].stdout.status, 'unavailable');
  assert.equal(context.privateOutputRetention, 'partial');
});

test('private evidence: separate invocations and overflow cannot overwrite the first capture', async (t) => {
  const context = await diagnosticContext(t);
  for (let index = 1; index <= 17; index++) {
    const output = captureContractOutput(context, 'observed');
    output.append('stderr', `invocation-${index}`);
    output.close();
  }
  await cleanupRunContext(context, { preserveEvidence: true });
  assert.equal(await readFile(join(context.testRoot, 'supervisor-1.stderr.private'), 'utf8'), 'invocation-1');
  assert.equal(await readFile(join(context.testRoot, 'supervisor-16.stderr.private'), 'utf8'), 'invocation-16');
  await assert.rejects(access(join(context.testRoot, 'supervisor-17.stderr.private')), { code: 'ENOENT' });
  const metadata = JSON.parse(await readFile(join(context.testRoot, 'supervisor-output.private.json'), 'utf8'));
  assert.equal(metadata.invocationOverflow, true);
  assert.equal(metadata.captures.length, 16);
});

for (const mode of ['assertion', 'stderr', 'observer', 'unread', 'ignored', 'success']) {
  test(`private evidence: real test hook retains failed contract only (${mode})`, { timeout: 20_000 }, async (t) => {
    const parent = await diagnosticContext(t);
    const receipt = join(parent.testRoot, 'context-root.private');
    const result = spawnSync(process.execPath, [
      fileURLToPath(new URL('./privateEvidenceTestFixture.mjs', import.meta.url)), receipt, mode], {
      env: { ...process.env, EKY_DOTNET_EXE: process.execPath },
      encoding: 'utf8', timeout: 10_000, maxBuffer: 131_072, windowsHide: true,
    });
    // The intentionally failing child's TAP stays private, including filesystem paths.
    await writeFile(join(parent.testRoot, 'ci-step.stdout.private'), result.stdout ?? '', { flag: 'wx' });
    await writeFile(join(parent.testRoot, 'ci-step.stderr.private'), result.stderr ?? '', { flag: 'wx' });
    assert.equal(result.error, undefined, 'Synthetic test runner must finish');
    assert.equal(result.status, mode === 'success' ? 0 : 1);
    if (mode !== 'success') assert.ok(result.stdout.includes(mode === 'stderr'
      ? 'WINDOWS_ACCEPTANCE_SUPERVISOR_STDERR_NOT_EMPTY' : 'synthetic contract assertion'),
    'The intended first failure must survive the test hook');
    const root = await readFile(receipt, 'utf8');
    t.after(() => t.passed === true ? rm(root, { recursive: true, force: true }) : undefined);
    if (mode === 'success') {
      await assert.rejects(access(root), { code: 'ENOENT' });
      return;
    }
    assert.equal(await readFile(join(root, 'result.json'), 'utf8'), '{"syntheticResult":true}');
    assert.equal(await readFile(join(root, 'ci-step.stderr.private'), 'utf8'), 'synthetic ci stderr');
    const metadata = JSON.parse(await readFile(join(root, 'supervisor-output.private.json'), 'utf8'));
    const unobserved = mode === 'unread' || mode === 'ignored';
    assert.equal(metadata.captures[0].mode, unobserved ? mode : 'observed');
    assert.equal(metadata.captures[0].closed, true);
    if (unobserved) {
      assert.equal(metadata.captures[0].stdout.status, 'notRead');
      await assert.rejects(access(join(root, 'supervisor-1.stdout.private')), { code: 'ENOENT' });
    } else {
      assert.match(await readFile(join(root, 'supervisor-1.stdout.private'), 'utf8'), /"phase":"hostExited"/);
      assert.equal(metadata.captures[0].stdout.ended, true);
      assert.equal(await readFile(join(root, 'supervisor-1.stderr.private'), 'utf8'),
        mode === 'stderr' ? 'synthetic native failure\n' : '');
    }
  });
}

for (const mode of ['multi-success', 'multi-cleanup-failure', 'multi-body-failure', 'multi-first-cleanup-failure']) {
  test(`private evidence: all test contexts share the cleanup decision (${mode})`, { timeout: 20_000 }, async (t) => {
    const parent = await diagnosticContext(t);
    const receipt = join(parent.testRoot, 'context-roots.private.json');
    const result = spawnSync(process.execPath, [
      fileURLToPath(new URL('./privateEvidenceTestFixture.mjs', import.meta.url)), receipt, mode], {
      encoding: 'utf8', timeout: 10_000, maxBuffer: 131_072, windowsHide: true,
    });
    await writeFile(join(parent.testRoot, 'ci-step.stdout.private'), result.stdout ?? '', { flag: 'wx' });
    await writeFile(join(parent.testRoot, 'ci-step.stderr.private'), result.stderr ?? '', { flag: 'wx' });
    assert.equal(result.error, undefined, 'Synthetic test runner must finish');
    const roots = JSON.parse(await readFile(receipt, 'utf8'));
    t.after(async () => {
      if (t.passed === true) for (const root of roots) await rm(root, { recursive: true, force: true });
    });
    assert.equal(roots.length, 3);
    assert.equal(result.status, mode === 'multi-success' ? 0 : 1);
    if (mode === 'multi-success') {
      for (const root of roots) await assert.rejects(access(root), { code: 'ENOENT' });
      return;
    }
    const expectedFailure = mode === 'multi-body-failure' ? 'synthetic contract assertion'
      : mode === 'multi-first-cleanup-failure' ? 'synthetic first cleanup failure' : 'synthetic second cleanup failure';
    assert.ok(result.stdout.includes(expectedFailure), 'The original body or first cleanup failure must survive');
    for (const [index, root] of roots.entries()) {
      assert.equal(await readFile(join(root, 'result.json'), 'utf8'), JSON.stringify({ syntheticResult: index + 1 }));
      assert.equal(await readFile(join(root, 'supervisor-1.stdout.private'), 'utf8'), `cleanup-${index + 1}`);
      assert.equal(await readFile(join(root, 'supervisor-1.stderr.private'), 'utf8'),
        `bodyPassed=${mode !== 'multi-body-failure'}`);
      const metadata = JSON.parse(await readFile(join(root, 'supervisor-output.private.json'), 'utf8'));
      assert.equal(metadata.captures[0].closed, true);
      assert.equal(metadata.captures[0].stdout.status, 'retained');
      assert.equal(metadata.captures[0].stdout.ended, true);
    }
  });
}

test('deadline proof publication requires bound failure and genuine both-live observations', async (t) => {
  const context = await diagnosticContext(t);
  await writeFile(join(context.testRoot, 'deadline-proof-write-failure.json'), JSON.stringify(proofPublicationFailure(context)));
  await writeFile(join(context.testRoot, 'deadline-process-proof.json.next'), JSON.stringify(controlledProof(context)));
  assert.deepEqual(await readDeadlineProofPublicationFailure(context), {
    resultCode: 'proofWriteFailed', writePhase: 'publish', nativeProcessProof: 'verified',
  });
});

for (const kind of ['missingFailure', 'malformed', 'extra', ...Object.keys(proofPublicationFailure({})),
  'missingProcessProof', 'earlySetupFailure', 'deadlineNotTriggered', 'notBothLive', 'unconfirmedExit']) {
  test(`deadline proof publication rejects earlier or unrelated failure: ${kind}`, async (t) => {
    const context = await diagnosticContext(t);
    const failure = proofPublicationFailure(context);
    const proof = controlledProof(context);
    if (Object.hasOwn(failure, kind) || kind === 'extra') failure[kind] = 'wrong';
    if (kind === 'earlySetupFailure') proof.setupFailure = 'readinessFailed';
    if (kind === 'deadlineNotTriggered') proof.deadlineTriggered = false;
    if (kind === 'notBothLive') proof.grandchild.aliveBeforeDeadline = false;
    if (kind === 'unconfirmedExit') proof.root.exitedAfterCleanup = false;
    if (kind !== 'missingFailure') await writeFile(join(context.testRoot, 'deadline-proof-write-failure.json'),
      kind === 'malformed' ? '{' : JSON.stringify(failure));
    if (kind !== 'missingProcessProof') await writeFile(join(context.testRoot, 'deadline-process-proof.json.next'), JSON.stringify(proof));
    await assert.rejects(readDeadlineProofPublicationFailure(context), {
      message: 'WINDOWS_ACCEPTANCE_DEADLINE_PROOF_PUBLICATION_INVALID',
    });
  });
}

test('deadline writer proof requires the exact bound publication failure', async (t) => {
  const context = await diagnosticContext(t);
  await writeFile(join(context.testRoot, 'deadline-writer-proof.json'), JSON.stringify(writerFailureProof(context)));
  assert.deepEqual(await readDeadlineWriterFailureProof(context), {
    resultCode: 'resultWriteFailed', writePhase: 'publish', lastCompletedPhase: 'close',
  });
});

for (const kind of ['missing', 'unreadable', 'malformed', 'null', 'array', 'oversized',
  ...Object.keys(writerFailureProof({})), 'extra']) {
  test(`deadline writer proof rejects missing, early or unrelated failure: ${kind}`, async (t) => {
    const context = await diagnosticContext(t);
    const path = join(context.testRoot, 'deadline-writer-proof.json');
    const proof = writerFailureProof(context);
    if (Object.hasOwn(proof, kind) || kind === 'extra') proof[kind] = 'wrong';
    if (kind === 'unreadable') await mkdir(path);
    else if (kind !== 'missing') await writeFile(path, kind === 'malformed' ? '{'
      : kind === 'null' ? 'null' : kind === 'array' ? '[]' : kind === 'oversized' ? ' '.repeat(4_097)
        : JSON.stringify(proof));
    await assert.rejects(readDeadlineWriterFailureProof(context), {
      message: 'WINDOWS_ACCEPTANCE_DEADLINE_WRITER_PROOF_INVALID',
    });
  });
}

for (const kind of ['read', 'assertion', 'execution']) {
  test(`deadline fixture boundary preserves evidence and hides private ${kind} errors`, async (t) => {
    const context = await diagnosticContext(t);
    const bytes = JSON.stringify(deadlineExecution(context).result);
    await writeFile(context.resultPath, bytes);
    await assert.rejects(verifyDeadlineFixture(context, async () => {
      if (kind === 'read') await readFile(join(context.testRoot, 'absent-proof.json'));
      else if (kind === 'assertion') assert.deepEqual({ private: context.runNonce }, { private: context.testRoot });
      else throw new Error(context.testRoot + context.runNonce);
    }), error => {
      assert.equal(error.message, 'WINDOWS_ACCEPTANCE_DEADLINE_CHECK_FAILED');
      assert.equal(error.stack, error.message);
      assert.equal(error.cause, undefined);
      assert.equal(error.actual, undefined);
      assert.equal(error.diagnostic.failure.phase, 'verification');
      assert.equal(error.diagnostic.cleanup, 'completed');
      assert.equal(error.diagnostic.retention, 'requested');
      assert.equal(error.diagnostic.diagnosticWrite, 'completed');
      assert.equal(JSON.stringify(error).includes(context.testRoot), false);
      assert.equal(JSON.stringify(error).includes(context.runNonce), false);
      return true;
    });
    assert.equal(await readFile(context.resultPath, 'utf8'), bytes);
  });
}

test('deadline fixture boundary preserves primary failure when cleanup also fails', async (t) => {
  const context = await diagnosticContext(t);
  await mkdir(join(context.runRoot, 'root.ready.json'));
  await assert.rejects(verifyDeadlineFixture(context, async () => { throw new Error('private'); }), error => {
    assert.equal(error.message, 'WINDOWS_ACCEPTANCE_DEADLINE_CHECK_FAILED');
    assert.equal(error.diagnostic.cleanup, 'failed');
    assert.equal(error.diagnostic.cleanupFailure, 'WINDOWS_ACCEPTANCE_FIXTURE_MARKER_READ_FAILED');
    assert.equal(error.diagnostic.retention, 'requested');
    return true;
  });
  await access(context.testRoot);
});

test('deadline fixture boundary removes successful evidence only after verification', async (t) => {
  const context = await diagnosticContext(t);
  const diagnostic = await verifyDeadlineFixture(context, async () => { await access(context.testRoot); });
  assert.equal(diagnostic.failure, null);
  assert.equal(diagnostic.cleanup, 'completed');
  await assert.rejects(access(context.testRoot), { code: 'ENOENT' });
});

for (const contract of ['bothLive', 'rootBeforeGrandchild']) {
  test(`deadline proof validator accepts only the named contract: ${contract}`, async (t) => {
    const context = await diagnosticContext(t);
    await writeFile(join(context.testRoot, 'deadline-process-proof.json'), JSON.stringify(controlledProof(context, contract)));
    assert.deepEqual(await readControlledDeadlineProof(context, contract), { contract, nativeProcessProof: 'verified' });
    await assert.rejects(readControlledDeadlineProof(context, contract === 'bothLive' ? 'rootBeforeGrandchild' : 'bothLive'), {
      message: 'WINDOWS_ACCEPTANCE_DEADLINE_PROCESS_PROOF_INVALID',
    });
  });
}

for (const kind of ['missing', 'unreadable', 'malformed', 'null', 'array', 'nonce', 'scenario', 'artifact',
  'schema', 'clock', 'extra', 'missingBinding', 'member', 'notAlive', 'notExited', 'sentinelInside',
  'sentinelExited', 'withheld', 'notTriggered', 'setupFailed', 'grandchildMissing']) {
  test(`deadline proof validator rejects incomplete or invalid proof: ${kind}`, async (t) => {
    const context = await diagnosticContext(t);
    const proof = controlledProof(context);
    const path = join(context.testRoot, 'deadline-process-proof.json');
    const mutations = {
      nonce: () => { proof.runNonce = 'wrong'; }, scenario: () => { proof.scenario = 'wrong'; },
      artifact: () => { proof.artifactDescriptorSha256 = 'wrong'; }, schema: () => { proof.schemaVersion = 2; },
      clock: () => { proof.clockKind = 'real'; }, extra: () => { proof.extra = context.testRoot; },
      missingBinding: () => { delete proof.runNonce; }, member: () => { proof.grandchild.member = false; },
      notAlive: () => { proof.root.aliveBeforeDeadline = false; }, notExited: () => { proof.root.exitedAfterCleanup = false; },
      sentinelInside: () => { proof.sentinel.outsideJob = false; }, sentinelExited: () => { proof.sentinel.aliveAfterCleanup = false; },
      withheld: () => { proof.creationWithheld = true; }, notTriggered: () => { proof.deadlineTriggered = false; },
      setupFailed: () => { proof.setupFailure = 'setupDeadlineExceeded'; }, grandchildMissing: () => { delete proof.grandchild; },
    };
    mutations[kind]?.();
    if (kind === 'unreadable') await mkdir(path);
    else if (kind !== 'missing') await writeFile(path, kind === 'malformed' ? '{' : kind === 'null' ? 'null'
      : kind === 'array' ? '[]' : JSON.stringify(proof));
    await assert.rejects(readControlledDeadlineProof(context, 'bothLive'), error => {
      assert.equal(error.message, 'WINDOWS_ACCEPTANCE_DEADLINE_PROCESS_PROOF_INVALID');
      assert.equal(error.cause, undefined);
      assert.equal(error.message.includes(context.testRoot), false);
      return true;
    });
  });
}

test('controlled deadline preserves terminal before rejecting missing process proof', async (t) => {
  const context = await diagnosticContext(t);
  const execution = deadlineExecution(context);
  const bytes = JSON.stringify(execution.result);
  await writeFile(context.resultPath, bytes);
  await assert.rejects(verifyControlledDeadlineRun(context, 'bothLive', async () => execution), error => {
    assert.equal(error.message, 'WINDOWS_ACCEPTANCE_DEADLINE_PROCESS_PROOF_INVALID');
    assert.equal(error.diagnostic.failure.phase, 'nativeProcessProof');
    assert.equal(error.diagnostic.terminal.processResultCode, 'deadlineExceeded');
    assert.equal(error.diagnostic.cleanup, 'completed');
    assert.equal(error.diagnostic.retention, 'requested');
    assert.equal(JSON.stringify(error.diagnostic).includes(context.testRoot), false);
    return true;
  });
  assert.equal(await readFile(context.resultPath, 'utf8'), bytes);
});

for (const role of ['root', 'output']) test(`deadline diagnostics: completed ${role} marker read does not wait for a missing file`, async (t) => {
  const context = await diagnosticContext(t);
  t.mock.method(globalThis, 'setTimeout', () => { throw new Error('unexpected readiness wait'); });
  await assert.rejects(readCompletedMarker(context, role), {
    message: 'WINDOWS_ACCEPTANCE_FIXTURE_MARKER_MISSING',
  });
});

for (const errorCode of [null, 'requestSchemaInvalid']) {
  test(`deadline diagnostics: completed output preserves its blocked-writer evidence (${errorCode})`, async (t) => {
    const context = await diagnosticContext(t);
    const marker = { ...fixtureMarker(context, 'output'), writerBlocked: true, errorCode };
    await writeFile(join(context.runRoot, 'output.ready.json'), JSON.stringify(marker));
    assert.deepEqual(await readCompletedMarker(context, 'output'), marker);
  });
}

for (const [name, changes] of Object.entries({
  unblocked: { writerBlocked: false },
  missingBlocked: { writerBlocked: undefined },
  unknownError: { errorCode: 'synthetic-private' },
  missingError: { errorCode: undefined },
  extra: { privateValue: 'synthetic-private' },
})) {
  test(`deadline diagnostics: rejects invalid completed output (${name})`, async (t) => {
    const context = await diagnosticContext(t);
    const marker = { ...fixtureMarker(context, 'output'), writerBlocked: true, errorCode: null, ...changes };
    await writeFile(join(context.runRoot, 'output.ready.json'), JSON.stringify(marker));
    await assert.rejects(readCompletedMarker(context, 'output'), {
      message: 'WINDOWS_ACCEPTANCE_FIXTURE_MARKER_INVALID',
    });
  });
}

for (const kind of ['malformed', 'null', 'array', 'nonce', 'role', 'schema', 'pid', 'extra']) {
  test(`deadline diagnostics: rejects invalid completed marker (${kind})`, async (t) => {
    const context = await diagnosticContext(t);
    const marker = fixtureMarker(context, 'root');
    const changes = {
      nonce: { runNonce: 'wrong' }, role: { role: 'grandchild' },
      schema: { schemaVersion: 2 }, pid: { processId: 0 }, extra: { secret: 'synthetic-private' },
    };
    const serialized = kind === 'malformed' ? '{synthetic-private'
      : kind === 'null' ? 'null' : kind === 'array' ? '[]'
        : JSON.stringify({ ...marker, ...changes[kind] });
    await writeFile(join(context.runRoot, 'root.ready.json'), serialized);
    await assert.rejects(readCompletedMarker(context, 'root'), {
      message: 'WINDOWS_ACCEPTANCE_FIXTURE_MARKER_INVALID',
    });
  });
}

test('deadline diagnostics: unreadable marker is not absence and prevents cleanup removal', async (t) => {
  const context = await diagnosticContext(t);
  await mkdir(join(context.runRoot, 'root.ready.json'));
  await assert.rejects(readCompletedMarker(context, 'root'), {
    message: 'WINDOWS_ACCEPTANCE_FIXTURE_MARKER_READ_FAILED',
  });
  await assert.rejects(cleanupRunContext(context), {
    message: 'WINDOWS_ACCEPTANCE_FIXTURE_MARKER_READ_FAILED',
  });
  await access(context.testRoot);
});

test('deadline diagnostics: terminal mismatch precedes missing markers and keeps its result', async (t) => {
  const context = await diagnosticContext(t);
  const execution = deadlineExecution(context, {
    processResultCode: 'processStartFailed', cleanupResultCode: 'notRequired',
  });
  const bytes = JSON.stringify(execution.result);
  await writeFile(context.resultPath, bytes);
  await assert.rejects(verifyDeadlineRun(context, async () => execution), (error) => {
    assert.equal(error.message, 'WINDOWS_ACCEPTANCE_DEADLINE_TERMINAL_UNEXPECTED');
    assert.deepEqual(error.diagnostic.failure, {
      phase: 'terminal', reason: 'WINDOWS_ACCEPTANCE_DEADLINE_TERMINAL_UNEXPECTED',
    });
    assert.deepEqual(error.diagnostic.terminal, {
      processResultCode: 'processStartFailed', cleanupResultCode: 'notRequired', processTreeAbsent: true,
    });
    assert.equal(error.diagnostic.rootMarker, 'notRead');
    assert.equal(error.diagnostic.grandchildMarker, 'notRead');
    assert.equal(error.diagnostic.cleanup, 'completed');
    return true;
  });
  assert.equal(await readFile(context.resultPath, 'utf8'), bytes);
});

test('deadline diagnostics: unvalidated terminal values never reach public diagnostics', async (t) => {
  const context = await diagnosticContext(t);
  const privateValue = context.testRoot + context.runNonce + 'synthetic-private';
  await assert.rejects(verifyDeadlineRun(context, async () => deadlineExecution(context, {
    processResultCode: privateValue,
  })), (error) => {
    assert.equal(error.message, 'WINDOWS_ACCEPTANCE_SUPERVISOR_RESULT_OUTCOME_INVALID');
    assert.equal(error.diagnostic.terminal, null);
    assert.equal(error.diagnostic.failure.phase, 'terminal');
    assert.equal(JSON.stringify(error).includes(privateValue), false);
    assert.equal(error.stack.includes(context.testRoot), false);
    assert.equal(error.cause, undefined);
    return true;
  });
});

test('deadline diagnostics: missing grandchild preserves the first result and marker bytes', async (t) => {
  const context = await diagnosticContext(t);
  mockAbsentProcesses(t);
  const execution = deadlineExecution(context);
  const markerBytes = JSON.stringify(fixtureMarker(context, 'root'));
  const resultBytes = JSON.stringify(execution.result);
  await writeFile(context.resultPath, resultBytes);
  await writeFile(join(context.runRoot, 'root.ready.json'), markerBytes);
  let diagnostic;
  await assert.rejects(verifyDeadlineRun(context, async () => execution), (error) => {
    diagnostic = error.diagnostic;
    assert.equal(error.message, 'WINDOWS_ACCEPTANCE_FIXTURE_MARKER_MISSING');
    assert.equal(diagnostic.failure.phase, 'grandchildMarker');
    assert.equal(diagnostic.rootMarker, 'valid');
    assert.equal(diagnostic.grandchildMarker, 'missing');
    assert.equal(diagnostic.terminal.processResultCode, 'deadlineExceeded');
    assert.equal(diagnostic.terminal.cleanupResultCode, 'processTreeAbsent');
    assert.equal(diagnostic.cleanup, 'completed');
    assert.equal(diagnostic.retention, 'requested');
    assert.equal(diagnostic.diagnosticWrite, 'completed');
    for (const value of [context.testRoot, context.runNonce, '12345']) {
      assert.equal(JSON.stringify(diagnostic).includes(value), false);
    }
    return true;
  });
  assert.equal(await readFile(context.resultPath, 'utf8'), resultBytes);
  assert.equal(await readFile(join(context.runRoot, 'root.ready.json'), 'utf8'), markerBytes);
  assert.deepEqual(JSON.parse(await readFile(join(context.testRoot, 'deadline-contract-diagnostic.json'), 'utf8')), diagnostic);
});

for (const bodyFails of [true, false]) {
  test(`deadline diagnostics: cleanup failure stays separate (bodyFails=${bodyFails})`, async (t) => {
    const context = await diagnosticContext(t);
    mockAbsentProcesses(t);
    if (!bodyFails) {
      for (const role of ['root', 'grandchild']) {
        await writeFile(join(context.runRoot, role + '.ready.json'), JSON.stringify(fixtureMarker(context, role)));
      }
    }
    const owned = Object.assign(new EventEmitter(), { exitCode: null, signalCode: null });
    owned.kill = t.mock.fn(() => {
      owned.exitCode = 1;
      queueMicrotask(() => owned.emit('close', 1, null));
      throw new Error(context.testRoot + context.runNonce + 'synthetic-private');
    });
    context.supervisorProcesses.add(owned);
    await assert.rejects(verifyDeadlineRun(context, async () => deadlineExecution(context)), (error) => {
      assert.equal(error.message, bodyFails
        ? 'WINDOWS_ACCEPTANCE_FIXTURE_MARKER_MISSING' : 'WINDOWS_ACCEPTANCE_DEADLINE_CLEANUP_FAILED');
      assert.equal(error.diagnostic.failure?.phase ?? null, bodyFails ? 'rootMarker' : null);
      assert.equal(error.diagnostic.cleanup, 'failed');
      assert.equal(error.diagnostic.cleanupFailure, 'WINDOWS_ACCEPTANCE_DEADLINE_CLEANUP_FAILED');
      for (const value of [context.testRoot, context.runNonce, 'synthetic-private']) {
        assert.equal(JSON.stringify(error).includes(value), false);
        assert.equal(error.stack.includes(value), false);
      }
      return true;
    });
    assert.equal(owned.kill.mock.callCount(), 1);
    await access(context.testRoot);
  });
}

test('deadline diagnostics: recording failure cannot mask the first failure or skip cleanup', async (t) => {
  const context = await diagnosticContext(t);
  await mkdir(join(context.testRoot, 'deadline-contract-diagnostic.json'));
  await assert.rejects(verifyDeadlineRun(context, async () => {
    throw new Error('synthetic-private ' + context.testRoot);
  }), (error) => {
    assert.equal(error.message, 'WINDOWS_ACCEPTANCE_DEADLINE_CHECK_FAILED');
    assert.equal(error.diagnostic.failure.phase, 'execution');
    assert.equal(error.diagnostic.cleanup, 'completed');
    assert.equal(error.diagnostic.diagnosticWrite, 'failed');
    assert.equal(JSON.stringify(error).includes('synthetic-private'), false);
    return true;
  });
  await access(context.testRoot);
});

test('deadline diagnostics: failed owned cleanup is not retried by the global hook', async (t) => {
  const context = await diagnosticContext(t);
  const otherContext = await diagnosticContext(t);
  const owned = Object.assign(new EventEmitter(), { exitCode: null, signalCode: null });
  const other = Object.assign(new EventEmitter(), { exitCode: null, signalCode: null });
  const close = (child) => {
    child.exitCode = 1;
    child.emit('close', 1, null);
  };
  t.after(() => {
    close(owned);
    close(other);
    t.mock.timers.reset();
  });
  let notifyCleanup;
  let ownedKillAttempts = 0;
  const cleanupEntered = new Promise((resolve) => { notifyCleanup = resolve; });
  owned.kill = t.mock.fn(() => {
    ownedKillAttempts += 1;
    notifyCleanup();
    // A broken global retry must fail the count assertion, not hang the runner.
    if (ownedKillAttempts > 1) queueMicrotask(() => close(owned));
    return true;
  });
  other.kill = t.mock.fn(() => { queueMicrotask(() => close(other)); return true; });
  registerSupervisorProcess(context, owned);
  registerSupervisorProcess(otherContext, other);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const rejected = assert.rejects(verifyDeadlineRun(context, async () => deadlineExecution(context)), (error) => {
    assert.equal(error.message, 'WINDOWS_ACCEPTANCE_FIXTURE_MARKER_MISSING');
    assert.equal(error.diagnostic.cleanupFailure, 'WINDOWS_ACCEPTANCE_FIXTURE_HANDLE_CLEANUP_TIMEOUT');
    assert.equal(error.diagnostic.retention, 'requested');
    return true;
  });
  await cleanupEntered;
  t.mock.timers.tick(10_000);
  await rejected;
  await cleanupActiveSupervisors();
  assert.equal(owned.kill.mock.callCount(), 1);
  assert.equal(other.kill.mock.callCount(), 1);
  assert.equal(context.supervisorProcesses.has(owned), true);
  assert.equal(otherContext.supervisorProcesses.has(other), false);
  await access(join(context.testRoot, 'deadline-contract-diagnostic.json'));
  const closed = once(owned, 'close');
  owned.kill();
  await closed;
  assert.equal(context.supervisorProcesses.has(owned), false);
});

test('deadline diagnostics: successful verification removes only the completed fixture', async (t) => {
  const context = await diagnosticContext(t);
  mockAbsentProcesses(t);
  for (const role of ['root', 'grandchild']) {
    await writeFile(join(context.runRoot, role + '.ready.json'), JSON.stringify(fixtureMarker(context, role)));
  }
  const diagnostic = await verifyDeadlineRun(context, async () => deadlineExecution(context));
  assert.equal(diagnostic.failure, null);
  assert.equal(diagnostic.cleanupFailure, null);
  assert.equal(diagnostic.rootProcess, 'absent');
  assert.equal(diagnostic.grandchildProcess, 'absent');
  assert.equal(diagnostic.cleanup, 'completed');
  assert.equal(diagnostic.retention, 'notRequested');
  await assert.rejects(access(context.testRoot), { code: 'ENOENT' });
});

test('deadline diagnostics: failed verification still closes a real owned process', WINDOWS_ONLY, async (t) => {
  const context = await contextFor(t, 'deadline-owned-cleanup');
  const sentinel = await startForeignSentinel(context);
  await assert.rejects(verifyDeadlineRun(context, async () => deadlineExecution(context)), {
    message: 'WINDOWS_ACCEPTANCE_FIXTURE_MARKER_MISSING',
  });
  assert.equal(isProcessAlive(sentinel.marker.processId), false);
  await access(context.testRoot);
  const diagnostic = JSON.parse(await readFile(join(context.testRoot, 'deadline-contract-diagnostic.json'), 'utf8'));
  assert.equal(diagnostic.cleanup, 'completed');
  assert.equal(diagnostic.failure.phase, 'rootMarker');
});

test('the supervisor binary is available', WINDOWS_ONLY, async () => {
  await access(SUPERVISOR_DLL);
});

test('contract fixtures resolve a temporary directory alias before creating owned paths', WINDOWS_ONLY, async (t) => {
  const parent = await contextFor(t, 'temporary-alias');
  const target = join(await realpath(parent.testRoot), 'target');
  const alias = join(parent.testRoot, 'alias');
  await mkdir(target);
  await symlink(target, alias, 'junction');
  const previous = { TEMP: process.env.TEMP, TMP: process.env.TMP };
  let context;
  try {
    process.env.TEMP = alias;
    process.env.TMP = alias;
    context = await contextFor(t, 'canonical-owned-paths');
  } finally {
    for (const key of ['TEMP', 'TMP']) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
  assert.ok(context.testRoot === await realpath(context.testRoot), 'Fixture root must be canonical');
  assert.equal(context.requestPath, join(context.testRoot, 'request.json'));
});

test('context cleanup removes the root only after its owned process exits', WINDOWS_ONLY, async (t) => {
  const context = await contextFor(t, 'context-cleanup-completed');
  const sentinel = await startForeignSentinel(context);
  await assert.doesNotReject(cleanupRunContext(context));
  assert.equal(isProcessAlive(sentinel.marker.processId), false);
  await assert.rejects(access(context.testRoot), { code: 'ENOENT' });
});

test('context cleanup can retain failed-run evidence without skipping owned handles', WINDOWS_ONLY, async (t) => {
  const context = await contextFor(t, 'context-cleanup-retained-result');
  const evidence = JSON.stringify({ processTreeAbsent: false, cleanupResultCode: 'cleanupUnverified' });
  await writeFile(context.resultPath, evidence, { flag: 'wx' });
  const sentinel = await startForeignSentinel(context);

  await assert.doesNotReject(cleanupRunContext(context, { preserveEvidence: true }));
  assert.equal(isProcessAlive(sentinel.marker.processId), false);
  assert.equal(await readFile(context.resultPath, 'utf8'), evidence);
  await access(context.testRoot);
});

for (const preserveEvidence of [false, true]) {
  test(`context cleanup preserves marker failure and closes owned handles: retain=${preserveEvidence}`, WINDOWS_ONLY, async (t) => {
    const context = await createRunContext('context-cleanup-invalid-marker');
    const markerPath = join(context.runRoot, 'root.ready.json');
    t.after(async () => {
      if (t.passed === true) await rm(markerPath, { force: true });
      await cleanupRunContext(context, { preserveEvidence: t.passed !== true });
    });
    const sentinel = await startForeignSentinel(context);
    const invalidMarker = JSON.stringify({ runNonce: 'invalid', processId: sentinel.marker.processId });
    await writeFile(markerPath, invalidMarker, { flag: 'wx' });

    await assert.rejects(cleanupRunContext(context, { preserveEvidence }), {
      message: 'WINDOWS_ACCEPTANCE_FIXTURE_MARKER_INVALID',
    });
    assert.equal(isProcessAlive(sentinel.marker.processId), false);
    assert.equal(await readFile(markerPath, 'utf8'), invalidMarker);
  });
}

test('context cleanup preserves evidence after handle timeout and still closes remaining handles', WINDOWS_ONLY, async (t) => {
  const context = await createRunContext('context-cleanup-handle-timeout');
  const unresponsive = Object.assign(new EventEmitter(), {
    exitCode: null, signalCode: null, kill: t.mock.fn(() => true),
  });
  const remaining = Object.assign(new EventEmitter(), { exitCode: null, signalCode: null });
  remaining.kill = t.mock.fn(() => {
    remaining.exitCode = 0;
    queueMicrotask(() => remaining.emit('close', 0, null));
    return true;
  });
  context.supervisorProcesses.add(unresponsive);
  context.supervisorProcesses.add(remaining);
  t.after(async () => {
    t.mock.timers.reset();
    unresponsive.exitCode = 1;
    remaining.exitCode = 0;
    await cleanupRunContext(context, { preserveEvidence: t.passed !== true });
  });
  const evidencePath = join(context.testRoot, 'retained-evidence.json');
  await writeFile(evidencePath, 'synthetic evidence', { flag: 'wx' });
  t.mock.timers.enable({ apis: ['setTimeout'] });

  const rejected = assert.rejects(cleanupRunContext(context), {
    message: 'WINDOWS_ACCEPTANCE_FIXTURE_HANDLE_CLEANUP_TIMEOUT',
  });
  t.mock.timers.tick(10_000);
  await rejected;
  assert.equal(unresponsive.kill.mock.callCount(), 1);
  assert.equal(remaining.kill.mock.callCount(), 1);
  assert.equal(await readFile(evidencePath, 'utf8'), 'synthetic evidence');
});

test('context cleanup preserves a handle error and still closes the next process group', WINDOWS_ONLY, async (t) => {
  const context = await createRunContext('context-cleanup-handle-error');
  const handleError = new Error('syntheticHandleError');
  const failing = Object.assign(new EventEmitter(), { exitCode: null, signalCode: null });
  failing.kill = t.mock.fn(() => {
    failing.exitCode = 1;
    queueMicrotask(() => failing.emit('close', 1, null));
    throw handleError;
  });
  const remaining = Object.assign(new EventEmitter(), { exitCode: null, signalCode: null });
  remaining.kill = t.mock.fn(() => {
    remaining.exitCode = 0;
    queueMicrotask(() => remaining.emit('close', 0, null));
    return true;
  });
  context.supervisorProcesses.add(failing);
  context.fixtureProcesses.add(remaining);
  t.after(async () => {
    failing.exitCode = 1;
    remaining.exitCode = 0;
    await cleanupRunContext(context, { preserveEvidence: t.passed !== true });
  });
  const evidencePath = join(context.testRoot, 'retained-evidence.json');
  await writeFile(evidencePath, 'synthetic evidence', { flag: 'wx' });

  await assert.rejects(cleanupRunContext(context), (error) => error === handleError);
  assert.equal(failing.kill.mock.callCount(), 1);
  assert.equal(remaining.kill.mock.callCount(), 1);
  assert.equal(await readFile(evidencePath, 'utf8'), 'synthetic evidence');
});

test('creation measurement output failure preserves process and cleanup results', WINDOWS_ONLY, async (t) => {
  const context = await contextFor(t, 'measurement-write-failure');
  await mkdir(join(context.testRoot, 'creation-measurement.json'));
  await writeRequest(context, createRequest(context, 'exitNonZero'));
  const { result, completion } = await readCompletedExecution(context,
    startProgramFailureFixture(context, 'measureCreation'));
  assert.equal(completion.exitCode, 1);
  assert.equal(result.processResultCode, 'processExitFailed');
  assert.equal(result.childExitCode, 23);
  assert.equal(result.cleanupResultCode, 'notRequired');
  assert.equal(result.processTreeAbsent, true);
});

for (const mode of [
  'atomicMembership', 'creationCancelled', 'creationLate', 'creationPending',
  'creationFailure', 'creationUnexpectedFailure',
]) {
  test(`process creation boundary: ${mode}`, WINDOWS_ONLY, async (testContext) => {
    const context = await contextFor(testContext, mode);
    const sentinel = await startForeignSentinel(context);
    const deadlineExpected = ['creationCancelled', 'creationLate', 'creationPending'].includes(mode);
    await writeRequest(context, createRequest(context, 'exitZero', deadlineExpected
      ? { timeoutMilliseconds: 2_000, cleanupReserveMilliseconds: 1_000 }
      : undefined));
    const terminal = await readCompletedExecution(context, startProgramFailureFixture(context, mode));
    const { result, completion } = terminal;
    assert.equal(result.processResultCode, mode === 'atomicMembership' ? 'processCompleted'
      : deadlineExpected ? 'deadlineExceeded' : 'processStartFailed');
    assert.equal(completion.exitCode, mode === 'atomicMembership' ? 0 : 1);
    assert.equal(result.processTreeAbsent, mode !== 'creationPending');
    assert.equal(result.cleanupResultCode, mode === 'creationPending' ? 'cleanupUnverified'
      : ['creationLate', 'creationUnexpectedFailure'].includes(mode) ? 'processTreeAbsent' : 'notRequired');
    assert.equal(result.processWin32ErrorCode, mode === 'creationFailure' ? 2 : null);
    assert.equal(isProcessAlive(sentinel.marker.processId), true);
    if (mode !== 'creationFailure') {
      const boundary = JSON.parse(await readFile(join(context.testRoot, 'process-boundary.json'), 'utf8'));
      if (mode === 'creationCancelled') {
        assert.equal(boundary.boundary, 'creationEntered');
      } else {
        assert.equal(boundary.boundary, 'createdSuspended');
        assert.equal(boundary.activeProcessCount, 1);
        assert.ok(Number.isInteger(boundary.processId) && boundary.processId > 0);
        await waitForProcessAbsent(boundary.processId);
      }
    }
    if (mode !== 'atomicMembership') {
      await assert.rejects(access(join(context.runRoot, 'root.ready.json')), { code: 'ENOENT' });
      await assert.rejects(access(context.workerResultPath), { code: 'ENOENT' });
      assert.equal(completion.evidence.some((entry) =>
        entry.phase === 'hostStarted' && entry.status === 'completed'), false);
    }
  });
}

for (const mode of ['nativeAfterTerminal', 'handlesAfterTerminal', 'failureAfterTerminal']) {
  test(`late creation ownership after terminal: ${mode}`, WINDOWS_ONLY, async (testContext) => {
    const context = await contextFor(testContext, mode);
    const sentinel = await startForeignSentinel(context);
    await writeRequest(context, createRequest(context, 'exitZero', {
      timeoutMilliseconds: 2_000, cleanupReserveMilliseconds: 1_000,
    }));
    const { result, completion } = await readCompletedExecution(
      context, startProgramFailureFixture(context, mode));
    assert.equal(completion.exitCode, 1);
    assert.equal(result.processResultCode, 'deadlineExceeded');
    assert.equal(result.workerResultCode, 'notChecked');
    assert.equal(result.cleanupResultCode, 'cleanupUnverified');
    assert.equal(result.processTreeAbsent, false);
    assert.deepEqual(JSON.parse(await readFile(join(context.testRoot, 'late-creation.json'), 'utf8')), {
      terminalBeforeRelease: true,
      countBeforeNative: mode === 'nativeAfterTerminal' ? 0 : null,
      lateHandlesClosed: true,
      exactLateProcessExited: true,
      originalAbsenceUnverified: true,
    });
    assert.equal(isProcessAlive(sentinel.marker.processId), true);
    await assert.rejects(access(join(context.runRoot, 'root.ready.json')), { code: 'ENOENT' });
    await assert.rejects(access(context.workerResultPath), { code: 'ENOENT' });
    assert.equal(completion.evidence.some((entry) =>
      entry.phase === 'hostStarted' && entry.status === 'completed'), false);
  });
}

test('command writes the failed result and exits with native creation still pending', WINDOWS_ONLY, async (t) => {
  const context = await contextFor(t, 'native-pending-command-exit');
  const sentinel = await startForeignSentinel(context);
  await writeRequest(context, createRequest(context, 'exitZero', {
    timeoutMilliseconds: 2_000, cleanupReserveMilliseconds: 1_000,
  }));
  const execution = startProgramFailureFixture(context, 'nativePendingAtCommandExit');
  const exit = once(execution.child, 'exit');
  const marker = await waitForMarker(context, 'command');
  assert.equal(marker.executeReturned, true);
  assert.equal(marker.resultWritten, true);
  assert.equal(marker.creationStillPending, true);
  assert.equal(execution.child.exitCode, null);
  const resultBeforeExit = await readWindowsAcceptanceSupervisorResult(context.resultPath, {
    ...context, supervisorExitCode: 1,
  });
  assert.equal(resultBeforeExit.processResultCode, 'deadlineExceeded');
  assert.equal(resultBeforeExit.workerResultCode, 'notChecked');
  assert.equal(resultBeforeExit.cleanupResultCode, 'cleanupUnverified');
  assert.equal(resultBeforeExit.processTreeAbsent, false);
  assert.equal(execution.child.exitCode, null);
  await releaseFixture(context, 'command');
  assert.deepEqual(await exit, [1, null]);
  const { result, completion } = await readCompletedExecution(context, execution);
  assert.deepEqual(result, resultBeforeExit);
  assert.equal(completion.evidence.some((entry) => entry.phase === 'resultWritten' && entry.status === 'completed'), true);
  assert.equal(completion.evidence.some((entry) => entry.phase === 'hostStarted' && entry.status === 'completed'), false);
  assert.equal(isProcessAlive(sentinel.marker.processId), true);
  await assert.rejects(access(join(context.runRoot, 'root.ready.json')), { code: 'ENOENT' });
  await assert.rejects(access(context.workerResultPath), { code: 'ENOENT' });
});

for (const mode of ['exitZero', 'spawnGrandchildAndHold']) {
  test(`atomic Job assignment inside an inherited Job: ${mode}`, WINDOWS_ONLY, async (testContext) => {
    // The outer instance is only the test container, representing an existing runner Job.
    const outer = await contextFor(testContext, 'nested-container');
    const inner = await contextFor(testContext, 'nested-worker');
    const sentinel = await startForeignSentinel(outer);
    await writeRequest(inner, createRequest(inner, mode, mode === 'exitZero' ? undefined : {
      timeoutMilliseconds: 2_500, cleanupReserveMilliseconds: 1_000,
    }));
    const containerRequest = createRequest(outer, 'exitZero');
    containerRequest.command = process.env.EKY_DOTNET_EXE || 'dotnet';
    containerRequest.arguments = [SUPERVISOR_DLL, '--request', inner.requestPath];
    await writeRequest(outer, containerRequest);
    const { result } = await readCompletedExecution(outer, startSupervisor(outer));
    const innerResult = await readWindowsAcceptanceSupervisorResult(inner.resultPath, {
      artifactDescriptorSha256: inner.artifactDescriptorSha256,
      runNonce: inner.runNonce,
      scenario: inner.scenario,
      supervisorExitCode: mode === 'exitZero' ? 0 : 1,
    });
    assert.equal(innerResult.processResultCode, mode === 'exitZero' ? 'processCompleted' : 'deadlineExceeded');
    assert.equal(innerResult.cleanupResultCode, mode === 'exitZero' ? 'notRequired' : 'processTreeAbsent');
    assert.equal(innerResult.processTreeAbsent, true);
    assert.equal(result.processResultCode, mode === 'exitZero' ? 'processCompleted' : 'processExitFailed');
    assert.equal(result.processTreeAbsent, true);
    // There is deliberately no outer worker result: an inner success must not be substituted for it.
    assert.equal(result.workerResultCode, mode === 'exitZero' ? 'workerResultMissing' : 'notChecked');
    assert.equal(isProcessAlive(sentinel.marker.processId), true);
  });
}

for (const observationMode of ['exitObservationLate', 'exitObservationEarlyReceipt']) {
  for (const mode of ['exitZero', 'exitNonZero']) {
    const earlyReceipt = observationMode === 'exitObservationEarlyReceipt';
    const boundary = earlyReceipt ? 'early root exit receipt before empty Job' : 'empty Job before exit observation';
    test(`${boundary} preserves ${mode}`, WINDOWS_ONLY, async (testContext) => {
      const context = await contextFor(testContext, observationMode + '-' + mode);
      await writeRequest(context, createRequest(context, mode));
      const { result, completion } = await readCompletedExecution(
        context, startProgramFailureFixture(context, observationMode));
      assert.deepEqual(JSON.parse(await readFile(join(context.testRoot, 'process-boundary.json'), 'utf8')),
        { boundary: 'jobEmptyBeforeExitObserved', exitObservedLater: true, earlyReceiptDeferred: earlyReceipt });
      assert.equal(result.processResultCode, mode === 'exitZero' ? 'processCompleted' : 'processExitFailed');
      assert.equal(result.childExitCode, mode === 'exitZero' ? 0 : 23);
      assert.equal(result.processTreeAbsent, true);
      assert.equal(result.cleanupResultCode, 'notRequired');
      assert.equal(completion.exitCode, mode === 'exitZero' ? 0 : 1);
      assert.ok(completion.evidence.some(entry => entry.phase === 'terminalWait' &&
        entry.resultCode === 'rootExitReceiptPending'));
    });
  }
}

test(
  'assigns the direct child before it runs and returns normal exit zero',
  WINDOWS_ONLY,
  async (testContext) => {
    const context = await contextFor(testContext, 'direct-child');
    const execution = await runSupervisor(context, 'exitZero');
    assert.equal(execution.exitCode, 0);
    assert.equal(execution.result.status, 'completed');
    assert.equal(execution.result.processTreeAbsent, true);
    assert.ok(
      execution.evidence.find(
        (entry) =>
          entry.phase === 'jobHandlePolicy' &&
          entry.resultCode === 'nonInheritableKillOnClose',
      ),
    );
    const assignedIndex = execution.evidence.findIndex(
      (entry) => entry.phase === 'hostAssigned',
    );
    const resumedIndex = execution.evidence.findIndex(
      (entry) =>
        entry.phase === 'hostStarted' && entry.status === 'completed',
    );
    assert.ok(assignedIndex >= 0);
    assert.ok(resumedIndex > assignedIndex);
  },
);

test(
  'Windows command-line quoting preserves empty, spaced, Unicode, quoted, and backslash arguments',
  WINDOWS_ONLY,
  async (testContext) => {
    const context = await contextFor(testContext, 'command-line-quoting');
    const expectedArguments = [
      '',
      ' ',
      'contains space',
      'unicode-\u00e4\u00f6',
      'inside"quote',
      String.raw`backslash-before-\"quote`,
      String.raw`two-backslashes-before-\\"quote`,
      String.raw`spaced trailing-backslashes\\`,
    ];
    const request = createRequest(context, 'recordArguments');
    request.arguments.push(...expectedArguments);
    await writeRequest(context, request);

    const execution = startSupervisor(context);
    const terminal = await readCompletedExecution(context, execution);
    assert.equal(terminal.result.status, 'completed');
    const recorded = JSON.parse(
      await readFile(join(context.runRoot, 'command-line-probe.json'), 'utf8'),
    );
    assert.deepEqual(recorded, {
      schemaVersion: 1,
      arguments: expectedArguments,
    });
  },
);

test(
  'a grandchild inherits the job and the complete tree exits normally',
  WINDOWS_ONLY,
  async (testContext) => {
    const context = await contextFor(testContext, 'grandchild-inheritance');
    await writeRequest(
      context,
      createRequest(context, 'spawnGrandchildAndHold'),
    );
    const execution = startSupervisor(context);
    const root = await waitForMarker(context, 'root');
    const grandchild = await waitForMarker(context, 'grandchild');
    await execution.waitForEvidence(
      (entry) =>
        entry.phase === 'processTreeObserved' &&
        entry.resultCode === 'descendantObserved',
    );
    await releaseFixture(context, 'root');
    const terminal = await readCompletedExecution(context, execution);
    assert.equal(terminal.result.status, 'completed');
    await waitForProcessAbsent(root.processId);
    await waitForProcessAbsent(grandchild.processId);
  },
);

test(
  'a non-zero direct child exit remains a process failure',
  WINDOWS_ONLY,
  async (testContext) => {
    const context = await contextFor(testContext, 'non-zero-exit');
    const execution = await runSupervisor(context, 'exitNonZero');
    assert.equal(execution.exitCode, 1);
    assert.equal(execution.result.status, 'failed');
    assert.equal(execution.result.processResultCode, 'processExitFailed');
    assert.equal(execution.result.childExitCode, 23);
    assert.equal(execution.result.processTreeAbsent, true);
  },
);

test(
  'worker exit zero with a live grandchild cannot become success',
  WINDOWS_ONLY,
  async (testContext) => {
    const context = await contextFor(testContext, 'zero-with-live-grandchild');
    await writeRequest(
      context,
      createRequest(context, 'spawnGrandchildThenExitOnRelease', {
        cleanupReserveMilliseconds: 800,
        timeoutMilliseconds: 2_500,
      }),
    );
    const execution = startSupervisor(context);
    const root = await waitForMarker(context, 'root');
    const grandchild = await waitForMarker(context, 'grandchild');
    await execution.waitForEvidence(
      (entry) => entry.phase === 'processTreeObserved',
    );
    await releaseFixture(context, 'root');
    await waitForProcessAbsent(root.processId);
    assert.equal(isProcessAlive(grandchild.processId), true);
    const terminal = await readCompletedExecution(context, execution);
    assert.equal(terminal.completion.exitCode, 1);
    assert.equal(terminal.result.processResultCode, 'deadlineExceeded');
    assert.equal(terminal.result.childExitCode, 0);
    assert.ok(terminal.completion.evidence.some(entry => entry.phase === 'terminalWait' &&
      entry.resultCode === 'descendantsPending'));
    assert.equal(terminal.result.cleanupResultCode, 'processTreeAbsent');
    await waitForProcessAbsent(grandchild.processId);
  },
);

async function completeControlledFixture(context, mode) {
  await startForeignSentinel(context);
  await writeRequest(context, createRequest(context,
    mode === 'deadlineSetupNeverReady' ? 'hold' : 'spawnGrandchildOnReleaseAndHold',
    { cleanupReserveMilliseconds: 800, timeoutMilliseconds: 2_500 }));
  return startProgramFailureFixture(context, mode).completion;
}

async function runControlledFixture(context, mode) {
  const completion = await completeControlledFixture(context, mode);
  const { result } = await readCompletedExecution(context, { completion: Promise.resolve(completion) });
  return { exitCode: completion.exitCode, result };
}

for (const [contract, mode] of [
  ['rootBeforeGrandchild', 'deadlineRootBeforeGrandchild'],
  ['bothLive', 'deadlineBothLive'],
]) test(
  `controlled deadline proves ${contract} with real owned processes repeatedly`,
  WINDOWS_ONLY,
  async (t) => {
    for (let repetition = 1; repetition <= repetitions; repetition += 1) {
      const context = await createRunContext(contract + '-' + repetition);
      try {
        const diagnostic = await verifyControlledDeadlineRun(context, contract,
          () => runControlledFixture(context, mode));
        t.diagnostic(JSON.stringify(diagnostic));
      } catch (error) {
        t.diagnostic(JSON.stringify(error.diagnostic));
        throw error;
      }
    }
  },
);

test('deadline clocks preserve actual task waits and cannot renew cleanup', WINDOWS_ONLY, async (t) => {
  const context = await createRunContext('deadline-clocks');
  const diagnostic = await verifyDeadlineFixture(context, async () => {
    await writeRequest(context, createRequest(context, 'exitZero'));
    const completed = await startProgramFailureFixture(context, 'deadlineClockContracts').completion;
    assert.equal(completed.exitCode, 0);
    assert.deepEqual(JSON.parse(await readFile(join(context.testRoot, 'deadline-clock-proof.json'), 'utf8')), {
      schemaVersion: 1, defaultClockPreserved: true, actualTaskCompletion: true,
      frozenWaitPreserved: true, cleanupCannotReset: true, firstFailurePreserved: true,
    });
  });
  t.diagnostic(JSON.stringify(diagnostic));
});

test('real deadline includes pending process creation at the original work boundary', WINDOWS_ONLY, async (t) => {
  const context = await createRunContext('real-creation-deadline');
  const diagnostic = await verifyDeadlineFixture(context, async () => {
    const sentinel = await startForeignSentinel(context);
    await writeRequest(context, createRequest(context, 'exitZero', {
      timeoutMilliseconds: 2_500, cleanupReserveMilliseconds: 800,
    }));
    const { completion, result } = await readCompletedExecution(
      context, startProgramFailureFixture(context, 'creationCancelled'));
    assert.equal(completion.exitCode, 1);
    assert.equal(result.processResultCode, 'deadlineExceeded');
    assert.equal(result.cleanupResultCode, 'notRequired');
    assert.equal(result.processTreeAbsent, true);
    assert.ok(result.durationMs >= 1_700);
    const boundary = JSON.parse(await readFile(join(context.testRoot, 'process-boundary.json'), 'utf8'));
    assert.equal(boundary.boundary, 'creationEntered');
    await assert.rejects(access(join(context.runRoot, 'root.ready.json')), { code: 'ENOENT' });
    assert.equal(isProcessAlive(sentinel.marker.processId), true);
  });
  t.diagnostic(JSON.stringify(diagnostic));
});

for (const mode of ['deadlineSetupNeverReady', 'deadlineCreationFailure', 'deadlineCreationPending',
  'deadlineProofWriteFailure', 'deadlineResultWriteFailure']) {
  test(`controlled deadline rejects incomplete evidence: ${mode}`, WINDOWS_ONLY, async (t) => {
    const context = await createRunContext(mode);
    const diagnostic = await verifyDeadlineFixture(context, async () => {
      const completion = await completeControlledFixture(context, mode);
      assert.equal(completion.exitCode, 1);
      const readTerminal = () => readCompletedExecution(context, { completion: Promise.resolve(completion) });
      if (mode === 'deadlineResultWriteFailure') {
        await assert.rejects(readTerminal(), {
          message: 'WINDOWS_ACCEPTANCE_SUPERVISOR_TERMINAL_RESULT_MISSING',
        });
        await readDeadlineWriterFailureProof(context);
        await readControlledDeadlineProof(context, 'bothLive');
        for (const role of ['root', 'grandchild']) {
          await waitForProcessAbsent((await readCompletedMarker(context, role)).processId);
        }
        assert.equal(isProcessAlive((await readCompletedMarker(context, 'sentinel')).processId), true);
        return;
      }
      const { result } = await readTerminal();
      const bytes = await readFile(context.resultPath, 'utf8');
      assert.deepEqual(JSON.parse(bytes), result);
      assert.equal(result.processResultCode,
        mode === 'deadlineCreationFailure' ? 'processStartFailed' : 'deadlineExceeded');
      assert.equal(result.cleanupResultCode, mode === 'deadlineCreationFailure' ? 'notRequired'
        : mode === 'deadlineCreationPending' ? 'cleanupUnverified' : 'processTreeAbsent');
      await assert.rejects(readControlledDeadlineProof(context, 'bothLive'), {
        message: 'WINDOWS_ACCEPTANCE_DEADLINE_PROCESS_PROOF_INVALID',
      });
      if (mode === 'deadlineProofWriteFailure') {
        await readDeadlineProofPublicationFailure(context);
      } else {
        const proof = JSON.parse(await readFile(join(context.testRoot, 'deadline-process-proof.json'), 'utf8'));
        assert.equal(proof.deadlineTriggered, false);
        assert.equal(proof.setupFailure, mode === 'deadlineCreationFailure'
          ? 'cleanupBeforeDeadline' : 'setupDeadlineExceeded');
      }
    }, { preserveEvidence: true });
    // Expected negative fixtures retain their raw evidence, without a second cleanup owner.
    t.diagnostic(JSON.stringify(diagnostic));
  });
}

test(
  'killing the supervisor closes the job and terminates its owned tree',
  WINDOWS_ONLY,
  async (testContext) => {
    const context = await contextFor(testContext, 'kill-on-close');
    await writeRequest(
      context,
      createRequest(context, 'spawnGrandchildAndHold'),
    );
    const execution = startSupervisor(context);
    const root = await waitForMarker(context, 'root');
    const grandchild = await waitForMarker(context, 'grandchild');
    await execution.waitForEvidence(
      (entry) => entry.phase === 'processTreeObserved',
    );
    assert.equal(execution.child.kill(), true);
    await execution.completion;
    await waitForProcessAbsent(root.processId);
    await waitForProcessAbsent(grandchild.processId);
    await assert.rejects(
      readWindowsAcceptanceSupervisorResult(context.resultPath, {
        artifactDescriptorSha256: context.artifactDescriptorSha256,
        runNonce: context.runNonce,
        scenario: context.scenario,
        supervisorExitCode: 1,
      }),
      /WINDOWS_ACCEPTANCE_SUPERVISOR_TERMINAL_RESULT_MISSING/,
    );
  },
);

test(
  'a foreign sentinel survives owned-tree deadline cleanup',
  WINDOWS_ONLY,
  async (testContext) => {
    const sentinelContext = await contextFor(testContext, 'foreign-sentinel');
    const sentinel = await startForeignSentinel(sentinelContext);

    const ownedContext = await contextFor(testContext, 'owned-timeout');
    const execution = await runSupervisor(ownedContext, 'hold', {
      cleanupReserveMilliseconds: 800,
      timeoutMilliseconds: 2_500,
    });
    assert.equal(execution.result.processResultCode, 'deadlineExceeded');
    assert.equal(isProcessAlive(sentinel.marker.processId), true);

    await releaseFixture(sentinelContext, 'sentinel');
    await once(sentinel.child, 'close');
    await waitForProcessAbsent(sentinel.marker.processId);
  },
);

test(
  'valid-request unexpected and result-writer failures remain distinct and fail closed',
  WINDOWS_ONLY,
  async (testContext) => {
    const unexpectedContext = await contextFor(
      testContext,
      'unexpected-failure',
    );
    await writeRequest(
      unexpectedContext,
      createRequest(unexpectedContext, 'exitZero'),
    );
    const unexpectedExecution = startProgramFailureFixture(
      unexpectedContext,
      'unexpectedFailure',
    );
    const unexpected = await readCompletedExecution(
      unexpectedContext,
      unexpectedExecution,
    );
    assert.equal(unexpected.completion.exitCode, 1);
    assert.equal(unexpected.result.status, 'failed');
    assert.equal(unexpected.result.processResultCode, 'unexpectedFailure');
    assert.equal(unexpected.result.cleanupResultCode, 'cleanupUnverified');
    assert.equal(unexpected.result.processTreeAbsent, false);

    const writerContext = await contextFor(
      testContext,
      'result-writer-failure',
    );
    await writeRequest(
      writerContext,
      createRequest(writerContext, 'exitZero'),
    );
    const writerExecution = startProgramFailureFixture(
      writerContext,
      'resultWriteFailure',
    );
    const writerCompletion = await writerExecution.completion;
    assert.equal(writerCompletion.exitCode, 1);
    assert.deepEqual(writerCompletion.evidence.filter((entry) => entry.phase === 'resultPublication')
      .map(({ status, errorCode, resultCode }) => ({ status, errorCode, resultCode })), [
      { status: 'failed', errorCode: 'publicationWriteException', resultCode: 'publish' },
    ]);
    assert.deepEqual(writerCompletion.evidence.filter((entry) => entry.phase === 'resultPublicationLastCompleted')
      .map(({ status, errorCode, resultCode }) => ({ status, errorCode, resultCode })), [
      { status: 'failed', errorCode: 'publicationWriteException', resultCode: 'close' },
    ]);
    assert.ok(
      writerCompletion.evidence.find(
        (entry) =>
          entry.phase === 'resultWritten' &&
          entry.status === 'failed' &&
          entry.errorCode === 'resultWriteFailed',
      ),
    );
    await assert.rejects(
      readWindowsAcceptanceSupervisorResult(writerContext.resultPath, {
        artifactDescriptorSha256: writerContext.artifactDescriptorSha256,
        runNonce: writerContext.runNonce,
        scenario: writerContext.scenario,
        supervisorExitCode: writerCompletion.exitCode,
      }),
      /WINDOWS_ACCEPTANCE_SUPERVISOR_TERMINAL_RESULT_MISSING/,
    );
  },
);

test(
  'two parallel supervisors keep their process ownership isolated',
  WINDOWS_ONLY,
  async (testContext) => {
    const timeoutContext = await contextFor(testContext, 'parallel-timeout');
    const successContext = await contextFor(testContext, 'parallel-success');
    await writeRequest(
      timeoutContext,
      createRequest(timeoutContext, 'spawnGrandchildAndHold', {
        cleanupReserveMilliseconds: 800,
        timeoutMilliseconds: 3_000,
      }),
    );
    await writeRequest(
      successContext,
      createRequest(successContext, 'spawnGrandchildAndHold'),
    );

    const timeoutExecution = startSupervisor(timeoutContext);
    const successExecution = startSupervisor(successContext);
    const timeoutGrandchild = await waitForMarker(
      timeoutContext,
      'grandchild',
    );
    const successRoot = await waitForMarker(successContext, 'root');
    const successGrandchild = await waitForMarker(
      successContext,
      'grandchild',
    );
    await Promise.all([
      timeoutExecution.waitForEvidence(
        (entry) => entry.phase === 'processTreeObserved',
      ),
      successExecution.waitForEvidence(
        (entry) => entry.phase === 'processTreeObserved',
      ),
    ]);

    const timeoutTerminal = await readCompletedExecution(
      timeoutContext,
      timeoutExecution,
    );
    assert.equal(
      timeoutTerminal.result.processResultCode,
      'deadlineExceeded',
    );
    await waitForProcessAbsent(timeoutGrandchild.processId);
    assert.equal(isProcessAlive(successRoot.processId), true);
    assert.equal(isProcessAlive(successGrandchild.processId), true);

    await releaseFixture(successContext, 'root');
    const successTerminal = await readCompletedExecution(
      successContext,
      successExecution,
    );
    assert.equal(successTerminal.result.status, 'completed');
    await waitForProcessAbsent(successRoot.processId);
    await waitForProcessAbsent(successGrandchild.processId);
  },
);

test(
  'malformed requests are rejected without launching a worker',
  WINDOWS_ONLY,
  async (testContext) => {
    const context = await contextFor(testContext, 'malformed-request');
    await writeRequest(context, {
      ...createRequest(context, 'exitZero'),
      unknownKey: true,
    });
    const execution = startSupervisor(context);
    const completion = await execution.completion;
    assert.equal(completion.exitCode, 1);
    assert.equal(await access(context.resultPath).then(() => true, () => false), false);
    // Invalid input supplies no trusted flush budget; any delivered evidence stays strict.
    for (const entry of completion.evidence) {
      if (['requestPreparation', 'requestPreparationLastCompleted'].includes(entry.phase)) {
        assert.deepEqual(Object.keys(entry).sort(), ['durationMs', 'elapsedMs', 'errorCode', 'operation',
          'phase', 'resultCode', 'schemaVersion', 'status']);
        assert.equal(entry.status, 'failed');
        assert.equal(entry.errorCode, 'preparationException');
        assert.equal(entry.resultCode, entry.phase === 'requestPreparation' ? 'requestSchemaValidation' : 'requestFileRead');
        continue;
      }
      assert.deepEqual(entry, {
        schemaVersion: 1, operation: 'windowsAcceptanceSupervisor',
        phase: 'requestValidated', status: 'failed', durationMs: 0, elapsedMs: 0,
        errorCode: 'requestSchemaInvalid',
      });
    }
    assert.equal(
      await access(context.runRoot).then(() => true, () => false),
      false,
    );
  },
);

test(
  'worker exit zero without a terminal result is rejected',
  WINDOWS_ONLY,
  async (testContext) => {
    const context = await contextFor(testContext, 'missing-worker-result');
    const execution = await runSupervisor(context, 'exitZeroWithoutResult');
    assert.equal(execution.exitCode, 1);
    assert.equal(execution.result.processResultCode, 'processCompleted');
    assert.equal(execution.result.workerResultCode, 'workerResultMissing');
    assert.equal(execution.result.processTreeAbsent, true);
  },
);

test(
  'a worker result bound to a stale nonce is rejected',
  WINDOWS_ONLY,
  async (testContext) => {
    const context = await contextFor(testContext, 'stale-worker-result');
    const execution = await runSupervisor(context, 'exitZeroStaleResult');
    assert.equal(execution.exitCode, 1);
    assert.equal(execution.result.processResultCode, 'processCompleted');
    assert.equal(
      execution.result.workerResultCode,
      'workerResultBindingInvalid',
    );
    assert.equal(execution.result.processTreeAbsent, true);
  },
);

test(
  'malformed request exits even when its safe evidence output blocks',
  { ...WINDOWS_ONLY, timeout: 10_000 },
  async (testContext) => {
    const context = await contextFor(testContext, 'blocked-invalid-request-evidence');
    const foreign = await contextFor(testContext, 'invalid-request-foreign');
    const sentinel = await startForeignSentinel(foreign);
    await writeRequest(context, createRequest(context, 'exitZero'));
    const execution = startProgramFailureFixture(context, 'blockedInvalidRequestEvidence');
    const blocked = await waitForMarker(context, 'output');
    assert.equal(blocked.writerBlocked, true);
    assert.equal(blocked.errorCode, 'requestSchemaInvalid');
    const completion = await execution.completion;
    assert.equal(completion.exitCode, 1);
    assert.equal(completion.signal, null);
    assert.equal(isProcessAlive(blocked.processId), false);
    assert.equal(isProcessAlive(sentinel.marker.processId), true);
    for (const file of [context.resultPath, context.workerResultPath,
      join(context.runRoot, 'root.ready.json')]) {
      await assert.rejects(access(file), { code: 'ENOENT' });
    }
    assert.equal(context.supervisorProcesses.size, 0);
  },
);

for (const mode of ['exitZero', 'exitNonZero', 'spawnGrandchildAndHold']) {
  test(
    `blocked safe evidence cannot prevent the command terminal result: ${mode}`,
    { ...WINDOWS_ONLY, timeout: 10_000 },
    async (testContext) => {
      const context = await contextFor(testContext, 'blocked-evidence-' + mode);
      const sentinel = await startForeignSentinel(context);
      const deadlineExpected = mode === 'spawnGrandchildAndHold';
      await writeRequest(
        context,
        createRequest(context, mode, {
          timeoutMilliseconds: 2_500,
          cleanupReserveMilliseconds: 1_000,
        }),
      );
      const execution = startProgramFailureFixture(context, 'blockedEvidence');
      const { result, completion } = await readCompletedExecution(context, execution);
      assert.equal(completion.exitCode, mode === 'exitZero' ? 0 : 1);
      assert.equal(
        result.processResultCode,
        deadlineExpected ? 'deadlineExceeded'
          : mode === 'exitZero' ? 'processCompleted' : 'processExitFailed',
      );
      assert.equal(
        result.workerResultCode,
        mode === 'exitZero' ? 'workerResultValidated' : 'notChecked',
      );
      assert.equal(
        result.cleanupResultCode,
        deadlineExpected ? 'processTreeAbsent' : 'notRequired',
      );
      assert.equal(result.processTreeAbsent, true);
      if (mode === 'exitNonZero') assert.equal(result.childExitCode, 23);
      // These are postconditions of a completed command, not live readiness waits.
      const blocked = await readCompletedMarker(context, 'output');
      assert.equal(blocked.writerBlocked, true);
      assert.equal(blocked.errorCode, null);
      const grandchild = deadlineExpected
        ? await readCompletedMarker(context, 'grandchild') : null;
      assert.equal(isProcessAlive(blocked.processId), false);
      if (grandchild !== null) await waitForProcessAbsent(grandchild.processId);
      assert.equal(isProcessAlive(sentinel.marker.processId), true);
    },
  );
}

test(
  'disabled or failed safe observability cannot change the terminal result',
  WINDOWS_ONLY,
  async (testContext) => {
    const observedContext = await contextFor(testContext, 'observed-output');
    const ignoredContext = await contextFor(testContext, 'ignored-output');
    const observed = await runSupervisor(observedContext, 'exitZero');
    const ignored = await runSupervisor(
      ignoredContext,
      'exitZero',
      undefined,
      { captureOutput: false },
    );
    const failedContext = await contextFor(testContext, 'failed-output');
    await writeRequest(failedContext, createRequest(failedContext, 'hold'));
    const failedExecution = startSupervisor(failedContext);
    await waitForMarker(failedContext, 'root');
    await failedExecution.waitForEvidence(
      (entry) =>
        entry.phase === 'hostStarted' && entry.status === 'completed',
    );
    failedExecution.child.stdout.destroy();
    await once(failedExecution.child.stdout, 'close');
    await releaseFixture(failedContext, 'root');
    const failed = await readCompletedExecution(
      failedContext,
      failedExecution,
    );

    for (const key of [
      'childExitCode',
      'cleanupResultCode',
      'cleanupWin32ErrorCode',
      'processResultCode',
      'processTreeAbsent',
      'processWin32ErrorCode',
      'status',
      'workerResultCode',
    ]) {
      assert.equal(ignored.result[key], observed.result[key]);
      assert.equal(failed.result[key], observed.result[key]);
    }
    assert.ok(observed.evidence.length > 0);
    assert.equal(ignored.evidence.length, 0);
    assert.equal(failed.result.status, 'completed');
  },
);
