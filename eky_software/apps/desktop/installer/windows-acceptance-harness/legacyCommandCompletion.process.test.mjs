import assert from 'node:assert/strict';
import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { cleanupRunContext, createRunContext, createRequest, startProgramFailureFixture, writeRequest }
  from '../windows-process-supervisor/tests/supervisorContractTestSupport.mjs';
import { readWindowsAcceptanceSupervisorResult } from '../windows-process-supervisor/windowsAcceptanceSupervisorResult.mjs';

import { describeCommandPhases, reportCommandFailure } from './acceptanceCommandEntrypointContract.mjs';

test('command failure diagnostics preserve missing results and reject raw fields', async () => {
  const root = join(tmpdir(), 'synthetic-command');
  const evidence = await describeCommandPhases(root, 'legacy', async (path) => {
    const phase = basename(dirname(path));
    if (!['prepare', 'scenario', 'publishFailure'].includes(phase)) throw Object.assign(new Error('private'), { code: 'ENOENT' });
    if (basename(path) === 'request.json') return {};
    if (phase === 'scenario') throw Object.assign(new Error('private'), { code: 'ENOENT' });
    throw new Error('private path and raw failure');
  });
  assert.deepEqual(evidence, [
    { phase: 'prepare', result: 'invalidOrUnreadable' },
    { phase: 'scenario', result: 'missing' },
    { phase: 'publishFailure', result: 'invalidOrUnreadable' },
  ]);
  const original = new Error('original assertion');
  assert.throws(() => reportCommandFailure({ diagnostic() { throw new Error('output failed'); } }, evidence, original),
    (error) => error === original);
});

test('command failure diagnostics keep worker loss separate from unverified cleanup', async () => {
  const request = { runNonce: 'c'.repeat(64), scenario: 'acceptanceCommandPhase', artifactDescriptorSha256: 'a'.repeat(64) };
  const evidence = await describeCommandPhases(join(tmpdir(), 'synthetic-command'), 'legacy', async (path) => {
    const phase = basename(dirname(path));
    if (!['prepare', 'scenario'].includes(phase)) throw Object.assign(new Error(), { code: 'ENOENT' });
    if (basename(path) === 'request.json') return request;
    return { ...request, schemaVersion: 1, status: 'failed', durationMs: 1,
      processResultCode: phase === 'prepare' ? 'processCompleted' : 'deadlineExceeded',
      childExitCode: phase === 'prepare' ? 0 : null,
      workerResultCode: phase === 'prepare' ? 'workerResultMissing' : 'notChecked',
      cleanupResultCode: phase === 'prepare' ? 'notRequired' : 'cleanupUnverified',
      processTreeAbsent: phase === 'prepare', processWin32ErrorCode: null, cleanupWin32ErrorCode: null };
  });
  assert.deepEqual(evidence, [
    { phase: 'prepare', result: 'validated', process: 'processCompleted', worker: 'workerResultMissing', cleanup: 'notRequired', processTreeAbsent: true },
    { phase: 'scenario', result: 'validated', process: 'deadlineExceeded', worker: 'notChecked', cleanup: 'cleanupUnverified', processTreeAbsent: false },
  ]);
});

for (const stage of ['WorkerReadHold', 'ResultWriteHold', 'ResultWriteHoldAfterFailure']) {
  test(`command owner exits after its own result I/O stalls: ${stage}`, {
    skip: process.platform !== 'win32', timeout: 30_000,
  }, async (t) => {
    const context = await createRunContext('command-owner-io-' + stage);
    t.after(() => cleanupRunContext(context, { preserveEvidence: true }));
    await writeRequest(context, createRequest(context, stage === 'ResultWriteHoldAfterFailure' ? 'exitNonZero' : 'exitZero', {
      timeoutMilliseconds: 4_000, cleanupReserveMilliseconds: 1_000,
    }));
    const execution = startProgramFailureFixture(context, 'phaseContinuation' + stage);
    const events = [];
    execution.child.once('exit', () => events.push('exit'));
    execution.child.once('close', () => events.push('close'));
    const completed = await execution.completion;
    assert.equal(completed.exitCode, 1);
    assert.equal(completed.signal, null);
    assert.deepEqual(events, ['exit', 'close']);
    const marker = JSON.parse(await readFile(join(context.testRoot, 'host-io-entered.json'), 'utf8'));
    assert.equal(marker.phase, stage === 'WorkerReadHold' ? 'workerRead' : 'resultWrite');
    const report = JSON.parse(await readFile(join(context.testRoot, 'phase-completion.json'), 'utf8'));
    assert.deepEqual(report.events, ['firstPhaseReturned']);
    assert.equal(report.first.processBoundaryVerified, false);
    assert.equal(report.second, null);
    if (stage === 'WorkerReadHold') {
      const result = await readWindowsAcceptanceSupervisorResult(context.resultPath, {
        artifactDescriptorSha256: context.artifactDescriptorSha256, runNonce: context.runNonce,
        scenario: context.scenario, supervisorExitCode: 1,
      });
      assert.equal(result.processResultCode, 'deadlineExceeded');
      assert.equal(result.processTreeAbsent, true);
      assert.equal(result.workerResultCode, 'notChecked');
      assert.equal(report.first.resultWritten, true);
    } else {
      assert.equal(report.first.processResultCode, stage === 'ResultWriteHoldAfterFailure' ? 'processExitFailed' : 'processCompleted');
      assert.equal(report.first.processTreeAbsent, true);
      assert.equal(report.first.resultWritten, false);
      await assert.rejects(lstat(context.resultPath), { code: 'ENOENT' });
    }
  });
}

