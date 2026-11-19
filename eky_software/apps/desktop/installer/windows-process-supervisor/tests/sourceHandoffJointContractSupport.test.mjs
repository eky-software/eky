import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { realpathSync } from 'node:fs';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import {
  completeSourceHandoffJointContract, readSourceHandoffJointFixture, verifySourceHandoffJointReport,
  withSourceHandoffJointFailureEvidence,
  SOURCE_HANDOFF_JOINT_REPORTER_URL,
} from './sourceHandoffJointContractSupport.mjs';
import { msiWindowEvidenceContract } from '../../windows-acceptance-harness/msiWindowEvidence.mjs';
import { observeSourceHandoffOwnerClose } from './supervisorContractTestSupport.mjs';
import { projectExceptionChain } from '../../../src/main/startupExceptionEvidence.ts';

const PURE = { timeout: 5_000 };
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const encode = value => Buffer.from(JSON.stringify(value) + '\n');
const COMMON = `realOrderedPrefix distinctMailboxAndSourceDirectory allRequiredWorkSettled realAdmissionConsumedOnce
allFourteenPinsClosed admissionReaderSettled admissionCleanupMatchesCase commandNotAccepted boundedCheckpointMatchesCase
sourceRequiredWorkSettled sourceHandlesClosed allSourceResourcesClosed realReservationEnteredBeforeOwner
reservationTaskAndPinSettled reservationCleanupSeparate optionalObserverStillNone lateFrameGapNotClaimed
sourceReleaseMatchesCase exactSourceCreationCount birthAndSameJobBeforeResume actualBirthIdentityRetained
samePhaseClockOrdered reservationEntryPrecedesActualSourceBirth originalNativeStatus nativeTreeAbsenceProved
actualFinalOwnerHostWorkCompleted actualFinalOwnerMatchesNative`.split(/\s+/);
const CASE = {
  exit0: 'naturalExitCodeDelivered recordedExchangeBeforeReturn actualRecordedEvidenceBound realWorkerResultValidated workerEnteredAfterExchange'.split(' '),
  sourceHold: `cleanupNeverClaimsNaturalExit abortNeverCompletesExchange abortReasonRetained abortNeverEntersBusinessWorker
reservationAbortBoundaryPreserved underlyingJobCleanupRetainedSeparately originalDeadlinePreserved reservationHeldAtNativeClose
callbackReleasedAfterNativeClose callbackReturnedWithinNativeBudget`.split(/\s+/),
};

