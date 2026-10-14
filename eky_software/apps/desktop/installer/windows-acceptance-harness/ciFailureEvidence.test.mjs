import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { link, mkdir, mkdtemp, open, readFile, readdir, realpath, rm, symlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { gunzipSync } from 'node:zlib';
import { collectJobFailureEvidence, evidenceSourceKind, jobEvidenceBinding, jobEvidenceGit } from './ciFailureEvidence.mjs';
import { projectPlaywrightFailureReport } from './playwrightFailureReport.mjs';
import { LEGACY_STARTUP_TERMINAL_FILENAME } from './legacyStartupFailureEvidence.mjs';
import { W6B2_INSTALLER_LOG_FILE, W6B2_INSTALLER_LOG_RECEIPT } from '../../src/main/w6b2PackagedInstallerLog.ts';
import { projectStartupException, STARTUP_EXCEPTION_CONTROL, STARTUP_EXCEPTION_SUFFIX } from '../../src/main/startupExceptionEvidence.ts';
import { executeCleanInstallUninstallLifecycle } from './cleanInstallUninstallLifecycle.mjs';
import { executeUpgradeRollbackLifecycle } from './upgradeRollbackLifecycle.mjs';
import { executeLegacyUpgradeLifecycle } from './legacyUpgradeLifecycle.mjs';
import { executeWorkspaceSuccessLifecycle } from './workspaceSuccessLifecycle.mjs';
import { executeWorkspaceFaultLifecycle } from './workspaceFaultLifecycle.mjs';
import { createRunnerFailureSink } from '../../../../test-reporters/runnerFailureEvidence.mjs';
import { msiWindowEvidenceContract, validateMsiWindowEvidence } from './msiWindowEvidence.mjs';

const run = 'run-aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const fingerprint = 'A'.repeat(40);
const nativeId = 'a'.repeat(32);

for (const [family, execute] of [
  ['clean', executeCleanInstallUninstallLifecycle], ['upgrade', executeUpgradeRollbackLifecycle],
  ['legacy', executeLegacyUpgradeLifecycle], ['workspace', executeWorkspaceSuccessLifecycle],
  ['workspaceFault', runtime => executeWorkspaceFaultLifecycle('preUpdateRecoveryPointFailure', runtime)],
]) {
  test(`${family} preserves the original before safe-code mapping without making evidence mandatory`, async () => {
    const original = new Error('synthetic native original', { cause: new Error('synthetic native cause') });
    const observations = [];
    const input = { inspectState: async () => { throw original; },
      observeFailure(error, phase) { observations.push({ error, phase }); throw new Error('synthetic observer failure'); } };
    const observed = await execute(input);
    const baseline = await execute({ ...input, observeFailure: undefined });
    assert.deepEqual(observed, baseline);
    assert.equal(observed.status, 'failed');
    assert.equal(observations[0].error, original);
    assert.equal(observations[0].phase, 'preflight');
    assert.equal(JSON.stringify(observed).includes('synthetic native'), false);
  });
}

test('only matching hosted Windows or Linux contexts select their native Git', () => {
  for (const [platform, runner, git] of [['win32', 'Windows', 'git.exe'], ['linux', 'Linux', 'git']]) {
    const env = { RUNNER_OS: runner, RUNNER_ENVIRONMENT: 'github-hosted', GITHUB_ACTIONS: 'true',
      GITHUB_EVENT_NAME: 'workflow_dispatch' };
    assert.equal(jobEvidenceGit(env, platform), git);
    for (const patch of [{ RUNNER_OS: 'macOS' }, { RUNNER_OS: runner === 'Linux' ? 'Windows' : 'Linux' },
      { RUNNER_ENVIRONMENT: 'self-hosted' }, { GITHUB_ACTIONS: 'false' },
      { GITHUB_EVENT_NAME: 'pull_request_target' }, { GITHUB_EVENT_NAME: '' }]) {
      assert.throws(() => jobEvidenceGit({ ...env, ...patch }, platform), /CI_FAILURE_EVIDENCE_UNVERIFIED/u);
    }
    assert.throws(() => jobEvidenceGit(env, 'darwin'), /CI_FAILURE_EVIDENCE_UNVERIFIED/u);
  }
});
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'eky-evidence-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const temp = join(root, 'temporary');
  const checkout = join(root, 'checkout');
  await mkdir(temp); await mkdir(checkout);
  const env = { RUNNER_TEMP: temp, GITHUB_WORKSPACE: checkout,
    GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '1', GITHUB_JOB: 'electron',
    EKY_EVIDENCE_JOB_KEY: 'core-electron-0', GITHUB_SHA: 'a'.repeat(40),
    EKY_EVIDENCE_JOB_OUTCOME: 'failure',
    EKY_DIAGNOSTIC_PUBLIC_KEY: '-----BEGIN PGP PUBLIC KEY BLOCK-----\nTEST\n-----END PGP PUBLIC KEY BLOCK-----',
    EKY_DIAGNOSTIC_KEY_FINGERPRINT: fingerprint, EKY_DIAGNOSTIC_VERIFIED_FINGERPRINT: fingerprint };
  const put = async (base, path, content) => {
    const destination = join(base, ...path.split('/'));
    await mkdir(join(destination, '..'), { recursive: true });
    await writeFile(destination, content);
    return destination;
  };
  return { root, temp, checkout, env, put };
}

test('MSI window records require the exact job and adjacent request without collecting the request', async t => {
  const { temp, env, put } = await fixture(t);
  const prefix = `eky-acceptance-command-${nativeId}/scenario`;
  const path = `${prefix}/msi-window-001.private.json`;
  const binding = { kind: 'github', runId: env.GITHUB_RUN_ID, attempt: env.GITHUB_RUN_ATTEMPT,
    job: env.GITHUB_JOB, sourceRevision: env.GITHUB_SHA };
  const record = { schemaVersion: 1, operation: 'msiWindowObservation', binding,
    runNonce: 'b'.repeat(64), scenario: 'packagedWorkspaceSuccess', artifactDescriptorSha256: 'c'.repeat(64),
    sequence: 1, elapsedMs: 123, clients: [{ processId: 1234, status: 'observed',
      windows: [{ role: 'message', text: 'SYNTHETIC WAIT', enabled: true }] }] };
  const request = { schemaVersion: 1, runNonce: record.runNonce, scenario: record.scenario,
    artifactDescriptorSha256: record.artifactDescriptorSha256, workingDirectory: join(temp, ...prefix.split('/')),
    command: 'EXCLUDED COMMAND', arguments: ['EXCLUDED ARGUMENT'] };
  const requestPath = await put(temp, `${prefix}/request.json`, JSON.stringify(request));
  const recordPath = await put(temp, path, JSON.stringify(record));
  await put(temp, path + '.pending', 'EXCLUDED INCOMPLETE');
  for (const patch of [null, { runNonce: 'd'.repeat(64) }, { scenario: 'historicalLegacyUpgrade' },
    { artifactDescriptorSha256: 'd'.repeat(64) }, { workingDirectory: temp }]) {
    await writeFile(requestPath, JSON.stringify({ ...request, ...patch }));
    const result = await collectJobFailureEvidence(env);
    const archived = JSON.parse(gunzipSync(await readFile(result.archivePath)));
    assert.equal(archived.manifest.files.length, 1);
    const entry = archived.manifest.files[0];
    assert.equal(entry.kind, 'msiWindowObservation');
    assert.equal(entry.status, patch ? 'unverified' : 'retained');
    assert.equal(Object.hasOwn(archived.files, entry.name), patch === null);
    assert.equal(JSON.stringify(archived).includes('EXCLUDED'), false);
  }
  for (const patch of [
    { binding: { ...binding, kind: 'local' } }, { binding: { ...binding, attempt: '2' } },
    { binding: { ...binding, sourceRevision: 'd'.repeat(40) } }, { sequence: 2 }, { extra: 'unknown' },
    { clients: [{ ...record.clients[0], windows: [{ role: 'edit', text: 'unknown', enabled: true }] }] },
    { clients: [{ ...record.clients[0], windows: [{ role: 'message', text: 'x'.repeat(msiWindowEvidenceContract.maximumTextCharacters + 1), enabled: true }] }] },
    { clients: [{ ...record.clients[0], status: 'unavailable' }] },
  ]) assert.throws(() => validateMsiWindowEvidence({ ...record, ...patch }, jobEvidenceBinding(env), path), /MSI_WINDOW_EVIDENCE_INVALID/);
  const withApplication = { ...record, schemaVersion: 2, clients: [{ ...record.clients[0],
    windows: [{ role: 'application', text: 'SYNTHETIC HOLDER', enabled: true }] }] };
  assert.equal(validateMsiWindowEvidence(withApplication, jobEvidenceBinding(env), path), withApplication);
  for (const schemaVersion of [1, 3]) assert.throws(() => validateMsiWindowEvidence(
    { ...withApplication, schemaVersion }, jobEvidenceBinding(env), path), /MSI_WINDOW_EVIDENCE_INVALID/);
  await writeFile(requestPath, JSON.stringify(request));
  await writeFile(recordPath, JSON.stringify(record).slice(0, -1));
  const interrupted = await collectJobFailureEvidence(env);
  assert.equal(interrupted.manifest.files[0].status, 'unverified');
  const partialArchive = JSON.parse(gunzipSync(await readFile(interrupted.archivePath)));
  assert.equal(Object.keys(partialArchive.files).length, 0);
  await writeFile(recordPath, Buffer.alloc(msiWindowEvidenceContract.maximumBytes + 1, 0x20));
  const oversized = await collectJobFailureEvidence(env);
  assert.equal(oversized.manifest.files[0].status, 'tooLarge');
  for (const forbidden of [path + '.pending', path.replace('/scenario/', '/prepare/'),
    path.replace('msi-window-001', 'msi-window-0001'), path.replace('msi-window-001', 'other')])
    assert.equal(evidenceSourceKind('temporary', forbidden), null);
});

