import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Duplex } from 'node:stream';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { cleanupRunContext, createRunContext, createRequest, startSupervisor, writeRequest }
  from '../windows-process-supervisor/tests/supervisorContractTestSupport.mjs';
import { readWindowsAcceptanceSupervisorResult } from '../windows-process-supervisor/windowsAcceptanceSupervisorResult.mjs';
import { readBootstrapExit, readHelperHandoff } from './rollbackBootstrapContractFixture.mjs';
import { readRollbackBootstrapContractDiagnostics } from './rollbackBootstrapContractDiagnostics.mjs';

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
    t.diagnostic(JSON.stringify(await readRollbackBootstrapContractDiagnostics(context.resultPath,
      join(context.testRoot, 'handoff-evidence.json'), { ...request, supervisorExitCode: completion.exitCode })));
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

test('rollback bootstrap diagnostics project only validated results and ordered handoff evidence', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'eky-rollback-diagnostic-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const resultPath = join(root, 'result.json');
  const handoffPath = join(root, 'handoff.json');
  const expected = { runNonce: 'a'.repeat(64), scenario: 'jobObjectFeasibility',
    artifactDescriptorSha256: 'b'.repeat(64), supervisorExitCode: 1 };
  const result = { schemaVersion: 1, runNonce: expected.runNonce, scenario: expected.scenario,
    artifactDescriptorSha256: expected.artifactDescriptorSha256, status: 'failed',
    processResultCode: 'deadlineExceeded', workerResultCode: 'notChecked',
    cleanupResultCode: 'processTreeAbsent', processTreeAbsent: true, childExitCode: null,
    processWin32ErrorCode: null, cleanupWin32ErrorCode: null, durationMs: 30_000 };
  await writeFile(resultPath, JSON.stringify(result));
  await writeFile(handoffPath, JSON.stringify({ schemaVersion: 1,
    phases: ['bootstrapExited', 'helperStarted', 'helperAliveAfterBootstrapExit'] }));
  const diagnostic = await readRollbackBootstrapContractDiagnostics(resultPath, handoffPath, expected);
  assert.deepEqual(diagnostic, { schemaVersion: 1, operation: 'rollbackBootstrapContract',
    supervisorResult: 'validated', handoffEvidence: 'validated', status: 'failed',
    processResultCode: 'deadlineExceeded', workerResultCode: 'notChecked',
    cleanupResultCode: 'processTreeAbsent', processTreeAbsent: true,
    lastHandoffPhase: 'helperAliveAfterBootstrapExit', handoffPhaseCount: 3 });
  const serialized = JSON.stringify(diagnostic);
  for (const privateValue of [root, expected.runNonce, expected.artifactDescriptorSha256]) {
    assert.equal(serialized.includes(privateValue), false);
  }
  await t.test('unbound and unknown result values are never published', async () => {
    for (const change of [{ runNonce: 'c'.repeat(64) }, { processResultCode: 'PRIVATE_TOKEN_SENTINEL' },
      { extra: 'PRIVATE_TOKEN_SENTINEL' }]) {
      await writeFile(resultPath, JSON.stringify({ ...result, ...change }));
      const observed = await readRollbackBootstrapContractDiagnostics(resultPath, handoffPath, expected);
      assert.equal(observed.supervisorResult, 'unavailableOrInvalid');
      assert.equal(Object.hasOwn(observed, 'processResultCode'), false);
      assert.equal(JSON.stringify(observed).includes('PRIVATE_TOKEN_SENTINEL'), false);
    }
  });
  await t.test('missing or partial files remain unavailable without replacing the failure', async () => {
    await rm(resultPath);
    await writeFile(handoffPath, '{"schemaVersion":1');
    assert.deepEqual(await readRollbackBootstrapContractDiagnostics(resultPath, handoffPath, expected), {
      schemaVersion: 1, operation: 'rollbackBootstrapContract',
      supervisorResult: 'unavailableOrInvalid', handoffEvidence: 'unavailableOrInvalid',
    });
  });
  await t.test('unknown, out-of-order and extended phase evidence is not published', async () => {
    for (const value of [null, [], { schemaVersion: 1, phases: [] },
      { schemaVersion: 1, phases: ['helperStarted'] },
      { schemaVersion: 1, phases: ['bootstrapExited', 'PRIVATE_TOKEN_SENTINEL'] },
      { schemaVersion: 1, phases: ['bootstrapExited'], private: 'PRIVATE_TOKEN_SENTINEL' }]) {
      await writeFile(handoffPath, JSON.stringify(value));
      const observed = await readRollbackBootstrapContractDiagnostics(resultPath, handoffPath, expected);
      assert.equal(observed.handoffEvidence, 'unavailableOrInvalid');
      assert.equal(Object.hasOwn(observed, 'lastHandoffPhase'), false);
      assert.equal(JSON.stringify(observed).includes('PRIVATE_TOKEN_SENTINEL'), false);
    }
  });
  await t.test('bootstrap rejection and full handoff are separate valid sequences', async () => {
    for (const phases of [['bootstrapExited', 'bootstrapClosed'],
      ['bootstrapExited', 'helperStarted', 'helperAliveAfterBootstrapExit',
        'helperTerminalReceived', 'bootstrapClosed']]) {
      await writeFile(handoffPath, JSON.stringify({ schemaVersion: 1, phases }));
      const observed = await readRollbackBootstrapContractDiagnostics(resultPath, handoffPath, expected);
      assert.equal(observed.handoffEvidence, 'validated');
      assert.equal(observed.lastHandoffPhase, 'bootstrapClosed');
      assert.equal(observed.handoffPhaseCount, phases.length);
    }
  });
});

function eventChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  return child;
}

test('rollback helper early exit reads EOF without probing a closed peer', async (t) => {
  const channel = new Duplex({ read() {}, write(_chunk, _encoding, callback) { callback(); } });
  t.after(() => channel.destroy());
  const writes = [];
  channel.write = (chunk) => {
    writes.push(chunk);
    throw Object.assign(new Error('write EPIPE'), { code: 'EPIPE' });
  };
  const phases = [];
  const completion = readHelperHandoff(channel, 'fixture-nonce', 'earlyHelperExit', async (phase) => {
    phases.push(phase);
    channel.push(null);
  });
  channel.push('fixture-nonce:started\n');
  await assert.rejects(completion, { message: 'ROLLBACK_HELPER_TERMINAL_MISSING' });
  assert.deepEqual(writes, []);
  assert.deepEqual(phases, ['helperStarted']);
});

test('rollback helper success still requires probe, release and all acknowledgements', async (t) => {
  const writes = [];
  const channel = new Duplex({ read() {}, write(chunk, _encoding, callback) {
    const command = chunk.toString();
    writes.push(command);
    assert.ok(['probe\n', 'release\n'].includes(command));
    this.push('fixture-nonce:' + (command === 'probe\n' ? 'alive' : 'completed') + '\n');
    callback();
  } });
  t.after(() => channel.destroy());
  const phases = [];
  const completion = readHelperHandoff(channel, 'fixture-nonce', 'completed', async (phase) => phases.push(phase));
  channel.push('fixture-nonce:started\n');
  await completion;
  assert.deepEqual(writes, ['probe\n', 'release\n']);
  assert.deepEqual(phases, ['helperStarted', 'helperAliveAfterBootstrapExit', 'helperTerminalReceived']);
});

test('rollback helper transport errors are not converted into missing-terminal evidence', async (t) => {
  const channel = new Duplex({ read() {}, write(_chunk, _encoding, callback) { callback(); } });
  t.after(() => channel.destroy());
  const failure = Object.assign(new Error('synthetic transport failure'), { code: 'EPIPE' });
  const completion = readHelperHandoff(channel, 'fixture-nonce', 'earlyHelperExit', async () => {
    channel.destroy(failure);
  });
  channel.push('fixture-nonce:started\n');
  await assert.rejects(completion, error => error === failure);
});

test('rollback helper rejects wrong identity and out-of-order messages', async (t) => {
  for (const message of ['other-nonce:started\n', 'fixture-nonce:completed\n']) {
    const channel = new Duplex({ read() {}, write(_chunk, _encoding, callback) { callback(); } });
    t.after(() => channel.destroy());
    const phases = [];
    const completion = readHelperHandoff(channel, 'fixture-nonce', 'earlyHelperExit', async phase => phases.push(phase));
    channel.push(message);
    await assert.rejects(completion, { code: 'ERR_ASSERTION' });
    assert.deepEqual(phases, []);
  }
});

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