function control(selected = 'exit0', binding = { kind: 'local' }, root = resolve('joint-pure-control')) {
  const success = selected === 'exit0';
  const native = { schemaVersion: 1, runNonce: 'c'.repeat(64), scenario: 'packagedWorkspaceSuccess',
    artifactDescriptorSha256: 'a'.repeat(64), durationMs: success ? 100 : 3_500,
    status: success ? 'completed' : 'failed', processResultCode: success ? 'processCompleted' : 'deadlineExceeded',
    workerResultCode: success ? 'workerResultValidated' : 'notChecked',
    cleanupResultCode: success ? 'notRequired' : 'processTreeAbsent', processTreeAbsent: true,
    childExitCode: success ? 0 : null, processWin32ErrorCode: null, cleanupWin32ErrorCode: null };
  const original = { Status: native.status, ProcessResultCode: native.processResultCode,
    WorkerResultCode: native.workerResultCode, CleanupResultCode: native.cleanupResultCode,
    ProcessTreeAbsent: true, ChildExitCode: native.childExitCode,
    ProcessWin32ErrorCode: null, CleanupWin32ErrorCode: null };
  const evidence = { schemaVersion: msiWindowEvidenceContract.schemaVersion, operation: msiWindowEvidenceContract.operation,
    binding, runNonce: native.runNonce, scenario: native.scenario,
    artifactDescriptorSha256: native.artifactDescriptorSha256, sequence: 1, elapsedMs: 50, clients: [], resources: null };
  const nativeBytes = encode(native), evidenceBytes = encode(evidence);
  const commandRoot = join(root, 'eky-acceptance-command-' + 'd'.repeat(32));
  const nativePath = join(commandRoot, 'scenario', 'result.json');
  const evidencePath = join(commandRoot, 'scenario', msiWindowEvidenceContract.filenamePrefix + '001.private.json');
  const reportPath = join(root, 'joint-reservation-result.private.json');
  const report = { schemaVersion: 1, selected, status: 'completed', firstFailure: null, harnessFailure: null,
    checks: Object.fromEntries([...COMMON, ...CASE[selected]].map(key => [key, true])), commandExit: 1,
    durationMs: success ? 1_000 : 3_900, commandRoot, runRoot: join(root, 'eky-t-synthetic'),
    postScenarioPhases: 'notRun', scope: 'twoCaseRealReservationSyntheticTransport',
    lateFrameWorkerRetirementGap: 'open', fullCommandAccepted: false, sourceEkyExecuted: false,
    originalMsiCauseEstablished: false, admissionCleanupFailure: null,
    admissionFirstFailure: success ? null : { hresult: -2146233029 }, boundedStopAfterScenario: success,
    nativeResult: native, finalOwnerOutcome: { ...original, HostOperationsCompleted: true },
    sourceProof: { schemaVersion: 1, case: selected, requestRejected: false, replayRejected: false,
      requiredWorkSettled: true, sourceHandlesClosed: true, allSettledResourcesClosed: true,
      birthCapturedBeforeResume: true, sourceInSameJobBeforeResume: true, creationAttempts: 1, releaseFailed: false,
      sourceErrorCode: null, requestFailure: null, sourceBirth: { ProcessId: 42, StartTimeLow: 1, StartTimeHigh: 0 },
      birthObservedAtMs: 30, resumeStartedAtMs: 40, resumeReturnedAtMs: 50,
      resultDeliveredBeforeRetirement: success, sourceExited: success, sourceExitCode: success ? 0 : null,
      originalOwnerOutcome: original, originalOwnerHostOperationsCompleted: true },
    reservationProof: { entered: true, entryReady: true, ownerStarted: true, taskSettled: true,
      pinClosed: true, resourcesReleased: true, allControlHandlesClosed: true, reservationResourcesSettled: true,
      enteredAtMs: 10, ownerStartedAtMs: 20, cleanupFailures: [], optionalMsiObserver: 'none',
      scope: 'realEvidenceReservationSyntheticSourceTransport', lateFrameAuthorityProved: false, fullCommandAccepted: false,
      exchangeSucceeded: success, exchangeCompleted: success, returned: success, workerContinuationObserved: success,
      publication: success ? 'recorded' : 'cancelled', firstFailure: success ? null : { type: 'TimeoutException', HResult: -2146233029 },
      actualEvidenceBinding: success ? evidence : null, actualEvidenceBytes: success ? evidenceBytes.length : null,
      actualEvidenceSha256: success ? sha256(evidenceBytes) : null,
      nativeCloseObserved: !success, reservationHeldAtNativeClose: !success, releaseAfterNativeClose: !success,
      unwindRelease: false, nativeCloseAtMs: success ? null : 3_000,
      callbackReleasedAtMs: success ? null : 3_100, callbackReturnedAtMs: success ? null : 3_200 } };
  const files = new Map([[nativePath, nativeBytes], ...(success ? [[evidencePath, evidenceBytes]] : [])]);
  const missing = () => Object.assign(new Error('JOINT_CONTROL_MISSING'), { code: 'ENOENT' });
  const operations = {
    environment: { GITHUB_ACTIONS: 'false' },
    readFixture: async (_root, path) => {
      if (path === reportPath) return encode(report);
      if (!files.has(path)) throw missing();
      return files.get(path);
    },
    statFixture: async path => { if (!files.has(path)) throw missing(); return {}; },
  };
  const complete = (completion = Promise.resolve({ exitCode: 0, signal: null })) =>
    completeSourceHandoffJointContract({ completion }, root, selected, operations);
  return { report, root, reportPath, files, native, nativePath, nativeBytes, evidence, evidencePath, evidenceBytes, operations, complete };
}

