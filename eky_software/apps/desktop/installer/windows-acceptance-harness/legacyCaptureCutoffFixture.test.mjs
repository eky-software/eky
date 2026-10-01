import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { prepareCaptureCutoffFixture, observeCaptureCutoff, summarizeCaptureCutoff } from './legacyCaptureCutoffFixture.mjs';
import { cleanupRunContext, createRunContext, startSupervisor } from '../windows-process-supervisor/tests/supervisorContractTestSupport.mjs';

const expected = { schemaVersion: 1, operation: 'installerCaptureCutoffDiagnostic', phase: 'commandObservation',
  status: 'completed', resultCode: 'diagnosticOnly', testStepOutcome: 'failure', lastPreparedPhase: 'scenario',
  callerResult: 'missing', phaseResult: 'missing', followingPhases: 'absent', cleanup: 'notInferred',
  cause: 'notEstablished', evidenceRetention: 'retained' };
const observed = { stepOutcome: 'failure', phasePrepared: true, callerResult: 'missing', phaseResult: 'missing', followingPhases: 'absent' };

test('cutoff projection does not infer a cause or cleanup from missing terminal results', () => {
  assert.deepEqual(summarizeCaptureCutoff(observed), expected);
  for (const change of [
    { stepOutcome: 'success' }, { stepOutcome: 'cancelled' }, { stepOutcome: 'skipped' },
    { phasePrepared: false }, { callerResult: 'present' }, { callerResult: 'unreadable' },
    { phaseResult: 'present' }, { phaseResult: 'unreadable' }, { followingPhases: 'unverified' },
  ]) {
    const result = summarizeCaptureCutoff({ ...observed, ...change });
    assert.equal(result.status, 'failed');
    assert.equal(result.resultCode, 'diagnosticUnverified');
    assert.equal(result.cleanup, 'notInferred');
    assert.equal(result.cause, 'notEstablished');
  }
});

test('cutoff projection discards arbitrary input and publishes only closed fields', () => {
  const hostile = 'SECRET-private-path-and-business-data';
  const result = summarizeCaptureCutoff({ stepOutcome: hostile, phasePrepared: hostile,
    callerResult: hostile, phaseResult: hostile, followingPhases: hostile, raw: hostile });
  assert.deepEqual(Object.keys(result), Object.keys(expected));
  assert.equal(JSON.stringify(result).includes(hostile), false);
  assert.equal(result.testStepOutcome, 'unknown');
  assert.equal(result.lastPreparedPhase, 'notObserved');
  assert.equal(result.callerResult, 'unavailable');
  assert.equal(result.phaseResult, 'unavailable');
  assert.equal(result.status, 'failed');
});

test('cutoff preparation binds the existing no-MSI fixture and preserves previous evidence', async (t) => {
  const temporaryRoot = await realpath(tmpdir());
  const parent = await mkdtemp(join(temporaryRoot, 'eky-cutoff-contract-'));
  t.after(() => rm(parent, { recursive: true, force: true }));
  const root = join(parent, 'capture');
  await prepareCaptureCutoffFixture(root, temporaryRoot);
  const request = JSON.parse(await readFile(join(root, 'request.json'), 'utf8'));
  assert.equal(request.testCase, 'scenarioHold');
  assert.equal(request.useCanonicalBudgets, true);
  assert.equal(request.node, process.execPath);
  assert.equal(request.worker, fileURLToPath(new URL('./legacyCommandWorkerFixture.mjs', import.meta.url)));
  assert.equal(request.arguments.length, 9);
  assert.equal(request.arguments[0], '--legacy-command');
  assert.deepEqual(JSON.parse(await readFile(request.arguments[2], 'utf8')), { testCase: 'scenarioHold' });
  await assert.rejects(prepareCaptureCutoffFixture(root, temporaryRoot), { code: 'EEXIST' });
  assert.equal((await observeCaptureCutoff(root, temporaryRoot, 'failure')).status, 'failed');
  await writeFile(join(root, 'command-root.txt'), temporaryRoot);
  const invalid = await observeCaptureCutoff(root, temporaryRoot, 'failure');
  assert.equal(invalid.lastPreparedPhase, 'notObserved');
  assert.equal(invalid.status, 'failed');
  assert.equal(JSON.stringify(invalid).includes(temporaryRoot), false);
});

