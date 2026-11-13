import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { createRunnerFailureSink, validateRunnerFailureEvidence } from '../../../test-reporters/runnerFailureEvidence.mjs';
import { projectExceptionChain, STARTUP_EXCEPTION_LIMITS } from '../../desktop/src/main/startupExceptionEvidence.ts';
import { captureWorkspaceDeletionFailure, shouldCaptureWorkspaceDeletionFailure,
  selectWorkspaceDeletionPhaseObservation } from '../src/fixtures/captureWorkspaceDeletionFailure.ts';
import { createWorkspaceDeletionRawPhaseRecorder,
  WORKSPACE_DELETION_MAIN_PHASE_COVERAGE } from '../../desktop/e2e/workspaceDeletionPhaseObservation.ts';
import { parsePhaseHandoffEnvelope } from '../../desktop/e2e/workspaceDeletionPhaseHandoff.ts';

function input(evaluate) {
  return { application: { evaluate }, runtimeInstanceId: '11111111-1111-4111-8111-111111111111',
    testInfo: { title: 'DESK-DELETE-PREPARE-001 synthetic boundary', testId: 'synthetic-case',
      file: 'electron/workspaceDeletionPreparation.spec.ts', line: 1, column: 1,
      retry: 1, repeatEachIndex: 0, annotations: [] } };
}

test('only a matching expected failure suppresses capture, never an unexpected timeout or interruption', () => {
  for (const [actual, expected, observed, capture] of [
    ['failed', 'failed', true, false],
    ['timedOut', 'failed', true, true],
    ['interrupted', 'failed', true, true],
    ['failed', 'passed', true, true],
    [undefined, 'passed', true, true],
    ['passed', 'passed', false, false],
    ['passed', 'failed', false, false],
  ]) assert.equal(shouldCaptureWorkspaceDeletionFailure(actual, expected, observed), capture);
});

test('the actual main reader reaches the existing bounded sink with attempt and runtime binding', async t => {
  const root = await mkdtemp(join(tmpdir(), 'eky-w73-evidence-'));
  let complete = false;
  t.after(() => complete ? rm(root, { recursive: true, force: true }) : undefined);
  const old = globalThis.__EKY_ELECTRON_E2E__;
  const projection = { chain: [
    { name: 'Error', message: 'SAFE_IPC_CODE', stack: 'Error: SAFE_IPC_CODE', truncated: false },
    { name: 'Error', message: 'SYNTHETIC_ORIGINAL', stack: 'Error: SYNTHETIC_ORIGINAL\n at syntheticOwner', truncated: false },
    { name: 'Error', message: 'SYNTHETIC_CAUSE', stack: 'Error: SYNTHETIC_CAUSE', truncated: false },
  ], incomplete: false };
  globalThis.__EKY_ELECTRON_E2E__ = { workspaceDeletionProof: { readFailures: () => ({ request: projection }) } };
  t.after(() => { if (old === undefined) delete globalThis.__EKY_ELECTRON_E2E__; else globalThis.__EKY_ELECTRON_E2E__ = old; });
  const context = input(async read => read());
  await captureWorkspaceDeletionFailure(context, createRunnerFailureSink({ env: {}, tempRoot: root }));
  assert.equal(context.testInfo.annotations[0].description, 'recorded');
  const [directory] = await readdir(root);
  const records = await readdir(join(root, directory));
  const file = records.find(name => !name.includes('summary'));
  const record = validateRunnerFailureEvidence(JSON.parse(await readFile(join(root, directory, file), 'utf8')));
  assert.equal(record.runner, 'playwright');
  assert.equal(record.phase, 'workspaceDeletionIpc');
  assert.equal(record.test.attempt, 1);
  assert.equal(record.test.id, `${context.testInfo.testId}:${context.runtimeInstanceId}`);
  assert.equal(record.exception.chain[1].message === 'SYNTHETIC_ORIGINAL', true);
  assert.equal(record.exception.chain[1].stack.includes('syntheticOwner'), true);
  assert.equal(record.exception.chain[2].message === 'SYNTHETIC_CAUSE', true);
  complete = true;
});