for (const stage of ['Completed', 'WorkerFailed', 'Deadline', 'CleanupUnverified',
  'PublicationFailed', 'RequestInvalid', 'BlockedEvidence']) {
  test(`same command preserves the completed phase boundary: ${stage}`, {
    skip: process.platform !== 'win32', timeout: 30_000,
  }, async (t) => {
    const context = await createRunContext('phase-continuation-' + stage);
    const nextRoot = join(context.testRoot, 'next');
    const next = { ...context, testRoot: nextRoot, requestPath: join(nextRoot, 'request.json'),
      resultPath: join(nextRoot, 'result.json'), workerResultPath: join(nextRoot, 'worker-result.json'),
      runRoot: join(nextRoot, context.runNonce), supervisorProcesses: new Set(), fixtureProcesses: new Set() };
    let verified = false;
    t.after(async () => {
      const preserveEvidence = !verified || ['CleanupUnverified', 'PublicationFailed'].includes(stage);
      await cleanupRunContext(next, { preserveEvidence });
      await cleanupRunContext(context, { preserveEvidence });
    });
    await mkdir(nextRoot);
    const held = ['Deadline', 'CleanupUnverified', 'PublicationFailed'].includes(stage);
    const request = createRequest(context, held ? 'spawnGrandchildAndHold'
      : stage === 'WorkerFailed' ? 'exitNonZero' : 'exitZero', held ? {
      timeoutMilliseconds: 4_000, cleanupReserveMilliseconds: 1_000,
    } : undefined);
    await writeRequest(context, stage === 'RequestInvalid' ? {} : request);
    await writeRequest(next, createRequest(next, 'exitZero'));
    const execution = startProgramFailureFixture(context, 'phaseContinuation' + stage);
    const receipts = [];
    execution.child.once('exit', () => receipts.push('commandExit'));
    execution.child.once('close', () => receipts.push('commandClose'));
    const completed = await execution.completion;
    assert.deepEqual(receipts, ['commandExit', 'commandClose']);
    assert.equal(completed.signal, null);
    const report = JSON.parse(await readFile(join(context.testRoot, 'phase-completion.json'), 'utf8'));
    const succeeded = ['Completed', 'BlockedEvidence'].includes(stage);
    const continued = !['CleanupUnverified', 'PublicationFailed', 'RequestInvalid'].includes(stage);
    assert.equal(completed.exitCode, succeeded ? 0 : 1);
    assert.equal(report.exitCode, completed.exitCode);
    assert.equal(report.first.exitCode, succeeded ? 0 : 1);
    assert.equal(report.first.resultWritten, !['PublicationFailed', 'RequestInvalid'].includes(stage));
    assert.equal(report.first.requestErrorCode, stage === 'RequestInvalid' ? 'requestSchemaInvalid' : null);
    assert.equal(report.first.processBoundaryVerified, continued);
    assert.deepEqual(report.events, continued
      ? ['firstPhaseReturned', 'secondPhaseStarted', 'secondPhaseReturned'] : ['firstPhaseReturned']);
    if (continued) {
      const terminal = await readWindowsAcceptanceSupervisorResult(next.resultPath, {
        artifactDescriptorSha256: next.artifactDescriptorSha256, runNonce: next.runNonce,
        scenario: next.scenario, supervisorExitCode: 0,
      });
      assert.equal(terminal.processTreeAbsent, true);
      assert.equal(report.second.exitCode, 0);
      assert.equal(report.second.processBoundaryVerified, true);
    } else {
      assert.equal(report.second, null);
      await assert.rejects(lstat(next.runRoot), { code: 'ENOENT' });
      await assert.rejects(lstat(next.resultPath), { code: 'ENOENT' });
    }
    if (stage === 'RequestInvalid') {
      assert.equal(report.first.processResultCode, null);
      await assert.rejects(lstat(context.runRoot), { code: 'ENOENT' });
    } else {
      assert.equal(report.first.processResultCode, held ? 'deadlineExceeded'
        : stage === 'WorkerFailed' ? 'processExitFailed' : 'processCompleted');
      assert.equal(report.first.processTreeAbsent, stage !== 'CleanupUnverified');
      if (held) assert.ok(completed.evidence.some((item) => item.phase === 'processTreeObserved'));
      if (stage !== 'PublicationFailed') {
        const terminal = await readWindowsAcceptanceSupervisorResult(context.resultPath, {
          artifactDescriptorSha256: context.artifactDescriptorSha256, runNonce: context.runNonce,
          scenario: context.scenario, supervisorExitCode: report.first.exitCode,
        });
        assert.equal(terminal.cleanupResultCode, report.first.cleanupResultCode);
        assert.equal(terminal.processTreeAbsent, report.first.processTreeAbsent);
      }
    }
    verified = true;
  });
}