test('prepared source handoff requires its own scope and exact inspection report in both named cases', PURE, async () => {
  for (const selected of ['exit0', 'sourceHold']) {
    const fixture = control(selected);
    const complete = () => completeSourceHandoffJointContract({
      completion: Promise.resolve({ exitCode: 0, signal: null }), ownerClosed: Promise.resolve(true),
    }, fixture.root, selected, { ...fixture.operations, prepared: true });
    await assert.rejects(complete());
    fixture.report.scope = 'twoCasePreparedReservationSyntheticTransport';
    delete fixture.report.checks.allFourteenPinsClosed;
    fixture.report.checks.allFifteenPinsClosed = true;
    fixture.report.runRoot = join(fixture.root, 'v26-a123bc');
    await assert.rejects(complete(), { code: 'ENOENT' });
    const inspection = join(fixture.report.runRoot, 'scenario', 'workspace-inspection-1.json');
    const absent = { schemaVersion: 1, productState: -1, productName: null, productVersion: null,
      localPackagePresent: false, ownedRegistryExists: false, ekyProcessCount: 0 };
    for (const contrary of [{ ekyProcessCount: 1 }, { localPackagePresent: true },
      { productName: 'synthetic contrary name' }, { productVersion: '0.0.0' }, { ownedRegistryExists: true }]) {
      fixture.files.set(inspection, encode({ ...absent, ...contrary }));
      await assert.rejects(complete(), { message: 'JOINT_FIXTURE_PRODUCT_REPORT_INVALID' });
    }
    fixture.files.set(inspection, encode(absent));
    await complete();
  }
});

test('prepared source handoff requires spawn before accepting a numerical close code', PURE, async () => {
  for (const [started, code, signal, expected] of [
    [false, -4058, null, false], [true, 1, null, true], [true, null, 'SIGTERM', false],
  ]) {
    const child = new EventEmitter();
    const closure = observeSourceHandoffOwnerClose(child);
    if (started) child.emit('spawn');
    child.emit('close', code, signal);
    assert.equal(await closure, expected);
  }
});

test('source handoff joint pure: foreign mode cannot supply the first failure or cleanup', PURE, async () => {
  for (const prepared of [true, false]) {
    const fixture = control(), observed = [], completion = new Error('JOINT_OWN_COMPLETION');
    Object.assign(fixture.report, { status: 'failed', firstFailure: 'JOINT_FOREIGN_CAUSE',
      admissionCleanupFailure: { exceptionType: 'IOException', hresult: -1, errorCode: 'foreignCleanup' } });
    if (!prepared) fixture.report.scope = 'twoCasePreparedReservationSyntheticTransport';
    await assert.rejects(completeSourceHandoffJointContract({
      completion: Promise.reject(completion), ownerClosed: Promise.resolve(true),
    }, fixture.root, 'exit0', { ...fixture.operations, prepared,
      observeAdditionalFailure(_error, phase) { observed.push(phase); },
    }), error => {
      assert.equal(error.cause, completion);
      assert.deepEqual(observed, ['jointFixtureReport']);
      return true;
    });
  }
});

test('prepared source handoff never opens a report without an observed owner close', PURE, async () => {
  const fixture = control();
  for (const ownerClosed of [undefined, Promise.resolve(false)]) {
    let reads = 0;
    await assert.rejects(completeSourceHandoffJointContract({
      completion: Promise.resolve({ exitCode: 0, signal: null }), ownerClosed,
    }, fixture.root, 'exit0', { ...fixture.operations, prepared: true,
      readFixture() { reads++; throw new Error('unexpectedRead'); },
    }), { message: 'JOINT_FIXTURE_OWNER_EXIT_UNVERIFIED' });
    assert.equal(reads, 0);
  }
});