for (const [name, evaluate, expected] of [
  ['missing original', async () => undefined, 'missing'],
  ['unavailable main', async () => { throw new Error('SYNTHETIC_TRANSPORT_LOST'); }, 'captureFailed'],
  ['pending main read', () => new Promise(() => {}), 'captureFailed'],
]) {
  test(`${name} stays missing or failed without blocking cleanup indefinitely`, async () => {
    const context = input(evaluate);
    await captureWorkspaceDeletionFailure(context, { record() { assert.fail('No original was observed'); },
      async flush() { assert.fail('No original was observed'); } });
    assert.equal(context.testInfo.annotations[0].description, expected);
  });
}

test('a missing application is not evidence of a captured source cause', async () => {
  const context = { ...input(async () => undefined), application: undefined };
  await captureWorkspaceDeletionFailure(context, { record() { assert.fail(); }, async flush() { assert.fail(); } });
  assert.equal(context.testInfo.annotations[0].description, 'unavailable');
});

test('a truncated or incomplete main projection never claims complete source capture', async () => {
  for (const incomplete of [false, true]) {
    const projection = { chain: [{ name: 'Error', message: 'SYNTHETIC_BOUNDED',
      stack: 'synthetic', truncated: !incomplete }], incomplete };
    const context = input(async () => ({ request: projection }));
    let recorded;
    await captureWorkspaceDeletionFailure(context, { record(value) { recorded = value; }, async flush() { return { status: 'recorded' }; } });
    assert.equal(context.testInfo.annotations[0].description, 'partial');
    assert.equal(recorded.phase, 'workspaceDeletionIpc');
    assert.equal(recorded.projectedException, projection);
  }
});

test('sink and annotation failures cannot replace the application failure', async () => {
  const projection = { chain: [{ name: 'Error', message: 'SYNTHETIC_ORIGINAL', stack: 'synthetic', truncated: false }], incomplete: false };
  for (const throws of ['record', 'flush', 'annotation']) {
    const context = input(async () => ({ request: projection }));
    if (throws === 'annotation') context.testInfo.annotations = { push() { throw new Error('SYNTHETIC_ANNOTATION'); } };
    await assert.doesNotReject(captureWorkspaceDeletionFailure(context, {
      record() { if (throws === 'record') throw new Error('SYNTHETIC_SINK'); },
      async flush() { if (throws === 'flush') throw new Error('SYNTHETIC_DELIVERY'); return { status: 'partial' }; },
    }));
    if (throws !== 'annotation') assert.equal(context.testInfo.annotations[0].description, 'captureFailed');
  }
});

test('the delivered record preserves source truncation, depth limits and sink redaction', async t => {
  const root = await mkdtemp(join(tmpdir(), 'eky-w73-projection-'));
  let complete = false;
  t.after(() => complete ? rm(root, { recursive: true, force: true }) : undefined);
  const secret = 'synthetic-delivery-redaction';
  let original = new Error('SYNTHETIC_BOTTOM');
  for (let index = 0; index < STARTUP_EXCEPTION_LIMITS.depth + 2; index++) {
    original = new Error('x'.repeat(STARTUP_EXCEPTION_LIMITS.message + 128), { cause: original });
  }
  const projection = projectExceptionChain(original);
  projection.chain[0].message = secret;
  const context = input(async () => ({ request: projection }));
  await captureWorkspaceDeletionFailure(context, createRunnerFailureSink({ env: {}, tempRoot: root, secrets: [secret] }));
  const [directory] = await readdir(root);
  const records = await readdir(join(root, directory));
  const file = records.find(name => !name.includes('summary'));
  const bytes = await readFile(join(root, directory, file), 'utf8');
  const record = validateRunnerFailureEvidence(JSON.parse(bytes));
  assert.equal(record.exception.incomplete, true);
  assert.equal(record.exception.chain.length, STARTUP_EXCEPTION_LIMITS.depth);
  assert.equal(record.exception.chain.every(part => part.truncated), true);
  assert.equal(bytes.includes(secret), false);
  assert.equal(record.exception.chain[0].message, '[redacted]');
  assert.equal(context.testInfo.annotations[0].description, 'partial');
  complete = true;
});

