import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test, { before, after } from 'node:test';

import {
  cleanupRunContext, createRequest, createRunContext,
  isProcessAlive, startForeignSentinel, startProgramFailureFixture, startSupervisor, writeRequest,
} from '../windows-process-supervisor/tests/supervisorContractTestSupport.mjs';
import { readWindowsAcceptanceSupervisorResult } from '../windows-process-supervisor/windowsAcceptanceSupervisorResult.mjs';

const DIRECTORY = dirname(fileURLToPath(import.meta.url));
let buildContext;
let fixtureExecutable;
let sharedFixture;
const diagnostic = process.env.EKY_V25_SHARED_FIXTURE === '1';

async function verifySharedFixture() {
  const info = await lstat(sharedFixture.fixtureExecutable);
  assert.equal(info.isFile() && !info.isSymbolicLink() && info.nlink === 1, true);
  assert.equal(createHash('sha256').update(await readFile(sharedFixture.fixtureExecutable)).digest('hex'),
    sharedFixture.fixtureSha256);
}

before(async () => {
  if (process.platform !== 'win32') return;
  // Temporary local diagnostic selection; the default test still owns its one compiled fixture.
  if (diagnostic) {
    sharedFixture = JSON.parse(await readFile(resolve(DIRECTORY,
      '../../.stage/v25-native-fixture-context.json'), 'utf8'));
    await verifySharedFixture();
    fixtureExecutable = sharedFixture.fixtureExecutable;
    return;
  }
  buildContext = await createRunContext('native-window-compilation');
  fixtureExecutable = resolve(buildContext.runRoot, 'WindowContract.exe');
  const request = createRequest(buildContext, 'exitZero');
  request.arguments = [
    resolve(DIRECTORY, 'fixtures', 'buildWindowsApplicationCloseFixture.mjs'),
    buildContext.requestPath,
  ];
  await writeRequest(buildContext, request);
  const completion = await startSupervisor(buildContext).completion;
  const result = await readWindowsAcceptanceSupervisorResult(buildContext.resultPath, {
    ...buildContext, supervisorExitCode: completion.exitCode,
  });
  assert.equal(result.processResultCode, 'processCompleted');
  assert.equal(result.workerResultCode, 'workerResultValidated');
  assert.equal(result.processTreeAbsent, true);
});

after(async () => {
  if (sharedFixture) await verifySharedFixture();
  if (buildContext) await cleanupRunContext(buildContext);
});

test('graceful close adapter requests one exact window close without ownership logic', async () => {
  const source = await readFile(
    resolve(DIRECTORY, 'requestWindowsApplicationClose.ps1'),
    'utf8',
  );
  assert.match(source, /Get-Process -Id \$ProcessId/u);
  assert.match(source, /WindowsApplicationCloseRequest\]::Request/u);
  assert.match(source, /\$actual\.Equals\(\$expected/u);
  assert.doesNotMatch(
    source,
    /Get-CimInstance|taskkill|Stop-Process|Wait-Process|Start-Sleep|while\s*\(|do\s*\{/iu,
  );
  const observer = await readFile(resolve(DIRECTORY, 'WindowsApplicationCloseRequest.cs'), 'utf8');
  assert.equal(observer.match(/\.CloseMainWindow\(\)/gu)?.length, 1);
  assert.match(observer, /\(uint\)target\.Id, 0, OutOfContext/u);
  assert.match(observer, /var processHandle = target\.Handle/u);
  assert.doesNotMatch(observer, /Process\.GetProcesses|Process\.Start|\.Kill\(|Thread\.Sleep|Task\.Delay|Timer/u);
});

for (const mode of ['visible', 'delayed', 'exited', 'exitWhileWaiting', 'absent']) {
  test(`native close observation: ${mode}`, { skip: process.platform !== 'win32' }, async (t) => {
    const context = await createRunContext(`native-close-${mode}`);
    t.after(() => cleanupRunContext(context));
    const foreign = await createRunContext(`foreign-window-${mode}`);
    t.after(() => cleanupRunContext(foreign));
    const sentinel = await startForeignSentinel(foreign);
    const request = createRequest(context, 'exitZero');
    const templatePath = resolve(context.testRoot, 'expected-result.json');
    await writeFile(templatePath, JSON.stringify({
      schemaVersion: 1, runNonce: context.runNonce, scenario: context.scenario,
      artifactDescriptorSha256: context.artifactDescriptorSha256,
      status: 'completed', resultCode: 'fixtureCompleted', errorCode: null,
    }), { flag: 'wx' });
    request.command = fixtureExecutable;
    request.arguments = [
      mode, templatePath, context.workerResultPath, context.requestPath + '.phase',
    ];
    await writeRequest(context, request);
    const completion = await startProgramFailureFixture(context, 'measureCreation').completion;
    const result = await readWindowsAcceptanceSupervisorResult(context.resultPath, {
      ...context, supervisorExitCode: completion.exitCode,
    });
    const fixturePhase = await readFile(context.requestPath + '.phase', 'utf8').catch(() => 'notStarted');
    const timing = await readCreationTiming(context.testRoot);
    if (diagnostic) console.log(JSON.stringify({ operation: 'nativeCreationComparison', mode,
      fixtureSha256: sharedFixture.fixtureSha256,
      timeoutMilliseconds: request.timeoutMilliseconds,
      cleanupReserveMilliseconds: request.cleanupReserveMilliseconds,
      processResultCode: result.processResultCode, cleanupResultCode: result.cleanupResultCode,
      fixturePhase, timing }));
    assert.equal(fixturePhase, mode === 'absent' ? 'observing' : 'completed', JSON.stringify({
      fixturePhase, process: result.processResultCode, cleanup: result.cleanupResultCode,
      timing,
      phases: completion.evidence.map(({ phase, elapsedMs }) => ({ phase, elapsedMs })),
    }));
    assert.equal(result.processTreeAbsent, true, JSON.stringify({
      process: result.processResultCode, childExit: result.childExitCode,
      cleanup: result.cleanupResultCode, worker: result.workerResultCode,
    }));
    assert.equal(isProcessAlive(sentinel.marker.processId), true);
    if (mode === 'absent') {
      assert.equal(result.processResultCode, 'deadlineExceeded');
      assert.equal(result.cleanupResultCode, 'processTreeAbsent');
    } else {
      assert.equal(result.processResultCode, 'processCompleted');
      assert.equal(result.workerResultCode, 'workerResultValidated');
      assert.equal(result.childExitCode, 0);
    }
  });
}

async function readCreationTiming(root) {
  try {
    const value = JSON.parse(await readFile(resolve(root, 'creation-measurement.json'), 'utf8'));
    if (value.schemaVersion !== 1 || !Number.isFinite(value.frequency) || value.frequency <= 0) return null;
    return Object.fromEntries([
      'preparationStarted', 'nativeCallStarted', 'nativeCallReturned', 'handlesCaptured', 'terminal',
    ].map((key) => [key + 'Ms', Number.isFinite(value[key])
      ? Math.round(value[key] * 1000 / value.frequency * 100) / 100 : null]));
  } catch {
    return null;
  }
}