// Prove the approved replacement before migrating the caller: the existing
// .NET command owns the operation itself, including blocking native work and
// result I/O. No outer contract Job or launch Worker can make this test pass.
for (const stage of ['Completed', 'Preparation', 'NativeWait', 'Read', 'Remove',
  'CleanupFailure', 'MissingResult', 'ResultBeforeExit', 'DeliveryHold', 'DeliveryFailure', 'ConsumerReadHold']) {
  test(`product command entrypoint owns its complete worker lifecycle: ${stage}`, {
    skip: process.platform !== 'win32', timeout: 30_000,
  }, async (t) => {
    const context = await createRunContext('product-command-entrypoint-' + stage);
    context.scenario = 'installerProductOperation';
    const nextRoot = join(context.testRoot, 'next');
    const next = { ...context, testRoot: nextRoot, requestPath: join(nextRoot, 'request.json'),
      resultPath: join(nextRoot, 'result.json'), workerResultPath: join(nextRoot, 'worker-result.json'),
      runRoot: join(nextRoot, context.runNonce), supervisorProcesses: new Set(), fixtureProcesses: new Set() };
    let verified = false;
    t.after(async () => {
      const preserveEvidence = !verified || stage === 'ConsumerReadHold';
      await cleanupRunContext(next, { preserveEvidence });
      await cleanupRunContext(context, { preserveEvidence });
    });
    const request = createRequest(context, 'exitZero', {
      timeoutMilliseconds: 4_000, cleanupReserveMilliseconds: 1_000,
    });
    const inputPath = join(context.testRoot, 'product-input.json');
    const reportPath = join(context.testRoot, 'product-result.json');
    const workerPath = fileURLToPath(new URL('./installerProductOperationWorker.mjs', import.meta.url));
    await writeFile(inputPath, JSON.stringify({ stage,
      binding: { schemaVersion: 1, runNonce: context.runNonce,
        scenario: context.scenario, artifactDescriptorSha256: context.artifactDescriptorSha256 },
      request: { schemaVersion: 1, nonce: context.runNonce, operation: 'inspect',
        productCode: '{00000000-0000-0000-0000-000000000001}', scenarioRoot: context.testRoot,
        nodeExecutable: process.execPath, workerPath, timeoutMilliseconds: 4_000,
        cleanupReserveMilliseconds: 1_000, deliveryReserveMilliseconds: 200 } }));
    request.arguments = [fileURLToPath(new URL('./fixtures/installerProductOperationWorkerFixture.mjs', import.meta.url)),
      '--owned-command', inputPath];
    await writeRequest(context, request);
    await mkdir(nextRoot);
    const consumerInputPath = join(nextRoot, 'consumer-input.json');
    const producerCompleted = ['Completed', 'ConsumerReadHold'].includes(stage);
    await writeFile(consumerInputPath, JSON.stringify({ productInputPath: inputPath,
      supervisorResultPath: context.resultPath, supervisorExitCode: producerCompleted ? 0 : 1,
      status: producerCompleted ? 'completed' : 'failed', holdBeforeRead: stage === 'ConsumerReadHold',
      resultCode: producerCompleted ? 'processCompleted'
        : ['CleanupFailure', 'DeliveryFailure'].includes(stage) ? 'processExitFailed'
          : stage === 'MissingResult' ? 'processCompleted' : 'timedOut',
      binding: { schemaVersion: 1, runNonce: next.runNonce, scenario: next.scenario,
        artifactDescriptorSha256: next.artifactDescriptorSha256 } }));
    const consumerRequest = createRequest(next, 'exitZero', stage === 'ConsumerReadHold'
      ? { timeoutMilliseconds: 4_000, cleanupReserveMilliseconds: 1_000 } : undefined);
    consumerRequest.arguments = [fileURLToPath(new URL('./legacyCommandWorkerFixture.mjs', import.meta.url)),
      'consumeOwnedProduct', consumerInputPath];
    await writeRequest(next, consumerRequest);
    // The same .NET command observes the producer exit, then runs the real
    // read-only decoder inside its next Job phase. Neither phase launches it.
    const execution = startProgramFailureFixture(context, 'phaseContinuationCompleted');
    const receipts = [];
    execution.child.once('exit', () => receipts.push('commandExit'));
    execution.child.once('close', () => receipts.push('commandClose'));
    const completed = await execution.completion;
    assert.deepEqual(receipts, ['commandExit', 'commandClose']);
    assert.equal(completed.signal, null);
    const continuation = JSON.parse(await readFile(join(context.testRoot, 'phase-completion.json'), 'utf8'));
    const terminal = await readWindowsAcceptanceSupervisorResult(context.resultPath, {
      artifactDescriptorSha256: context.artifactDescriptorSha256, runNonce: context.runNonce,
      scenario: context.scenario, supervisorExitCode: continuation.first.exitCode,
    });
    assert.equal(terminal.processTreeAbsent, true);
    assert.equal(continuation.second.exitCode, stage === 'ConsumerReadHold' ? 1 : 0);
    assert.equal(continuation.second.processBoundaryVerified, true);
    const consumerTerminal = await readWindowsAcceptanceSupervisorResult(next.resultPath, {
      artifactDescriptorSha256: next.artifactDescriptorSha256, runNonce: next.runNonce,
      scenario: next.scenario, supervisorExitCode: continuation.second.exitCode,
    });
    assert.equal(consumerTerminal.processTreeAbsent, true);
    if (stage === 'ConsumerReadHold') {
      assert.equal(terminal.status, 'completed');
      assert.equal(consumerTerminal.processResultCode, 'deadlineExceeded');
      assert.equal(consumerTerminal.cleanupResultCode, 'processTreeAbsent');
      assert.equal(consumerTerminal.workerResultCode, 'notChecked');
      assert.equal(completed.exitCode, 1);
      await assert.rejects(readFile(join(nextRoot, 'consumer-result.json')), { code: 'ENOENT' });
      verified = true;
      return;
    }
    assert.equal(consumerTerminal.status, 'completed');
    if (stage === 'Completed') {
      assert.equal(completed.exitCode, 0);
      assert.equal(terminal.status, 'completed');
      assert.equal(terminal.workerResultCode, 'workerResultValidated');
      assert.equal(JSON.parse(await readFile(reportPath, 'utf8')).result.status, 'completed');
    } else {
      assert.equal(completed.exitCode, 1);
      assert.equal(terminal.status, 'failed');
      if (stage === 'CleanupFailure') {
        assert.equal(terminal.processResultCode, 'processExitFailed');
        const report = JSON.parse(await readFile(reportPath, 'utf8')).result;
        assert.equal(report.errorCode, 'commandFailed');
        assert.equal(report.resultCleanup, 'failed');
        assert.equal((await lstat(join(context.testRoot, 'product-operation-' + context.runNonce))).isDirectory(), true);
      } else if (stage === 'DeliveryFailure') {
        assert.equal(terminal.processResultCode, 'processExitFailed');
        assert.equal(JSON.parse(await readFile(reportPath, 'utf8')).result.status, 'completed');
        await assert.rejects(readFile(context.workerResultPath), { code: 'ENOENT' });
      } else if (stage === 'MissingResult') {
        assert.equal(terminal.processResultCode, 'processCompleted');
        assert.equal(terminal.workerResultCode, 'workerResultMissing');
      } else {
        assert.equal(terminal.processResultCode, 'deadlineExceeded');
        assert.equal(terminal.cleanupResultCode, 'processTreeAbsent');
        const marker = JSON.parse(await readFile(join(context.testRoot, 'product-boundary-' + context.runNonce + '.json'), 'utf8'));
        assert.equal(marker.phase, { Preparation: 'preparation', NativeWait: 'nativeWaitEntered',
          Read: 'resultRead', Remove: 'resultCleanup', ResultBeforeExit: 'resultBeforeExit',
          DeliveryHold: 'resultDelivery' }[stage]);
        if (stage === 'NativeWait') {
          assert.ok(completed.evidence.some((entry) => entry.phase === 'processTreeObserved'),
            'The blocking native call must have created a descendant in the command Job');
        }
        if (stage === 'ResultBeforeExit') {
          assert.equal(JSON.parse(await readFile(context.workerResultPath, 'utf8')).status, 'completed');
          assert.equal(terminal.workerResultCode, 'notChecked');
        }
      }
    }
    verified = true;
  });
}