for (const location of ['runnerTemp', 'nativeTemp', 'sharedTemp']) {
  test(`MSI window binding accepts only the configured temporary parent alias: ${location}`, async t => {
    const { root, temp, env, put } = await fixture(t);
    const base = await realpath(temp);
    const alias = join(root, 'configured-alias');
    const foreignAlias = join(root, 'unconfigured-alias');
    const linkType = process.platform === 'win32' ? 'junction' : 'dir';
    await symlink(base, alias, linkType);
    await symlink(base, foreignAlias, linkType);
    const runner = join(root, 'runner');
    await mkdir(runner);
    const collectionEnv = { ...env, RUNNER_TEMP: location === 'runnerTemp' ? alias : location === 'nativeTemp' ? runner : base };
    const options = location === 'runnerTemp' ? {} : { nativeTemp: alias };
    const prefix = `eky-acceptance-command-${nativeId}/scenario`;
    const phaseRoot = join(base, ...prefix.split('/'));
    const foreignPhaseRoot = join(runner, ...prefix.split('/'));
    await mkdir(foreignPhaseRoot, { recursive: true });
    const record = { schemaVersion: 1, operation: 'msiWindowObservation',
      binding: { kind: 'github', runId: env.GITHUB_RUN_ID, attempt: env.GITHUB_RUN_ATTEMPT,
        job: env.GITHUB_JOB, sourceRevision: env.GITHUB_SHA },
      runNonce: 'b'.repeat(64), scenario: 'packagedWorkspaceSuccess', artifactDescriptorSha256: 'c'.repeat(64),
      sequence: 1, elapsedMs: 123, clients: [] };
    const request = { schemaVersion: 1, runNonce: record.runNonce, scenario: record.scenario,
      artifactDescriptorSha256: record.artifactDescriptorSha256,
      workingDirectory: join(alias, ...prefix.split('/')), command: 'EXCLUDED COMMAND', arguments: ['EXCLUDED ARGUMENT'] };
    const requestPath = await put(base, `${prefix}/request.json`, JSON.stringify(request));
    await put(base, `${prefix}/msi-window-001.private.json`, JSON.stringify(record));
    await symlink(phaseRoot, join(base, `eky-acceptance-command-${nativeId}`, 'phase-alias'), linkType);
    await symlink(join(base, `eky-acceptance-command-${nativeId}`),
      join(base, `eky-acceptance-command-${'d'.repeat(32)}`), linkType);
    const sibling = join(base, `eky-acceptance-command-${'e'.repeat(32)}`, 'scenario');
    await mkdir(sibling, { recursive: true });
    assert.notEqual(request.workingDirectory, phaseRoot);
    assert.equal(await realpath(request.workingDirectory), phaseRoot);
    for (const [label, patch, accepted] of [
      ['configured alias', {}, true],
      ['canonical parent', { workingDirectory: phaseRoot }, true],
      ['unconfigured parent alias', { workingDirectory: join(foreignAlias, ...prefix.split('/')) }, false],
      ['linked phase', { workingDirectory: join(alias, `eky-acceptance-command-${nativeId}`, 'phase-alias') }, false],
      ['linked command', { workingDirectory: join(alias, `eky-acceptance-command-${'d'.repeat(32)}`, 'scenario') }, false],
      ['sibling command', { workingDirectory: sibling }, false],
      ['foreign source with matching suffix', { workingDirectory: foreignPhaseRoot }, false],
      ['changed nonce', { runNonce: 'd'.repeat(64) }, false],
      ['changed scenario', { scenario: 'historicalLegacyUpgrade' }, false],
      ['changed descriptor', { artifactDescriptorSha256: 'd'.repeat(64) }, false],
    ]) {
      await writeFile(requestPath, JSON.stringify({ ...request, ...patch }));
      const collected = await collectJobFailureEvidence(collectionEnv, options);
      const archive = JSON.parse(gunzipSync(await readFile(collected.archivePath)));
      assert.equal(archive.manifest.files.length, 1, label);
      const entry = archive.manifest.files[0];
      assert.equal(entry.status, accepted ? 'retained' : 'unverified', label);
      assert.equal(entry.location, location === 'nativeTemp' ? 'nativeTemp' : 'runnerTemp', label);
      assert.equal(Object.keys(archive.files).length, accepted ? 1 : 0, label);
      if (accepted) assert.deepEqual(JSON.parse(Buffer.from(archive.files[entry.name], 'base64')), record);
      assert.equal(JSON.stringify(archive).includes('EXCLUDED'), false, label);
    }
    await writeFile(requestPath, JSON.stringify(request));
    await link(requestPath, join(root, 'linked-request.json'));
    const linked = await collectJobFailureEvidence(collectionEnv, options);
    const archive = JSON.parse(gunzipSync(await readFile(linked.archivePath)));
    assert.equal(archive.manifest.files[0].status, 'unverified');
    assert.deepEqual(archive.files, {});
  });
}

test('MSI wait evidence precedes newer repetitive supervisor receipts at source quota', async t => {
  const { temp, env, put } = await fixture(t);
  const prefix = `eky-acceptance-command-${nativeId}/scenario`;
  const record = { schemaVersion: 1, operation: 'msiWindowObservation',
    binding: { kind: 'github', runId: env.GITHUB_RUN_ID, attempt: env.GITHUB_RUN_ATTEMPT,
      job: env.GITHUB_JOB, sourceRevision: env.GITHUB_SHA },
    runNonce: 'b'.repeat(64), scenario: 'packagedWorkspaceSuccess', artifactDescriptorSha256: 'c'.repeat(64),
    sequence: 1, elapsedMs: 123, clients: [] };
  await put(temp, `${prefix}/request.json`, JSON.stringify({ schemaVersion: 1,
    runNonce: record.runNonce, scenario: record.scenario, artifactDescriptorSha256: record.artifactDescriptorSha256,
    workingDirectory: join(temp, ...prefix.split('/')) }));
  await put(temp, `${prefix}/msi-window-001.private.json`, JSON.stringify(record));
  for (let index = 0; index < 140; index++) await put(temp, `eky supervisor q${index}/result.json`, '{}');
  const result = await collectJobFailureEvidence(env);
  assert.equal(result.manifest.sources.find(item => item.area === 'temporary').status, 'limited');
  assert.equal(result.manifest.files[0].kind, 'msiWindowObservation');
  assert.equal(result.manifest.files[0].status, 'retained');
});

