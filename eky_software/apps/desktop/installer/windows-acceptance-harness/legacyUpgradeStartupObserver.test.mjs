import assert from 'node:assert/strict';
import { appendFile, link, lstat, mkdir, mkdtemp, readFile, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import { readWindowsShortPathFixture } from '../windows-process-supervisor/tests/supervisorContractTestSupport.mjs';
import { deriveLegacySourceUserDataRoot } from './legacyUpgradeProfileEvidence.mjs';
import { executeLegacyCommandPhase } from './legacyCommandPhase.mjs';
import { createLegacyUpgradeWorkerRequest } from './legacyUpgradeContracts.mjs';
import { LEGACY_STARTUP_TERMINAL_FILENAME, projectLegacyStartupTerminalEvidence, readLegacyStartupFailureEvidence,
  startupEvidenceAllowsFixtureRemoval, validateLegacyStartupFailureEvidence } from './legacyStartupFailureEvidence.mjs';
import { projectStartupException, STARTUP_EXCEPTION_CONTROL, STARTUP_EXCEPTION_SUFFIX } from '../../src/main/startupExceptionEvidence.ts';

import {
  captureDesktopLifecycleBaseline,
  readDesktopLifecycleEvents,
  requireTargetShutdownCompleted,
  waitForTargetDesktopStarted,
} from './legacyUpgradeStartupObserver.mjs';

const APP = Object.freeze({ appVersion: '0.2.7', buildRevision: 'a'.repeat(40) });
const RUNTIME = '12345678-1234-4abc-8abc-1234567890ab';

function event(eventName, eventId, overrides = {}) {
  const failure = eventName === 'desktop.bootstrapFailed';
  return {
    schemaVersion: 1,
    component: 'desktop',
    category: 'runtime',
    level: failure ? 'error' : 'info',
    outcome: failure ? 'failure' : 'success',
    eventName,
    eventId,
    runtimeInstanceId: RUNTIME,
    timestamp: '2026-09-04T08:00:00.000Z',
    appVersion: APP.appVersion,
    buildRevision: APP.buildRevision.slice(0, 12),
    ...overrides,
  };
}

async function fixture(t, automaticCleanup = true) {
  const root = await mkdtemp(join(tmpdir(), 'eky-legacy-observer-'));
  if (automaticCleanup) {
    t.after(() => rm(root, { force: true, recursive: true }));
  }
  const logs = resolve(root, 'desktop');
  await mkdir(logs);
  const info = resolve(logs, 'desktop-info-2026-09-001.jsonl');
  const warning = resolve(logs, 'desktop-warning-error-2026-09-001.jsonl');
  await appendFile(
    info,
    `${JSON.stringify(event('desktop.started', '22345678-1234-4abc-8abc-1234567890ab', { runtimeInstanceId: '32345678-1234-4abc-8abc-1234567890ab' }))}\n`,
  );
  await appendFile(warning, '');
  return { info, logs, root, warning };
}

function deferred() {
  let resolvePromise;
  const promise = new Promise((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

test('startup observer resolves from a new matching event without polling', async (t) => {
  const files = await fixture(t);
  const baseline = await captureDesktopLifecycleBaseline(files.logs);
  const child = deferred();
  const waiting = waitForTargetDesktopStarted({
    baselineEventIds: baseline,
    childCompletion: child.promise,
    expectedIdentity: APP,
    logDirectory: files.logs,
  });
  await appendFile(
    files.info,
    `${JSON.stringify(event('desktop.started', '42345678-1234-4abc-8abc-1234567890ab'))}\n`,
  );
  const started = await waiting;
  assert.equal(started.runtimeInstanceId, RUNTIME);
});

test('startup observer accepts the same directory through a Windows 8.3 alias', {
  skip: process.platform !== 'win32',
}, async (t) => {
  const files = await fixture(t, false);
  let verified = false;
  t.after(() => verified ? rm(files.root, { force: true, recursive: true }) : undefined);
  const shortRoot = await readWindowsShortPathFixture(files.root, { directory: files.root });
  assert.notEqual(shortRoot, files.root, 'The fixture must exercise a real 8.3 alias');
  assert.match(shortRoot, /~[0-9]/);
  assert.equal(await realpath(shortRoot), await realpath(files.root));
  const child = deferred();
  const waiting = waitForTargetDesktopStarted({
    baselineEventIds: await captureDesktopLifecycleBaseline(files.logs),
    childCompletion: child.promise,
    expectedIdentity: APP,
    logDirectory: resolve(shortRoot, 'desktop'),
  });
  await appendFile(
    files.info,
    `${JSON.stringify(event('desktop.started', '42345678-1234-4abc-8abc-1234567890ab'))}\n`,
  );
  assert.equal((await waiting).runtimeInstanceId, RUNTIME);
  verified = true;
});

test('startup observer still rejects a directory link before watching its target', async (t) => {
  const files = await fixture(t);
  const linked = resolve(files.root, 'linked');
  await symlink(files.logs, linked, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(waitForTargetDesktopStarted({
    baselineEventIds: [],
    childCompletion: deferred().promise,
    expectedIdentity: APP,
    logDirectory: linked,
  }), /targetOperationalLogInvalid/);
});

test('startup observer fails closed on a matching bootstrap failure', async (t) => {
  const files = await fixture(t);
  const child = deferred();
  const waiting = waitForTargetDesktopStarted({
    baselineEventIds: await captureDesktopLifecycleBaseline(files.logs),
    childCompletion: child.promise,
    expectedIdentity: APP,
    logDirectory: files.logs,
  });
  await appendFile(
    files.warning,
    `${JSON.stringify(event('desktop.bootstrapFailed', '52345678-1234-4abc-8abc-1234567890ab'))}\n`,
  );
  await assert.rejects(waiting, /targetBootstrapFailed/);
});

test('bootstrap projection retains the recorded cause and stage without arbitrary payload', async (t) => {
  const files = await fixture(t);
  await appendFile(files.warning, `${JSON.stringify(event('desktop.bootstrapFailed',
    '52345678-1234-4abc-8abc-1234567890ab', {
      errorCode: 'PROFILE_SNAPSHOT_VALIDATION_FAILED', stage: 'startup',
      message: 'EXCLUDED raw error', token: 'EXCLUDED secret',
    }))}\n`);
  const failure = (await readDesktopLifecycleEvents(files.logs)).find(
    item => item.eventName === 'desktop.bootstrapFailed');
  assert.equal(failure.errorCode, 'PROFILE_SNAPSHOT_VALIDATION_FAILED');
  assert.equal(failure.stage, 'startup');
  assert.equal(failure.causeStatus, 'recorded');
  assert.equal(failure.timestamp, '2026-09-04T08:00:00.000Z');
  assert.equal(JSON.stringify(failure).includes('EXCLUDED'), false);
});

async function failureEvidenceFixture(t, fields = {}) {
  const files = await fixture(t);
  const runNonce = 'b'.repeat(64);
  const logDirectory = resolve(deriveLegacySourceUserDataRoot(files.root, runNonce), 'runtime', 'logs', 'desktop');
  await mkdir(resolve(logDirectory, '..'), { recursive: true });
  await rename(files.logs, logDirectory);
  const warning = resolve(logDirectory, 'desktop-warning-error-2026-09-001.jsonl');
  await appendFile(warning, `${JSON.stringify(event('desktop.bootstrapFailed',
    '52345678-1234-4abc-8abc-1234567890ab', {
      errorCode: 'PROFILE_SNAPSHOT_VALIDATION_FAILED', stage: 'startup', ...fields,
    }))}\n`);
  return { root: files.root, logDirectory, warning, input: { runRoot: files.root,
    artifact: { descriptorSha256: 'c'.repeat(64), target: APP },
    supervisorResult: { runNonce, processTreeAbsent: true } } };
}

test('stopped legacy capture binds cause to the isolated run and expected target runtime', async t => {
  const f = await failureEvidenceFixture(t);
  await appendFile(f.warning, `${JSON.stringify(event('desktop.bootstrapFailed',
    '62345678-1234-4abc-8abc-1234567890ab', { appVersion: '0.2.6',
      errorCode: 'EXCLUDED_SOURCE_CAUSE', stage: 'startup' }))}\n`);
  const evidence = await readLegacyStartupFailureEvidence(f.input);
  assert.equal(evidence.status, 'recorded');
  assert.equal(evidence.scenarioRunNonce, f.input.supervisorResult.runNonce);
  assert.equal(evidence.events.length, 1);
  assert.equal(evidence.events[0].runtimeInstanceId, RUNTIME);
  assert.equal(startupEvidenceAllowsFixtureRemoval(evidence), true);
  assert.equal(JSON.stringify(evidence).includes('EXCLUDED'), false);
  const notOwned = await readLegacyStartupFailureEvidence({ ...f.input,
    supervisorResult: { ...f.input.supervisorResult, processTreeAbsent: false } });
  assert.equal(notOwned.status, 'unverified');
  assert.deepEqual(notOwned.events, []);
  assert.equal(startupEvidenceAllowsFixtureRemoval(notOwned), false);
});

test('absent or malformed causes remain unavailable and retain the original fixture', async t => {
  for (const fields of [{ errorCode: undefined }, { stage: undefined }, { errorCode: 'private path C:\\Users\\example' },
    { errorCode: ['DESKTOP_START_FAILED'] }, { stage: 'EXCLUDED arbitrary stage' }]) {
    const f = await failureEvidenceFixture(t, fields);
    const evidence = await readLegacyStartupFailureEvidence(f.input);
    assert.equal(evidence.status, 'recorded');
    assert.notEqual(evidence.events[0].causeStatus, 'recorded');
    assert.equal(startupEvidenceAllowsFixtureRemoval(evidence), false);
    assert.equal(JSON.stringify(evidence).includes('EXCLUDED'), false);
  }
});

test('static capture rejects linked logs, missing logs and a substituted run identity', async t => {
  const f = await failureEvidenceFixture(t);
  const missing = await readLegacyStartupFailureEvidence({ ...f.input,
    supervisorResult: { ...f.input.supervisorResult, runNonce: 'd'.repeat(64) } });
  assert.equal(missing.status, 'missing');
  assert.equal(startupEvidenceAllowsFixtureRemoval(missing), false);
  await link(f.warning, resolve(f.root, 'linked-log.jsonl'));
  const linked = await readLegacyStartupFailureEvidence(f.input);
  assert.equal(linked.status, 'unverified');
  assert.equal(startupEvidenceAllowsFixtureRemoval(linked), false);
});

test('stopped capture never treats an incomplete final record or empty log directory as absence of failure', async t => {
  const partial = await failureEvidenceFixture(t);
  await writeFile(partial.warning, JSON.stringify(event('desktop.bootstrapFailed',
    '52345678-1234-4abc-8abc-1234567890ab', { errorCode: 'DESKTOP_START_FAILED', stage: 'startup' })));
  const partialEvidence = await readLegacyStartupFailureEvidence(partial.input);
  assert.equal(partialEvidence.status, 'unverified');
  assert.equal(startupEvidenceAllowsFixtureRemoval(partialEvidence), false);
  const empty = await failureEvidenceFixture(t);
  await rm(empty.logDirectory, { recursive: true });
  await mkdir(empty.logDirectory);
  assert.equal((await readLegacyStartupFailureEvidence(empty.input)).status, 'unverified');
});

test('encrypted terminal projection rejects extra fields, mismatched binding and malformed events', async t => {
  const f = await failureEvidenceFixture(t);
  const evidence = await readLegacyStartupFailureEvidence(f.input);
  const binding = { schemaVersion: 1, scenario: 'acceptanceCommandPhase', runNonce: 'd'.repeat(64),
    artifactDescriptorSha256: f.input.artifact.descriptorSha256 };
  const saved = { binding, startupEvidence: evidence, outcome: { errorCode: 'EXCLUDED terminal details' } };
  assert.deepEqual(projectLegacyStartupTerminalEvidence(saved), { binding, startupEvidence: evidence });
  for (const modified of [{ ...saved, request: {} }, { ...saved, binding: { ...binding, runNonce: [binding.runNonce] } },
    { ...saved, binding: { ...binding, artifactDescriptorSha256: 'e'.repeat(64) } }]) {
    assert.throws(() => projectLegacyStartupTerminalEvidence(modified), /legacyStartupEvidenceInvalid/);
  }
  for (const eventChange of [{ rawError: 'EXCLUDED' }, { runtimeInstanceId: [RUNTIME] },
    { buildRevision: 'f'.repeat(12) }, { causeStatus: 'missing' }]) {
    assert.throws(() => validateLegacyStartupFailureEvidence({ ...evidence,
      events: [{ ...evidence.events[0], ...eventChange }] }), /legacyStartupEvidenceInvalid/);
  }
});

async function cleanupContext(t, f) {
  const request = createLegacyUpgradeWorkerRequest({ runNonce: f.input.supervisorResult.runNonce,
    artifactDescriptorSha256: f.input.artifact.descriptorSha256, fixtureRoot: resolve(f.root, 'fixture') });
  await mkdir(resolve(f.root, 'scenario'));
  await writeFile(resolve(f.root, 'scenario', 'worker-request.json'), JSON.stringify(request));
  const commandRoot = await mkdtemp(join(tmpdir(), 'eky-acceptance-command-'));
  t.after(() => rm(commandRoot, { force: true, recursive: true }));
  const phaseRoot = resolve(commandRoot, 'fixtureCleanup');
  await mkdir(phaseRoot);
  const absent = { status: 'completed', resultCleanup: 'completed', state: Buffer.from(JSON.stringify({
    schemaVersion: 1, productState: -1, productName: null, productVersion: null, localPackagePresent: false,
    ownedRegistryExists: false, ekyProcessCount: 0,
  })).toString('base64') };
  return { phase: 'fixtureCleanup', phaseRoot,
    binding: { schemaVersion: 1, runNonce: 'd'.repeat(64), scenario: 'acceptanceCommandPhase',
      artifactDescriptorSha256: request.artifactDescriptorSha256 },
    state: { runRoot: f.root, artifact: f.input.artifact, products: Object.fromEntries(
      ['Source', 'Target'].flatMap(role => ['Before', 'After'].map(suffix => [`inspect${role}${suffix}`, absent]))),
      safetyErrorCode: null, fixtureRemoved: false, fixtureCleanupResultCode: 'retainedUnverified' },
    reports: { scenario: { ...f.input.supervisorResult, status: 'failed', processResultCode: 'deadlineExceeded',
      workerResultCode: 'notChecked', cleanupResultCode: 'processTreeAbsent' } } };
}

test('actual fixture cleanup preserves the cause in its existing terminal write before removing the profile', async t => {
  const f = await failureEvidenceFixture(t);
  const context = await cleanupContext(t, f);
  const { phaseRoot } = context;
  await executeLegacyCommandPhase(context, { filesystem: async ({ operation, payload }) => {
    assert.equal(operation, 'remove');
    assert.equal((await readFile(resolve(phaseRoot, LEGACY_STARTUP_TERMINAL_FILENAME), 'utf8')).includes('PROFILE_SNAPSHOT_VALIDATION_FAILED'), true);
    await rm(payload.root, { recursive: true });
  } });
  const saved = JSON.parse(await readFile(resolve(phaseRoot, LEGACY_STARTUP_TERMINAL_FILENAME), 'utf8'));
  assert.equal(saved.outcome.errorCode, 'WINDOWS_ACCEPTANCE_SUPERVISOR_DEADLINE_EXCEEDED');
  assert.equal(saved.startupEvidence.events[0].errorCode, 'PROFILE_SNAPSHOT_VALIDATION_FAILED');
  assert.equal(context.state.fixtureRemoved, true);
  await assert.rejects(lstat(f.root), { code: 'ENOENT' });
});

test('actual fixture cleanup retains the profile when the cause is unavailable or terminal delivery fails', async t => {
  const unavailable = await failureEvidenceFixture(t, { errorCode: undefined });
  const context = await cleanupContext(t, unavailable);
  await executeLegacyCommandPhase(context, { filesystem: async () => assert.fail('unverified fixture removal') });
  const saved = JSON.parse(await readFile(resolve(context.phaseRoot, LEGACY_STARTUP_TERMINAL_FILENAME), 'utf8'));
  assert.equal(saved.outcome.errorCode, 'WINDOWS_ACCEPTANCE_SUPERVISOR_DEADLINE_EXCEEDED');
  assert.equal(saved.startupEvidence.events[0].causeStatus, 'missing');
  assert.equal(context.state.fixtureRemoved, false);
  assert.equal(context.state.fixtureCleanupResultCode, 'retainedUnverified');
  assert.equal((await lstat(unavailable.root)).isDirectory(), true);
  const blocked = await failureEvidenceFixture(t);
  const blockedContext = await cleanupContext(t, blocked);
  await writeFile(resolve(blockedContext.phaseRoot, LEGACY_STARTUP_TERMINAL_FILENAME), 'existing evidence');
  await assert.rejects(executeLegacyCommandPhase(blockedContext,
    { filesystem: async () => assert.fail('fixture removal before delivery') }));
  assert.equal(blockedContext.state.fixtureRemoved, false);
  assert.equal((await lstat(blocked.root)).isDirectory(), true);
});

test('actual fixture cleanup preserves the original exception before removing its synthetic profile', async t => {
  const f = await failureEvidenceFixture(t);
  const context = await cleanupContext(t, f);
  const resultRoot = resolve(deriveLegacySourceUserDataRoot(f.root, f.input.supervisorResult.runNonce), '..', 'result');
  await mkdir(resultRoot);
  await writeFile(resolve(resultRoot, STARTUP_EXCEPTION_CONTROL), JSON.stringify({ schemaVersion: 1,
    scenarioRunNonce: f.input.supervisorResult.runNonce, ...APP }));
  const record = projectStartupException(new Error('synthetic first original failure', { cause: new Error('synthetic cause') }),
    { scenarioRunNonce: f.input.supervisorResult.runNonce, ...APP, runtimeInstanceId: RUNTIME }, 'compositionStartup');
  await writeFile(resolve(resultRoot, `${RUNTIME}${STARTUP_EXCEPTION_SUFFIX}`), JSON.stringify(record));
  await executeLegacyCommandPhase(context, { filesystem: async ({ operation, payload }) => {
    assert.equal(operation, 'remove');
    const saved = JSON.parse(await readFile(resolve(context.phaseRoot, LEGACY_STARTUP_TERMINAL_FILENAME), 'utf8'));
    assert.equal(saved.originalExceptionEvidence.status, 'recorded');
    assert.equal(saved.originalExceptionEvidence.exceptions[0].chain[0].message === 'synthetic first original failure', true);
    await rm(payload.root, { recursive: true });
  } });
  assert.equal(context.state.fixtureRemoved, true);
  const saved = JSON.parse(await readFile(resolve(context.phaseRoot, LEGACY_STARTUP_TERMINAL_FILENAME), 'utf8'));
  assert.equal(projectLegacyStartupTerminalEvidence(saved).originalExceptionEvidence.exceptions[0].chain.length, 2);
});

test('startup observer rejects a process exit without readiness', async (t) => {
  const files = await fixture(t);
  const child = deferred();
  const waiting = waitForTargetDesktopStarted({
    baselineEventIds: await captureDesktopLifecycleBaseline(files.logs),
    childCompletion: child.promise,
    expectedIdentity: APP,
    logDirectory: files.logs,
  });
  child.resolve({ exitCode: 1 });
  await assert.rejects(waiting, /targetApplicationExitedEarly/);
});

test('shutdown proof is bound to the same runtime generation', async (t) => {
  const files = await fixture(t);
  const baseline = await captureDesktopLifecycleBaseline(files.logs);
  await appendFile(
    files.info,
    `${JSON.stringify(event('desktop.started', '62345678-1234-4abc-8abc-1234567890ab'))}\n${JSON.stringify(event('desktop.shutdownCompleted', '72345678-1234-4abc-8abc-1234567890ab'))}\n`,
  );
  await assert.doesNotReject(
    requireTargetShutdownCompleted({
      baselineEventIds: baseline,
      expectedIdentity: APP,
      logDirectory: files.logs,
      runtimeInstanceId: RUNTIME,
    }),
  );
});
