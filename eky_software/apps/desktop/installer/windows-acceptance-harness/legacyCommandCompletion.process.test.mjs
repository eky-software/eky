import assert from 'node:assert/strict';
import { lstat, mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { cleanupRunContext, createRunContext, createRequest, startProgramFailureFixture, startSupervisor, writeRequest }
  from '../windows-process-supervisor/tests/supervisorContractTestSupport.mjs';
import { readWindowsAcceptanceSupervisorResult } from '../windows-process-supervisor/windowsAcceptanceSupervisorResult.mjs';
import { legacyCallerResultIdentity, parseLegacyCallerResult } from './legacyCallerResult.mjs';
import { workspaceCallerResultIdentity, parseWorkspaceCallerResult } from './workspaceCallerResult.mjs';
import { legacyCallerResultFile } from './legacyCallerResultFile.mjs';
import { workspaceCallerResultFile } from './workspaceCallerResultFile.mjs';

for (const kind of ['legacy', 'workspace-success', 'workspace-fault']) {
  test(`${kind} public command resolves the real worker and rejects an invalid artifact before installation`, {
    skip: process.platform !== 'win32', timeout: 60_000,
  }, async (t) => {
    const context = await createRunContext(kind + '-public-entry');
    let verified = false;
    t.after(() => cleanupRunContext(context, { preserveEvidence: !verified }));
    const temp = join(context.testRoot, 'temporary');
    const profile = join(context.testRoot, 'synthetic-appdata');
    await mkdir(temp);
    await mkdir(profile);
    const workspace = kind !== 'legacy';
    const resultPath = join(temp, `eky-${workspace ? 'workspace' : 'legacy'}-caller-` + randomBytes(16).toString('hex'), 'result.json');
    const descriptor = join(context.testRoot, workspace ? 'workspace-success-artifact.json' : 'legacy-upgrade-artifact.json');
    await writeFile(descriptor, '{}');
    const environment = { ...process.env, TEMP: temp, TMP: temp, APPDATA: profile, LOCALAPPDATA: profile };
    delete environment.npm_node_execpath;
    const execution = startSupervisor(context, { captureOutput: false, environment, dotnetArguments: [
      `--${kind}-command`, '--artifact-descriptor', descriptor, '--expected-descriptor-sha256', 'a'.repeat(64),
      '--expected-build-revision', 'b'.repeat(40), ...(kind === 'workspace-fault' ? ['--fault-scenario', 'acceptanceInterruption'] : []),
      '--result-path', resultPath,
    ] });
    const receipts = [];
    execution.child.once('exit', () => receipts.push('exit'));
    execution.child.once('close', () => receipts.push('close'));
    const completion = await execution.completion;
    assert.deepEqual(receipts, ['exit', 'close']);
    assert.equal(completion.signal, null);
    assert.equal(completion.exitCode, 1);
    const roots = (await readdir(temp)).filter((name) => /^eky-acceptance-command-[0-9a-f]{32}$/.test(name));
    assert.equal(roots.length, 1);
    const commandRoot = join(temp, roots[0]);
    const report = JSON.parse(await readFile(join(commandRoot, 'materialize', 'result.json'), 'utf8'));
    assert.equal(report.processResultCode, 'processExitFailed');
    assert.equal(report.processTreeAbsent, true);
    await assert.rejects(lstat(join(commandRoot, 'inspectSourceBefore')), { code: 'ENOENT' });
    const result = JSON.parse(await readFile(resultPath, 'utf8'));
    assert.equal(result.outcome.status, 'failed');
    assert.equal(result.outcome.fixtureRemoved, false);
    assert.deepEqual(await readdir(profile), []);
    verified = true;
  });
}

for (const kind of ['legacy', 'workspace-success', 'workspace-fault']) {
for (const testCase of ['completed', 'blockedEvidence', 'preparationHold', 'productInspectionHold', 'scenarioHold', 'uninstallHold', 'resultBeforeExit', 'cleanupFailed', 'scenarioAndCleanupFailed', 'removalHold',
  'publicationBeforeExit', 'productMissingResult', 'preconditionFailed', 'scenarioMissing', 'businessFailed', 'profileChanged', 'artifactChanged',
  ...(kind === 'legacy' ? [] : ['footprintFailed']), ...(kind === 'workspace-fault' ? ['sessionFailed'] : [])]) {
  const workspace = kind !== 'legacy';
  const succeeded = ['completed', 'blockedEvidence'].includes(testCase);
  const faultScenario = kind === 'workspace-fault' ? 'acceptanceInterruption' : undefined;
  test(`${kind} fixed command entrypoint completes the real phase chain: ${testCase}`, {
    skip: process.platform !== 'win32', timeout: 90_000,
  }, async (t) => {
    const context = await createRunContext(kind + '-entry-' + testCase);
    const callerRoot = join(await realpath(tmpdir()), `eky-${workspace ? 'workspace' : 'legacy'}-caller-` + randomBytes(16).toString('hex'));
    const resultPath = join(callerRoot, 'result.json');
    const descriptor = join(context.testRoot, workspace ? 'workspace-success-artifact.json' : 'legacy-upgrade-artifact.json');
    let verified = false;
    t.after(async () => {
      await cleanupRunContext(context, { preserveEvidence: !verified || testCase !== 'completed' });
      if (verified && testCase === 'completed') await rm(callerRoot, { recursive: true });
    });
    await writeFile(descriptor, JSON.stringify({ testCase }));
    const evidenceRequestPath = join(context.testRoot, 'evidence-request.json');
    if (testCase === 'blockedEvidence') await writeFile(evidenceRequestPath, JSON.stringify(createRequest(context, 'exitZero')));
    await writeFile(context.requestPath, JSON.stringify({ node: process.execPath,
      ...(testCase === 'blockedEvidence' ? { evidenceRequestPath } : {}),
      worker: fileURLToPath(new URL('./legacyCommandWorkerFixture.mjs', import.meta.url)),
      arguments: [`--${kind}-command`, '--artifact-descriptor', descriptor, '--expected-descriptor-sha256', 'a'.repeat(64),
        '--expected-build-revision', 'b'.repeat(40), ...(faultScenario ? ['--fault-scenario', faultScenario] : []), '--result-path', resultPath] }));
    const execution = startSupervisor(context, { captureOutput: false,
      dotnetAssembly: fileURLToPath(new URL('../bin/windows-process-supervisor-contract-fixture/Release/net10.0/Eky.WindowsProcessSupervisor.ContractFixture.dll', import.meta.url)),
      dotnetArguments: ['--mode', 'legacyCommandEntry', '--request', context.requestPath] });
    const events = [];
    execution.child.once('exit', () => events.push('exit'));
    execution.child.once('close', () => events.push('close'));
    const completion = await execution.completion;
    assert.deepEqual(events, ['exit', 'close']);
    assert.equal(completion.signal, null);
    assert.equal(completion.exitCode, succeeded ? 0 : 1);
    const commandRoot = await readFile(join(context.testRoot, 'command-root.txt'), 'utf8');
    const phase = { preparationHold: 'prepare', productInspectionHold: 'inspectSourceBefore', scenarioHold: 'scenario', uninstallHold: 'uninstallTarget',
      resultBeforeExit: 'uninstallTarget', removalHold: 'fixtureCleanup', publicationBeforeExit: 'publish' }[testCase];
    if (phase) {
      const outcome = JSON.parse(await readFile(join(commandRoot, phase, 'result.json'), 'utf8'));
      assert.equal(outcome.processResultCode, 'deadlineExceeded');
      assert.equal(outcome.processTreeAbsent, true);
      assert.equal(outcome.cleanupResultCode, 'processTreeAbsent');
    }
    if (testCase === 'preparationHold') await assert.rejects(lstat(resultPath), { code: 'ENOENT' });
    else {
      const binding = workspace ? workspaceCallerResultIdentity(resultPath, { expectedBuildRevision: 'b'.repeat(40),
        expectedDescriptorSha256: 'a'.repeat(64), faultScenario })
        : legacyCallerResultIdentity(resultPath, { buildRevision: 'b'.repeat(40), artifactDescriptorSha256: 'a'.repeat(64) });
      const result = (workspace ? parseWorkspaceCallerResult : parseLegacyCallerResult)(await readFile(resultPath), binding);
      assert.equal(result.outcome.status, succeeded || testCase === 'publicationBeforeExit' ? 'completed' : 'failed');
      if (!succeeded) await assert.rejects((workspace ? workspaceCallerResultFile : legacyCallerResultFile)(
        'verify', resultPath, binding, completion.exitCode));
      if (succeeded) assert.equal(result.outcome.fixtureRemoved, true);
      if (testCase === 'scenarioAndCleanupFailed') {
        assert.equal(result.outcome.errorCode, workspace ? 'sourceInstallFailed' : 'WINDOWS_ACCEPTANCE_LEGACY_SOURCE_SMOKE_FAILED');
        assert.equal(result.outcome.semanticCleanupResultCode, 'semanticCleanupFailed');
        assert.equal(result.outcome.fixtureRemoved, false);
      }
      if (['cleanupFailed', 'scenarioAndCleanupFailed'].includes(testCase)) {
        await assert.rejects(lstat(join(commandRoot, 'uninstallSource')), { code: 'ENOENT' });
        assert.equal(result.outcome.fixtureRemoved, false);
      }
      if (['uninstallHold', 'resultBeforeExit'].includes(testCase)) {
        assert.equal(result.outcome.errorCode, workspace ? 'supervisorDeadlineExceeded' : 'WINDOWS_ACCEPTANCE_SUPERVISOR_DEADLINE_EXCEEDED');
        assert.equal(result.outcome.fixtureRemoved, false);
        await assert.rejects(lstat(join(commandRoot, 'uninstallSource')), { code: 'ENOENT' });
      }
      if (testCase === 'preconditionFailed') {
        assert.equal(result.outcome.errorCode, workspace ? 'preconditionFailed' : 'WINDOWS_ACCEPTANCE_LEGACY_PRECONDITION_FAILED');
        await assert.rejects(lstat(join(commandRoot, 'scenario')), { code: 'ENOENT' });
        await assert.rejects(lstat(join(commandRoot, 'uninstallTarget')), { code: 'ENOENT' });
      }
      if (testCase === 'productInspectionHold') {
        assert.equal(result.outcome.errorCode, workspace ? 'supervisorDeadlineExceeded' : 'WINDOWS_ACCEPTANCE_SUPERVISOR_DEADLINE_EXCEEDED');
        assert.equal(result.outcome.fixtureRemoved, false);
        await assert.rejects(lstat(join(commandRoot, 'scenario')), { code: 'ENOENT' });
        await assert.rejects(lstat(join(commandRoot, 'uninstallTarget')), { code: 'ENOENT' });
      }
      if (testCase === 'productMissingResult') {
        const report = JSON.parse(await readFile(join(commandRoot, 'uninstallTarget', 'result.json'), 'utf8'));
        assert.equal(report.processResultCode, 'processCompleted');
        assert.equal(report.workerResultCode, 'workerResultMissing');
        assert.equal(report.processTreeAbsent, true);
        await assert.rejects(lstat(join(commandRoot, 'uninstallSource')), { code: 'ENOENT' });
      }
      if (['scenarioMissing', 'businessFailed', 'sessionFailed'].includes(testCase)) {
        assert.equal(result.outcome.semanticCleanupResultCode, 'semanticCleanupCompleted');
        assert.equal(result.outcome.fixtureRemoved, true);
      }
      if (testCase === 'sessionFailed') assert.equal(result.outcome.errorCode, 'sessionProofInvalid');
      if (['profileChanged', 'artifactChanged', 'footprintFailed', 'preconditionFailed', 'productMissingResult'].includes(testCase)) {
        assert.equal(result.outcome.fixtureRemoved, false);
        const { state } = JSON.parse(await readFile(join(commandRoot, 'prepare', 'phase-state.json'), 'utf8'));
        assert.equal((await lstat(state.runRoot)).isDirectory(), true);
      }
    }
    verified = true;
  });
}
}

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