test('source handoff joint pure: both complete reports and raw artifacts pass without starting a process', PURE, async () => {
  for (const selected of ['exit0', 'sourceHold']) {
    const fixture = control(selected);
    verifySourceHandoffJointReport(fixture.report, selected);
    await fixture.complete();
  }
});

test('source handoff joint reporter URL loads the actual reporter and preserves its original child failure', PURE, async () => {
  assert.equal(new URL(SOURCE_HANDOFF_JOINT_REPORTER_URL).protocol, 'file:');
  const root = realpathSync.native(await mkdtemp(join(realpathSync.native(tmpdir()), 'eky-joint-reporter-')));
  let child, completed = false;
  try {
    await writeFile(join(root, 'fixture.test.mjs'), `import test from 'node:test';
test('joint reporter URI original', () => { throw new Error('JOINT_REPORTER_URI_ORIGINAL'); });\n`, { flag: 'wx' });
    child = spawnSync(process.execPath, ['--preserve-symlinks', '--preserve-symlinks-main', '--test',
      '--test-concurrency=1', '--test-reporter=' + SOURCE_HANDOFF_JOINT_REPORTER_URL, 'fixture.test.mjs'],
    { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 4_000, maxBuffer: 65_536,
      env: { ...process.env, NODE_TEST_CONTEXT: undefined, TEMP: root, TMP: root, TMPDIR: root } });
    assert.equal(child.error, undefined); assert.equal(child.signal, null); assert.equal(child.status, 1);
    assert.doesNotMatch(child.stderr, /ERR_UNSUPPORTED_ESM_URL_SCHEME/u);
    const directories = (await readdir(root)).filter(name => name.startsWith('eky-test-errors-'));
    assert.equal(directories.length, 1);
    const records = [];
    for (const name of await readdir(join(root, directories[0]))) {
      records.push(JSON.parse(await readFile(join(root, directories[0], name), 'utf8')));
    }
    assert.equal(records.length, 2);
    const original = records.find(record => record.kind === 'runnerFailure');
    assert.equal(original.test.name, 'joint reporter URI original');
    assert.ok(original.exception.chain.some(part => part.message === 'JOINT_REPORTER_URI_ORIGINAL' &&
      part.stack?.includes('fixture.test.mjs')));
    assert.ok(records.some(record => record.kind === 'runnerFailureSummary' && record.status === 'recorded' && record.recorded === 1));
    completed = true;
  } finally {
    if (completed && Number.isInteger(child?.status) && child.signal === null) await rm(root, { recursive: true });
  }
});

test('source handoff joint pure: missing false mistyped and extra checks fail closed', PURE, () => {
  for (const selected of ['exit0', 'sourceHold']) {
    for (const name of [...COMMON, ...CASE[selected]]) {
      for (const value of [false, 'true', undefined]) {
        const { report } = control(selected);
        if (value === undefined) delete report.checks[name]; else report.checks[name] = value;
        assert.throws(() => verifySourceHandoffJointReport(report, selected), name);
      }
    }
    const { report } = control(selected);
    report.checks.unexpected = true;
    assert.throws(() => verifySourceHandoffJointReport(report, selected));
  }
});