test('MSI and nested original evidence precede receipts across competing command roots', async t => {
  const { temp, env, put } = await fixture(t);
  const prefix = `eky-acceptance-command-${nativeId}/scenario`;
  const record = { schemaVersion: 1, operation: 'msiWindowObservation',
    binding: { kind: 'github', runId: env.GITHUB_RUN_ID, attempt: env.GITHUB_RUN_ATTEMPT,
      job: env.GITHUB_JOB, sourceRevision: env.GITHUB_SHA },
    runNonce: 'b'.repeat(64), scenario: 'packagedWorkspaceSuccess', artifactDescriptorSha256: 'c'.repeat(64),
    sequence: 1, elapsedMs: 123, clients: [] };
  await put(temp, `${prefix}/request.json`, JSON.stringify({ schemaVersion: 1,
    runNonce: record.runNonce, scenario: record.scenario, artifactDescriptorSha256: record.artifactDescriptorSha256,
    workingDirectory: join(temp, ...prefix.split('/')) }));
  await put(temp, `${prefix}/msi-window-001.private.json`, JSON.stringify(record));
  const nested = join(temp, 'eky supervisor nested', 'temporary');
  await mkdir(nested, { recursive: true });
  const sink = createRunnerFailureSink({ tempRoot: nested, env: { ...env, GITHUB_ACTIONS: 'true' } });
  sink.record({ runner: 'node', phase: 'testFailure', testName: 'nested', attempt: 0, error: new Error('SYNTHETIC NESTED FIRST') });
  await sink.flush();
  for (let index = 1; index <= 140; index++) {
    const command = `eky-acceptance-command-${index.toString(16).padStart(32, '0')}`;
    await put(temp, `${command}/scenario/result.json`, '{}');
    const newest = new Date(Date.now() + 60_000);
    await utimes(join(temp, command), newest, newest);
  }
  const result = await collectJobFailureEvidence(env);
  assert.equal(result.manifest.sources.find(item => item.area === 'temporary').status, 'limited');
  assert.deepEqual(result.manifest.files.slice(0, 3).map(item => [item.kind, item.status]),
    [['runnerFailure', 'retained'], ['runnerFailure', 'retained'], ['msiWindowObservation', 'retained']]);
  const archive = JSON.parse(gunzipSync(await readFile(result.archivePath)));
  const original = JSON.parse(Buffer.from(archive.files[result.manifest.files[1].name], 'base64'));
  assert.equal(original.exception.chain[0].message, 'SYNTHETIC NESTED FIRST');
});

test('slow discovery leaves time to retain the already discovered first error', async t => {
  const { temp, env, put } = await fixture(t);
  const sink = createRunnerFailureSink({ tempRoot: temp, env: { ...env, GITHUB_ACTIONS: 'true' } });
  sink.record({ runner: 'node', phase: 'testFailure', testName: 'discovery', attempt: 0,
    error: new Error('SYNTHETIC FIRST BEFORE SLOW DISCOVERY') });
  await sink.flush();
  const first = (await readdir(temp)).find(name => name.startsWith('eky-test-errors-'));
  const newest = new Date(Date.now() + 60_000);
  await utimes(join(temp, first), newest, newest);
  for (let index = 1; index <= 100; index++) await put(temp, `eky supervisor slow/${index}-target.log`, 'synthetic later data');
  let time = 0;
  const result = await collectJobFailureEvidence(env, { now: () => (time += 50) });
  const source = result.manifest.sources.find(item => item.area === 'temporary');
  assert.equal(source.status, 'limited');
  assert.ok(source.examinedEntries < 100);
  assert.deepEqual(result.manifest.files.map(item => [item.kind, item.status]),
    [['runnerFailure', 'retained'], ['runnerFailure', 'retained']]);
  const archive = JSON.parse(gunzipSync(await readFile(result.archivePath)));
  const original = JSON.parse(Buffer.from(archive.files[result.manifest.files[1].name], 'base64'));
  assert.equal(original.exception.chain[0].message, 'SYNTHETIC FIRST BEFORE SLOW DISCOVERY');
});

test('runner originals and delivery summaries require the current job, revision and invocation', async t => {
  const { temp, env } = await fixture(t);
  const sink = createRunnerFailureSink({ tempRoot: temp, env: { ...env, GITHUB_ACTIONS: 'true' } });
  sink.record({ runner: 'vitest', phase: 'testFailure', testName: 'synthetic', attempt: 0,
    error: new Error('synthetic runner original', { cause: new Error('synthetic runner cause') }) });
  assert.equal((await sink.flush()).status, 'recorded');
  const directory = join(temp, (await readdir(temp)).find(name => name.startsWith('eky-test-errors-')));
  const path = join(directory, (await readdir(directory)).find(name => !name.endsWith('.summary.private.json')));
  const record = JSON.parse(await readFile(path, 'utf8'));
  for (const patch of [null, { binding: { ...record.binding, jobKeySource: 'githubJob', jobKey: env.GITHUB_JOB } },
    { binding: { kind: 'local' } }, { binding: { ...record.binding, runId: '456' } },
    { binding: { ...record.binding, attempt: '2' } }, { binding: { ...record.binding, job: 'other' } },
    { binding: { ...record.binding, jobKey: 'other' } }, { binding: { ...record.binding, sourceRevision: 'b'.repeat(40) } },
    { invocationId: '12345678-1234-4abc-8abc-1234567890ab' }, { extra: 'EXCLUDED' }]) {
    await writeFile(path, JSON.stringify({ ...record, ...patch }));
    const collected = await collectJobFailureEvidence(env);
    const archive = JSON.parse(gunzipSync(await readFile(collected.archivePath)));
    const entries = archive.manifest.files.filter(file => file.kind === 'runnerFailure');
    assert.equal(entries.length, 2);
    const summary = entries.find(file => file.source.endsWith('.summary.private.json'));
    assert.equal(summary.status, 'retained');
    assert.equal(summary.deliveryStatus, 'recorded');
    const entry = entries.find(file => file !== summary);
    const expected = patch === null || patch.binding?.jobKeySource === 'githubJob';
    assert.equal(entry.status, expected ? 'retained' : 'unverified');
    assert.equal(Object.hasOwn(archive.files, entry.name), expected);
  }
});

test('runner collection retains its first error and summary before the per-source file quota', async t => {
  const { temp, env } = await fixture(t);
  const sink = createRunnerFailureSink({ tempRoot: temp, env: { ...env, GITHUB_ACTIONS: 'true' } });
  for (let index = 0; index < 128; index++) {
    sink.record({ runner: 'node', phase: 'testFailure', testName: `synthetic-${index}`, attempt: 0,
      error: new Error(index === 0 ? 'synthetic first original' : 'synthetic later original') });
  }
  assert.equal((await sink.flush()).status, 'recorded');
  const collected = await collectJobFailureEvidence(env);
  const archive = JSON.parse(gunzipSync(await readFile(collected.archivePath)));
  const entries = archive.manifest.files.filter(file => file.kind === 'runnerFailure');
  const source = archive.manifest.sources.find(value => value.area === 'temporary');
  assert.equal(source.status, 'limited');
  assert.equal(entries.length, source.fileLimit);
  assert.ok(entries.every(entry => entry.status === 'retained'));
  const records = entries.map(entry => JSON.parse(Buffer.from(archive.files[entry.name], 'base64')));
  assert.equal(records[0].kind, 'runnerFailureSummary');
  assert.equal(records[0].observed, 128);
  assert.equal(records[1].sequence, 1);
  assert.equal(records[1].exception.chain[0].message, 'synthetic first original');
  assert.equal(records.some(record => record.sequence === 128), false);
  const originalDirectory = join(temp, (await readdir(temp)).find(name => name.startsWith('eky-test-errors-')));
  assert.equal((await readdir(originalDirectory)).length, 129);
});

test('packaged originals require their exact control, runtime and current source binding', async t => {
  const { temp, env, put } = await fixture(t);
  const runtimeInstanceId = '12345678-1234-4abc-8abc-1234567890ab';
  const binding = { scenarioRunNonce: 'b'.repeat(64), appVersion: '0.2.81',
    buildRevision: env.GITHUB_SHA, runtimeInstanceId };
  const prefix = `eky-desktop-smoke/${binding.scenarioRunNonce.slice(0, 32)}/result`;
  const control = { schemaVersion: 1, scenarioRunNonce: binding.scenarioRunNonce,
    appVersion: binding.appVersion, buildRevision: binding.buildRevision };
  const record = projectStartupException(new Error('synthetic original', { cause: new Error('synthetic cause') }),
    binding, 'packagedSmoke');
  const controlPath = await put(temp, `${prefix}/${STARTUP_EXCEPTION_CONTROL}`, JSON.stringify(control));
  const source = await put(temp, `${prefix}/${runtimeInstanceId}${STARTUP_EXCEPTION_SUFFIX}`, JSON.stringify(record));
  for (const patch of [null, { scenarioRunNonce: 'c'.repeat(64) }, { buildRevision: 'd'.repeat(40) },
    { appVersion: '0.2.80' }, { extra: 'not allowed' }]) {
    await writeFile(controlPath, JSON.stringify({ ...control, ...patch }));
    const collected = await collectJobFailureEvidence(env);
    const archive = JSON.parse(gunzipSync(await readFile(collected.archivePath)));
    assert.equal(archive.manifest.files.length, 1);
    const entry = archive.manifest.files[0];
    assert.equal(entry.kind, 'startupException');
    assert.equal(entry.status, patch === null ? 'retained' : 'unverified');
    assert.equal(Object.hasOwn(archive.files, entry.name), patch === null);
    if (patch === null) assert.deepEqual(JSON.parse(Buffer.from(archive.files[entry.name], 'base64')), record);
  }
  assert.deepEqual(JSON.parse(await readFile(source, 'utf8')), record);
});

