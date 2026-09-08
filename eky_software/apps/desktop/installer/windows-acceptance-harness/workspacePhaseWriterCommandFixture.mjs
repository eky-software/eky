import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFile, writeFile } from 'node:fs/promises';
import { setImmediate } from 'node:timers/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createWorkspacePhaseWriter } from './workspacePhaseWriter.mjs';
import { WORKSPACE_PHASE_MAX_BYTES } from './workspacePhaseObservation.mjs';
import { runWorkspaceCallerCli } from './workspaceCallerCli.mjs';
import { parseWorkspaceSuccessArguments } from './runWorkspaceSuccess.mjs';

// Contract fixture only. The existing Job Object test support contains this
// command and its writer even when an assertion fails before terminal evidence.
const input = JSON.parse(await readFile(process.argv[2], 'utf8'));
assert(['normal', 'unread', 'brokenChannel', 'brokenOutput', 'writerCrash', 'cancelled', 'invalidFields', 'missingResult',
  'callerFailure', 'invalidCallerResult'].includes(input.mode));
const cancellation = new AbortController();
let child;
let childClosed = false;
let starts = 0;
let closePromise;
const output = [];
const writer = createWorkspacePhaseWriter({
  timeoutMilliseconds: 10_000, terminationTimeoutMilliseconds: 1_000, signal: cancellation.signal,
  spawnProcess(command, args, options) {
    starts += 1;
    child = spawn(command, args, { ...options, stdio: ['pipe', 'pipe', 'ignore'] });
    closePromise = new Promise((resolve) => child.once('close', () => { childClosed = true; resolve(); }));
    return child;
  },
});
const observation = {
  schemaVersion: 1, operation: 'workspaceAcceptanceCaller', scenario: 'packagedWorkspaceSuccess',
  phase: 'supervisorExit', status: 'completed', durationMs: 0, elapsedMs: 1,
};

