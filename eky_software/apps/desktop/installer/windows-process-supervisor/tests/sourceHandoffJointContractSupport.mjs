import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { lstat, mkdir, open, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRunnerFailureSink } from '../../../../../test-reporters/runnerFailureEvidence.mjs';
import { WORKSPACE_SUCCESS_DESCRIPTOR_FILENAME } from '../../windows-acceptance-harness/workspaceSuccessArtifactDescriptor.mjs';
import { WORKSPACE_CALLER_RESULT_PREFIX, WORKSPACE_CALLER_RESULT_FILENAME } from '../../windows-acceptance-harness/workspaceCallerResult.mjs';
import { msiWindowEvidenceContract, validateMsiWindowEvidence } from '../../windows-acceptance-harness/msiWindowEvidence.mjs';
import { parseStrictJsonObjectBytes } from '../../windows-acceptance-harness/strictJsonObject.mjs';
import { validateWindowsAcceptanceSupervisorResult } from '../windowsAcceptanceSupervisorResult.mjs';
import { createTestRunContext, startSourceHandoffJointFixture } from './supervisorContractTestSupport.mjs';

const COMMON_CHECKS = [
  "realOrderedPrefix",
  "distinctMailboxAndSourceDirectory",
  "allRequiredWorkSettled",
  "realAdmissionConsumedOnce",
  "allFourteenPinsClosed",
  "admissionReaderSettled",
  "admissionCleanupMatchesCase",
  "commandNotAccepted",
  "boundedCheckpointMatchesCase",
  "sourceRequiredWorkSettled",
  "sourceHandlesClosed",
  "allSourceResourcesClosed",
  "realReservationEnteredBeforeOwner",
  "reservationTaskAndPinSettled",
  "reservationCleanupSeparate",
  "optionalObserverStillNone",
  "lateFrameGapNotClaimed",
  "sourceReleaseMatchesCase",
  "exactSourceCreationCount",
  "birthAndSameJobBeforeResume",
  "actualBirthIdentityRetained",
  "samePhaseClockOrdered",
  "reservationEntryPrecedesActualSourceBirth",
  "originalNativeStatus",
  "nativeTreeAbsenceProved",
  "actualFinalOwnerHostWorkCompleted",
  "actualFinalOwnerMatchesNative"
];
const CASE_CHECKS = { exit0: ["naturalExitCodeDelivered","recordedExchangeBeforeReturn","actualRecordedEvidenceBound","realWorkerResultValidated","workerEnteredAfterExchange"], sourceHold: ["cleanupNeverClaimsNaturalExit","abortNeverCompletesExchange","abortReasonRetained","abortNeverEntersBusinessWorker","reservationAbortBoundaryPreserved","underlyingJobCleanupRetainedSeparately","originalDeadlinePreserved","reservationHeldAtNativeClose","callbackReleasedAfterNativeClose","callbackReturnedWithinNativeBudget"] };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const samePath = (left, right) => resolve(left).toLowerCase() === resolve(right).toLowerCase();
const sameFile = (left, right) => ['dev', 'ino', 'size', 'nlink', 'mtimeNs', 'ctimeNs']
  .every(key => left[key] === right[key]);