test('source allowlist excludes databases, requests, config, environment, traces and profiles', () => {
  for (const path of ['eky supervisor abc/result.json', `eky supervisor abc/temporary/eky-acceptance-command-${nativeId}/prepare/result.json`,
    `eky-workspace-caller-${nativeId}/result.json`, `eky-acceptance-command-${nativeId}/prepare/worker-result.json`,
    `eky-t-abc/eky-acceptance-command-${nativeId}/prepare/result.json`,
    `eky supervisor abc/temporary/eky-legacy-caller-${nativeId}/result.json`]) {
    assert.equal(evidenceSourceKind('temporary', path), 'nativeResult');
  }
  for (const path of ['other/result.json', 'eky supervisor abc/request.json', 'eky supervisor abc/runtime-config.json',
    'eky supervisor abc/data.sqlite', 'eky supervisor abc/profiles/result.json',
    'eky supervisor abc/../result.json', 'eky-pnpm-abc/node_modules/result.json',
    'eky supervisor abc/business/result.json', `eky-acceptance-command-${nativeId}/profile/result.json`,
    'eky-workspace-caller-a1/result.json', `eky-t-abc/arbitrary/eky-workspace-caller-${nativeId}/result.json`]) {
    assert.equal(evidenceSourceKind('temporary', path), null);
  }
  assert.equal(evidenceSourceKind('reports', `${run}/results.private.json`), 'playwrightReport');
  assert.equal(evidenceSourceKind('results', `${run}/test-retry1/trace.zip`), null);
  assert.equal(evidenceSourceKind('results', `${run}/test-retry1/data.sqlite`), null);
});

test('binding rejects missing attempts, invalid job names and unknown revisions', () => {
  const env = { GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '1', GITHUB_JOB: 'job',
    EKY_EVIDENCE_JOB_KEY: 'job-0', GITHUB_SHA: 'a'.repeat(40) };
  assert.equal(jobEvidenceBinding(env).attempt, '1');
  for (const [field, value] of [['GITHUB_RUN_ATTEMPT', '0'], ['GITHUB_SHA', 'unknown'],
    ['EKY_EVIDENCE_JOB_KEY', '../job'], ['GITHUB_JOB', 'job\nunsafe']]) {
    assert.throws(() => jobEvidenceBinding({ ...env, [field]: value }), /CI_FAILURE_EVIDENCE_UNVERIFIED/u);
  }
});