test('cutoff observation survives an owned command termination without inventing its terminal result', {
  skip: process.platform !== 'win32', timeout: 90_000,
}, async (t) => {
  const context = await createRunContext('capture-cutoff');
  // Command termination has no terminal cleanup proof: retain all owned evidence.
  t.after(() => cleanupRunContext(context, { preserveEvidence: true }));
  const temporaryRoot = await realpath(tmpdir());
  const root = join(context.testRoot, 'capture');
  await prepareCaptureCutoffFixture(root, temporaryRoot);
  const assembly = fileURLToPath(new URL('../bin/windows-process-supervisor-contract-fixture/Release/net10.0/Eky.WindowsProcessSupervisor.ContractFixture.dll', import.meta.url));
  const execution = startSupervisor(context, { captureOutput: true, dotnetAssembly: assembly,
    dotnetArguments: ['--mode', 'legacyCommandEntry', '--request', join(root, 'request.json')] });
  let scenario = false;
  await execution.waitForEvidence((entry) => {
    if (entry.phase === 'scenario' && entry.status === 'started') scenario = true;
    return scenario && entry.phase === 'processTreeObserved' && entry.status === 'completed';
  }, 60_000);
  assert.equal(execution.child.kill('SIGKILL'), true);
  const completion = await execution.completion;
  assert.notEqual(completion.exitCode, 0);
  assert.deepEqual(await observeCaptureCutoff(root, temporaryRoot, 'failure'), expected);
  const commandRoot = await readFile(join(root, 'command-root.txt'), 'utf8');
  await mkdir(join(commandRoot, 'publishFailure'));
  assert.equal((await observeCaptureCutoff(root, temporaryRoot, 'failure')).status, 'failed');
  await writeFile(join(commandRoot, 'scenario', 'result.json'), '{}');
  assert.equal((await observeCaptureCutoff(root, temporaryRoot, 'failure')).phaseResult, 'present');
});

test('cutoff workflow is opt-in and preserves normal acceptance and recorder failure', async () => {
  const workflow = await readFile(new URL('../../../../../.github/workflows/windows-acceptance-supervisor-feasibility.yml', import.meta.url), 'utf8');
  const job = workflow.slice(workflow.indexOf('  inspector-cutoff-diagnostic:'), workflow.indexOf('  msi-file-version-policy:'));
  assert.match(job, /github\.event_name == 'workflow_dispatch' && inputs\.mode == 'inspector-cutoff-diagnostic'/u);
  assert.match(job, /ref: \$\{\{ github\.sha \}\}/u);
  assert.equal((job.match(/continue-on-error: true/gu) ?? []).length, 1);
  assert.match(job, /id: cutoff_command[\s\S]*?timeout-minutes: 1\s+continue-on-error: true/u);
  assert.match(job, /--mode legacyCommandEntry --request \$request/u);
  assert.match(job, /if: always\(\) && steps\.cutoff_capture_start\.outcome != 'skipped'/u);
  assert.match(job, /CUTOFF_STEP_OUTCOME: \$\{\{ steps\.cutoff_command\.outcome \}\}/u);
  assert.match(job, /if: always\(\) && steps\.cutoff_capture_stop\.outcome == 'success'/u);
  assert.match(job, /-Mode analyze -LegacyCommand -ContractFixture/u);
  assert.match(job, /-Mode analyze -LegacyCommand -ContractFixture \| ForEach-Object \{\s+\$output\.Add\(\[string\]\$_\)\s+Write-Output \$_\s+\}/u);
  assert.doesNotMatch(job, /\$output = &|\$output \| Write-Output/u);
  assert.match(job, /foreach \(\$phase in @\('command', 'scenario'\)\)/u);
  assert.match(job, /if \(\$analysisExit -ne 0\) \{ throw 'INSPECTOR_CUTOFF_EXTRACTION_INCOMPLETE' \}/u);
  assert.doesNotMatch(job, /upload-artifact|msiexec|pnpm|npm install|strategy:|matrix:|Remove-Item/u);
  assert.ok(job.indexOf('-Mode start') < job.indexOf('--mode legacyCommandEntry'));
  assert.ok(job.indexOf('-Mode stop') > job.indexOf('--mode legacyCommandEntry'));
  assert.match(workflow, /job-object-feasibility:\s+if: [^\n]+inputs\.mode != 'inspector-cutoff-diagnostic'/u);
});