function readFirstLine(stream) {
  return new Promise((resolve, reject) => {
    let pending = Buffer.alloc(0);
    function finish(error) {
      stream.pause();
      stream.off('data', receive);
      stream.off('end', ended);
      stream.off('error', finish);
      if (error) reject(error);
      else resolve(pending.toString('utf8'));
    }
    function ended() { finish(new Error('FIXTURE_PHASE_MISSING')); }
    function receive(bytes) {
      pending = Buffer.concat([pending, bytes]);
      if (pending.length > WORKSPACE_PHASE_MAX_BYTES) finish(new Error('FIXTURE_PHASE_TOO_LARGE'));
      else if (pending.includes(10)) finish();
    }
    stream.on('data', receive);
    stream.once('end', ended);
    stream.once('error', finish);
  });
}
let blocked = false;
let result;
try {
  const firstOutput = readFirstLine(child.stdout);
  assert.equal(writer.send(observation), true);
  output.push(await firstOutput);
  if (input.mode === 'unread') {
    // Fill the real pipe without reading it. No sleep or completion-by-time:
    // the condition requires both a full receiver and a pending input write.
    for (let batch = 0; batch < 50_000 && !blocked; batch += 1) {
      let rejected = 0;
      for (let i = 0; i < 32; i += 1) if (!writer.send(observation)) rejected += 1;
      await setImmediate();
      blocked = rejected === 32 && child.stdout.readableLength >= child.stdout.readableHighWaterMark &&
        child.stdin.writableLength > 0;
    }
    assert.equal(blocked, true);
  } else if (input.mode === 'brokenChannel') {
    const closed = once(child.stdin, 'close');
    child.stdin.destroy();
    await closed;
    assert.equal(writer.send(observation), false);
  } else if (input.mode === 'writerCrash') {
    assert.equal(child.kill(), true); // Exact handle; fault injection, not cleanup ownership.
    await closePromise;
  } else if (input.mode === 'brokenOutput') {
    const closed = once(child.stdout, 'close');
    child.stdout.destroy();
    await closed;
    writer.send(observation);
    await closePromise;
    assert.equal(child.exitCode, 1);
  } else if (input.mode === 'cancelled') {
    cancellation.abort();
  } else if (input.mode === 'invalidFields') {
    child.stdout.on('data', (bytes) => output.push(bytes.toString('utf8')));
    child.stdout.resume();
    child.stdin.write(JSON.stringify({ ...observation, session: 'synthetic-private' }) + '\n');
    await closePromise;
    assert.equal(child.exitCode, 1);
  }
} finally {
  result = await writer.finish();
}
assert.equal(result.writerResultCode, 'writerAbsent');
assert.equal(childClosed, true);
assert.equal(child.stdin.destroyed, true);
assert.equal(starts, 1);
assert.equal(output.join(''), JSON.stringify(observation) + '\n');
const outcome = {
  schemaVersion: 1, scenario: 'packagedWorkspaceSuccess', status: 'completed', errorCode: null,
  safetyErrorCode: null, failedPhase: null, processTreeAbsent: true, fixtureRemoved: true, businessDataPreserved: true,
  phaseWriterResultCode: result.writerResultCode, phaseDiagnosticResultCode: result.diagnosticResultCode,
  fixtureCleanupResultCode: 'fixtureRemoved', supervisorProcessResultCode: 'processCompleted',
  supervisorWorkerResultCode: 'workerResultValidated', supervisorCleanupResultCode: 'notRequired',
  scenarioResultCode: 'workspaceSuccessCompleted', initialProductStateResultCode: 'targetProductPresent',
  postconditionResultCode: 'exactProductsAbsent', removalPostconditionResultCode: 'installerFootprintAbsent',
  semanticCleanupResultCode: 'semanticCleanupCompleted', semanticProofResultCode: 'workspaceSemanticProofValidated',
  buildRevision: 'a'.repeat(40), artifactDescriptorSha256: input.artifactDescriptorSha256,
  sourcePackageSha256: 'c'.repeat(64), targetPackageSha256: 'd'.repeat(64), profileFileCountBefore: 0, profileFileCountAfter: 0,
};
if (input.mode === 'callerFailure') Object.assign(outcome, { status: 'failed', errorCode: 'scenarioResultInvalid' });
if (input.mode === 'invalidCallerResult') outcome.session = 'synthetic-private';
const callerExit = await runWorkspaceCallerCli([
  '--artifact-descriptor', resolve('workspace-success-artifact.json'), '--expected-descriptor-sha256', input.artifactDescriptorSha256,
  '--expected-build-revision', 'a'.repeat(40), '--result-path', input.callerResultPath,
], { parseScenario: parseWorkspaceSuccessArguments,
  runScenario: async () => { if (input.mode === 'callerFailure') throw new Error('synthetic-original'); return outcome; },
  failureDetails: () => outcome, errorCode: () => 'unexpectedFailure',
});
// The enclosing contract Job remains the only emergency owner of this command.
const verifier = spawn(process.execPath, [fileURLToPath(new URL('./verifyWorkspaceCallerResult.mjs', import.meta.url)),
  '--artifact-descriptor', resolve('workspace-success-artifact.json'), '--expected-descriptor-sha256', input.artifactDescriptorSha256,
  '--expected-build-revision', 'a'.repeat(40), '--result-path', input.callerResultPath, '--command-exit', String(callerExit),
], { stdio: 'ignore', windowsHide: true, shell: false });
const [verificationExit, verificationSignal] = await once(verifier, 'close');
assert.equal(verificationSignal, null);
assert.equal(verificationExit, callerExit === 0 ? 0 : 1);
await writeFile(input.reportPath, JSON.stringify({
  result, blocked, childClosed, inputDestroyed: child.stdin.destroyed, starts, output, callerExit, verificationExit,
}), { flag: 'wx' });

// Required worker evidence is deliberately separate from optional phase output.
// The missing-result case must be rejected by the real enclosing supervisor.
if (input.mode !== 'missingResult') {
  await writeFile(input.workerResultPath, JSON.stringify({
    schemaVersion: 1, runNonce: input.runNonce, scenario: input.scenario,
    artifactDescriptorSha256: input.artifactDescriptorSha256,
    status: 'completed', resultCode: 'phaseWriterContractCompleted', errorCode: null,
  }), { flag: 'wx' });
}
process.exitCode = callerExit;