test('workspace target installer collection requires exact caller binding and matching retained bytes', async t => {
  const { temp, env, put } = await fixture(t);
  const prefix = `eky-workspace-caller-${nativeId}`;
  const binding = { schemaVersion: 1, invocationId: nativeId, scenario: 'packagedWorkspaceFaultRollback',
    faultScenario: 'passiveWorkspaceMigrationFailure', buildRevision: 'a'.repeat(40),
    artifactDescriptorSha256: 'b'.repeat(64) };
  const bytes = Buffer.from('synthetic MSI action before cancellation\n');
  const receipt = { binding, status: 'retained', bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex') };
  await put(temp, `${prefix}/binding.json`, JSON.stringify(binding));
  await put(temp, `${prefix}/${W6B2_INSTALLER_LOG_RECEIPT}`, JSON.stringify(receipt));
  const source = await put(temp, `${prefix}/${W6B2_INSTALLER_LOG_FILE}`, bytes);
  for (const path of [`${prefix}/profile/${W6B2_INSTALLER_LOG_FILE}`,
    `${prefix}/other.private.log`, `${prefix}/${W6B2_INSTALLER_LOG_FILE}.bak`,
    `eky-workspace-caller-invalid/${W6B2_INSTALLER_LOG_FILE}`]) {
    assert.equal(evidenceSourceKind('temporary', path), null);
    await put(temp, path, 'EXCLUDED');
  }
  const collected = await collectJobFailureEvidence({ ...env, EKY_EVIDENCE_JOB_OUTCOME: 'cancelled' });
  const archive = JSON.parse(gunzipSync(await readFile(collected.archivePath)));
  assert.equal(archive.manifest.jobOutcome, 'cancelled');
  assert.equal(archive.manifest.cleanup, 'notInferred');
  assert.equal(archive.manifest.files.length, 2);
  const entry = archive.manifest.files.find(file => file.source.endsWith('/' + W6B2_INSTALLER_LOG_FILE));
  assert.equal(entry.status, 'retained');
  assert.deepEqual(Buffer.from(archive.files[entry.name], 'base64'), bytes);
  await writeFile(source, 'CHANGED');
  const changed = await collectJobFailureEvidence(env);
  const rejected = JSON.parse(gunzipSync(await readFile(changed.archivePath)));
  const failed = rejected.manifest.files.find(file => file.source.endsWith('/' + W6B2_INSTALLER_LOG_FILE));
  assert.equal(failed.status, 'unverified');
  assert.equal(Object.hasOwn(rejected.files, failed.name), false);
  assert.equal((await readFile(source, 'utf8')), 'CHANGED');
});

for (const bytes of [64 * 1024 * 1024, 64 * 1024 * 1024 + 1]) {
  test(`job collection keeps the 64 MiB cap and receipt binding for a target MSI log: ${bytes}`, async t => {
    const { temp, env, put } = await fixture(t);
    const prefix = `eky-workspace-caller-${nativeId}`;
    const binding = { schemaVersion: 1, invocationId: nativeId, scenario: 'packagedWorkspaceFaultRollback',
      faultScenario: 'passiveWorkspaceMigrationFailure', buildRevision: 'a'.repeat(40),
      artifactDescriptorSha256: 'b'.repeat(64) };
    await put(temp, `${prefix}/binding.json`, JSON.stringify(binding));
    const source = await put(temp, `${prefix}/${W6B2_INSTALLER_LOG_FILE}`, 'synthetic first MSI action');
    const file = await open(source, 'r+');
    try { await file.truncate(bytes); } finally { await file.close(); }
    const expectedHash = createHash('sha256').update(await readFile(source)).digest('hex');
    await put(temp, `${prefix}/${W6B2_INSTALLER_LOG_RECEIPT}`, JSON.stringify({ binding, status: 'retained',
      bytes, sha256: expectedHash }));
    const collected = await collectJobFailureEvidence(env);
    const archive = JSON.parse(gunzipSync(await readFile(collected.archivePath)));
    const entry = archive.manifest.files.find(value => value.source.endsWith('/' + W6B2_INSTALLER_LOG_FILE));
    if (bytes === 64 * 1024 * 1024) {
      assert.equal(entry.status, 'retained');
      const retained = Buffer.from(archive.files[entry.name], 'base64');
      assert.equal(retained.length, bytes);
      assert.equal(createHash('sha256').update(retained).digest('hex'), expectedHash);
    } else {
      assert.equal(entry.status, 'tooLarge');
      assert.equal(Object.hasOwn(archive.files, entry.name), false);
    }
    assert.equal(createHash('sha256').update(await readFile(source)).digest('hex'), expectedHash);
  });
}

test('bound target MSI log cannot exceed the remaining aggregate budget after other evidence', async t => {
  const { temp, env, put } = await fixture(t);
  const prefix = `eky-workspace-caller-${nativeId}`;
  const binding = { schemaVersion: 1, invocationId: nativeId, scenario: 'packagedWorkspaceFaultRollback',
    faultScenario: 'passiveWorkspaceMigrationFailure', buildRevision: 'a'.repeat(40),
    artifactDescriptorSha256: 'b'.repeat(64) };
  await put(temp, `${prefix}/binding.json`, JSON.stringify(binding));
  const source = await put(temp, `${prefix}/${W6B2_INSTALLER_LOG_FILE}`, 'synthetic native MSI log');
  const file = await open(source, 'r+');
  try { await file.truncate(64 * 1024 * 1024); } finally { await file.close(); }
  const hash = createHash('sha256').update(await readFile(source)).digest('hex');
  await put(temp, `${prefix}/${W6B2_INSTALLER_LOG_RECEIPT}`, JSON.stringify({ binding, status: 'retained',
    bytes: 64 * 1024 * 1024, sha256: hash }));
  for (let index = 1; index <= 8; index++) {
    const path = await put(temp, `eky supervisor prior/supervisor-${index}.stdout.private`, 'synthetic output');
    const handle = await open(path, 'r+');
    try { await handle.truncate(64 * 1024 * 1024); } finally { await handle.close(); }
  }
  const newest = new Date(Date.now() + 60_000);
  await utimes(join(temp, 'eky supervisor prior'), newest, newest);
  const collected = await collectJobFailureEvidence(env);
  const retained = collected.manifest.files.filter(value => value.status === 'retained');
  assert.equal(retained.filter(value => value.source.startsWith('temporary/eky supervisor prior/')).length, 8);
  assert.equal(retained.reduce((sum, value) => sum + value.bytes, 0), 512 * 1024 * 1024);
  const rejected = collected.manifest.files.find(value => value.source.endsWith('/' + W6B2_INSTALLER_LOG_FILE));
  assert.equal(rejected.status, 'totalLimit');
  await assert.rejects(readFile(join(collected.root, 'retained', rejected.name)), { code: 'ENOENT' });
  assert.equal(createHash('sha256').update(await readFile(source)).digest('hex'), hash);
});

test('legacy collection admits only the bound cause projection from the existing cleanup terminal file', async t => {
  const { temp, env, put } = await fixture(t);
  const prefix = `eky-acceptance-command-${nativeId}/fixtureCleanup`;
  const terminal = LEGACY_STARTUP_TERMINAL_FILENAME;
  assert.equal(evidenceSourceKind('temporary', `${prefix}/${terminal}`), 'legacyStartupEvidence');
  for (const path of [`${prefix}/${terminal}.bak`, `${prefix}/profile/${terminal}`, `${prefix}/terminal.json`,
    `eky-acceptance-command-${nativeId}/scenario/${terminal}`,
    `eky-acceptance-command-${nativeId}/fixtureCleanup/operational.jsonl`]) {
    assert.equal(evidenceSourceKind('temporary', path), null);
  }
  const binding = { schemaVersion: 1, runNonce: 'b'.repeat(64), scenario: 'acceptanceCommandPhase',
    artifactDescriptorSha256: 'c'.repeat(64) };
  const startupEvidence = { schemaVersion: 1, scenarioRunNonce: 'd'.repeat(64),
    artifactDescriptorSha256: binding.artifactDescriptorSha256,
    targetIdentity: { appVersion: '0.2.7', buildRevision: 'a'.repeat(40) }, status: 'recorded', events: [{
      appVersion: '0.2.7', buildRevision: 'a'.repeat(12), eventName: 'desktop.bootstrapFailed',
      eventId: '12345678-1234-4abc-8abc-1234567890ab', runtimeInstanceId: '22345678-1234-4abc-8abc-1234567890ab',
      timestamp: '2026-09-04T08:00:00.000Z', errorCode: 'PROFILE_SNAPSHOT_VALIDATION_FAILED',
      stage: 'startup', causeStatus: 'recorded',
    }] };
  await put(temp, `${prefix}/${terminal}`, JSON.stringify({ binding, startupEvidence,
    outcome: { errorCode: 'EXCLUDED raw outcome' } }));
  await put(temp, `eky-acceptance-command-${'f'.repeat(32)}/fixtureCleanup/${terminal}`,
    JSON.stringify({ binding, startupEvidence: { ...startupEvidence, password: 'EXCLUDED' }, outcome: {} }));
  await put(temp, `eky-acceptance-command-${'e'.repeat(32)}/fixtureCleanup/${terminal}`,
    `{"binding":${JSON.stringify(binding)},"startupEvidence":${JSON.stringify(startupEvidence)},"outcome":{},"outcome":{}}`);
  const collected = await collectJobFailureEvidence(env);
  const archive = JSON.parse(gunzipSync(await readFile(collected.archivePath)));
  const retained = archive.manifest.files.find(entry => entry.status === 'retained');
  const bytes = Buffer.from(archive.files[retained.name], 'base64');
  assert.equal(retained.kind, 'legacyStartupEvidence');
  assert.equal(retained.projection, 'boundBootstrapCauseAndStageWithoutOutcomeOrProfile');
  assert.deepEqual(JSON.parse(bytes), { binding, startupEvidence });
  assert.equal(bytes.includes(Buffer.from('EXCLUDED')), false);
  assert.equal(archive.manifest.files.filter(entry => entry.status === 'unverified').length, 2);
  assert.equal(Object.keys(archive.files).length, 1);
});

test('legacy packaged failure retains existing smoke output but excludes the profile and backup', async t => {
  const { root, env, put } = await fixture(t);
  const nativeTemp = join(root, 'native');
  await mkdir(nativeTemp);
  const smoke = `eky-desktop-smoke/${nativeId}`;
  const expected = new Map([
    [`${smoke}/result/desktop-smoke-result.json`, Buffer.from('{"status":"failed","stage":"profileComparison"}')],
    [`${smoke}/smoke-output.private.json`, Buffer.from('{"stderr":"synthetic legacy failure"}')],
  ]);
  for (const [path, bytes] of expected) await put(nativeTemp, path, bytes);
  for (const path of ['user-data/runtime/data/eky.sqlite', 'legacy-input/original.ekybackup',
    'legacy-input/identity.json', 'profile-backup-smoke-state.json']) {
    await put(nativeTemp, `${smoke}/${path}`, 'EXCLUDED-LEGACY-CONTENT');
  }
  const collected = await collectJobFailureEvidence(env, { nativeTemp });
  const archive = JSON.parse(gunzipSync(await readFile(collected.archivePath)));
  assert.equal(archive.manifest.files.length, expected.size);
  for (const entry of archive.manifest.files) {
    assert.equal(entry.kind, 'packagedSmoke');
    assert.equal(entry.location, 'nativeTemp');
    assert.equal(entry.status, 'retained');
    const bytes = Buffer.from(archive.files[entry.name], 'base64');
    assert.deepEqual(bytes, expected.get(entry.source.slice('temporary/'.length)));
    assert.equal(bytes.includes(Buffer.from('EXCLUDED-LEGACY-CONTENT')), false);
  }
});

test('named sandbox probe preserves only its prepared bounded native failure evidence', async t => {
  const { checkout, temp, env, put } = await fixture(t);
  const evidence = { operation: 'linuxProfileInspection', status: 'failed', phase: 'preparation',
    causeCode: 'PROFILE_INSPECTION_NATIVE_BUILD_FAILED', nativeCompilationEvidence: {
      status: 'retained', complete: true, sourceBytes: 28, retainedBytes: 28,
      prefixBase64: Buffer.from('synthetic native build error!').toString('base64'), suffixBase64: '' } };
  const bytes = Buffer.from(JSON.stringify(evidence));
  await put(checkout, `eky_software/apps/e2e/test-results/${run}/preparation/process-output.private.json`, bytes);
  for (const name of ['build.private.log', 'source/data.sqlite', 'runtime/config.json']) {
    await put(temp, `eky-inspection-native-ABC123/inspection-native-DEF456/${name}`, 'EXCLUDED');
  }
  const selected = { ...env, GITHUB_JOB: 'linux-inspection-sandbox-probe', EKY_EVIDENCE_JOB_KEY: 'k-linux-sandbox-probe' };
  const collected = await collectJobFailureEvidence(selected);
  const archive = JSON.parse(gunzipSync(await readFile(collected.archivePath)));
  assert.deepEqual(archive.manifest.approvedExceptions, ['boundedNativeBuildFailure']);
  assert.ok(archive.manifest.exclusions.includes('unapprovedDependencyToolRawOutput'));
  assert.equal(archive.manifest.files.length, 1);
  const retained = archive.manifest.files[0];
  assert.equal(retained.kind, 'processOutput');
  assert.equal(retained.status, 'retained');
  assert.deepEqual(Buffer.from(archive.files[retained.name], 'base64'), bytes);
  assert.equal(Buffer.from(archive.files[retained.name], 'base64').includes(Buffer.from('EXCLUDED')), false);
  const normal = await collectJobFailureEvidence(env);
  assert.equal(Object.hasOwn(normal.manifest, 'approvedExceptions'), false);
  assert.ok(normal.manifest.exclusions.includes('dependencyToolRawOutput'));
  assert.equal(normal.manifest.files[0].status, 'unverified');
});

test('Windows preparation compiler evidence requires the current named job and generation', async t => {
  const { checkout, env, put } = await fixture(t);
  const selected = { ...env, GITHUB_JOB: 'e2e-electron-windows-critical' };
  const record = { schemaVersion: 1, operation: 'electronE2ePreparation', status: 'failed', phase: 'nativeCompilation',
    causeCode: 'PROFILE_INSPECTION_NATIVE_BUILD_FAILED', invocationId: run.slice(4), binding: jobEvidenceBinding(selected),
    nativeCompilationEvidence: { status: 'retained', complete: true, sourceBytes: 29, retainedBytes: 29,
      prefixBase64: Buffer.from('synthetic native build error!').toString('base64'), suffixBase64: '' } };
  const path = await put(checkout, `eky_software/apps/e2e/test-results/${run}/preparation/process-output.private.json`,
    JSON.stringify(record));
  for (const patch of [null, { invocationId: 'b'.repeat(36) }, { binding: { ...record.binding, attempt: '2' } },
    { binding: { ...record.binding, sourceRevision: 'b'.repeat(40) } }, { extra: 'EXCLUDED' },
    { nativeCompilationEvidence: { ...record.nativeCompilationEvidence, retainedBytes: 65537 } }]) {
    await writeFile(path, JSON.stringify({ ...record, ...patch }));
    const collected = await collectJobFailureEvidence(selected);
    const archive = JSON.parse(gunzipSync(await readFile(collected.archivePath)));
    const [entry] = archive.manifest.files;
    assert.deepEqual(archive.manifest.approvedExceptions, ['boundedNativeBuildFailure']);
    assert.equal(entry.status, patch === null ? 'retained' : 'unverified');
    assert.equal(Object.hasOwn(archive.files, entry.name), patch === null);
    if (patch === null) assert.deepEqual(JSON.parse(Buffer.from(archive.files[entry.name], 'base64')), record);
  }
  await writeFile(path, JSON.stringify(record));
  for (const patch of [{ GITHUB_JOB: 'other' }, { EKY_EVIDENCE_JOB_KEY: 'other' }]) {
    const rejected = await collectJobFailureEvidence({ ...selected, ...patch });
    assert.equal(rejected.manifest.files[0].status, 'unverified');
  }
  await put(checkout, `eky_software/apps/e2e/test-results/${run}/unreviewed-case/process-output.private.json`, JSON.stringify(record));
  const misplaced = await collectJobFailureEvidence(selected);
  assert.equal(misplaced.manifest.files.find(entry => entry.source.includes('/unreviewed-case/')).status, 'unverified');
  await writeFile(path, JSON.stringify(record).padEnd(96 * 1024 + 1, ' '));
  const oversized = await collectJobFailureEvidence(selected);
  assert.equal(oversized.manifest.files.find(entry => entry.source.includes('/preparation/')).status, 'tooLarge');
});

test('Electron lifecycle collection admits only the named attempt file', () => {
  assert.equal(evidenceSourceKind('results', `${run}/test-attempt0/electron-lifecycle.json`), 'electronLifecycle');
  for (const area of ['reports', 'temporary']) {
    assert.equal(evidenceSourceKind(area, `${run}/test-attempt0/electron-lifecycle.json`), null);
  }
  for (const path of [`${run}/electron-lifecycle.json`, 'other/test/electron-lifecycle.json',
    `${run}/test/electron-lifecycle.private.json`, `${run}/test/electron-lifecycle.json.bak`,
    `${run}/test/attachments/electron-lifecycle.json`, `${run}/../electron-lifecycle.json`,
    `${run}/./electron-lifecycle.json`, `${run}/test/config.json`, `${run}/test/trace.zip`]) {
    assert.equal(evidenceSourceKind('results', path), null);
  }
});

test('Electron lifecycle collection preserves first failure, retry and ownership as separate evidence', async t => {
  const { checkout, env, put } = await fixture(t);
  const root = `eky_software/apps/e2e/test-results/${run}`;
  const common = { schemaVersion: 1, observationsTruncated: false,
    startupCapture: { status: 'notRequested' },
    ownership: { owner: { status: 'processTreeAbsent', firstFailure: null },
      bridge: 'closed', observerFailure: null, launchFailure: false, goSent: true, bridgeExit: 'matched' } };
  const first = { ...common, attempt: 0, launch: [{ generation: 2, phase: 'connected' }],
    publicCloseFailure: { startupGeneration: 2, reason: 'timedOut' },
    cleanup: { api: 'completed', runtime: 'unverified', port: 'released', runRoot: 'retained' } };
  const retry = { ...common, attempt: 1, launch: [{ generation: 1, phase: 'connected' }],
    cleanup: { api: 'completed', runtime: 'completed', port: 'released', runRoot: 'removed' } };
  const expected = new Map();
  for (const [directory, content] of [['test-attempt0', first], ['test-retry1', retry]]) {
    const source = `results/${run}/${directory}/electron-lifecycle.json`;
    const bytes = Buffer.from(JSON.stringify(content, null, 2) + '\n');
    expected.set(source, bytes);
    await put(checkout, `${root}/${directory}/electron-lifecycle.json`, bytes);
  }
  for (const file of ['test-attempt0/data.sqlite', 'test-attempt0/config.json',
    'test-attempt0/attachments/electron-lifecycle.json', 'profiles/electron-lifecycle.json']) {
    await put(checkout, `${root}/${file}`, 'EXCLUDED');
  }
  const collected = await collectJobFailureEvidence(env);
  const archive = JSON.parse(gunzipSync(await readFile(collected.archivePath)));
  assert.equal(archive.manifest.files.length, 2);
  assert.equal(archive.manifest.cleanup, 'notInferred');
  assert.equal(archive.manifest.unresolvedEvidenceHold, true);
  for (const entry of archive.manifest.files) {
    assert.equal(entry.kind, 'electronLifecycle');
    assert.equal(entry.status, 'retained');
    const bytes = Buffer.from(archive.files[entry.name], 'base64');
    assert.deepEqual(bytes, expected.get(entry.source));
    assert.equal(entry.bytes, bytes.length);
    assert.equal(entry.sha256, createHash('sha256').update(bytes).digest('hex'));
    expected.delete(entry.source);
  }
  assert.equal(expected.size, 0);
});

test('Electron lifecycle collection retains existing size and hardlink rejection', async t => {
  const { checkout, env, put } = await fixture(t);
  const root = `eky_software/apps/e2e/test-results/${run}`;
  await put(checkout, `${root}/large/electron-lifecycle.json`, Buffer.alloc(64 * 1024 * 1024 + 1));
  const original = await put(checkout, `${root}/linked/electron-lifecycle.json`, 'EXCLUDED-LINK');
  await link(original, join(checkout, 'alias.json'));
  const collected = await collectJobFailureEvidence(env);
  const archive = JSON.parse(gunzipSync(await readFile(collected.archivePath)));
  assert.equal(archive.manifest.files.length, 2);
  assert.equal(archive.manifest.files.find(file => file.source.includes('/large/')).status, 'tooLarge');
  assert.equal(archive.manifest.files.find(file => file.source.includes('/linked/')).status, 'unverified');
  assert.deepEqual(archive.files, {});
});

test('Electron lifecycle collection never follows an attempt directory outside the checkout', async t => {
  const { root, checkout, env, put } = await fixture(t);
  await put(root, 'outside/electron-lifecycle.json', 'EXCLUDED-OUTSIDE');
  const results = join(checkout, 'eky_software/apps/e2e/test-results', run);
  await mkdir(results, { recursive: true });
  await symlink(join(root, 'outside'), join(results, 'test-attempt0'), process.platform === 'win32' ? 'junction' : 'dir');
  const collected = await collectJobFailureEvidence(env);
  const archive = JSON.parse(gunzipSync(await readFile(collected.archivePath)));
  assert.equal(archive.manifest.files.length, 0);
  assert.equal(archive.manifest.sources.find(source => source.area === 'results').status, 'partial');
  assert.deepEqual(archive.files, {});
});

test('MSI policy evidence admits only its named files in the supervisor-owned root', () => {
  for (const name of ['policy-result.json', '1-source.log', '12-target.log', '23-uninstall.log']) {
    assert.equal(evidenceSourceKind('temporary', `eky supervisor abc/${name}`), 'msiPolicyEvidence');
    assert.equal(evidenceSourceKind('results', `eky supervisor abc/${name}`), null);
    assert.equal(evidenceSourceKind('temporary', `other/${name}`), null);
    assert.equal(evidenceSourceKind('temporary', `eky supervisor abc/profiles/${name}`), null);
  }
  for (const name of ['source.log', '0-source.log', '01-source.log', '1-source.log.bak',
    '1-files.json', '1-product.json', '1-arbitrary.log', 'descriptor.json', 'request.json',
    'policy-result.json.tmp', 'fixture/policy-result.json', '../1-source.log']) {
    assert.equal(evidenceSourceKind('temporary', `eky supervisor abc/${name}`), null);
  }
});

test('MSI failure evidence preserves log bytes and separate cleanup even without a worker result', async t => {
  const { temp, env, put } = await fixture(t);
  const source = Buffer.from('\uFEFFMSI synthetic source failure\r\n', 'utf16le');
  await put(temp, 'eky supervisor failed/1-source.log', source);
  await put(temp, 'eky supervisor failed/2-uninstall.log', 'synthetic cleanup completed');
  await put(temp, 'eky supervisor failed/policy-result.json', '{"result":{"status":"failed","cleanupStatus":"completed"}}');
  // A killed worker may leave only its in-progress log, not a terminal result.
  await put(temp, 'eky supervisor interrupted/1-source.log', 'partial synthetic log');
  await put(temp, 'eky supervisor failed/fixture/descriptor.json', 'EXCLUDED-DESCRIPTOR');
  await put(temp, 'eky supervisor failed/request.json', 'EXCLUDED-REQUEST');
  const collected = await collectJobFailureEvidence(env);
  const archive = JSON.parse(gunzipSync(await readFile(collected.archivePath)));
  assert.equal(archive.manifest.files.length, 4);
  assert.equal(archive.manifest.cleanup, 'notInferred');
  for (const entry of archive.manifest.files) {
    assert.equal(entry.status, 'retained');
    assert.equal(entry.kind, 'msiPolicyEvidence');
    const bytes = Buffer.from(archive.files[entry.name], 'base64');
    assert.equal(createHash('sha256').update(bytes).digest('hex'), entry.sha256);
    assert.equal(bytes.includes(Buffer.from('EXCLUDED')), false);
  }
  const entry = archive.manifest.files.find(file => file.source.endsWith('failed/1-source.log'));
  assert.deepEqual(Buffer.from(archive.files[entry.name], 'base64'), source);
  assert.ok(archive.manifest.files.some(file => file.source.endsWith('interrupted/1-source.log')));
});

test('ordinary MSI logs retain all bytes at the shared 64 MiB boundary', async t => {
  const { temp, env, put } = await fixture(t);
  const source = await put(temp, 'eky supervisor sample/1-source.log', 'synthetic MSI first action');
  const handle = await open(source, 'r+');
  try { await handle.truncate(64 * 1024 * 1024); } finally { await handle.close(); }
  const collected = await collectJobFailureEvidence(env);
  const archive = JSON.parse(gunzipSync(await readFile(collected.archivePath)));
  const entry = archive.manifest.files.find(file => file.source.endsWith('1-source.log'));
  assert.equal(entry.status, 'retained');
  const retained = Buffer.from(archive.files[entry.name], 'base64');
  assert.equal(retained.length, 64 * 1024 * 1024);
  assert.equal(createHash('sha256').update(retained).digest('hex'), entry.sha256);
  assert.equal(createHash('sha256').update(await readFile(source)).digest('hex'), entry.sha256);
});

test('a report above the previous 8 MiB cap retains failure fields but not config or inline content', async t => {
  const { checkout, env, put } = await fixture(t);
  const message = 'synthetic failure\n' + 'x'.repeat(9 * 1024 * 1024);
  await put(checkout, `eky_software/apps/e2e/playwright-report/${run}/results.private.json`,
    JSON.stringify({ config: { secret: 'EXCLUDED' }, errors: [{ message }],
      suites: [{ specs: [{ tests: [{ results: [{ retry: 0,
        attachments: [{ name: 'inline', body: 'EXCLUDED' }] }] }] }] }] }));
  const collected = await collectJobFailureEvidence(env);
  const archive = JSON.parse(gunzipSync(await readFile(collected.archivePath)));
  const entry = archive.manifest.files.find(file => file.kind === 'playwrightReport');
  assert.equal(entry.status, 'retained');
  assert.ok(entry.bytes > 8 * 1024 * 1024);
  const retained = Buffer.from(archive.files[entry.name], 'base64');
  assert.equal(createHash('sha256').update(retained).digest('hex'), entry.sha256);
  assert.equal(JSON.parse(retained).errors[0].message, message);
  assert.equal(retained.includes(Buffer.from('EXCLUDED')), false);
});

test('MSI logs keep size and hardlink rejection at the approved 64 MiB boundary', async t => {
  const { temp, env, put } = await fixture(t);
  await put(temp, 'eky supervisor sample/1-source.log', Buffer.alloc(64 * 1024 * 1024 + 1));
  const linked = await put(temp, 'eky supervisor sample/2-target.log', 'not safe to copy');
  await link(linked, join(temp, 'eky supervisor sample/3-uninstall.log'));
  const { manifest } = await collectJobFailureEvidence(env);
  assert.equal(manifest.files.length, 3);
  assert.equal(manifest.files.find(file => file.source.endsWith('1-source.log')).status, 'tooLarge');
  assert.ok(manifest.files.filter(file => !file.source.endsWith('1-source.log'))
    .every(file => file.status === 'unverified'));
});

test('first-failure bytes from different families and attempts survive collection without DB content', async t => {
  const { temp, checkout, env, put } = await fixture(t);
  await put(temp, `eky supervisor abc/temporary/eky-acceptance-command-${nativeId}/prepare/result.json`, '{"cleanupWin32ErrorCode":5}');
  await put(temp, 'eky supervisor abc/data.sqlite', 'DO-NOT-COLLECT-DATABASE');
  await put(temp, 'eky-pnpm-abc/bootstrap-failure.private.json', '{"stderr":"EXCLUDED-DEPENDENCY-TOOL"}');
  await put(checkout, `eky_software/apps/e2e/playwright-report/${run}/results.private.json`,
    JSON.stringify({ config: { webServer: { env: { PASSWORD: 'EXCLUDED-CONFIG' } } }, errors: [],
      suites: [{ specs: [{ tests: [{ results: [{ retry: 0, error: { message: 'first failure' } },
        { retry: 1, status: 'passed' }] }] }] }] }));
  const collected = await collectJobFailureEvidence(env);
  const decoded = JSON.parse(gunzipSync(await readFile(collected.archivePath)));
  assert.equal(decoded.manifest.jobOutcome, 'failure');
  assert.equal(decoded.manifest.cleanup, 'notInferred');
  assert.equal(decoded.manifest.unresolvedEvidenceHold, true);
  assert.equal(decoded.manifest.files.length, 2);
  for (const entry of decoded.manifest.files) {
    assert.equal(entry.status, 'retained');
    const bytes = Buffer.from(decoded.files[entry.name], 'base64');
    assert.equal(bytes.length, entry.bytes);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), entry.sha256);
    assert.equal(bytes.includes(Buffer.from('DO-NOT-COLLECT')), false);
    assert.equal(bytes.includes(Buffer.from('EXCLUDED-DEPENDENCY-TOOL')), false);
    assert.equal(bytes.includes(Buffer.from('EXCLUDED-CONFIG')), false);
  }
  const reportFile = decoded.manifest.files.find(file => file.kind === 'playwrightReport');
  const report = JSON.parse(Buffer.from(decoded.files[reportFile.name], 'base64'));
  assert.deepEqual(report.suites[0].specs[0].tests[0].results.map(result => result.retry), [0, 1]);
  assert.equal(report.suites[0].specs[0].tests[0].results[0].error.message, 'first failure');
  const again = await collectJobFailureEvidence({ ...env, GITHUB_RUN_ATTEMPT: '2' });
  assert.notEqual(collected.root, again.root);
  assert.equal(JSON.parse(gunzipSync(await readFile(collected.archivePath))).manifest.binding.attempt, '1');
});

