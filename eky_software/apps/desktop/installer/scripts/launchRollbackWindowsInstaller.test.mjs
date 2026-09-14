import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { cleanupRunContext, createRunContext, createRequest, startSupervisor, writeRequest }
  from '../windows-process-supervisor/tests/supervisorContractTestSupport.mjs';
import { readWindowsAcceptanceSupervisorResult } from '../windows-process-supervisor/windowsAcceptanceSupervisorResult.mjs';
import { readBootstrapExit } from './rollbackBootstrapContractFixture.mjs';

for (const testCase of ['completed', 'missingHelper', 'earlyHelperExit', 'helperHold']) {
  test(`rollback bootstrap supervised handoff: ${testCase}`, {
    skip: process.platform !== 'win32', timeout: 60_000,
  }, async (t) => {
    const context = await createRunContext('rollback-bootstrap-' + testCase);
    let verified = false;
    t.after(() => cleanupRunContext(context, { preserveEvidence: !verified || testCase !== 'completed' }));
    const inputPath = join(context.testRoot, 'rollback-fixture.json');
    await writeFile(inputPath, JSON.stringify({ root: context.testRoot, testCase, runNonce: context.runNonce,
      scenario: context.scenario, artifactDescriptorSha256: context.artifactDescriptorSha256 }));
    const request = createRequest(context, 'exitZero', testCase === 'helperHold'
      ? { timeoutMilliseconds: 10_000, cleanupReserveMilliseconds: 2_000 }
      : { timeoutMilliseconds: 35_000, cleanupReserveMilliseconds: 5_000 });
    request.arguments = [fileURLToPath(new URL('./rollbackBootstrapContractFixture.mjs', import.meta.url)), inputPath];
    await writeRequest(context, request);
    const execution = startSupervisor(context);
    const events = [];
    execution.child.once('exit', () => events.push('exit'));
    execution.child.once('close', () => events.push('close'));
    const completion = await execution.completion;
    assert.deepEqual(events, ['exit', 'close']);
    assert.equal(completion.signal, null);
    assert.equal(completion.exitCode, testCase === 'completed' ? 0 : 1);
    const result = await readWindowsAcceptanceSupervisorResult(context.resultPath, {
      ...request, supervisorExitCode: completion.exitCode,
    });
    assert.equal(result.processTreeAbsent, true);
    const evidence = JSON.parse(await readFile(join(context.testRoot, 'handoff-evidence.json'), 'utf8'));
    assert.equal(evidence.schemaVersion, 1);
    if (testCase === 'helperHold') {
      assert.deepEqual(evidence.phases, ['bootstrapExited', 'helperStarted', 'helperAliveAfterBootstrapExit']);
      assert.equal(result.processResultCode, 'deadlineExceeded');
      assert.equal(result.cleanupResultCode, 'processTreeAbsent');
      await assert.rejects(readFile(context.workerResultPath), { code: 'ENOENT' });
    } else {
      assert.equal(result.processResultCode, testCase === 'completed' ? 'processCompleted' : 'processExitFailed');
      const worker = JSON.parse(await readFile(context.workerResultPath, 'utf8'));
      assert.deepEqual(worker, { schemaVersion: 1, runNonce: context.runNonce, scenario: context.scenario,
        artifactDescriptorSha256: context.artifactDescriptorSha256,
        status: testCase === 'completed' ? 'completed' : 'failed',
        resultCode: testCase === 'completed' ? 'rollbackContractValidated' : 'rollbackContractFailed',
        errorCode: { completed: null, missingHelper: 'bootstrapRejected', earlyHelperExit: 'helperTerminalMissing' }[testCase] });
      if (testCase === 'completed') {
        assert.equal(result.workerResultCode, 'workerResultValidated');
        assert.deepEqual(evidence.phases, ['bootstrapExited', 'helperStarted', 'helperAliveAfterBootstrapExit',
          'helperTerminalReceived', 'bootstrapClosed']);
      } else {
        assert.deepEqual(evidence.phases, testCase === 'missingHelper'
          ? ['bootstrapExited', 'bootstrapClosed'] : ['bootstrapExited', 'helperStarted']);
      }
    }
    verified = true;
  });
}

function eventChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  return child;
}

test('rollback bootstrap reader preserves non-zero exit without success acknowledgement', async () => {
  const child = eventChild();
  const completion = readBootstrapExit(child);
  child.emit('exit', 30, null);
  assert.deepEqual(await completion, { status: 30, signal: null, stdout: '', stderr: '' });
});

test('rollback bootstrap reader accepts acknowledgement delivered after process exit', async () => {
  const child = eventChild();
  const completion = readBootstrapExit(child);
  let returned = false;
  completion.then(() => { returned = true; });
  child.emit('exit', 0, null);
  await Promise.resolve();
  assert.equal(returned, false);
  child.stdout.emit('data', Buffer.from('EKY_ROLLBACK_'));
  await Promise.resolve();
  assert.equal(returned, false);
  child.stdout.emit('data', Buffer.from('HELPER_STARTED\r\n'));
  assert.equal((await completion).status, 0);
});

test('rollback bootstrap reader rejects closed output without acknowledgement and does not invent a live-process exit', async () => {
  const child = eventChild();
  const completion = readBootstrapExit(child);
  const rejected = assert.rejects(completion, { message: 'ROLLBACK_BOOTSTRAP_ACKNOWLEDGEMENT_INVALID' });
  let returned = false;
  completion.catch(() => { returned = true; });
  child.stdout.emit('end');
  await Promise.resolve();
  assert.equal(returned, false);
  child.emit('exit', 0, null);
  await rejected;
});