export async function readSourceHandoffJointFixture(root, file, maximum = 65_536) {
  const child = relative(root, file);
  assert(child && child !== '..' && !child.startsWith('../') && !child.startsWith('..\\') && !isAbsolute(child));
  const parents = [];
  for (let current = dirname(file); ; current = dirname(current)) {
    const info = await lstat(current, { bigint: true });
    assert(info.isDirectory() && !info.isSymbolicLink() && samePath(realpathSync.native(current), current));
    parents.push({ path: current, info });
    if (samePath(current, root)) break;
  }
  const handle = await open(file, 'r');
  let firstFailure, bytes;
  try {
    const before = await handle.stat({ bigint: true });
    const selected = await lstat(file, { bigint: true });
    assert(before.isFile() && !selected.isSymbolicLink() && before.nlink === 1n &&
      before.size >= 2n && before.size <= BigInt(maximum) && sameFile(before, selected));
    assert(samePath(realpathSync.native(file), file));
    bytes = Buffer.alloc(Number(before.size));
    let offset = 0;
    while (offset < bytes.length) {
      const read = await handle.read(bytes, offset, bytes.length - offset, offset);
      assert(read.bytesRead > 0);
      offset += read.bytesRead;
    }
    assert.equal((await handle.read(Buffer.alloc(1), 0, 1, bytes.length)).bytesRead, 0);
    assert(sameFile(before, await handle.stat({ bigint: true })));
    assert(sameFile(before, await lstat(file, { bigint: true })));
    for (const parent of parents) {
      const current = await lstat(parent.path, { bigint: true });
      assert(current.isDirectory() && !current.isSymbolicLink() && current.dev === parent.info.dev &&
        current.ino === parent.info.ino && samePath(realpathSync.native(parent.path), parent.path));
    }
  } catch (error) { firstFailure = error; }
  try { await handle.close(); }
  catch (error) {
    if (firstFailure) throw new AggregateError([firstFailure, error], 'JOINT_FIXTURE_READ_AND_CLOSE_FAILED', { cause: firstFailure });
    throw error;
  }
  if (firstFailure) throw firstFailure;
  return bytes;
}

function json(bytes, maximumBytes = 65_536) {
  return parseStrictJsonObjectBytes(bytes, { maximumBytes, errorCode: 'JOINT_FIXTURE_JSON_INVALID' });
}

function technicalJointFailure(value, hresultKey) {
  const token = text => typeof text === 'string' && /^[A-Za-z][A-Za-z0-9_]{0,127}$/.test(text);
  const type = token(value?.exceptionType) ? value.exceptionType : 'UnknownNativeException';
  const code = token(value?.errorCode) ? value.errorCode : 'unknown';
  const hresult = value?.[hresultKey];
  const failure = new Error(`errorCode=${code}; HResult=${Number.isInteger(hresult) &&
    hresult >= -2_147_483_648 && hresult <= 2_147_483_647 ? hresult : 'unknown'}`);
  failure.name = type;
  // The native projection has no original stack. Do not substitute a reader stack for it.
  failure.stack = undefined;
  return failure;
}

function failedJointReport(report) {
  const first = typeof report.firstFailure === 'string' && /^[A-Za-z][A-Za-z0-9_]{0,127}$/.test(report.firstFailure)
    ? report.firstFailure : 'JOINT_FIXTURE_FIRST_FAILURE_UNKNOWN';
  const original = new Error(first, report.harnessFailure == null ? undefined : {
    cause: technicalJointFailure(report.harnessFailure, 'HResult'),
  });
  if (report.admissionCleanupFailure == null) return original;
  return new AggregateError([original, technicalJointFailure(report.admissionCleanupFailure, 'hresult')],
    'JOINT_FIXTURE_REPORT_AND_CLEANUP_FAILED', { cause: original });
}