test('report projection retains original failure fields but excludes configuration and inline attachments', () => {
  const error = { message: 'first failure', stack: 'synthetic stack', snippet: 'assert(false)' };
  const result = { retry: 0, error, errors: [error], stderr: [{ text: 'synthetic stderr' }],
    status: 'failed', steps: [{ title: 'nested', error }],
    attachments: [{ name: 'unreviewed', contentType: 'binary', path: '/synthetic/file', body: 'EXCLUDED-BODY' }] };
  const projected = projectPlaywrightFailureReport({ config: { env: { secret: 'EXCLUDED-CONFIG' } },
    metadata: 'EXCLUDED-METADATA', errors: [error],
    suites: [{ specs: [{ tests: [{ results: [result] }] }] }] });
  const saved = projected.suites[0].specs[0].tests[0].results[0];
  assert.deepEqual(saved.error, error);
  assert.deepEqual(saved.stderr, result.stderr);
  assert.deepEqual(saved.steps, result.steps);
  assert.equal(saved.attachments[0].body, undefined);
  assert.equal(JSON.stringify(projected).includes('EXCLUDED'), false);
  assert.throws(() => projectPlaywrightFailureReport({}), /REPORT_INVALID/u);
});

test('missing data is explicit, not a successful test or verified cleanup', async t => {
  const { env } = await fixture(t);
  const { manifest } = await collectJobFailureEvidence(env);
  assert.equal(manifest.files.length, 0);
  assert.equal(manifest.sources.find(source => source.area === 'reports').status, 'missing');
  assert.equal(manifest.cleanup, 'notInferred');
  assert.equal(manifest.publicCommandLog, 'githubWorkflowLog');
});