test('source handoff joint pure: malformed reports and forged successful summaries are rejected', PURE, () => {
  for (const report of [null, [], {}, undefined]) assert.throws(() => verifySourceHandoffJointReport(report, 'exit0'));
  const mutations = [
    r => { r.selected = 'sourceHold'; }, r => { r.schemaVersion = 2; }, r => { r.status = 'pending'; },
    r => { r.firstFailure = 'hidden'; }, r => { r.harnessFailure = {}; }, r => { r.checks = []; },
    r => { r.commandExit = 0; }, r => { r.postScenarioPhases = 'completed'; }, r => { r.scope = 'other'; },
    r => { r.fullCommandAccepted = true; }, r => { r.sourceEkyExecuted = true; }, r => { r.originalMsiCauseEstablished = true; },
    r => { r.lateFrameWorkerRetirementGap = 'closed'; }, r => { r.admissionCleanupFailure = {}; },
    r => { r.durationMs = null; }, r => { r.sourceProof.sourceBirth.ProcessId = '42'; },
    r => { r.sourceProof.sourceBirth.StartTimeLow = 0; }, r => { r.sourceProof.birthObservedAtMs = null; },
    r => { r.sourceProof.resumeStartedAtMs = -1; }, r => { r.sourceProof.resumeReturnedAtMs = 39; },
    r => { r.reservationProof.ownerStartedAtMs = 31; }, r => { r.sourceProof.originalOwnerOutcome.ProcessTreeAbsent = false; },
    r => { r.finalOwnerOutcome.ChildExitCode = 7; }, r => { r.nativeResult.processTreeAbsent = false; },
    r => { r.sourceProof.requestFailure = {}; }, r => { r.sourceProof.sourceErrorCode = 'failed'; },
    r => { r.reservationProof.cleanupFailures = [{}]; }, r => { r.reservationProof.scope = 'other'; },
  ];
  for (const mutate of mutations) {
    const { report } = control(); mutate(report);
    assert.throws(() => verifySourceHandoffJointReport(report, 'exit0'), String(mutate));
  }
  for (const key of ['sourceProof', 'reservationProof', 'nativeResult', 'finalOwnerOutcome', 'checks']) {
    const { report } = control(); delete report[key];
    assert.throws(() => verifySourceHandoffJointReport(report, 'exit0'), key);
  }
});

test('source handoff joint pure: held-source abort cannot claim exchange natural exit or late release', PURE, () => {
  for (const mutate of [
    r => { r.reservationProof.publication = 'recorded'; }, r => { r.sourceProof.sourceExited = true; },
    r => { r.reservationProof.exchangeCompleted = true; }, r => { r.reservationProof.unwindRelease = true; },
    r => { r.reservationProof.nativeCloseAtMs = 2_999; }, r => { r.reservationProof.callbackReleasedAtMs = null; },
    r => { r.reservationProof.callbackReturnedAtMs = 4_000; }, r => { r.reservationProof.firstFailure = null; },
    r => { r.admissionFirstFailure.hresult++; }, r => { r.reservationProof.actualEvidenceSha256 = 'a'.repeat(64); },
  ]) {
    const { report } = control('sourceHold'); mutate(report);
    assert.throws(() => verifySourceHandoffJointReport(report, 'sourceHold'), String(mutate));
  }
});

test('source handoff joint pure: raw native and MSI bindings are checked independently of green reports', PURE, async () => {
  for (const mutate of [
    f => f.files.set(f.nativePath, encode({ ...f.native, runNonce: 'e'.repeat(64) })),
    f => f.files.set(f.nativePath, encode({ ...f.native, childExitCode: 7 })),
    f => f.files.set(f.nativePath, Buffer.from('{broken')),
    f => f.files.delete(f.nativePath),
    f => f.files.set(f.evidencePath, Buffer.concat([f.evidenceBytes, Buffer.from(' ')])),
    f => { f.report.reservationProof.actualEvidenceSha256 = 'e'.repeat(64); },
    f => { f.report.reservationProof.actualEvidenceBytes++; },
    f => f.files.delete(f.evidencePath),
  ]) {
    const fixture = control(); mutate(fixture);
    await assert.rejects(fixture.complete(), String(mutate));
  }
  for (const mutation of [{ sequence: 2 }, { schemaVersion: 1 }, { elapsedMs: -1 }, { operation: 'wrong' },
    { runNonce: 'e'.repeat(64) }, { artifactDescriptorSha256: 'e'.repeat(64) },
    { binding: { kind: 'local', extra: true } }, { extra: true }]) {
    const fixture = control(); Object.assign(fixture.evidence, mutation);
    const bytes = encode(fixture.evidence);
    fixture.files.set(fixture.evidencePath, bytes);
    Object.assign(fixture.report.reservationProof, { actualEvidenceBytes: bytes.length, actualEvidenceSha256: sha256(bytes) });
    await assert.rejects(fixture.complete(), JSON.stringify(mutation));
  }
  const held = control('sourceHold'); held.files.set(held.evidencePath, held.evidenceBytes);
  await assert.rejects(held.complete());
});