export function verifySourceHandoffJointReport(report, selected) {
  assert(Object.hasOwn(CASE_CHECKS, selected));
  assert(report !== null && typeof report === 'object' && !Array.isArray(report));
  assert.equal(report.schemaVersion, 1);
  assert.equal(report.selected, selected);
  if (report.status === 'failed') {
    throw failedJointReport(report);
  }
  assert.equal(report.status, 'completed');
  assert.equal(report.firstFailure, null);
  assert.equal(report.harnessFailure, null);
  assert(report.checks !== null && typeof report.checks === 'object' && !Array.isArray(report.checks));
  assert.deepEqual(Object.keys(report.checks).sort(), [...COMMON_CHECKS, ...CASE_CHECKS[selected]].sort());
  for (const [name, passed] of Object.entries(report.checks)) assert.equal(passed, true, name);
  assert.equal(report.commandExit, 1);
  assert.equal(report.postScenarioPhases, 'notRun');
  assert.equal(report.scope, 'twoCaseRealReservationSyntheticTransport');
  assert.equal(report.lateFrameWorkerRetirementGap, 'open');
  for (const key of ['fullCommandAccepted', 'sourceEkyExecuted', 'originalMsiCauseEstablished']) assert.equal(report[key], false);
  assert.equal(report.admissionCleanupFailure, null);
  assert(Number.isSafeInteger(report.durationMs) && report.durationMs >= 0 && report.durationMs <= 14_400_000);
  const native = report.nativeResult, final = report.finalOwnerOutcome;
  validateWindowsAcceptanceSupervisorResult(native, { runNonce: native.runNonce, scenario: 'packagedWorkspaceSuccess',
    artifactDescriptorSha256: 'a'.repeat(64), supervisorExitCode: selected === 'exit0' ? 0 : 1 });
  assert.equal(native.processTreeAbsent, true);
  assert.equal(final.HostOperationsCompleted, true);
  for (const [owner, result] of [['Status', 'status'], ['ProcessResultCode', 'processResultCode'],
    ['WorkerResultCode', 'workerResultCode'], ['CleanupResultCode', 'cleanupResultCode'], ['ProcessTreeAbsent', 'processTreeAbsent'],
    ['ChildExitCode', 'childExitCode'], ['ProcessWin32ErrorCode', 'processWin32ErrorCode'],
    ['CleanupWin32ErrorCode', 'cleanupWin32ErrorCode']])
    assert.equal(final[owner], native[result]);
  const source = report.sourceProof, reservation = report.reservationProof;
  assert.equal(source.schemaVersion, 1);
  assert.equal(source.case, selected);
  assert.equal(source.requestRejected, false);
  assert.equal(source.replayRejected, false);
  assert.equal(source.sourceErrorCode, null);
  assert.equal(source.requestFailure, null);
  for (const key of ['requiredWorkSettled', 'sourceHandlesClosed', 'allSettledResourcesClosed',
    'birthCapturedBeforeResume', 'sourceInSameJobBeforeResume']) assert.equal(source[key], true);
  assert.equal(source.creationAttempts, 1);
  assert.equal(source.releaseFailed, false);
  for (const key of ['ProcessId', 'StartTimeLow', 'StartTimeHigh']) {
    assert(Number.isSafeInteger(source.sourceBirth[key]) && source.sourceBirth[key] >= (key === 'ProcessId' ? 1 : 0) &&
      source.sourceBirth[key] <= 0xffffffff);
  }
  assert(source.sourceBirth.StartTimeLow > 0 || source.sourceBirth.StartTimeHigh > 0);
  for (const value of [source.birthObservedAtMs, source.resumeStartedAtMs, source.resumeReturnedAtMs,
    reservation.enteredAtMs, reservation.ownerStartedAtMs]) {
    assert(Number.isSafeInteger(value) && value >= 0 && value <= report.durationMs);
  }
  assert(source.birthObservedAtMs <= source.resumeStartedAtMs && source.resumeStartedAtMs <= source.resumeReturnedAtMs);
  for (const key of ['entered', 'entryReady', 'ownerStarted', 'taskSettled', 'pinClosed', 'resourcesReleased',
    'allControlHandlesClosed', 'reservationResourcesSettled']) assert.equal(reservation[key], true);
  assert.deepEqual(reservation.cleanupFailures, []);
  assert.equal(reservation.optionalMsiObserver, 'none');
  assert.equal(reservation.scope, 'realEvidenceReservationSyntheticSourceTransport');
  assert.equal(reservation.lateFrameAuthorityProved, false);
  assert.equal(reservation.fullCommandAccepted, false);
  assert(reservation.enteredAtMs <= reservation.ownerStartedAtMs && reservation.ownerStartedAtMs <= source.birthObservedAtMs);
  const success = selected === 'exit0';
  assert.equal(report.boundedStopAfterScenario, success);
  for (const key of ['exchangeSucceeded', 'exchangeCompleted', 'returned', 'workerContinuationObserved'])
    assert.equal(reservation[key], success);
  assert.equal(source.resultDeliveredBeforeRetirement, success);
  assert.equal(source.sourceExited, success);
  assert.equal(source.sourceExitCode, success ? 0 : null);
  assert.equal(source.originalOwnerHostOperationsCompleted, true);
  const { HostOperationsCompleted: _hostCompleted, ...finalNativeOutcome } = final;
  assert.deepEqual(source.originalOwnerOutcome, finalNativeOutcome);
  if (success) {
    assert.equal(report.admissionFirstFailure, null);
    assert.equal(native.status, 'completed');
    assert.equal(native.workerResultCode, 'workerResultValidated');
    assert.equal(reservation.publication, 'recorded');
    assert.equal(reservation.firstFailure, null);
    assert.match(reservation.actualEvidenceSha256, /^[a-f0-9]{64}$/);
    assert(Number.isSafeInteger(reservation.actualEvidenceBytes) && reservation.actualEvidenceBytes >= 2 &&
      reservation.actualEvidenceBytes <= msiWindowEvidenceContract.maximumBytes);
  } else {
    assert.equal(native.status, 'failed');
    assert.equal(native.processResultCode, 'deadlineExceeded');
    assert.notEqual(reservation.publication, 'recorded');
    assert(['OperationCanceledException', 'TimeoutException'].includes(reservation.firstFailure.type));
    assert.equal(report.admissionFirstFailure.hresult, reservation.firstFailure.HResult);
    assert.equal(reservation.actualEvidenceBinding, null);
    assert.equal(reservation.actualEvidenceBytes, null);
    assert.equal(reservation.actualEvidenceSha256, null);
    for (const key of ['nativeCloseObserved', 'reservationHeldAtNativeClose', 'releaseAfterNativeClose'])
      assert.equal(reservation[key], true);
    assert.equal(reservation.unwindRelease, false);
    for (const value of [reservation.nativeCloseAtMs, reservation.callbackReleasedAtMs, reservation.callbackReturnedAtMs])
      assert(Number.isSafeInteger(value) && value >= 0 && value <= report.durationMs);
    assert(reservation.nativeCloseAtMs >= 3000 && reservation.nativeCloseAtMs < 4000);
    assert(reservation.callbackReleasedAtMs >= reservation.nativeCloseAtMs);
    assert(reservation.callbackReturnedAtMs >= reservation.callbackReleasedAtMs && reservation.callbackReturnedAtMs < 4000);
  }
}