test('OS-native temporary roots are collected separately from runner staging', async t => {
  const { root, temp, env, put } = await fixture(t);
  const nativeTemp = join(root, 'native');
  await mkdir(nativeTemp);
  await put(temp, 'eky supervisor abc/result.json', '{"location":"runner"}');
  await put(nativeTemp, `eky-t-def/eky-workspace-caller-${nativeId}/result.json`, '{"location":"native"}');
  await put(nativeTemp, 'eky-t-def/profile/result.json', 'EXCLUDED-PROFILE');
  const { manifest } = await collectJobFailureEvidence(env, { nativeTemp });
  assert.equal(manifest.files.length, 2);
  assert.deepEqual(manifest.files.map(file => file.location).sort(), ['nativeTemp', 'runnerTemp']);
  assert.ok(manifest.files.every(file => file.status === 'retained'));
  assert.equal(manifest.sources.find(source => source.location === 'nativeTemp').status, 'complete');
});

test('older native results cannot evict reports or the latest failed native root', async t => {
  const { env, temp, checkout, put } = await fixture(t);
  for (let index = 0; index < 256; index++) {
    await put(temp, `eky supervisor old${index}/result.json`, '{"earlier":true}');
    await utimes(join(temp, `eky supervisor old${index}`), new Date(0), new Date(0));
  }
  await put(temp, 'eky supervisor latest/result.json', '{"firstFailure":"newest"}');
  await put(checkout, `eky_software/apps/e2e/playwright-report/${run}/results.private.json`, '{"suites":[],"errors":[]}');
  await put(checkout, `eky_software/apps/e2e/test-results/${run}/failed-attempt0/process-output.private.json`, '{"stderr":"first failure"}');
  const { manifest } = await collectJobFailureEvidence(env);
  assert.ok(manifest.files.some(file => file.kind === 'playwrightReport' && file.status === 'retained'));
  assert.ok(manifest.files.some(file => file.kind === 'processOutput' && file.status === 'retained'));
  assert.ok(manifest.files.some(file => file.source.endsWith('latest/result.json') && file.status === 'retained'));
  assert.equal(manifest.sources.find(source => source.area === 'temporary').status, 'limited');
  assert.ok(manifest.files.length <= 256);
});