test('source handoff joint pure: GitHub MSI binding must match the current run attempt job and revision', PURE, async () => {
  const binding = { kind: 'github', runId: '98765', attempt: '1', job: 'joint-proof', sourceRevision: 'b'.repeat(40) };
  const fixture = control('exit0', binding);
  fixture.operations.environment = { GITHUB_ACTIONS: 'true', GITHUB_RUN_ID: binding.runId,
    GITHUB_RUN_ATTEMPT: binding.attempt, GITHUB_JOB: binding.job, GITHUB_SHA: binding.sourceRevision };
  await fixture.complete();
  for (const key of ['GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT', 'GITHUB_JOB', 'GITHUB_SHA']) {
    const before = fixture.operations.environment[key]; fixture.operations.environment[key] = 'wrong';
    await assert.rejects(fixture.complete()); fixture.operations.environment[key] = before;
  }
});

test('source handoff joint pure: failed report remains first when completion also rejects', PURE, async () => {
  const fixture = control(); fixture.report.status = 'failed'; fixture.report.firstFailure = 'JOINT_SYNTHETIC_ORIGINAL';
  const completion = new Error('JOINT_SYNTHETIC_COMPLETION');
  await assert.rejects(fixture.complete(Promise.reject(completion)), error => {
    assert(error instanceof AggregateError);
    assert.equal(error.cause.message, 'JOINT_SYNTHETIC_ORIGINAL');
    assert.equal(error.errors[0], error.cause); assert.equal(error.errors[1], completion);
    return true;
  });
});

test('source handoff joint pure: bounded native cause and independent cleanup survive completion rejection', PURE, async () => {
  const fixture = control();
  Object.assign(fixture.report, { status: 'failed', firstFailure: 'JOINT_SYNTHETIC_ORIGINAL',
    harnessFailure: { exceptionType: 'IOException', HResult: -2147024891, errorCode: 'jointSyntheticNativeFailure',
      sourceBirth: 'DO_NOT_PROJECT_PRIVATE_REPORT', environment: 'DO_NOT_PROJECT_PRIVATE_REPORT' },
    admissionCleanupFailure: { exceptionType: 'IOException', hresult: -2147024890, errorCode: 'jointSyntheticCleanupFailure',
      managedFrames: ['DO_NOT_PROJECT_PRIVATE_REPORT'] } });
  const completion = new Error('JOINT_SYNTHETIC_COMPLETION');
  await assert.rejects(fixture.complete(Promise.reject(completion)), error => {
    assert(error instanceof AggregateError); assert.equal(error.errors.length, 3);
    assert.equal(error.cause, error.errors[0]); assert.equal(error.cause.message, 'JOINT_SYNTHETIC_ORIGINAL');
    assert.equal(error.cause.cause.name, 'IOException');
    assert.equal(error.cause.cause.message, 'errorCode=jointSyntheticNativeFailure; HResult=-2147024891');
    assert.equal(error.cause.cause.stack, undefined);
    assert.equal(error.errors[1], completion);
    assert.equal(error.errors[2].message, 'errorCode=jointSyntheticCleanupFailure; HResult=-2147024890');
    assert.equal(error.errors[2].stack, undefined);
    const projection = projectExceptionChain(error);
    assert.equal(JSON.stringify(projection).includes('DO_NOT_PROJECT_PRIVATE_REPORT'), false);
    assert.equal(projection.incomplete, true);
    assert.equal(projection.chain.at(-1).stack, null);
    return true;
  });
  await assert.rejects(fixture.complete(), error => {
    assert(error instanceof AggregateError); assert.equal(error.errors.length, 2);
    assert.equal(error.errors[0].message, 'JOINT_SYNTHETIC_ORIGINAL'); return true;
  });
});

