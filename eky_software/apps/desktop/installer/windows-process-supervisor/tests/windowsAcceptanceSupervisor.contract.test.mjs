import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import {
  cleanupRunContext,
  cleanupActiveSupervisors,
  createRequest,
  createRunContext,
  isProcessAlive,
  releaseFixture,
  runSupervisor,
  startForeignSentinel,
  startProgramFailureFixture,
  startSupervisor,
  SUPERVISOR_DLL,
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

async function contextFor(testContext, label) {
  const context = await createRunContext(label);
  testContext.after(async () => cleanupRunContext(context));
  return context;
}

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

test('the supervisor binary is available', WINDOWS_ONLY, async () => {
  await access(SUPERVISOR_DLL);
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
      await rm(markerPath, { force: true });
      await cleanupRunContext(context);
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
    await cleanupRunContext(context);
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
    await cleanupRunContext(context);
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

for (const mode of ['exitZero', 'exitNonZero']) {
  test(`empty Job before exit observation preserves ${mode}`, WINDOWS_ONLY, async (testContext) => {
    const context = await contextFor(testContext, 'exit-observation-' + mode);
    await writeRequest(context, createRequest(context, mode));
    const { result, completion } = await readCompletedExecution(
      context, startProgramFailureFixture(context, 'exitObservationLate'));
    assert.deepEqual(JSON.parse(await readFile(join(context.testRoot, 'process-boundary.json'), 'utf8')),
      { boundary: 'jobEmptyBeforeExitObserved', exitObservedLater: true });
    assert.equal(result.processResultCode, mode === 'exitZero' ? 'processCompleted' : 'processExitFailed');
    assert.equal(result.processTreeAbsent, true);
    assert.equal(completion.exitCode, mode === 'exitZero' ? 0 : 1);
  });
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
    assert.equal(terminal.result.cleanupResultCode, 'processTreeAbsent');
    await waitForProcessAbsent(grandchild.processId);
  },
);

test(
  'the monotonic deadline terminates both owned generations repeatedly',
  WINDOWS_ONLY,
  async () => {
    for (let repetition = 1; repetition <= repetitions; repetition += 1) {
      const context = await createRunContext('deadline-' + repetition);
      try {
        const execution = await runSupervisor(
          context,
          'spawnGrandchildAndHold',
          {
            cleanupReserveMilliseconds: 800,
            timeoutMilliseconds: 2_500,
          },
        );
        const root = await waitForMarker(context, 'root');
        const grandchild = await waitForMarker(context, 'grandchild');
        assert.equal(execution.exitCode, 1);
        assert.equal(execution.result.processResultCode, 'deadlineExceeded');
        assert.equal(execution.result.cleanupResultCode, 'processTreeAbsent');
        assert.equal(execution.result.processTreeAbsent, true);
        await waitForProcessAbsent(root.processId);
        await waitForProcessAbsent(grandchild.processId);
      } finally {
        await cleanupRunContext(context);
      }
    }
  },
);

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
    assert.equal(
      completion.evidence.at(-1)?.errorCode,
      'requestSchemaInvalid',
    );
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