test('request revocation and a later shutdown failure reach two distinct delivered records', async t => {
  const root = await mkdtemp(join(tmpdir(), 'eky-w73-two-causes-'));
  let complete = false;
  t.after(() => complete ? rm(root, { recursive: true, force: true }) : undefined);
  const context = input(async () => ({
    request: projectExceptionChain(new Error('SYNTHETIC_EXPECTED_REVOCATION')),
    shutdown: projectExceptionChain(new Error('SYNTHETIC_SHUTDOWN_FIRST', { cause: new Error('SYNTHETIC_SHUTDOWN_CAUSE') })),
  }));
  await captureWorkspaceDeletionFailure(context, createRunnerFailureSink({ env: {}, tempRoot: root }));
  const [directory] = await readdir(root);
  const names = (await readdir(join(root, directory))).filter(name => !name.includes('summary'));
  const records = await Promise.all(names.map(async name =>
    validateRunnerFailureEvidence(JSON.parse(await readFile(join(root, directory, name), 'utf8')))));
  assert.equal(records.length, 2);
  assert.equal(records.find(record => record.phase === 'workspaceDeletionIpc').exception.chain[0].message === 'SYNTHETIC_EXPECTED_REVOCATION', true);
  const shutdown = records.find(record => record.phase === 'workspaceDeletionShutdown');
  assert.equal(shutdown.exception.chain[0].message === 'SYNTHETIC_SHUTDOWN_FIRST', true);
  assert.equal(shutdown.exception.chain[1].message === 'SYNTHETIC_SHUTDOWN_CAUSE', true);
  assert.equal(context.testInfo.annotations[0].description, 'recorded');
  complete = true;
});

test('the real main reader delivers execution causes without pretending they came from IPC', async t => {
  const old = globalThis.__EKY_ELECTRON_E2E__;
  const execution = projectExceptionChain(new Error('SYNTHETIC_EXECUTION_ORIGINAL',
    { cause: new Error('SYNTHETIC_EXECUTION_CAUSE') }));
  const request = projectExceptionChain(new Error('SYNTHETIC_PREPARATION_ORIGINAL'));
  t.after(() => { if (old === undefined) delete globalThis.__EKY_ELECTRON_E2E__; else globalThis.__EKY_ELECTRON_E2E__ = old; });
  for (const withPreparation of [false, true]) {
    globalThis.__EKY_ELECTRON_E2E__ = {
      ...(withPreparation ? { workspaceDeletionProof: { readFailures: () => ({ request }) } } : {}),
      workspaceDeletionExecutionProof: { readFailures: () => ({ execution }) },
    };
    const records = [];
    const context = input(async read => read());
    await captureWorkspaceDeletionFailure(context, { record(value) { records.push(value); },
      async flush() { return { status: 'recorded' }; } });
    assert.equal(context.testInfo.annotations[0].description, 'recorded');
    assert.equal(records.length, withPreparation ? 2 : 1);
    assert.equal(records.find(record => record.phase === 'workspaceDeletionExecution').projectedException, execution);
    if (withPreparation) assert.equal(records.find(record => record.phase === 'workspaceDeletionIpc').projectedException, request);
  }
});

const phaseScenario = 'DESK-DELETE-RECOVERY-001';
const phaseRuntimeIds = ['11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222', '55555555-5555-4555-8555-555555555555'];
const phaseEnvironment = { GITHUB_ACTIONS: 'true', GITHUB_RUN_ID: '98765', GITHUB_RUN_ATTEMPT: '3',
  GITHUB_JOB: 'phase-parent', EKY_EVIDENCE_JOB_KEY: 'phase-parent-0', GITHUB_SHA: 'a'.repeat(40) };
const phaseRequire = createRequire(import.meta.url);