async function verifyJointArtifacts(root, report, selected, readFixture, statFixture, environment) {
  verifySourceHandoffJointReport(report, selected);
  assert(typeof report.commandRoot === 'string' && isAbsolute(report.commandRoot));
  const command = relative(root, report.commandRoot);
  assert(/^eky-acceptance-command-[a-f0-9]{32}$/.test(command));
  const resultPath = join(report.commandRoot, 'scenario', 'result.json');
  const native = json(await readFixture(root, resultPath));
  validateWindowsAcceptanceSupervisorResult(native, { runNonce: report.nativeResult.runNonce,
    scenario: 'packagedWorkspaceSuccess', artifactDescriptorSha256: 'a'.repeat(64),
    supervisorExitCode: selected === 'exit0' ? 0 : 1 });
  assert.deepEqual(native, report.nativeResult);
  const evidencePath = join(report.commandRoot, 'scenario', msiWindowEvidenceContract.filenamePrefix + '001.private.json');
  if (selected === 'exit0') {
    const bytes = await readFixture(root, evidencePath, msiWindowEvidenceContract.maximumBytes);
    const evidence = json(bytes, msiWindowEvidenceContract.maximumBytes);
    assert.equal(bytes.length, report.reservationProof.actualEvidenceBytes);
    assert.equal(hash(bytes), report.reservationProof.actualEvidenceSha256);
    assert.deepEqual(evidence, report.reservationProof.actualEvidenceBinding);
    if (environment.GITHUB_ACTIONS === 'true') {
      validateMsiWindowEvidence(evidence, { runId: environment.GITHUB_RUN_ID, attempt: environment.GITHUB_RUN_ATTEMPT,
        job: environment.GITHUB_JOB, sourceRevision: environment.GITHUB_SHA }, evidencePath);
    } else {
      assert.deepEqual(evidence.binding, { kind: 'local' });
      // The collector codec accepts GitHub bindings only; validate every other field unchanged.
      const binding = { runId: '1', attempt: '1', job: 'joint-local-control', sourceRevision: 'b'.repeat(40) };
      validateMsiWindowEvidence({ ...evidence, binding: { kind: 'github', ...binding } }, binding, evidencePath);
    }
    assert.equal(evidence.schemaVersion, msiWindowEvidenceContract.schemaVersion);
    assert.equal(evidence.runNonce, native.runNonce);
    assert.equal(evidence.scenario, native.scenario);
    assert.equal(evidence.artifactDescriptorSha256, native.artifactDescriptorSha256);
    assert.deepEqual(evidence.clients, []);
    assert.equal(evidence.resources, null);
  } else await assert.rejects(statFixture(evidencePath), { code: 'ENOENT' });
}