test('unrelated temporary names do not consume the eligible evidence search budget', async t => {
  const { env, temp, put } = await fixture(t);
  for (let index = 0; index < 4100; index++) await writeFile(join(temp, `unrelated-${index}`), 'excluded');
  await put(temp, 'eky supervisor latest/result.json', '{"firstFailure":true}');
  const { manifest } = await collectJobFailureEvidence(env);
  assert.equal(manifest.files.length, 1);
  assert.equal(manifest.files[0].status, 'retained');
  assert.ok(manifest.sources.find(source => source.area === 'temporary').examinedEntries < 10);
});

test('oversized and hardlinked evidence is rejected without copying unrelated files', async t => {
  const { env, temp, put } = await fixture(t);
  const large = await put(temp, 'eky supervisor abc/result.json', Buffer.alloc(64 * 1024 * 1024 + 1));
  await link(large, join(temp, 'eky supervisor abc/worker-result.json'));
  const { manifest } = await collectJobFailureEvidence(env);
  assert.equal(manifest.files.length, 2);
  assert.ok(manifest.files.every(entry => entry.status === 'unverified'));
  await put(temp, 'eky supervisor def/result.json', Buffer.alloc(64 * 1024 * 1024 + 1));
  const another = await collectJobFailureEvidence(env);
  assert.ok(another.manifest.files.some(entry => entry.status === 'tooLarge'));
});

test('symlink source cannot import a file outside its declared root', async t => {
  const { root, temp, env, put } = await fixture(t);
  const outside = await put(root, 'outside.json', 'PRIVATE-OUTSIDE');
  await mkdir(join(temp, 'eky supervisor abc'));
  try { await symlink(outside, join(temp, 'eky supervisor abc/result.json')); }
  catch (error) { if (error.code === 'EPERM') { t.skip('Symlink creation not available'); return; } throw error; }
  const collected = await collectJobFailureEvidence(env);
  assert.equal(collected.manifest.files[0].status, 'unverified');
  const decoded = gunzipSync(await readFile(collected.archivePath)).toString();
  assert.equal(decoded.includes(Buffer.from('PRIVATE-OUTSIDE').toString('base64')), false);
});

test('a redirected native directory is not traversed or reported as complete', async t => {
  const { root, temp, env, put } = await fixture(t);
  await put(root, 'outside/result.json', 'EXCLUDED-JUNCTION');
  await symlink(join(root, 'outside'), join(temp, 'eky supervisor alias'), process.platform === 'win32' ? 'junction' : 'dir');
  const { manifest } = await collectJobFailureEvidence(env);
  assert.equal(manifest.files.length, 0);
  assert.equal(manifest.sources.find(source => source.area === 'temporary').status, 'partial');
});

test('an unconfirmed encryption recipient prevents even plaintext staging', async t => {
  const { env } = await fixture(t);
  await assert.rejects(collectJobFailureEvidence({ ...env, EKY_DIAGNOSTIC_VERIFIED_FINGERPRINT: '' }),
    /WORKSPACE_ENCRYPTED_EVIDENCE_UNVERIFIED/u);
});

test('hosted proof entrypoint produces a real first failure, not only a fabricated result', async t => {
  const { env, temp, root } = await fixture(t);
  const output = join(root, 'github-output');
  await writeFile(output, '');
  const child = spawnSync(process.execPath, [resolve(import.meta.dirname, '../../../../../.github/scripts/ciFailureEvidenceProbe.mjs')], {
    env: { ...process.env, ...env, GITHUB_ACTIONS: 'true', RUNNER_ENVIRONMENT: 'github-hosted',
      GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_OUTPUT: output, TMP: temp, TEMP: temp, TMPDIR: temp },
    encoding: 'utf8', timeout: 10000, maxBuffer: 4096, windowsHide: true,
  });
  assert.equal(child.error, undefined);
  assert.equal(child.signal, null);
  assert.equal(child.status, 19);
  assert.equal(child.stdout.trim(), 'CI_FAILURE_EVIDENCE_PROBE_EXPECTED_FAILURE');
  assert.equal(child.stderr, '');
  assert.equal(await readFile(output, 'utf8'), 'probe_verified=true\n');
  const collected = await collectJobFailureEvidence(env);
  const archive = JSON.parse(gunzipSync(await readFile(collected.archivePath)));
  assert.equal(archive.manifest.files.length, 2);
  const entry = archive.manifest.files.find(file => file.source.endsWith('/ci-step.stderr.private'));
  assert.equal(Buffer.from(archive.files[entry.name], 'base64').toString(), 'SYNTHETIC_FIRST_FAILURE_PRIVATE\n');
});

test('job CLI rejects untrusted context before publishing or staging evidence', { skip: !['win32', 'linux'].includes(process.platform) }, async t => {
  const { env, temp, root } = await fixture(t);
  const workspace = resolve(import.meta.dirname, '../../../../..');
  const head = spawnSync(process.platform === 'win32' ? 'git.exe' : 'git', ['rev-parse', 'HEAD'], { cwd: workspace, encoding: 'utf8', timeout: 10000 });
  assert.equal(head.status, 0);
  const revision = head.stdout.trim();
  const eventPath = join(root, 'event.json');
  const outputPath = join(root, 'output.txt');
  const event = JSON.stringify({ pull_request: { head: { repo: { full_name: 'synthetic/repo' } } } });
  for (const [payload, patch] of [
    [event, { RUNNER_ENVIRONMENT: 'self-hosted' }],
    [event, { RUNNER_OS: process.platform === 'win32' ? 'Linux' : 'Windows' }],
    [event, { GITHUB_EVENT_NAME: 'pull_request_target' }],
    ['{}', {}],
    [JSON.stringify({ pull_request: { head: { repo: { full_name: 'untrusted/fork' } } } }), {}],
    ['{malformed', {}],
    [' '.repeat(2 * 1024 * 1024 + 1), {}],
    [event, { GITHUB_SHA: revision[0] === 'a' ? 'b'.repeat(40) : 'a'.repeat(40) }],
    [event, { EKY_DIAGNOSTIC_VERIFIED_FINGERPRINT: '' }],
  ]) {
    await writeFile(eventPath, payload); await writeFile(outputPath, 'existing=value\n');
    const child = spawnSync(process.execPath, [resolve(import.meta.dirname, 'ciFailureEvidence.mjs')], {
      env: { ...process.env, ...env, GITHUB_ACTIONS: 'true', RUNNER_OS: process.platform === 'win32' ? 'Windows' : 'Linux', RUNNER_ENVIRONMENT: 'github-hosted',
        GITHUB_EVENT_NAME: 'pull_request', GITHUB_REPOSITORY: 'synthetic/repo', GITHUB_SHA: revision,
        GITHUB_WORKSPACE: workspace, GITHUB_OUTPUT: outputPath, GITHUB_EVENT_PATH: eventPath, ...patch },
      encoding: 'utf8', timeout: 15000, maxBuffer: 4096, windowsHide: true,
    });
    assert.equal(child.error, undefined);
    assert.equal(child.status, 1);
    assert.equal(child.stdout, '');
    assert.equal(child.stderr.trim(), 'CI_FAILURE_EVIDENCE_UNVERIFIED');
    assert.equal(await readFile(outputPath, 'utf8'), 'existing=value\n');
  }
  const { readdir } = await import('node:fs/promises');
  assert.deepEqual(await readdir(temp), []);
});
