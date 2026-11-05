import { parseArgs } from 'node:util';
import { registerHooks } from 'node:module';
import { readFile, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { capturePackagedSmokePhaseOutput, observeSmokeOutput } from './packagedSmokeFailureEvidence.mjs';
import { reportPackagedSmokeBackend, resolvePackagedSmokeTempPath } from '../dist/main/packagedSmoke.js';
import { STARTUP_EXCEPTION_TOKEN_ENV } from '../src/main/startupExceptionEvidence.ts';
import { createRunnerFailureSink } from '../../../test-reporters/runnerFailureEvidence.mjs';

// Inner receipts/package assembly are controlled; the CLI, companion, real
// reservation and outer C# Job remain real. This never starts Eky or SQLite.
const worker = new URL('./packagedSmokeJobWorker.mjs', import.meta.url);
const driver = new URL('./run-packaged-smoke.mjs', import.meta.url);
const { values } = parseArgs({ args: process.argv.slice(2), strict: true, allowPositionals: false, options: {
  phase: { type: 'string' }, 'run-nonce': { type: 'string' }, 'artifact-descriptor-sha256': { type: 'string' },
} });
const token = process.env.EKY_DESKTOP_SMOKE_TOKEN;
if (process.env.EKY_E2E !== '1' || process.env.EKY_PACKAGED_WORKFLOW_FIXTURE !== '1' ||
    process.argv[1] !== fileURLToPath(worker) || values.phase !== 'workspaceDeletion' ||
    !/^[a-f0-9]{32}$/u.test(token ?? '') || !/^[a-f0-9]{64}$/u.test(values['run-nonce'] ?? '')) {
  throw new Error('PACKAGED_WORKFLOW_FIXTURE_REFUSED');
}
const root = join(resolvePackagedSmokeTempPath(tmpdir()), 'eky-desktop-smoke', token);
const phaseRoot = join(root, 'result', 'workflow-jobs', values['run-nonce']);
if (await realpath(process.cwd()) !== phaseRoot) throw new Error('PACKAGED_WORKFLOW_FIXTURE_REFUSED');
const sink = createRunnerFailureSink({ tempRoot: process.env.RUNNER_TEMP });
let first, delivery;
const capture = error => {
  if (first !== undefined) return;
  first = { error };
  sink.record({ runner: 'node', phase: 'packagedWorkflowFixtureOriginal', attempt: 0, error });
};
capture.waitForDelivery = () => delivery ??= (async () => {
  if ((await sink.flush()).status !== 'recorded') throw new Error('PACKAGED_WORKFLOW_FIXTURE_EVIDENCE_UNAVAILABLE');
  await writeFile(join(phaseRoot, 'root.ready.json'), JSON.stringify({ schemaVersion: 1,
    runNonce: values['run-nonce'], role: 'root', processId: process.pid }), { flag: 'wx', mode: 0o600 });
  for (;;) {
    try { await readFile(join(phaseRoot, 'root.release')); break; }
    catch (error) { if (error?.code !== 'ENOENT') throw error; }
    await delay(20);
  }
  return 'recorded';
})();
const mocks = {
  './packagedSmokeJob.mjs': { async runOwnedPackagedSmokePhase(input, options) {
    const { capturePackagedSmokeJobPhase } = await import(worker.href);
    const selected = capturePackagedSmokeJobPhase(input, options.environment);
    const stream = () => ({ text: '', truncated: false, readFailed: false, available: true,
      ended: true, changed: false, partial: false });
    const stdout = stream();
    if (!input.phase.startsWith('selector')) reportPackagedSmokeBackend({ enabled: true, phase: input.phase },
      12345, text => { stdout.text += text; });
    return { binding: selected.binding,
      supervisorResult: { ...selected.binding, status: 'completed', processResultCode: 'processCompleted',
        workerResultCode: 'workerResultValidated', childExitCode: 0, processWin32ErrorCode: null,
        cleanupWin32ErrorCode: null, cleanupResultCode: 'notRequired', processTreeAbsent: true, durationMs: 1 },
      diagnostic: { status: 'verified', phase: { phase: selected.expectedStage, stdout, stderr: stream() } },
      portRelease: { status: input.phase.startsWith('selector') ? 'notStarted' : 'verified' } };
  } },
  './read-desktop-electron-version.mjs': { async readDesktopElectronVersion() { return 'fixture-only'; } },
  './packaged-release-candidate.mjs': { async preparePackagedReleaseCandidateSmoke() {
    await writeFile(join(phaseRoot, 'unexpected-release-preparation.json'), '{"schemaVersion":1}', { flag: 'wx', mode: 0o600 });
  } },
  './packagedSmokeFailureEvidence.mjs': { capturePackagedSmokePhaseOutput, observeSmokeOutput,
    async prepareSmokeExceptionEvidence() { return { capture, arguments: [],
      environment: { [STARTUP_EXCEPTION_TOKEN_ENV]: token + 'e'.repeat(32) } }; } },
};
const key = '__ekyOwnedWorkflowFixture'; globalThis[key] = mocks;
registerHooks({ resolve(specifier, context, nextResolve) {
  const owner = specifier === './packagedSmokeJob.mjs' ? worker.href : driver.href;
  if (context.parentURL === owner && Object.hasOwn(mocks, specifier)) {
    const source = Object.keys(mocks[specifier]).map(name =>
      `export const ${name} = globalThis[${JSON.stringify(key)}][${JSON.stringify(specifier)}][${JSON.stringify(name)}];`).join('\n');
    return { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true };
  }
  return nextResolve(specifier, context);
} });