export async function completeSourceHandoffJointContract(execution, root, selected, {
  readFixture = readSourceHandoffJointFixture, statFixture = lstat, environment = process.env,
  observeAdditionalFailure,
} = {}) {
  assert(Object.hasOwn(CASE_CHECKS, selected));
  let completed, completionFailure, reportFailure, report;
  let completionRejected = false, reportRejected = false;
  try { completed = await execution.completion; }
  catch (error) { completionFailure = error; completionRejected = true; }
  try {
    report = json(await readFixture(root, join(root, 'joint-reservation-result.private.json')));
    await verifyJointArtifacts(root, report, selected, readFixture, statFixture, environment);
  } catch (error) { reportFailure = error; reportRejected = true; }
  const observe = (error, phase) => {
    try { observeAdditionalFailure?.(error, phase); }
    catch { /* Evidence delivery cannot replace the original test failure. */ }
  };
  const reportSelected = report?.schemaVersion === 1 && report.selected === selected;
  if (reportRejected && reportSelected && report.admissionCleanupFailure != null) {
    observe(technicalJointFailure(report.admissionCleanupFailure, 'hresult'), 'jointFixtureCleanup');
  }
  // A reported first failure must survive a later output/completion rejection.
  // With no readable report, retain the genuine completion error as the primary cause.
  if (completionRejected && reportRejected) {
    const reportedFirstFailure = reportSelected && report.status === 'failed';
    const reportErrors = reportedFirstFailure && reportFailure instanceof AggregateError ? reportFailure.errors : [reportFailure];
    const primary = reportedFirstFailure ? reportErrors[0] : completionFailure;
    if (primary !== completionFailure) observe(completionFailure, 'jointFixtureCompletion');
    else observe(reportFailure, 'jointFixtureReport');
    const errors = reportedFirstFailure ? [primary, completionFailure, ...reportErrors.slice(1)] : [primary, reportFailure];
    throw new AggregateError(errors,
      'JOINT_FIXTURE_REPORT_AND_COMPLETION_FAILED', { cause: primary });
  }
  if (reportRejected) throw reportFailure;
  if (completionRejected) throw completionFailure;
  assert.equal(completed.exitCode, 0);
  assert.equal(completed.signal, null);
}

export async function withSourceHandoffJointFailureEvidence(testContext, run, {
  sink = createRunnerFailureSink(),
  file = fileURLToPath(new URL('./windowsAcceptanceSupervisor.contract.test.mjs', import.meta.url)),
} = {}) {
  const observe = (error, phase) => {
    try { sink.record({ runner: 'node', phase, testName: testContext.name, file, attempt: 0, error }); }
    catch { /* Keep the test's original result. */ }
  };
  try { return await run(observe); }
  finally {
    try { await sink.flush(); }
    catch { /* Unavailable supplemental evidence is not a different test outcome. */ }
  }
}

export async function runSourceHandoffJointContract(testContext, selected) {
  assert(Object.hasOwn(CASE_CHECKS, selected));
  const context = await createTestRunContext(testContext, 'source-handoff-joint-' + selected);
  const root = join(context.testRoot, 'temporary');
  await mkdir(root);
  await writeFile(join(root, 'control.private.json'), JSON.stringify({ schemaVersion: 1, node: process.execPath,
    descriptorFilename: WORKSPACE_SUCCESS_DESCRIPTOR_FILENAME, callerResultPrefix: WORKSPACE_CALLER_RESULT_PREFIX,
    callerResultFilename: WORKSPACE_CALLER_RESULT_FILENAME }), { flag: 'wx' });
  await writeFile(join(root, WORKSPACE_SUCCESS_DESCRIPTOR_FILENAME), JSON.stringify({ schemaVersion: 1, syntheticOnly: true }),
    { flag: 'wx' });
  await withSourceHandoffJointFailureEvidence(testContext, observeAdditionalFailure =>
    completeSourceHandoffJointContract(startSourceHandoffJointFixture(context, selected), root, selected,
      { observeAdditionalFailure }));
}