test('source handoff joint pure: unavailable or malformed technical cause stays unknown without a fabricated native stack', PURE, async () => {
  for (const harnessFailure of [{}, false, { exceptionType: 'private path/value', HResult: 'not-an-integer',
    errorCode: 'DO NOT PROJECT ARBITRARY CONTENT' }]) {
    const fixture = control();
    Object.assign(fixture.report, { status: 'failed', firstFailure: null, harnessFailure });
    await assert.rejects(fixture.complete(), error => {
      assert.equal(error.message, 'JOINT_FIXTURE_FIRST_FAILURE_UNKNOWN');
      assert.equal(error.cause.name, 'UnknownNativeException');
      assert.equal(error.cause.message, 'errorCode=unknown; HResult=unknown');
      assert.equal(error.cause.stack, undefined); return true;
    });
  }
});

test('source handoff joint pure: completion and cleanup are delivered separately without replacing the primary cause', PURE, async () => {
  const fixture = control(), records = [];
  Object.assign(fixture.report, { status: 'failed', firstFailure: 'JOINT_ORIGINAL',
    admissionCleanupFailure: { exceptionType: 'IOException', hresult: -1, errorCode: 'jointCleanup' } });
  let flushed = 0;
  const completion = new Error('JOINT_COMPLETION');
  const sink = { record: value => records.push(value), flush: async () => { flushed++; } };
  await assert.rejects(withSourceHandoffJointFailureEvidence({ name: 'joint fixture' }, observeAdditionalFailure => {
    fixture.operations.observeAdditionalFailure = observeAdditionalFailure;
    return fixture.complete(Promise.reject(completion));
  }, { sink, file: 'synthetic.test.mjs' }), error => error.cause.message === 'JOINT_ORIGINAL');
  assert.equal(flushed, 1);
  assert.deepEqual(records.map(record => record.phase), ['jointFixtureCleanup', 'jointFixtureCompletion']);
  assert.equal(records[0].error.message, 'errorCode=jointCleanup; HResult=-1');
  assert.equal(records[1].error, completion);
  for (const record of records) {
    assert.equal(record.runner, 'node'); assert.equal(record.testName, 'joint fixture');
    assert.equal(record.file, 'synthetic.test.mjs'); assert.equal(record.attempt, 0);
  }
});

test('source handoff joint pure: supplemental recording and flushing cannot change a failed or successful result', PURE, async () => {
  const original = new Error('JOINT_ORIGINAL');
  let flushed = 0;
  const sink = { record: () => { throw new Error('JOINT_RECORD_FAILURE'); },
    flush: async () => { flushed++; throw new Error('JOINT_FLUSH_FAILURE'); } };
  await assert.rejects(withSourceHandoffJointFailureEvidence({ name: 'synthetic' }, observe => {
    observe(new Error('JOINT_SECONDARY'), 'jointFixtureCompletion'); throw original;
  }, { sink }), error => error === original);
  const value = await withSourceHandoffJointFailureEvidence({ name: 'synthetic' }, async () => 17, { sink });
  assert.equal(value, 17); assert.equal(flushed, 2);
});