function scopePhaseEnvironment(t) {
  const before = new Map(Object.keys(phaseEnvironment).map(key => [key, process.env[key]]));
  t.after(() => {
    for (const [key, value] of before) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  Object.assign(process.env, phaseEnvironment);
}

function phaseRaw(runtimeInstanceId) {
  const recorder = createWorkspaceDeletionRawPhaseRecorder(runtimeInstanceId, () => 1, WORKSPACE_DELETION_MAIN_PHASE_COVERAGE);
  recorder.observePhase(runtimeInstanceId, { phase: 'preparation', event: 'entered', callId: 1 });
  return recorder.freeze();
}

async function phaseParentFixture(t) {
  scopePhaseEnvironment(t);
  const root = await realpath(await mkdtemp(join(tmpdir(), 'eky-phase-parent-')));
  let complete = false;
  t.after(() => complete ? rm(root, { recursive: true, force: true }) : undefined);
  const outputDir = join(root, 'results', 'run-33333333-3333-4333-8333-333333333333');
  const attempt = join(outputDir, 'synthetic-current-fixture-retry1');
  await mkdir(attempt, { recursive: true });
  const testInfo = { retry: 1, repeatEachIndex: 2, project: { outputDir },
    title: `${phaseScenario} synthetic source callback`, testId: 'synthetic-phase-parent',
    file: 'electron/workspaceDeletionExecution.spec.ts', line: 1, column: 1, timeout: 5000,
    status: 'passed', expectedStatus: 'passed', errors: [], annotations: [],
    outputPath: name => join(attempt, name) };
  const path = testInfo.outputPath('failure.private.json');
  return { root, testInfo, path, complete() { complete = true; }, async evidence() {
    const value = parsePhaseHandoffEnvelope(await readFile(path));
    assert.notEqual(value, undefined);
    return value;
  } };
}

// Only the actual fixture callback is compiled. Its capture and format owners
// remain direct source imports; imported Electron/process ports are controlled.
async function loadPhaseFixture(ports) {
  const ts = phaseRequire('typescript');
  const url = new URL('../src/fixtures/isolatedElectronTest.ts', import.meta.url);
  const source = await readFile(url, 'utf8');
  const result = ts.transpileModule(source.replaceAll('import.meta.dirname', JSON.stringify(dirname(fileURLToPath(url)))), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
    reportDiagnostics: true,
  });
  assert.deepEqual(result.diagnostics, []);
  const module = { exports: {} };
  new Function('require', 'module', 'exports', result.outputText)(specifier =>
    specifier === './captureWorkspaceDeletionFailure.js'
      ? { captureWorkspaceDeletionFailure, shouldCaptureWorkspaceDeletionFailure, selectWorkspaceDeletionPhaseObservation }
      : ports(specifier), module, module.exports);
  return module.exports;
}

async function actualPhaseFixture(t, mode = {}) {
  const f = await phaseParentFixture(t), runRoot = join(f.root, 'profile');
  await mkdir(runRoot);
  const events = [], runtimes = [], phaseReads = [], reports = [], runs = [];
  let releaseRead, readReleased = false;
  const heldRead = new Promise(resolve => { releaseRead = value => { readReleased = true; resolve(value); }; });
  t.after(async () => { releaseRead(phaseRaw(phaseRuntimeIds[0])); await Promise.allSettled(runs); });
  const createRuntime = () => {
    const runtimeInstanceId = phaseRuntimeIds[runtimes.length];
    assert.notEqual(runtimeInstanceId, undefined);
    const runtime = { runtimeInstanceId, runtimeRoot: runRoot, userDataPath: join(runRoot, 'user'),
      configPath: join(runRoot, 'config'), observationsPath: join(runRoot, 'observations'),
      sessionSecret: 'synthetic-session', profile: {}, backendPort: 12345 };
    runtimes.push(runtime);
    return runtime;
  };
  const ports = specifier => {
    if (specifier.startsWith('node:')) return phaseRequire(specifier);
    if (specifier === '@playwright/test') return { test: { extend: definitions => definitions }, expect: {},
      request: { newContext: async () => ({ dispose: async () => { events.push('api-dispose'); } }) } };
    const name = specifier.split('/').at(-1);
    switch (name) {
      case 'createElectronE2eRuntime.js': return { createElectronE2eRuntime: createRuntime, resolveElectronE2eApplicationPath: () => runRoot };
      case 'assertElectronLaunchPrerequisites.js': return { assertElectronLaunchPlatform() {}, assertElectronLaunchPrerequisites() {} };
      case 'createElectronEnvironment.js': return { createElectronEnvironment: () => ({}) };
      case 'createElectronE2eProfile.js': return { listElectronE2eProfileDirectories: () => [] };
      case 'createE2eRunRoot.js': return { createE2eRunRoot: () => runRoot };
      case 'createE2eWorkerPaths.js': return { createE2eWorkerPaths: () => ({ workerRoot: runRoot,
        artifactsRoot: join(runRoot, 'artifacts'), documentsRoot: join(runRoot, 'documents') }) };
      case 'e2eFixtureLifetime.js': return { createE2eFixtureLifetime: () => ({ assertCurrent() {} }) };
      case 'reserveLoopbackPort.js': return { reserveLoopbackPort: async () => 12345 };
      case 'removeE2eRunRoot.js': return { removeE2eRunRoot: async () => { events.push('remove-root'); await rm(runRoot, { recursive: true }); } };
      case 'resolveElectronE2eExecutable.js': return { resolveElectronE2eExecutable: () => 'synthetic-never-executed' };
      case 'waitForLoopbackPortRelease.js': return { waitForLoopbackPortRelease: async () => { events.push('port-release'); } };
      case 'readE2eScenarioId.js': return { readE2eScenarioId: () => mode.scenario ?? phaseScenario };
      case 'electronSelectorProfileFixture.js': return { assertElectronSelectorFixtureCombination() {}, prepareElectronSelectorProfile: async () => {} };
      case 'electronSelectorTestRelease.js': return { usesSelectorTestBackend: () => false };
      case 'workspaceDeletionProofProtocol.js': return { isWorkspaceDeletionProofScenario: () => false, isWorkspaceDeletionExecutionProofScenario: () => true };
      case 'electronLaunchBudgets.js': return { ELECTRON_E2E_PROCESS_CONNECT_TIMEOUT_MILLISECONDS: 15000 };
      case 'captureElectronLaunchFailure.js': return { createElectronLaunchFailureCapture: () => ({ observe() {}, captureBackendFailure() {}, finish: () => ({}) }),
        readObservedElectronLaunchExitCode: () => null };
      case 'electronLifecycleProjection.mjs': return { recordElectronEvidenceFailure: (_info, kind) => { events.push(`evidence-${kind}`); } };
      case 'reportElectronPrivateFailure.js': return { captureElectronPrivateCloseFailure: () => ({}),
        reportElectronStartupException: async () => { events.push('original-report'); }, reportElectronCloseFailure: async () => {} };
      case 'reportElectronLifecycleEvidence.js': return { reportElectronLifecycleEvidence: async (_info, value) => {
        events.push('lifecycle-report'); reports.push(value);
      } };
      case 'reportStartupProcessOutput.js': return { reportFixtureProcessOutput: async () => { events.push('process-report'); }, reportStartupProcessOutput: async () => {} };
      case 'startOwnedWindowsElectronBridge.js': return { startOwnedWindowsElectronBridge: () => {
        const current = runtimes.at(-1), application = new EventEmitter();
        application.evaluate = callback => {
          if (String(callback).includes('readPhaseObservation')) {
            phaseReads.push(current.runtimeInstanceId); events.push(`phase-read-${current.runtimeInstanceId}`);
            if (mode.read === 'pending' || mode.read === 'duringClose') return heldRead;
            if (mode.read === 'throw') throw new Error('SYNTHETIC_PHASE_READ');
            if (mode.read === 'reject') return Promise.reject(new Error('SYNTHETIC_PHASE_READ'));
            return Promise.resolve(phaseRaw(mode.read === 'wrong' ? phaseRuntimeIds[2] : current.runtimeInstanceId));
          }
          events.push('original-read'); return Promise.resolve(undefined);
        };
        return { application: Promise.resolve(application), readObservedWorkloadState: () => 'exited',
          readCleanupEvidence: () => ({ owner: { status: 'processTreeAbsent' }, bridge: {} }),
          readStdout: () => '', readStderr: () => '', workload: { readExitCode: () => 0 } };
      } };
      case 'launchElectronRuntime.js': return { launchElectronRuntime: async options => {
        const application = await options.launch();
        options.connected(application, { stdout: { resume() {} }, stderr: { resume() {} } });
        return { electronApp: application, page: { isClosed: () => false } };
      } };
      case 'closeOwnedWindowsElectronRuntime.js': return { closeOwnedWindowsElectronRuntime: async () => {
        events.push('close-start', `close-start-${runtimes.at(-1).runtimeInstanceId}`);
        if (mode.read === 'duringClose') releaseRead(phaseRaw(runtimes.at(-1).runtimeInstanceId));
        await Promise.resolve(); events.push('close-end');
        if (mode.closeFailure) throw new Error('SYNTHETIC_OWNER_CLOSE');
      } };
      default: return new Proxy({}, { get: (_target, key) => () => {
        throw new Error(`UNEXPECTED_PHASE_TEST_PORT:${name}:${String(key)}`);
      } });
    }
  };
  const loaded = await loadPhaseFixture(ports);
  const run = use => {
    const work = loaded.test.e2eElectron({ e2eElectronStartupMode: 'normal', e2eBackendStartupFault: 'none',
      e2eDialogMode: 'accept', e2eNativeOpenDialogMode: 'accept', e2eNativeOpenDialogPurpose: 'invoicePdfArchive',
      e2eWorkspaceBackupFixture: 'none', e2eLegacyInvoiceProfile: 'none', e2eSelectorProfile: 'none' }, use, f.testInfo);
    runs.push(work);
    return work;
  };
  return { ...f, runRoot, events, runtimes, phaseReads, reports, run, releaseRead, readReleased: () => readReleased };
}

test('phase parent source selects the recovery runtime immediately before the confirmation button', { timeout: 5000 }, async () => {
  const ts = phaseRequire('typescript');
  const source = ts.createSourceFile('workspaceDeletionExecution.spec.ts',
    await readFile(new URL('../tests/electron/workspaceDeletionExecution.spec.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
  const selections = [];
  const visit = node => {
    if (ts.isExpressionStatement(node) && ts.isCallExpression(node.expression) &&
        ts.isPropertyAccessExpression(node.expression.expression) &&
        node.expression.expression.name.text === 'selectWorkspaceDeletionObservationRuntime') selections.push(node);
    ts.forEachChild(node, visit);
  };
  visit(source);
  assert.equal(selections.length, 1);
  const selection = selections[0];
  assert.equal(selection.expression.expression.expression.getText(source), 'e2eElectron');
  const statements = selection.parent.statements, next = statements[statements.indexOf(selection) + 1];
  assert.equal(ts.isExpressionStatement(next) && ts.isAwaitExpression(next.expression), true);
  const click = next.expression.expression;
  assert.equal(ts.isCallExpression(click) && ts.isPropertyAccessExpression(click.expression), true);
  assert.equal(click.expression.name.text, 'click');
  const locator = click.expression.expression;
  assert.equal(ts.isCallExpression(locator) && ts.isPropertyAccessExpression(locator.expression), true);
  assert.equal(locator.expression.expression.getText(source), 'e2eElectron.page');
  assert.equal(locator.expression.name.text, 'getByRole');
  assert.equal(locator.arguments[0].text, 'button');
  const name = locator.arguments[1].properties.find(property => property.name?.getText(source) === 'name');
  assert.equal(name.initializer.text, 'Jatka poistovahvistukseen');
});

test('phase parent direct capture reads once without returning a close wait or accepting another runtime', { timeout: 5000 }, async t => {
  const f = await phaseParentFixture(t), selected = phaseRuntimeIds[0];
  let reads = 0, release;
  const pending = new Promise(resolve => { release = resolve; });
  t.after(() => { release(phaseRaw(selected)); });
  const application = { evaluate() { reads++; return pending; } };
  const observation = selectWorkspaceDeletionPhaseObservation({ application, runtimeInstanceId: selected, scenarioId: phaseScenario, testInfo: f.testInfo });
  observation.beginClose({ evaluate() { assert.fail('Wrong application'); } }, selected);
  observation.beginClose(application, phaseRuntimeIds[1]);
  assert.equal(reads, 0);
  assert.equal(observation.beginClose(application, selected), undefined);
  observation.beginClose(application, selected);
  assert.equal(reads, 1);
  assert.equal(await observation.reportFailure(true), 'notRequired');
  release(phaseRaw(selected)); await pending; await Promise.resolve();
  observation.finishClose(application, selected);
  assert.equal(await observation.reportFailure(true), 'recorded');
  assert.equal((await f.evidence()).availability, 'captured');
  f.complete();
});

test('phase parent actual fixture keeps the selected old capture through preparation and final restarts', { timeout: 5000 }, async t => {
  const f = await actualPhaseFixture(t), primary = new Error('SYNTHETIC_BODY_FIRST');
  let selected;
  await assert.rejects(f.run(async harness => {
    await harness.restart(); selected = harness.runtime.runtimeInstanceId;
    harness.selectWorkspaceDeletionObservationRuntime(); await harness.restart(); throw primary;
  }), error => error === primary);
  const evidence = await f.evidence();
  assert.equal(evidence.selection.runtimeInstanceId, selected); assert.equal(evidence.availability, 'captured');
  assert.equal(evidence.selection.testAttempt, 1); assert.equal(evidence.selection.repeatEachIndex, 2);
  assert.deepEqual(f.phaseReads, [selected]); assert.equal(f.runtimes.length, 3);
  const readAt = f.events.indexOf(`phase-read-${selected}`), closeAt = f.events.indexOf(`close-start-${selected}`);
  assert.ok(readAt >= 0 && closeAt > readAt);
  assert.ok(f.events.includes('original-read')); assert.ok(f.events.includes('original-report')); assert.ok(f.events.includes('lifecycle-report'));
  f.complete();
});

for (const read of ['pending', 'throw', 'reject', 'wrong']) {
  test(`phase parent actual fixture ${read} read never holds close or invents an observation`, { timeout: 5000 }, async t => {
    const f = await actualPhaseFixture(t, { read }), primary = new Error('SYNTHETIC_BODY_FIRST');
    await assert.rejects(f.run(async harness => { harness.selectWorkspaceDeletionObservationRuntime(); throw primary; }), error => error === primary);
    assert.equal((await f.evidence()).availability, 'unavailable'); assert.deepEqual(f.phaseReads, [f.runtimes[0].runtimeInstanceId]);
    assert.ok(f.events.includes('close-end')); assert.ok(f.events.includes('port-release'));
    assert.equal(f.readReleased(), false);
    const before = await readFile(f.path);
    f.releaseRead(phaseRaw(f.runtimes[0].runtimeInstanceId)); await Promise.resolve(); await Promise.resolve();
    assert.equal((await readFile(f.path)).equals(before), true); f.complete();
  });
}

for (const read of ['duringClose', 'pending']) {
  test(`phase parent actual fixture freezes ${read} data in close-failure finally and reports cleanup-only failure`, { timeout: 5000 }, async t => {
    const f = await actualPhaseFixture(t, { read, closeFailure: true });
    await assert.rejects(f.run(async harness => { harness.selectWorkspaceDeletionObservationRuntime(); }), /E2E_ELECTRON_CLEANUP_FAILED/u);
    assert.equal((await f.evidence()).availability, read === 'duringClose' ? 'captured' : 'unavailable');
    assert.equal(f.reports[0].cleanup.runtime, 'unverified');
    assert.ok(!f.events.includes('original-read')); assert.ok(f.events.includes('original-report'));
    assert.ok(f.events.includes('lifecycle-report')); assert.ok(!f.events.includes('remove-root'));
    const before = await readFile(f.path);
    f.releaseRead(phaseRaw(f.runtimes[0].runtimeInstanceId)); await Promise.resolve(); await Promise.resolve();
    assert.equal((await readFile(f.path)).equals(before), true); f.complete();
  });
}

test('phase parent actual fixture freezes a pending old read before restart and before final reporting', { timeout: 5000 }, async t => {
  const f = await actualPhaseFixture(t, { read: 'pending' }), primary = new Error('SYNTHETIC_BODY_AFTER_RESTART');
  let selected;
  await assert.rejects(f.run(async harness => {
    harness.selectWorkspaceDeletionObservationRuntime(); selected = harness.runtime.runtimeInstanceId;
    await harness.restart(); assert.notEqual(harness.runtime.runtimeInstanceId, selected);
    assert.ok(!f.events.includes('lifecycle-report')); assert.equal(f.readReleased(), false);
    f.releaseRead(phaseRaw(selected)); await Promise.resolve(); await Promise.resolve(); throw primary;
  }), error => error === primary);
  const evidence = await f.evidence();
  assert.equal(evidence.selection.runtimeInstanceId, selected); assert.equal(evidence.availability, 'unavailable');
  assert.equal('snapshot' in evidence, false); assert.deepEqual(f.phaseReads, [selected]); f.complete();
});

for (const restart of [false, true]) {
  test(`phase parent actual passing fixture reads once before close with restart=${restart} and writes no phase report`, { timeout: 5000 }, async t => {
    const f = await actualPhaseFixture(t);
    await f.run(async harness => { harness.selectWorkspaceDeletionObservationRuntime(); if (restart) await harness.restart(); });
    const selected = f.runtimes[0].runtimeInstanceId;
    assert.deepEqual(f.phaseReads, [selected]); assert.ok(f.events.indexOf(`phase-read-${selected}`) < f.events.indexOf(`close-start-${selected}`));
    await assert.rejects(readFile(f.path), { code: 'ENOENT' }); assert.ok(f.events.includes('remove-root')); f.complete();
  });
}

test('phase parent actual unselected fixture preserves original and lifecycle reporting without phase reads', { timeout: 5000 }, async t => {
  const f = await actualPhaseFixture(t), primary = new Error('SYNTHETIC_UNSELECTED_FAILURE');
  await assert.rejects(f.run(async () => { throw primary; }), error => error === primary);
  assert.deepEqual(f.phaseReads, []); await assert.rejects(readFile(f.path), { code: 'ENOENT' });
  assert.ok(f.events.includes('original-report')); assert.ok(f.events.includes('lifecycle-report')); f.complete();
});

test('phase parent actual fixture delivery collision preserves bytes and separate original and lifecycle reports', { timeout: 5000 }, async t => {
  const f = await actualPhaseFixture(t), before = Buffer.from('SYNTHETIC_COLLISION'), primary = new Error('SYNTHETIC_BODY_FIRST');
  await writeFile(f.path, before, { flag: 'wx' });
  await assert.rejects(f.run(async harness => { harness.selectWorkspaceDeletionObservationRuntime(); throw primary; }), error => error === primary);
  assert.equal((await readFile(f.path)).equals(before), true);
  assert.ok(f.events.includes('original-report')); assert.ok(f.events.includes('lifecycle-report')); assert.ok(f.events.includes('process-report'));
  assert.ok(!f.events.includes('remove-root')); f.complete();
});

for (const otherScenario of [false, true]) {
  test(`phase parent actual fixture cannot replace its selection or enable another scenario=${otherScenario}`, { timeout: 5000 }, async t => {
    const f = await actualPhaseFixture(t, { scenario: otherScenario ? 'DESK-DELETE-UI-001' : phaseScenario });
    await f.run(async harness => {
      if (!otherScenario) harness.selectWorkspaceDeletionObservationRuntime();
      assert.throws(() => harness.selectWorkspaceDeletionObservationRuntime(), /E2E_WORKSPACE_DELETION_OBSERVATION_INVALID/u);
    });
    assert.equal(f.phaseReads.length, otherScenario ? 0 : 1); f.complete();
  });
}