test('source handoff joint pure: missing and wrong-selection reports retain their own error without attributing foreign cleanup', PURE, async () => {
  for (const variant of ['missing', 'wrongSchema', 'wrongCase']) {
    const fixture = control(), observed = [], completion = new Error('JOINT_COMPLETION');
    const readFailure = new Error('JOINT_REPORT_READ_FAILURE');
    fixture.operations.observeAdditionalFailure = (error, phase) => observed.push({ error, phase });
    if (variant === 'missing') fixture.operations.readFixture = async () => { throw readFailure; };
    else {
      fixture.report.admissionCleanupFailure = { exceptionType: 'IOException', hresult: -1, errorCode: 'foreignCleanup' };
      if (variant === 'wrongSchema') fixture.report.schemaVersion = 2;
      else fixture.report.selected = 'sourceHold';
    }
    await assert.rejects(fixture.complete(Promise.reject(completion)), error => {
      assert.equal(error.cause, completion);
      assert.equal(observed.length, 1); assert.equal(observed[0].phase, 'jointFixtureReport');
      assert.equal(observed[0].error, error.errors[1]);
      if (variant === 'missing') assert.equal(observed[0].error, readFailure);
      return true;
    });
  }
});

test('source handoff joint pure: absent malformed and unreadable reports cannot mask completion evidence', PURE, async () => {
  for (const code of ['ENOENT', 'EACCES']) {
    const fixture = control(), readFailure = Object.assign(new Error('JOINT_READ_FAILED'), { code });
    fixture.operations.readFixture = async () => { throw readFailure; };
    const completion = new Error('JOINT_COMPLETION_FAILED');
    await assert.rejects(fixture.complete(Promise.reject(completion)), error => {
      assert(error instanceof AggregateError); assert(error.errors.includes(completion)); assert(error.errors.includes(readFailure));
      assert.equal(error.cause, completion); return true;
    });
    await assert.rejects(fixture.complete(), error => error === readFailure);
  }
  const malformed = control(); malformed.operations.readFixture = async () => Buffer.from('{bad');
  const completion = new Error('JOINT_COMPLETION_FAILED');
  await assert.rejects(malformed.complete(Promise.reject(completion)), error => {
    assert(error instanceof AggregateError); assert.equal(error.cause, completion);
    assert.equal(error.errors[1].message, 'JOINT_FIXTURE_JSON_INVALID'); return true;
  });
});

test('source handoff joint pure: successful report never overrides failed exit signal or completion', PURE, async () => {
  const fixture = control(), failure = new Error('JOINT_COMPLETION_FAILED');
  await assert.rejects(fixture.complete(Promise.reject(failure)), error => error === failure);
  for (const completed of [{ exitCode: 1, signal: null }, { exitCode: 0, signal: 'SIGTERM' }])
    await assert.rejects(fixture.complete(Promise.resolve(completed)));
});

test('source handoff joint pure: command root traversal and unsupported cases fail before artifact reads', PURE, async () => {
  for (const commandRoot of [join(resolve('outside'), 'eky-acceptance-command-' + 'd'.repeat(32)),
    'relative', null, join(resolve('joint-pure-control'), 'unexpected')]) {
    const fixture = control(); fixture.report.commandRoot = commandRoot;
    await assert.rejects(fixture.complete());
  }
  let read = false;
  await assert.rejects(completeSourceHandoffJointContract({ completion: Promise.resolve() }, resolve('unused'), 'other', {
    readFixture: async () => { read = true; },
  }));
  assert.equal(read, false);
});

test('source handoff joint pure: bounded physical reader accepts exact bytes and rejects oversize missing and outside files', PURE, async () => {
  const root = realpathSync.native(await mkdtemp(join(realpathSync.native(tmpdir()), 'joint-read-')));
  try {
    const path = join(root, 'sample.json'), bytes = encode({ syntheticOnly: true });
    await writeFile(path, bytes, { flag: 'wx' });
    assert.equal((await readSourceHandoffJointFixture(root, path)).equals(bytes), true);
    await assert.rejects(readSourceHandoffJointFixture(root, path, bytes.length - 1));
    await assert.rejects(readSourceHandoffJointFixture(root, join(root, 'missing.json')), { code: 'ENOENT' });
    await assert.rejects(readSourceHandoffJointFixture(root, join(root, '..', 'outside.json')));
  } finally { await rm(root, { recursive: true }); }
});
